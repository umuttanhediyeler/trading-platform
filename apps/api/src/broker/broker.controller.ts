import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { Request } from 'express';
import { EntitlementsService } from '../auth/entitlements.service';
import { EntitlementGuard } from '../auth/guards/entitlement.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { RequiresEntitlement } from '../common/decorators/requires-entitlement.decorator';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  BrokerCredentials,
  BrokerName,
} from './broker-adapter.interface';
import { BrokerOrderService } from './broker-order.service';
import { BrokerRegistry } from './broker-registry.service';

class ConnectBrokerDto {
  @IsIn(['alpaca', 'binance'])
  broker!: BrokerName;

  @IsString()
  @MinLength(1)
  apiKey!: string;

  @IsString()
  @MinLength(1)
  apiSecret!: string;

  /** Always defaults to paper; live must be requested explicitly. */
  @IsOptional()
  @IsIn(['paper', 'live'])
  mode?: 'paper' | 'live';
}

class PlaceOrderDto {
  @IsString()
  symbol!: string;

  @IsIn(['buy', 'sell'])
  side!: 'buy' | 'sell';

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsIn(['market', 'limit'])
  type!: 'market' | 'limit';

  @IsOptional()
  @IsNumber()
  limitPrice?: number;

  @IsString()
  @MinLength(8)
  clientOrderId!: string;
}

@Controller('broker')
@UseGuards(JwtAuthGuard, EntitlementGuard)
export class BrokerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsService,
    private readonly orders: BrokerOrderService,
    private readonly registry: BrokerRegistry,
  ) {}

  @Get('providers')
  providers() {
    return this.registry.providers();
  }

  @Post('connect')
  @RequiresEntitlement('broker_enabled')
  async connect(@Req() req: Request, @Body() dto: ConnectBrokerDto) {
    const user = req.user as AuthenticatedUser;
    const key = this.encryptionKey();
    const mode = dto.mode ?? 'paper';
    if (
      mode === 'live' &&
      this.config.get<string>('ALLOW_LIVE_BROKER', 'false') !== 'true'
    ) {
      throw new ForbiddenException(
        'Live broker mode is disabled. Set ALLOW_LIVE_BROKER=true only after paper soak.',
      );
    }
    const credentials: BrokerCredentials = {
      broker: dto.broker,
      apiKey: dto.apiKey,
      apiSecret: dto.apiSecret,
      mode,
    };
    // Verify the credentials and selected environment before persisting them.
    await this.registry.get(dto.broker).getAccountBalance(credentials);

    const link = await this.prisma.brokerLink.upsert({
      where: { userId: user.id },
      update: {
        broker: dto.broker,
        apiKeyEnc: encryptSecret(dto.apiKey, key),
        apiSecretEnc: encryptSecret(dto.apiSecret, key),
        mode,
        connectedAt: new Date(),
      },
      create: {
        userId: user.id,
        broker: dto.broker,
        apiKeyEnc: encryptSecret(dto.apiKey, key),
        apiSecretEnc: encryptSecret(dto.apiSecret, key),
        mode,
      },
    });
    // Never return encrypted (or plain) credentials to the client.
    return { broker: link.broker, mode: link.mode, connectedAt: link.connectedAt };
  }

  @Get('positions')
  @RequiresEntitlement('broker_enabled')
  async positions(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    const creds = await this.loadCredentials(user.id);
    return this.orders.getPositions(creds);
  }

  @Get('orders')
  @RequiresEntitlement('broker_enabled')
  async orderHistory(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.prisma.brokerOrderLedger.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        clientOrderId: true,
        brokerOrderId: true,
        broker: true,
        mode: true,
        symbol: true,
        side: true,
        quantity: true,
        orderType: true,
        limitPrice: true,
        source: true,
        signalId: true,
        status: true,
        brokerStatus: true,
        failureReason: true,
        submittedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  @Post('orders/reconcile')
  @RequiresEntitlement('broker_enabled')
  async reconcileOrders(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    const creds = await this.loadCredentials(user.id);
    return this.orders.reconcile(user.id, creds);
  }

  @Post('orders')
  async placeOrder(@Req() req: Request, @Body() dto: PlaceOrderDto) {
    const user = req.user as AuthenticatedUser;

    // Real orders require auto_trade (full auto) or one_click entitlement.
    const [autoTrade, oneClick] = await Promise.all([
      this.entitlements.isEnabled(user.planTier, 'auto_trade_enabled'),
      this.entitlements.isEnabled(user.planTier, 'one_click_enabled'),
    ]);
    if (!autoTrade && !oneClick) {
      throw new ForbiddenException(
        `Your plan (${user.planTier}) does not allow placing real orders`,
      );
    }

    const creds = await this.loadCredentials(user.id);
    return this.orders.submit(user.id, creds, dto, { source: 'one_click' });
  }

  private async loadCredentials(userId: string): Promise<BrokerCredentials> {
    const link = await this.prisma.brokerLink.findUnique({ where: { userId } });
    if (!link) {
      throw new BadRequestException('No broker connected. POST /broker/connect first.');
    }
    const key = this.encryptionKey();
    if (!this.registry.isSupported(link.broker)) {
      throw new BadRequestException(
        `Stored broker "${link.broker}" is no longer supported; reconnect a supported provider`,
      );
    }
    return {
      broker: link.broker,
      apiKey: decryptSecret(link.apiKeyEnc, key),
      apiSecret: decryptSecret(link.apiSecretEnc, key),
      mode: link.mode as 'paper' | 'live',
    };
  }

  private encryptionKey(): string {
    const key = this.config.get<string>('ENCRYPTION_KEY', '');
    if (!key) {
      throw new BadRequestException('ENCRYPTION_KEY is not configured');
    }
    return key;
  }
}
