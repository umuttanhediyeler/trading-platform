import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { SimulationModule } from '../simulation/simulation.module';
import { MlBridgeService } from './ml-bridge.service';
import { SignalsController } from './signals.controller';
import { SignalsGateway } from './signals.gateway';

@Module({
  imports: [AuthModule, SimulationModule, MarketDataModule],
  controllers: [SignalsController],
  providers: [SignalsGateway, MlBridgeService],
  exports: [SignalsGateway, MlBridgeService],
})
export class SignalsModule {}
