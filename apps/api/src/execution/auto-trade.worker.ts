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
import { computePositionSize } from './position-sizing';
import { computeRiskTargets, inferSignalSide } from './risk-targets';

export const AUTO_TRADE_QUEUE = 'auto-trade';

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
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const signals = await this.prisma.signal.findMany({
      where: { status: 'open', generatedAt: { gte: since } },
      orderBy: { generatedAt: 'desc' },
      take: 20,
    });
    if (signals.length === 0) return;

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

    const encKey = this.config.get<string>('ENCRYPTION_KEY', '');
    if (!encKey) return;

    for (const user of users) {
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

      // Keep ledger in sync so "Bekleyen" rows resolve to filled/canceled.
      await this.orders.reconcile(user.id, creds).catch((err) =>
        this.logger.warn(
          `Auto-trade reconcile failed for ${user.id}: ${(err as Error).message}`,
        ),
      );
      await this.recoverStuckPending(user.id, creds);

      for (const signal of signals) {
        const clientOrderId = `${signal.id}:${user.id}`.slice(0, 48);
        const existing = await this.prisma.brokerOrderLedger.findUnique({
          where: {
            userId_clientOrderId: { userId: user.id, clientOrderId },
          },
          select: { id: true, status: true },
        });
        if (existing && existing.status !== 'failed') continue;

        try {
          const entry = Number(signal.entryPrice);
          const maxRisk = user.riskSettings?.maxRiskPerTrade ?? 2;
          const side = inferSignalSide(
            entry,
            Number(signal.stopPrice),
            Number(signal.targetPrice),
          );
          const userTargets = computeRiskTargets({
            entry,
            strategyId: signal.strategyId,
            maxRiskPerTrade: maxRisk,
            confidence: signal.confidence,
            side,
          });
          const stop = userTargets.stopPrice;
          const target = userTargets.targetPrice;

          let equity = 100_000;
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

          const qty = computePositionSize({
            equity,
            entryPrice: entry,
            stopPrice: stop,
            maxRiskPerTrade: maxRisk,
          });
          if (qty < 1) {
            this.logger.warn(
              `Auto-trade skipped ${signal.symbol}: qty=${qty} too small`,
            );
            continue;
          }

          // Bracket entry: longs need stop < entry < target; shorts invert.
          const useBracket =
            entry > 0 &&
            stop > 0 &&
            target > 0 &&
            (side === 'buy'
              ? stop < entry && target > entry
              : stop > entry && target < entry);

          // Failed prior attempt for this signal: new client id so Alpaca accepts.
          const orderClientId =
            existing?.status === 'failed'
              ? `${clientOrderId}:${Date.now().toString(36)}`.slice(0, 48)
              : clientOrderId;

          await this.orders.submit(
            user.id,
            creds,
            {
              symbol: signal.symbol,
              side,
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
          this.logger.log(
            `Auto-trade placed ${side} ${signal.symbol} qty=${qty} for user ${user.id}`,
          );
        } catch (err) {
          this.logger.warn(
            `Auto-trade skipped user=${user.id} signal=${signal.id}: ${(err as Error).message}`,
          );
          const expectedRejection =
            err instanceof HttpException && err.getStatus() < 500;
          if (!expectedRejection) {
            await this.alerts.send('execution.auto_trade_failed', 'critical', {
              userId: user.id,
              signalId: signal.id,
              symbol: signal.symbol,
              broker: user.brokerLink.broker,
              mode: user.brokerLink.mode,
              message: (err as Error).message,
            });
          }
        }
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
    const cutoff = new Date(Date.now() - 45_000);
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
