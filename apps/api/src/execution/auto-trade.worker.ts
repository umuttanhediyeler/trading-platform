import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { BrokerOrderService } from '../broker/broker-order.service';
import { BrokerRegistry } from '../broker/broker-registry.service';
import { AlertsService } from '../common/alerts.service';
import { decryptSecret } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { bullmqConnection } from '../common/bullmq-redis';
import {
  computePositionSizeDetailed,
  tradeQualityScore,
} from './position-sizing';
import { computeRiskTargets, inferSignalSide } from './risk-targets';

export const AUTO_TRADE_QUEUE = 'auto-trade';

/** US cash equity regular session (Mon–Fri 09:30–16:00 America/New_York). */
export function isUsEquityRegularHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // Intl may emit "24" for midnight in some engines.
  const h = hour === 24 ? 0 : hour;
  const mins = h * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/**
 * Full-auto execution: every minute, look for recent open AI signals and
 * submit paper/live broker orders for users in full_auto mode who pass
 * risk checks. Idempotent via clientOrderId = signalId:userId.
 */
@Injectable()
export class AutoTradeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoTradeWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly orders: BrokerOrderService,
    private readonly alerts: AlertsService,
    private readonly registry: BrokerRegistry,
  ) {}

  async onModuleInit() {
    if (this.config.get('DISABLE_WORKERS') === 'true') return;
    const connection = this.connectionOptions();
    this.queue = new Queue(AUTO_TRADE_QUEUE, { connection });
    this.worker = new Worker(AUTO_TRADE_QUEUE, async () => this.tick(), {
      connection,
    });
    this.worker.on('failed', (_job, err) => {
      this.logger.warn(`Auto-trade tick failed: ${err.message}`);
      void this.alerts.send('execution.auto_trade_worker_failed', 'critical', {
        message: err.message,
      });
    });
    await this.queue
      .add(
        'auto-trade-tick',
        {},
        { repeat: { pattern: '* * * * *' }, removeOnComplete: 50, removeOnFail: 50 },
      )
      .catch((err) =>
        this.logger.warn(`Could not schedule auto-trade: ${err.message}`),
      );
  }

  async tick() {
    const users = await this.prisma.user.findMany({
      where: {
        executionMode: 'full_auto',
        subscription: {
          planTier: 'premium',
          status: { in: ['active', 'trialing'] },
        },
        brokerLink: { isNot: null },
        riskSettings: { killSwitchActive: false },
      },
      include: { brokerLink: true, riskSettings: true },
    });
    if (users.length === 0) return;

    const encKey = this.config.get<string>('ENCRYPTION_KEY', '');
    if (!encKey) return;

    const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const signals = await this.prisma.signal.findMany({
      where: { status: 'open', generatedAt: { gte: since } },
      orderBy: { generatedAt: 'desc' },
      take: 40,
    });

    for (const user of users) {
      try {
        if (!user.brokerLink) continue;
        if (!this.registry.isSupported(user.brokerLink.broker)) {
          this.logger.error(
            `Auto-trade skipped unsupported broker ${user.brokerLink.broker} for user ${user.id}`,
          );
          continue;
        }

        const creds = {
          broker: user.brokerLink.broker,
          apiKey: decryptSecret(user.brokerLink.apiKeyEnc, encKey),
          apiSecret: decryptSecret(user.brokerLink.apiSecretEnc, encKey),
          mode: user.brokerLink.mode as 'paper' | 'live',
        };

        await this.orders.reconcile(user.id, creds).catch((err) =>
          this.logger.warn(
            `Auto-trade reconcile failed for ${user.id}: ${(err as Error).message}`,
          ),
        );
        await this.recoverStuckPending(user.id, creds);
        // Take-profit / stop exits first so capital frees before new entries.
        await this.closeResolvedLongs(user.id, creds);
        await this.closeLongsAtTargets(user.id, creds);
        await this.protectNakedLongs(user.id, creds);

        // New entries only in US cash equity RTH — overnight market/bracket
        // day orders sit as "new" with no position (Alpaca recent orders ≠ positions).
        if (!isUsEquityRegularHours()) {
          this.logger.debug(
            `Auto-trade entries skipped outside US RTH for ${user.id}`,
          );
          continue;
        }

        let equity = 100_000;
        let currentExposure = 0;
        try {
          const balance = await this.registry
            .get(creds.broker)
            .getAccountBalance(creds);
          const parsed = Number(balance.equity);
          if (Number.isFinite(parsed) && parsed > 0) equity = parsed;
        } catch {
          const sim = await this.prisma.simulatedAccount.findUnique({
            where: { userId: user.id },
            select: { balance: true },
          });
          const simBal = Number(sim?.balance ?? 0);
          if (simBal > 0) equity = simBal;
        }
        let heldSymbols = new Set<string>();
        try {
          const positions = await this.registry
            .get(creds.broker)
            .getPositions(creds);
          currentExposure = positions
            .filter((p) => p.quantity > 0)
            .reduce(
              (sum, p) => sum + Math.abs(Number(p.marketValue) || 0),
              0,
            );
          heldSymbols = new Set(
            positions.filter((p) => p.quantity > 0).map((p) => p.symbol),
          );
        } catch {
          // Sizing falls back to risk-only caps when positions unavailable.
        }

        const maxExposure = equity * 0.7;
        if (currentExposure >= maxExposure) {
          this.logger.log(
            `Auto-trade book full for ${user.id}: $${currentExposure.toFixed(0)} / $${maxExposure.toFixed(0)}`,
          );
          continue;
        }

        // Best setups claim capital first when the book is filling up.
        const ranked = [...signals]
          .map((signal) => {
            const entry = Number(signal.entryPrice);
            const side = inferSignalSide(
              entry,
              Number(signal.stopPrice),
              Number(signal.targetPrice),
            );
            if (side !== 'buy' || !(entry > 0)) return null;
            if (heldSymbols.has(signal.symbol.toUpperCase())) return null;
            const maxRisk = user.riskSettings?.maxRiskPerTrade ?? 2;
            const targets = computeRiskTargets({
              entry,
              strategyId: signal.strategyId,
              maxRiskPerTrade: maxRisk,
              confidence: signal.confidence,
              side: 'buy',
            });
            return {
              signal,
              entry,
              maxRisk,
              stop: targets.stopPrice,
              target: targets.targetPrice,
              quality: tradeQualityScore({
                entryPrice: entry,
                stopPrice: targets.stopPrice,
                targetPrice: targets.targetPrice,
                confidence: signal.confidence,
              }),
            };
          })
          .filter((row): row is NonNullable<typeof row> => row != null)
          .sort((a, b) => b.quality - a.quality);

        let stopNewEntries = false;
        let placedThisTick = 0;
        for (const row of ranked) {
          if (stopNewEntries || placedThisTick >= 5) break;
          const { signal, entry, maxRisk, stop, target } = row;

          // Idempotent by signal, not by truncated clientOrderId.
          const openForSignal = await this.prisma.brokerOrderLedger.findFirst({
            where: {
              userId: user.id,
              signalId: signal.id,
              side: 'buy',
              status: { in: ['pending', 'submitted'] },
            },
            select: { id: true },
          });
          if (openForSignal) continue;

          try {
            const sized = computePositionSizeDetailed({
              equity,
              entryPrice: entry,
              stopPrice: stop,
              targetPrice: target,
              confidence: signal.confidence,
              maxRiskPerTrade: maxRisk,
              currentExposure,
            });
            const qty = sized.qty;
            if (qty < 1) {
              this.logger.warn(
                `Auto-trade skipped ${signal.symbol}: no remaining exposure budget`,
              );
              stopNewEntries = true;
              continue;
            }

            const useBracket =
              entry > 0 &&
              stop > 0 &&
              target > 0 &&
              stop < entry &&
              target > entry;

            const failedAttempts = await this.prisma.brokerOrderLedger.count({
              where: {
                userId: user.id,
                signalId: signal.id,
                side: 'buy',
                status: 'failed',
              },
            });
            const orderClientId = this.entryClientOrderId(
              signal.id,
              user.id,
              failedAttempts,
            );

            await this.orders.submit(
              user.id,
              creds,
              {
                symbol: signal.symbol,
                side: 'buy',
                quantity: qty,
                type: 'market',
                clientOrderId: orderClientId,
                entryPriceHint: entry > 0 ? entry : undefined,
                ...(useBracket
                  ? {
                      orderClass: 'bracket' as const,
                      takeProfitPrice: target,
                      stopLossPrice: stop,
                    }
                  : {}),
              },
              {
                source: 'full_auto',
                signalId: signal.id,
                allowAutomatedLive:
                  this.config.get('ALLOW_FULL_AUTO_LIVE') === 'true',
              },
            );
            currentExposure += qty * entry;
            heldSymbols.add(signal.symbol.toUpperCase());
            placedThisTick += 1;
            this.logger.log(
              `Auto-trade placed buy ${signal.symbol} qty=${qty} notional=$${sized.notional.toFixed(0)} risk=${(sized.riskPct * 100).toFixed(2)}% halfKelly=${(sized.halfKelly * 100).toFixed(1)}% q=${sized.quality.toFixed(2)} for user ${user.id}`,
            );
          } catch (err) {
            const message = (err as Error).message;
            this.logger.warn(
              `Auto-trade skipped user=${user.id} signal=${signal.id}: ${message}`,
            );
            if (
              message.includes('Total exposure') ||
              message.includes('no remaining exposure') ||
              message.includes('Daily trade limit') ||
              message.includes('Kill switch') ||
              message.includes('Daily broker loss') ||
              message.includes('Daily loss limit')
            ) {
              stopNewEntries = true;
            }
            const expectedRejection =
              err instanceof HttpException && err.getStatus() < 500;
            if (!expectedRejection) {
              await this.alerts.send('execution.auto_trade_failed', 'critical', {
                userId: user.id,
                signalId: signal.id,
                symbol: signal.symbol,
                broker: user.brokerLink.broker,
                mode: user.brokerLink.mode,
                message,
              });
            }
          }
        }
      } catch (err) {
        this.logger.warn(
          `Auto-trade user ${user.id} failed: ${(err as Error).message}`,
        );
      }
    }
  }

  /** Short enough that retries can append a suffix within Alpaca's 48-char limit. */
  private entryClientOrderId(
    signalId: string,
    userId: string,
    failedAttempts = 0,
  ): string {
    const sig = signalId.replace(/-/g, '').slice(0, 12);
    const uid = userId.replace(/-/g, '').slice(0, 8);
    const base = `a:${sig}:${uid}`;
    if (failedAttempts <= 0) return base.slice(0, 48);
    return `${base}:r${failedAttempts}:${Date.now().toString(36)}`.slice(0, 48);
  }

  /**
   * When an AI signal hits target/stop, sell any leftover long broker position
   * opened from that signal. Brackets usually do this on Alpaca; this is the
   * safety net when legs are missing/canceled (kill switch, pool failures).
   */
  private async closeResolvedLongs(
    userId: string,
    creds: {
      broker: string;
      apiKey: string;
      apiSecret: string;
      mode: 'paper' | 'live';
    },
  ) {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const resolved = await this.prisma.signal.findMany({
      where: {
        status: { in: ['hit_target', 'hit_stop'] },
        resolvedAt: { gte: since },
      },
      orderBy: { resolvedAt: 'desc' },
      take: 40,
    });
    if (resolved.length === 0) return;

    let positions;
    try {
      positions = await this.registry.get(creds.broker).getPositions(creds);
    } catch (err) {
      this.logger.warn(
        `Exit check positions failed for ${userId}: ${(err as Error).message}`,
      );
      return;
    }

    for (const signal of resolved) {
      const long = positions.find(
        (p) => p.symbol === signal.symbol && p.quantity > 0,
      );
      if (!long) continue;

      const entry = await this.prisma.brokerOrderLedger.findFirst({
        where: {
          userId,
          signalId: signal.id,
          side: 'buy',
          status: 'submitted',
        },
        select: { id: true },
      });
      if (!entry) continue;

      // Already queued/held for an open sell — do not double-submit.
      const openSell = await this.prisma.brokerOrderLedger.findFirst({
        where: {
          userId,
          symbol: signal.symbol,
          side: 'sell',
          status: { in: ['pending', 'submitted'] },
          OR: [
            { brokerStatus: null },
            {
              brokerStatus: {
                notIn: [
                  'filled',
                  'canceled',
                  'cancelled',
                  'expired',
                  'rejected',
                  'done_for_day',
                ],
              },
            },
          ],
        },
        select: { id: true },
      });
      if (openSell) continue;

      const exitClientId = `exit:${signal.id}:${userId}`.slice(0, 48);
      const existingExit = await this.prisma.brokerOrderLedger.findUnique({
        where: {
          userId_clientOrderId: { userId, clientOrderId: exitClientId },
        },
        select: { id: true, status: true },
      });
      if (existingExit && existingExit.status !== 'failed') continue;

      const qty = Math.floor(Math.abs(long.quantity));
      if (qty < 1) continue;

      try {
        await this.orders.submit(
          userId,
          creds,
          {
            symbol: signal.symbol,
            side: 'sell',
            quantity: qty,
            type: 'market',
            clientOrderId:
              existingExit?.status === 'failed'
                ? `${exitClientId}:${Date.now().toString(36)}`.slice(0, 48)
                : exitClientId,
            entryPriceHint: Number(signal.resolvedPrice ?? signal.entryPrice),
          },
          {
            source: 'full_auto',
            signalId: signal.id,
            allowAutomatedLive:
              this.config.get('ALLOW_FULL_AUTO_LIVE') === 'true',
          },
        );
        this.logger.log(
          `Auto-trade exit sell ${signal.symbol} qty=${qty} (${signal.status}) for user ${userId}`,
        );
      } catch (err) {
        this.logger.warn(
          `Auto-trade exit failed ${signal.symbol} for ${userId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Backup exit when Alpaca bracket legs are missing: if mark price hits the
   * TP/SL stored on the buy ledger row, market-sell the long.
   */
  private async closeLongsAtTargets(
    userId: string,
    creds: {
      broker: string;
      apiKey: string;
      apiSecret: string;
      mode: 'paper' | 'live';
    },
  ) {
    let positions;
    try {
      positions = await this.registry.get(creds.broker).getPositions(creds);
    } catch {
      return;
    }
    const longs = positions.filter((p) => p.quantity > 0);
    if (longs.length === 0) return;

    for (const pos of longs) {
      const buy = await this.prisma.brokerOrderLedger.findFirst({
        where: {
          userId,
          symbol: pos.symbol,
          side: 'buy',
          status: 'submitted',
          source: 'full_auto',
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, signalId: true, requestPayload: true },
      });
      if (!buy) continue;

      const payload = (buy.requestPayload ?? {}) as {
        takeProfitPrice?: number;
        stopLossPrice?: number;
      };
      const tp = Number(payload.takeProfitPrice ?? 0);
      const sl = Number(payload.stopLossPrice ?? 0);
      if (!(tp > 0 || sl > 0)) continue;

      const mark =
        Math.abs(pos.quantity) > 0
          ? Math.abs(pos.marketValue / pos.quantity)
          : 0;
      if (!(mark > 0)) continue;

      const hitTp = tp > 0 && mark >= tp;
      const hitSl = sl > 0 && mark <= sl;
      if (!hitTp && !hitSl) continue;

      const exitClientId = `px:${buy.id}:${userId}`.slice(0, 48);
      const existingExit = await this.prisma.brokerOrderLedger.findUnique({
        where: {
          userId_clientOrderId: { userId, clientOrderId: exitClientId },
        },
        select: { id: true, status: true },
      });
      if (existingExit && existingExit.status !== 'failed') continue;

      const qty = Math.floor(Math.abs(pos.quantity));
      if (qty < 1) continue;

      try {
        await this.orders.submit(
          userId,
          creds,
          {
            symbol: pos.symbol,
            side: 'sell',
            quantity: qty,
            type: 'market',
            clientOrderId:
              existingExit?.status === 'failed'
                ? `${exitClientId}:${Date.now().toString(36)}`.slice(0, 48)
                : exitClientId,
            entryPriceHint: mark,
          },
          {
            source: 'full_auto',
            signalId: buy.signalId ?? undefined,
            allowAutomatedLive:
              this.config.get('ALLOW_FULL_AUTO_LIVE') === 'true',
          },
        );
        this.logger.log(
          `Auto-trade price-exit sell ${pos.symbol} qty=${qty} mark=${mark.toFixed(2)} ${hitTp ? 'TP' : 'SL'} for user ${userId}`,
        );
      } catch (err) {
        this.logger.warn(
          `Auto-trade price-exit failed ${pos.symbol} for ${userId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * After day-TIF bracket legs expire, longs sit naked. Re-attach GTC OCO
   * take-profit / stop-loss from the original entry payload when no open
   * sell already protects the symbol.
   */
  private async protectNakedLongs(
    userId: string,
    creds: {
      broker: string;
      apiKey: string;
      apiSecret: string;
      mode: 'paper' | 'live';
    },
  ) {
    if (creds.broker !== 'alpaca') return;

    let positions;
    try {
      positions = await this.registry.get(creds.broker).getPositions(creds);
    } catch {
      return;
    }
    const longs = positions.filter((p) => p.quantity > 0);
    if (longs.length === 0) return;

    // Symbols that already have an open sell / OCO / market exit queued.
    const openSellSymbols = new Set<string>();
    const openBuys = await this.prisma.brokerOrderLedger.findMany({
      where: {
        userId,
        side: 'sell',
        status: { in: ['pending', 'submitted'] },
        OR: [
          { brokerStatus: null },
          {
            brokerStatus: {
              notIn: [
                'filled',
                'canceled',
                'cancelled',
                'expired',
                'rejected',
                'done_for_day',
              ],
            },
          },
        ],
      },
      select: { symbol: true },
      take: 200,
    });
    for (const row of openBuys) openSellSymbols.add(row.symbol.toUpperCase());

    for (const pos of longs) {
      const symbol = pos.symbol.toUpperCase();
      if (openSellSymbols.has(symbol)) continue;

      const buy = await this.prisma.brokerOrderLedger.findFirst({
        where: {
          userId,
          symbol,
          side: 'buy',
          status: 'submitted',
          source: 'full_auto',
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, signalId: true, requestPayload: true },
      });
      if (!buy) continue;

      const payload = (buy.requestPayload ?? {}) as {
        takeProfitPrice?: number;
        stopLossPrice?: number;
      };
      const tp = Number(payload.takeProfitPrice ?? 0);
      const sl = Number(payload.stopLossPrice ?? 0);
      if (!(tp > 0 && sl > 0 && tp > sl)) continue;

      const qty = Math.floor(Math.abs(pos.quantity));
      if (qty < 1) continue;

      const clientOrderId = `oco:${buy.id}:${userId}`.slice(0, 48);
      const existing = await this.prisma.brokerOrderLedger.findUnique({
        where: { userId_clientOrderId: { userId, clientOrderId } },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== 'failed') continue;

      try {
        await this.orders.submit(
          userId,
          creds,
          {
            symbol,
            side: 'sell',
            quantity: qty,
            type: 'limit',
            limitPrice: tp,
            clientOrderId:
              existing?.status === 'failed'
                ? `${clientOrderId}:${Date.now().toString(36)}`.slice(0, 48)
                : clientOrderId,
            orderClass: 'oco',
            takeProfitPrice: tp,
            stopLossPrice: sl,
            entryPriceHint: pos.avgEntryPrice,
          },
          {
            source: 'full_auto',
            signalId: buy.signalId ?? undefined,
            allowAutomatedLive:
              this.config.get('ALLOW_FULL_AUTO_LIVE') === 'true',
          },
        );
        openSellSymbols.add(symbol);
        this.logger.log(
          `Auto-trade re-armed OCO ${symbol} qty=${qty} tp=${tp} sl=${sl} for user ${userId}`,
        );
      } catch (err) {
        this.logger.warn(
          `Auto-trade OCO protect failed ${symbol} for ${userId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /** Pending rows with no broker id after 2 minutes are abandoned submissions. */
  private async recoverStuckPending(
    userId: string,
    creds: {
      broker: string;
      apiKey: string;
      apiSecret: string;
      mode: 'paper' | 'live';
    },
  ) {
    const cutoff = new Date(Date.now() - 120_000);
    const stuck = await this.prisma.brokerOrderLedger.findMany({
      where: {
        userId,
        status: 'pending',
        brokerOrderId: null,
        createdAt: { lt: cutoff },
      },
      take: 50,
    });
    for (const row of stuck) {
      try {
        const brokerOrder = await this.registry
          .get(creds.broker)
          .getOrderByClientOrderId(creds, row.clientOrderId, row.symbol);
        await this.prisma.brokerOrderLedger.update({
          where: { id: row.id },
          data: {
            brokerOrderId: brokerOrder.id,
            status: 'submitted',
            brokerStatus: brokerOrder.status,
            responsePayload: brokerOrder as never,
            submittedAt: row.submittedAt ?? new Date(),
            failureReason: null,
          },
        });
      } catch {
        await this.prisma.brokerOrderLedger.update({
          where: { id: row.id },
          data: {
            status: 'failed',
            failureReason: 'Abandoned pending submission (never reached broker)',
          },
        });
      }
    }
  }

  private connectionOptions() {
    return bullmqConnection(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
