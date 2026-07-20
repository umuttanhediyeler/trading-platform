import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { RiskGuardService } from '../execution/risk-guard.service';
import { brokerOrdersSubmittedTotal } from '../metrics/counters';
import { PrismaService } from '../prisma/prisma.service';
import {
  BrokerCredentials,
  BrokerOrder,
  BrokerOrderRequest,
  BrokerPosition,
} from './broker-adapter.interface';
import { BrokerRegistry } from './broker-registry.service';

export interface BrokerOrderContext {
  source: 'one_click' | 'full_auto';
  signalId?: string;
  /** Full-auto callers must explicitly opt in before any live submission. */
  allowAutomatedLive?: boolean;
}

@Injectable()
export class BrokerOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly riskGuard: RiskGuardService,
    private readonly registry: BrokerRegistry,
  ) {}

  getPositions(credentials: BrokerCredentials): Promise<BrokerPosition[]> {
    return this.registry.get(credentials.broker).getPositions(credentials);
  }

  async reconcile(userId: string, credentials: BrokerCredentials) {
    const adapter = this.registry.get(credentials.broker);
    const ledgerOrders = await this.prisma.brokerOrderLedger.findMany({
      where: {
        userId,
        broker: credentials.broker,
        mode: credentials.mode,
        status: { in: ['pending', 'submitted', 'failed'] },
      },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    let updated = 0;
    let cleaned = 0;
    const errors: Array<{ clientOrderId: string; message: string }> = [];

    for (const ledgerOrder of ledgerOrders) {
      if (
        ledgerOrder.status === 'failed' &&
        !ledgerOrder.brokerOrderId &&
        this.isExpectedFailureReason(ledgerOrder.failureReason)
      ) {
        await this.prisma.brokerOrderLedger
          .delete({ where: { id: ledgerOrder.id } })
          .catch(() => undefined);
        cleaned += 1;
        continue;
      }

      try {
        const brokerOrder = await adapter.getOrderByClientOrderId(
          credentials,
          ledgerOrder.clientOrderId,
          ledgerOrder.symbol,
        );
        const nextStatus = this.ledgerStatusFromBroker(brokerOrder.status);
        await this.prisma.brokerOrderLedger.update({
          where: { id: ledgerOrder.id },
          data: {
            brokerOrderId: brokerOrder.id,
            status: nextStatus,
            brokerStatus: brokerOrder.status,
            responsePayload: brokerOrder as unknown as Prisma.InputJsonValue,
            submittedAt: ledgerOrder.submittedAt ?? new Date(),
            failureReason: null,
          },
        });
        updated += 1;
      } catch (error) {
        if (
          ledgerOrder.status === 'failed' &&
          !ledgerOrder.brokerOrderId &&
          this.isBrokerNotFound(error)
        ) {
          await this.prisma.brokerOrderLedger
            .delete({ where: { id: ledgerOrder.id } })
            .catch(() => undefined);
          cleaned += 1;
          continue;
        }
        errors.push({
          clientOrderId: ledgerOrder.clientOrderId,
          message: this.errorMessage(error),
        });
      }
    }
    return { checked: ledgerOrders.length, updated, cleaned, errors };
  }

  async submit(
    userId: string,
    credentials: BrokerCredentials,
    order: BrokerOrderRequest,
    context: BrokerOrderContext,
  ): Promise<BrokerOrder> {
    this.assertModeAllowed(credentials.mode, context);
    const adapter = this.registry.get(credentials.broker);

    const existing = await this.prisma.brokerOrderLedger.findUnique({
      where: {
        userId_clientOrderId: { userId, clientOrderId: order.clientOrderId },
      },
    });
    if (existing) {
      return this.resolveDuplicate(existing);
    }

    try {
      await this.prisma.brokerOrderLedger.create({
        data: {
          userId,
          broker: credentials.broker,
          mode: credentials.mode,
          clientOrderId: order.clientOrderId,
          symbol: order.symbol.toUpperCase(),
          side: order.side,
          quantity: order.quantity,
          orderType: order.type,
          limitPrice: order.limitPrice,
          source: context.source,
          signalId: context.signalId,
          requestPayload: order as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      return this.resolveDuplicate(
        await this.prisma.brokerOrderLedger.findUniqueOrThrow({
          where: {
            userId_clientOrderId: { userId, clientOrderId: order.clientOrderId },
          },
        }),
      );
    }

    try {
      // Run after reserving the idempotency key so concurrent submissions are
      // visible to the daily-trade limit before either reaches the broker.
      await this.riskGuard.assertCanTrade(userId, {
        includesPendingReservation: true,
      });
      await this.riskGuard.assertBrokerOrderAllowed(userId, credentials, order);
      const brokerOrder = await adapter.placeOrder(credentials, {
        ...order,
        symbol: order.symbol.toUpperCase(),
      });
      await this.prisma.brokerOrderLedger.update({
        where: {
          userId_clientOrderId: { userId, clientOrderId: order.clientOrderId },
        },
        data: {
          brokerOrderId: brokerOrder.id,
          status: 'submitted',
          brokerStatus: brokerOrder.status,
          responsePayload: brokerOrder as unknown as Prisma.InputJsonValue,
          submittedAt: new Date(),
          failureReason: null,
        },
      });
      brokerOrdersSubmittedTotal.inc({ mode: credentials.mode });
      return brokerOrder;
    } catch (error) {
      const ledgerKey = {
        userId_clientOrderId: { userId, clientOrderId: order.clientOrderId },
      };
      if (this.isExpectedRejection(error)) {
        // Risk gates and other expected 4xx rejections should not pollute the
        // ledger as permanent "failed" orders (auto-trade runs every minute).
        await this.prisma.brokerOrderLedger
          .delete({ where: ledgerKey })
          .catch(() => undefined);
      } else {
        await this.prisma.brokerOrderLedger
          .update({
            where: ledgerKey,
            data: {
              status: 'failed',
              failureReason: this.errorMessage(error).slice(0, 1000),
            },
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  private ledgerStatusFromBroker(
    brokerStatus: string,
  ): 'submitted' | 'canceled' | 'failed' {
    const normalized = brokerStatus.toLowerCase();
    if (
      normalized.includes('cancel') ||
      normalized.includes('expire') ||
      normalized === 'rejected'
    ) {
      return 'canceled';
    }
    if (normalized.includes('fail') || normalized.includes('reject')) {
      return 'failed';
    }
    return 'submitted';
  }

  private isExpectedRejection(error: unknown): boolean {
    return error instanceof HttpException && error.getStatus() < 500;
  }

  private isExpectedFailureReason(reason: string | null): boolean {
    if (!reason) return false;
    const needles = [
      'Daily trade limit',
      'Kill switch',
      'Per-trade risk',
      'Total exposure',
      'Daily loss limit',
      'Daily broker loss',
      'Live broker order submission is disabled',
      'Full-auto live trading is disabled',
      'already being submitted',
      'failed order; use a new id',
      'sub-penny increment',
      'minimum pricing criteria',
      '42210000',
    ];
    return needles.some((needle) => reason.includes(needle));
  }

  private isBrokerNotFound(error: unknown): boolean {
    const message = this.errorMessage(error).toLowerCase();
    return message.includes('404') || message.includes('not found');
  }

  private assertModeAllowed(
    mode: BrokerCredentials['mode'],
    context: BrokerOrderContext,
  ) {
    if (mode !== 'live') return;
    if (this.config.get<string>('ALLOW_LIVE_BROKER', 'false') !== 'true') {
      throw new ForbiddenException('Live broker order submission is disabled');
    }
    if (
      context.source === 'full_auto' &&
      (!context.allowAutomatedLive ||
        this.config.get<string>('ALLOW_FULL_AUTO_LIVE', 'false') !== 'true')
    ) {
      throw new ForbiddenException(
        'Full-auto live trading is disabled; full-auto is paper-only by default',
      );
    }
  }

  private async resolveDuplicate(
    existing: {
      status: string;
      responsePayload: Prisma.JsonValue | null;
    },
  ): Promise<BrokerOrder> {
    if (existing.status === 'submitted' && existing.responsePayload) {
      return existing.responsePayload as unknown as BrokerOrder;
    }
    throw new ConflictException(
      existing.status === 'pending'
        ? 'An order with this clientOrderId is already being submitted'
        : 'This clientOrderId belongs to a failed order; use a new id after reviewing the failure',
    );
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
