import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AlpacaAdapter } from '../broker/alpaca.adapter';
import { BinanceAdapter } from '../broker/binance.adapter';
import { BROKER_ADAPTERS } from '../broker/broker-adapter.interface';
import { BrokerRegistry } from '../broker/broker-registry.service';
import { ExecutionController } from './execution.controller';
import { ExecutionGateway } from './execution.gateway';
import { ExecutionService } from './execution.service';
import { RiskGuardService } from './risk-guard.service';

@Module({
  imports: [AuthModule],
  controllers: [ExecutionController],
  providers: [
    ExecutionService,
    RiskGuardService,
    ExecutionGateway,
    // The registry lives here so RiskGuardService can
    // cancel broker orders on kill switch without a module cycle with
    // BrokerModule, which imports this module.
    AlpacaAdapter,
    BinanceAdapter,
    {
      provide: BROKER_ADAPTERS,
      inject: [AlpacaAdapter, BinanceAdapter],
      useFactory: (alpaca: AlpacaAdapter, binance: BinanceAdapter) => [
        alpaca,
        binance,
      ],
    },
    BrokerRegistry,
  ],
  exports: [ExecutionService, RiskGuardService, BrokerRegistry],
})
export class ExecutionModule {}
