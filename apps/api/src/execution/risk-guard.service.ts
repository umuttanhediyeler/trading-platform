import {
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BrokerAdapter,
  BrokerCredentials,
  BrokerOrderRequest,
} from '../broker/broker-adapter.interface';
import { BrokerRegistry } from '../broker/broker-registry.service';
import { AlertsService } from '../common/alerts.service';
import { decryptSecret } from '../common/crypto';
import { killSwitchTriggersTotal } from '../metrics/counters';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutionGateway } from './execution.gateway';

const DEFAULT_MAX_TOTAL_EXPOSURE_PCT = 50;

interface LedgerFill {
  symbol: string;
  side: string;
  quantity: number;
  price: number;
}

/**
 * Mandatory safety layer in front of any automated/one-click order:
 *  1. kill switch must be off
 *  2. daily max trade count not exceeded
 *  3. daily max loss percent not exceeded (breaching it trips the kill
 *     switch and drops the user back to manual mode)
 *
 * The broker order path additionally runs `assertBrokerOrderAllowed`, which
 * checks per-trade risk, total exposure and realized broker PnL against the
 * real broker account. All broker-aware checks degrade gracefully: if the
 * adapter or credentials are unavailable the existing sim-based checks are
 * the only line of defense (unchanged behavior).
 */
@Injectable()
export class RiskGuardService {
  private readonly logger = new Logger(RiskGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ExecutionGateway,
    private readonly config: ConfigService,
    @Optional()
    private readonly registry?: BrokerRegistry,
    @Optional()
    private readonly alerts?: AlertsService,
  ) {}

  async assertCanTrade(
    userId: string,
    options: { includesPendingReservation?: boolean } = {},
  ): Promise<void> {
    const settings = await this.prisma.riskSettings.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    if (settings.killSwitchActive) {
      throw new ForbiddenException(
        'Kill switch is active — automated trading is stopped',
      );
    }

    const startOfDay = this.startOfUtcDay();

    const account = await this.prisma.simulatedAccount.findUnique({
      where: { userId },
    });

    const todayOrders = await this.prisma.simulatedOrder.findMany({
      where: {
        accountId: account?.id ?? '__none__',
        openedAt: { gte: startOfDay },
      },
    });

    const brokerOrderCount = await this.prisma.brokerOrderLedger.count({
      where: {
        userId,
        createdAt: { gte: startOfDay },
        status: { in: ['pending', 'submitted'] },
      },
    });
    // Only deliberate trades count toward the daily trade limit: user-initiated
    // manual paper orders plus real broker submissions. AI-signal sim auto-fills
    // mirror generated signals for portfolio visibility, so counting them would
    // exhaust the limit before a single full-auto broker order is placed.
    const manualSimTradeCount = todayOrders.filter(
      (order) => order.source === 'manual',
    ).length;
    const dailyTradeCount = manualSimTradeCount + brokerOrderCount;

    // Broker submissions include their newly reserved pending row, while other
    // callers are rejected as soon as all configured slots are already used.
    const limitReached = options.includesPendingReservation
      ? dailyTradeCount > settings.maxDailyTrades
      : dailyTradeCount >= settings.maxDailyTrades;
    if (limitReached) {
      throw new ForbiddenException(
        `Daily trade limit reached (${settings.maxDailyTrades})`,
      );
    }

    if (account) {
      const realizedPnl = todayOrders
        .filter((o) => o.pnl !== null)
        .reduce((sum, o) => sum + Number(o.pnl), 0);
      const balance = Number(account.balance);
      const lossPercent =
        balance > 0 && realizedPnl < 0 ? (-realizedPnl / balance) * 100 : 0;

      if (lossPercent >= settings.maxDailyLossPercent) {
        await this.triggerKillSwitch(
          userId,
          `Daily loss limit of ${settings.maxDailyLossPercent}% breached (${lossPercent.toFixed(2)}%)`,
        );
        throw new ForbiddenException(
          'Daily loss limit breached — kill switch activated',
        );
      }
    }
  }

  /**
   * Broker-aware risk checks for real (paper/live) order submissions:
   *  1. per-trade risk: quantity * stop distance must not exceed
   *     maxRiskPerTrade% of account equity
   *  2. total exposure: open ledger orders + broker positions market value
   *     must stay under MAX_TOTAL_EXPOSURE_PCT% of equity (default 50)
   *  3. daily realized broker PnL (from ledger fills, where available) must
   *     not breach maxDailyLossPercent — breaching trips the kill switch
   *
   * Degrades to a no-op when the broker account is unreachable so the
   * existing sim-based checks (assertCanTrade) remain the fallback.
   */
  async assertBrokerOrderAllowed(
    userId: string,
    credentials: BrokerCredentials,
    order: BrokerOrderRequest,
  ): Promise<void> {
    if (!this.registry) return;
    const adapter = this.registry.get(credentials.broker);

    let equity: number;
    try {
      const balance = await adapter.getAccountBalance(credentials);
      equity = Number(balance.equity);
    } catch (error) {
      this.logger.warn(
        `Broker risk checks skipped for ${userId} (account unavailable): ${this.errorMessage(error)}`,
      );
      return;
    }
    if (!Number.isFinite(equity) || equity <= 0) return;

    const settings = await this.prisma.riskSettings.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    const entryEstimate = order.limitPrice ?? order.entryPriceHint;
    const stopPrice = order.stopLossPrice;

    // 1. Per-trade risk (only when we know both entry and stop).
    if (entryEstimate && stopPrice) {
      const riskAmount = order.quantity * Math.abs(entryEstimate - stopPrice);
      const maxRisk = equity * (settings.maxRiskPerTrade / 100);
      if (riskAmount > maxRisk) {
        throw new ForbiddenException(
          `Per-trade risk $${riskAmount.toFixed(2)} exceeds ${settings.maxRiskPerTrade}% of equity ($${maxRisk.toFixed(2)})`,
        );
      }
    }

    // 2. Total exposure cap.
    const maxExposurePct = this.maxTotalExposurePct();
    let positionsValue = 0;
    try {
      const positions = await adapter.getPositions(credentials);
      positionsValue = positions.reduce(
        (sum, p) => sum + Math.abs(Number(p.marketValue) || 0),
        0,
      );
    } catch (error) {
      this.logger.warn(
        `Exposure check using ledger only for ${userId} (positions unavailable): ${this.errorMessage(error)}`,
      );
    }
    const openOrdersNotional = await this.openLedgerOrdersNotional(
      userId,
      order.clientOrderId,
    );
    const newOrderNotional = entryEstimate
      ? order.quantity * entryEstimate
      : 0;
    const totalExposure = positionsValue + openOrdersNotional + newOrderNotional;
    const maxExposure = equity * (maxExposurePct / 100);
    if (totalExposure > maxExposure) {
      throw new ForbiddenException(
        `Total exposure $${totalExposure.toFixed(2)} would exceed ${maxExposurePct}% of equity ($${maxExposure.toFixed(2)})`,
      );
    }

    // 3. Daily realized broker PnL. Only enforceable when ledger fills carry
    // fill prices (populated by reconcile); otherwise the sim-based daily
    // loss check in assertCanTrade remains the fallback.
    const realizedPnl = await this.brokerRealizedPnlToday(userId);
    if (realizedPnl !== null && realizedPnl < 0) {
      const lossPercent = (-realizedPnl / equity) * 100;
      if (lossPercent >= settings.maxDailyLossPercent) {
        await this.triggerKillSwitch(
          userId,
          `Daily broker loss limit of ${settings.maxDailyLossPercent}% breached (${lossPercent.toFixed(2)}%)`,
        );
        throw new ForbiddenException(
          'Daily broker loss limit breached — kill switch activated',
        );
      }
    }
  }

  /** Trips the kill switch: stops automation and drops the user to manual mode. */
  async triggerKillSwitch(userId: string, reason: string): Promise<void> {
    const triggeredAt = new Date();
    await this.prisma.$transaction([
      this.prisma.riskSettings.upsert({
        where: { userId },
        update: {
          killSwitchActive: true,
          killSwitchReason: reason,
          killSwitchAt: triggeredAt,
        },
        create: {
          userId,
          killSwitchActive: true,
          killSwitchReason: reason,
          killSwitchAt: triggeredAt,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { executionMode: 'manual' },
      }),
    ]);
    this.logger.warn(`Kill switch triggered for ${userId}: ${reason}`);
    killSwitchTriggersTotal.inc();
    this.gateway.emitKillSwitchTriggered(userId, reason);
    this.alerts
      ?.send('execution.kill_switch', 'critical', { userId, reason })
      .catch(() => undefined);

    // Best effort: never let broker connectivity issues break the kill
    // switch itself — the DB flags above are already committed.
    try {
      await this.enforceBrokerKillSwitch(userId, reason);
    } catch (error) {
      this.logger.error(
        `Kill switch broker enforcement failed for ${userId}: ${this.errorMessage(error)}`,
      );
    }
  }

  /**
   * Cancels every open/pending broker order recorded in the ledger and, when
   * KILL_SWITCH_FLATTEN=true, closes open positions with market orders.
   */
  private async enforceBrokerKillSwitch(
    userId: string,
    reason: string,
  ): Promise<void> {
    if (!this.registry) return;
    const encKey = this.config.get<string>('ENCRYPTION_KEY', '');
    if (!encKey) return;
    const link = await this.prisma.brokerLink.findUnique({
      where: { userId },
    });
    if (!link) return;
    if (!this.registry.isSupported(link.broker)) {
      this.logger.error(
        `Kill switch cannot enforce unsupported broker ${link.broker} for ${userId}`,
      );
      return;
    }
    const adapter = this.registry.get(link.broker);

    const credentials: BrokerCredentials = {
      broker: link.broker,
      apiKey: decryptSecret(link.apiKeyEnc, encKey),
      apiSecret: decryptSecret(link.apiSecretEnc, encKey),
      mode: link.mode as 'paper' | 'live',
    };

    const openOrders = await this.prisma.brokerOrderLedger.findMany({
      where: {
        userId,
        broker: credentials.broker,
        mode: credentials.mode,
        status: { in: ['pending', 'submitted'] },
      },
      take: 200,
    });

    let canceled = 0;
    for (const ledgerOrder of openOrders) {
      try {
        let brokerOrderId = ledgerOrder.brokerOrderId;
        if (!brokerOrderId) {
          const brokerOrder = await adapter.getOrderByClientOrderId(
            credentials,
            ledgerOrder.clientOrderId,
            ledgerOrder.symbol,
          );
          brokerOrderId = brokerOrder.id;
        }
        await adapter.cancelOrder(
          credentials,
          brokerOrderId,
          ledgerOrder.symbol,
        );
        await this.prisma.brokerOrderLedger.update({
          where: { id: ledgerOrder.id },
          data: {
            status: 'canceled',
            brokerStatus: 'canceled',
            brokerOrderId,
            failureReason: `Canceled by kill switch: ${reason}`.slice(0, 1000),
          },
        });
        canceled += 1;
      } catch (error) {
        this.logger.warn(
          `Kill switch could not cancel order ${ledgerOrder.clientOrderId}: ${this.errorMessage(error)}`,
        );
      }
    }
    if (openOrders.length > 0) {
      this.logger.warn(
        `Kill switch canceled ${canceled}/${openOrders.length} open broker orders for ${userId}`,
      );
    }

    if (this.config.get<string>('KILL_SWITCH_FLATTEN', 'false') === 'true') {
      await this.flattenPositions(userId, credentials, adapter);
    }
  }

  /** Closes every open broker position with a market order (opt-in via env). */
  private async flattenPositions(
    userId: string,
    credentials: BrokerCredentials,
    adapter: BrokerAdapter,
  ): Promise<void> {
    const positions = await adapter.getPositions(credentials);
    for (const position of positions) {
      const quantity = Math.abs(position.quantity);
      if (!quantity) continue;
      const clientOrderId = `ksflat:${position.symbol}:${Date.now()}`.slice(
        0,
        48,
      );
      try {
        const order = await adapter.placeOrder(credentials, {
          symbol: position.symbol,
          side: position.quantity > 0 ? 'sell' : 'buy',
          quantity,
          type: 'market',
          clientOrderId,
        });
        await this.prisma.brokerOrderLedger
          .create({
            data: {
              userId,
              broker: credentials.broker,
              mode: credentials.mode,
              clientOrderId,
              symbol: position.symbol.toUpperCase(),
              side: position.quantity > 0 ? 'sell' : 'buy',
              quantity,
              orderType: 'market',
              source: 'kill_switch',
              status: 'submitted',
              brokerOrderId: order.id,
              brokerStatus: order.status,
              requestPayload: { reason: 'kill_switch_flatten' },
              responsePayload: order as object,
              submittedAt: new Date(),
            },
          })
          .catch(() => undefined);
        this.logger.warn(
          `Kill switch flattened ${position.symbol} x${quantity} for ${userId}`,
        );
      } catch (error) {
        this.logger.warn(
          `Kill switch could not flatten ${position.symbol}: ${this.errorMessage(error)}`,
        );
      }
    }
  }

  /**
   * Estimated notional of open (pending/submitted) ledger orders. Market
   * orders without a stored entry hint contribute 0 — a known undercount,
   * mitigated by positions market value once fills land.
   */
  private async openLedgerOrdersNotional(
    userId: string,
    excludeClientOrderId?: string,
  ): Promise<number> {
    const rows = await this.prisma.brokerOrderLedger.findMany({
      where: {
        userId,
        status: { in: ['pending', 'submitted'] },
        ...(excludeClientOrderId
          ? { clientOrderId: { not: excludeClientOrderId } }
          : {}),
      },
      take: 500,
    });
    return rows.reduce((sum, row) => {
      const payload = (row.requestPayload ?? {}) as Record<string, unknown>;
      const price =
        (row.limitPrice != null ? Number(row.limitPrice) : 0) ||
        Number(payload.limitPrice) ||
        Number(payload.entryPriceHint) ||
        0;
      return sum + row.quantity * price;
    }, 0);
  }

  /**
   * Realized broker PnL for today, FIFO-matching same-day buy and sell fills
   * from the ledger. Returns null when no usable fill data exists (fill
   * prices are populated by reconcile), signaling callers to rely on the
   * sim-based fallback.
   */
  private async brokerRealizedPnlToday(userId: string): Promise<number | null> {
    const rows = await this.prisma.brokerOrderLedger.findMany({
      where: {
        userId,
        brokerStatus: 'filled',
        updatedAt: { gte: this.startOfUtcDay() },
      },
      orderBy: { updatedAt: 'asc' },
      take: 500,
    });

    const fills: LedgerFill[] = [];
    for (const row of rows) {
      const payload = (row.responsePayload ?? {}) as Record<string, unknown>;
      const price = Number(payload.filledAvgPrice);
      const quantity = Number(payload.filledQty) || row.quantity;
      if (!Number.isFinite(price) || price <= 0 || quantity <= 0) continue;
      fills.push({ symbol: row.symbol, side: row.side, quantity, price });
    }
    if (fills.length === 0) return null;

    const buysBySymbol = new Map<string, Array<{ qty: number; price: number }>>();
    let realized = 0;
    for (const fill of fills) {
      if (fill.side === 'buy') {
        const queue = buysBySymbol.get(fill.symbol) ?? [];
        queue.push({ qty: fill.quantity, price: fill.price });
        buysBySymbol.set(fill.symbol, queue);
        continue;
      }
      // Sell: match against today's buys FIFO; unmatched quantity has an
      // unknown (pre-existing) cost basis and is skipped.
      let remaining = fill.quantity;
      const queue = buysBySymbol.get(fill.symbol) ?? [];
      while (remaining > 0 && queue.length > 0) {
        const lot = queue[0];
        const matched = Math.min(remaining, lot.qty);
        realized += matched * (fill.price - lot.price);
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 0) queue.shift();
      }
    }
    return realized;
  }

  private maxTotalExposurePct(): number {
    const raw = Number(
      this.config.get<string>(
        'MAX_TOTAL_EXPOSURE_PCT',
        String(DEFAULT_MAX_TOTAL_EXPOSURE_PCT),
      ),
    );
    return Number.isFinite(raw) && raw > 0
      ? raw
      : DEFAULT_MAX_TOTAL_EXPOSURE_PCT;
  }

  private startOfUtcDay(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
