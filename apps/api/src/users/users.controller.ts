import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

class UpdateRiskDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  maxDailyTrades!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(20)
  maxDailyLossPercent!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.25)
  @Max(5)
  maxRiskPerTrade!: number;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /** Profile + plan info for the authenticated user. */
  @Get('me')
  async me(@Req() req: Request) {
    const authUser = req.user as AuthenticatedUser;
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      include: {
        subscription: true,
        riskSettings: true,
        brokerLink: { select: { broker: true, mode: true, connectedAt: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      executionMode: user.executionMode,
      plan: {
        tier: user.subscription?.planTier ?? 'free',
        status: user.subscription?.status ?? 'active',
        currentPeriodEnd: user.subscription?.currentPeriodEnd ?? null,
      },
      riskSettings: user.riskSettings
        ? {
            maxDailyTrades: user.riskSettings.maxDailyTrades,
            maxDailyLossPercent: user.riskSettings.maxDailyLossPercent,
            maxRiskPerTrade: user.riskSettings.maxRiskPerTrade,
            killSwitchActive: user.riskSettings.killSwitchActive,
            killSwitchReason: user.riskSettings.killSwitchReason,
            killSwitchAt: user.riskSettings.killSwitchAt,
          }
        : null,
      broker: user.brokerLink,
    };
  }

  @Put('me/risk')
  async updateRisk(@Req() req: Request, @Body() dto: UpdateRiskDto) {
    const authUser = req.user as AuthenticatedUser;
    const risk = await this.prisma.riskSettings.upsert({
      where: { userId: authUser.id },
      update: {
        maxDailyTrades: dto.maxDailyTrades,
        maxDailyLossPercent: dto.maxDailyLossPercent,
        maxRiskPerTrade: dto.maxRiskPerTrade,
      },
      create: {
        userId: authUser.id,
        maxDailyTrades: dto.maxDailyTrades,
        maxDailyLossPercent: dto.maxDailyLossPercent,
        maxRiskPerTrade: dto.maxRiskPerTrade,
      },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: { executionMode: true },
    });
    return {
      maxDailyTrades: risk.maxDailyTrades,
      maxDailyLossPercent: risk.maxDailyLossPercent,
      maxRiskPerTrade: risk.maxRiskPerTrade,
      killSwitchActive: risk.killSwitchActive,
      executionMode: user?.executionMode ?? 'manual',
    };
  }
}
