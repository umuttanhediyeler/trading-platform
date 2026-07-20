import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AlertsModule } from './common/alerts.module';
import { BacktestModule } from './backtest/backtest.module';
import { BillingModule } from './billing/billing.module';
import { BrokerModule } from './broker/broker.module';
import { ExecutionModule } from './execution/execution.module';
import { HealthModule } from './health/health.module';
import { MarketDataModule } from './market-data/market-data.module';
import { MetricsModule } from './metrics/metrics.module';
import { ModelsModule } from './models/models.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScannerModule } from './scanner/scanner.module';
import { SignalsModule } from './signals/signals.module';
import { SimulationModule } from './simulation/simulation.module';
import { UsersModule } from './users/users.module';
import { WatchlistsModule } from './watchlists/watchlists.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AlertsModule,
    PrismaModule,
    MetricsModule,
    HealthModule,
    AuthModule,
    UsersModule,
    BillingModule,
    MarketDataModule,
    ScannerModule,
    SignalsModule,
    ModelsModule,
    WatchlistsModule,
    BacktestModule,
    SimulationModule,
    ExecutionModule,
    BrokerModule,
  ],
})
export class AppModule {}
