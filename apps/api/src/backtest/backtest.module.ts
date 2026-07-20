import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { BacktestBridgeService } from './backtest-bridge.service';
import { BacktestController } from './backtest.controller';
import { BacktestQuotaService } from './backtest-quota.service';

@Module({
  imports: [AuthModule, MarketDataModule],
  controllers: [BacktestController],
  providers: [BacktestBridgeService, BacktestQuotaService],
})
export class BacktestModule {}
