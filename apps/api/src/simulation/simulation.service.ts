import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { QuoteCacheService } from '../market-data/quote-cache.service';
import { PrismaService } from '../prisma/prisma.service';

export interface OpenSimOrderInput {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice?: number; // optional; falls back to cached quote
  stopPrice: number;
  targetPrice: number;
  source: 'manual' | 'ai_signal';
}

@Injectable()
export class SimulationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quoteCache: QuoteCacheService,
  ) {}

  async getAccount(userId: string) {
    const account = await this.prisma.simulatedAccount.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    const openOrders = await this.prisma.simulatedOrder.findMany({
      where: { accountId: account.id, status: 'open' },
      orderBy: { openedAt: 'desc' },
    });
    const closedOrders = await this.prisma.simulatedOrder.findMany({
      where: { accountId: account.id, status: 'closed' },
      orderBy: { closedAt: 'desc' },
      take: 100,
    });
    const openPositions = await Promise.all(
      openOrders.map(async (order) => {
        const cached = await this.quoteCache
          .getQuote(order.symbol)
          .catch(() => null);
        const currentPrice = cached?.quote.price ?? Number(order.entryPrice);
        const entryPrice = Number(order.entryPrice);
        const direction = order.side === 'buy' ? 1 : -1;
        return {
          id: order.id,
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          entryPrice,
          currentPrice,
          pnl: (currentPrice - entryPrice) * direction * order.quantity,
          status: 'open' as const,
          source: order.source,
        };
      }),
    );
    const closedTrades = closedOrders.map((order) => ({
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      entryPrice: Number(order.entryPrice),
      currentPrice: Number(order.exitPrice ?? order.entryPrice),
      pnl: Number(order.pnl ?? 0),
      status: 'closed' as const,
      source: order.source,
    }));
    const cash = Number(account.balance);
    const openMarketValue = openPositions.reduce(
      (sum, position) => sum + position.currentPrice * position.quantity,
      0,
    );
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const realizedToday = closedOrders
      .filter((order) => order.closedAt && order.closedAt >= startOfDay)
      .reduce((sum, order) => sum + Number(order.pnl ?? 0), 0);
    const unrealized = openPositions.reduce(
      (sum, position) => sum + position.pnl,
      0,
    );

    return {
      balance: cash,
      equity: cash + openMarketValue,
      dayPnl: realizedToday + unrealized,
      openPositions,
      closedTrades,
    };
  }

  async openOrder(userId: string, input: OpenSimOrderInput) {
    const account = await this.prisma.simulatedAccount.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    let entryPrice = input.entryPrice;
    if (entryPrice === undefined) {
      const cached = await this.quoteCache.getQuote(input.symbol).catch(() => null);
      if (!cached) {
        throw new BadRequestException(
          `No price available for ${input.symbol}; provide entryPrice explicitly`,
        );
      }
      entryPrice = cached.quote.price;
    }

    const cost = entryPrice * input.quantity;
    if (new Prisma.Decimal(account.balance).lessThan(cost)) {
      throw new BadRequestException('Insufficient simulated balance');
    }

    const [order] = await this.prisma.$transaction([
      this.prisma.simulatedOrder.create({
        data: {
          accountId: account.id,
          symbol: input.symbol,
          side: input.side,
          quantity: input.quantity,
          entryPrice,
          stopPrice: input.stopPrice,
          targetPrice: input.targetPrice,
          source: input.source,
        },
      }),
      this.prisma.simulatedAccount.update({
        where: { id: account.id },
        data: { balance: { decrement: cost } },
      }),
    ]);
    return order;
  }

  async closeOrder(userId: string, orderId: string, exitPrice: number) {
    const account = await this.prisma.simulatedAccount.findUnique({
      where: { userId },
    });
    if (!account) throw new NotFoundException('Simulated account not found');

    const order = await this.prisma.simulatedOrder.findFirst({
      where: { id: orderId, accountId: account.id, status: 'open' },
    });
    if (!order) throw new NotFoundException('Open order not found');

    const entry = Number(order.entryPrice);
    const direction = order.side === 'buy' ? 1 : -1;
    const pnl = (exitPrice - entry) * direction * order.quantity;
    const proceeds = entry * order.quantity + pnl;

    const [closed] = await this.prisma.$transaction([
      this.prisma.simulatedOrder.update({
        where: { id: order.id },
        data: {
          status: 'closed',
          exitPrice,
          closedAt: new Date(),
          pnl,
        },
      }),
      this.prisma.simulatedAccount.update({
        where: { id: account.id },
        data: { balance: { increment: proceeds } },
      }),
    ]);
    return closed;
  }
}
