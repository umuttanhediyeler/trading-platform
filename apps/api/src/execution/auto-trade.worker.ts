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
      for (const signal of signals) {
        const clientOrderId = `${signal.id}:${user.id}`.slice(0, 48);
        const existing = await this.prisma.brokerOrderLedger.findUnique({
          where: {
            userId_clientOrderId: { userId: user.id, clientOrderId },
          },
          select: { id: true },
        });
        if (existing) continue;

        try {
          const entry = Number(signal.entryPrice);
          const stop = Number(signal.stopPrice);
          const target = Number(signal.targetPrice);
          const riskPct = user.riskSettings?.maxRiskPerTrade ?? 1;
          // Conservative fixed-risk sizing: $ risk budget / stop distance.
          const stopDistance = Math.max(Math.abs(entry - stop), entry * 0.005);
          const riskBudget = 100_000 * (riskPct / 100); // paper default notional
          const qty = Math.max(1, Math.floor(riskBudget / stopDistance));

          const creds = {
            broker: user.brokerLink.broker,
            apiKey: decryptSecret(user.brokerLink.apiKeyEnc, encKey),
            apiSecret: decryptSecret(user.brokerLink.apiSecretEnc, encKey),
            mode: user.brokerLink.mode as 'paper' | 'live',
          };

          // Bracket entry (attached take-profit + stop-loss) whenever the
          // signal levels are coherent for a long; plain market otherwise.
          const useBracket =
            entry > 0 && stop > 0 && target > 0 && stop < entry && target > entry;

          await this.orders.submit(
            user.id,
            creds,
            {
              symbol: signal.symbol,
              side: 'buy',
              quantity: Math.min(qty, 10),
              type: 'market',
              clientOrderId,
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
            `Auto-trade placed ${signal.symbol} for user ${user.id}`,
          );
        } catch (err) {
          this.logger.warn(
            `Auto-trade skipped user=${user.id} signal=${signal.id}: ${(err as Error).message}`,
          );
          // Expected risk-gate / idempotency rejections (kill switch, daily
          // limit, duplicate clientOrderId, etc.) are normal control-flow, not
          // incidents — only alert on genuine (5xx / non-HTTP) failures so the
          // critical channel is not flooded every minute.
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

  private connectionOptions() {
    const url = new URL(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
    );
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
    };
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
