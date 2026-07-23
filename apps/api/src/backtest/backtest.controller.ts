import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsISO8601, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { RequiresEntitlement } from '../common/decorators/requires-entitlement.decorator';
import { EntitlementGuard } from '../auth/guards/entitlement.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BacktestBridgeService } from './backtest-bridge.service';
import { BacktestQuotaService } from './backtest-quota.service';

class RunBacktestDto {
  @IsString()
  strategyId!: string;

  @IsString()
  symbol!: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  params?: Record<string, unknown>;
}

@Controller('backtest')
@UseGuards(JwtAuthGuard, EntitlementGuard)
export class BacktestController {
  constructor(
    private readonly bridge: BacktestBridgeService,
    private readonly quota: BacktestQuotaService,
  ) {}

  @Post('run')
  @RequiresEntitlement('backtest_enabled')
  async run(@Req() req: Request, @Body() dto: RunBacktestDto) {
    const user = req.user as AuthenticatedUser;
    const reservationId = await this.quota.reserve(user.id, user.planTier, dto);
    try {
      return this.bridge.startRun(user.id, dto, reservationId);
    } catch (error) {
      await this.quota.fail(reservationId, error);
      throw error;
    }
  }

  @Get('jobs/:jobId')
  @RequiresEntitlement('backtest_enabled')
  job(@Param('jobId') jobId: string) {
    return this.bridge.getJob(jobId);
  }

  @Get('quota')
  @RequiresEntitlement('backtest_enabled')
  quotaStatus(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.quota.getQuota(user.id, user.planTier);
  }

  @Get('runs')
  @RequiresEntitlement('backtest_enabled')
  listRuns(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.bridge.listRuns(user.id);
  }

  @Get('strategies')
  @RequiresEntitlement('backtest_enabled')
  listStrategies() {
    return this.bridge.listStrategies();
  }
}
