import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { SimExecutionWorker } from './sim-execution.worker';
import { SimulationController } from './simulation.controller';
import { SimulationService } from './simulation.service';

@Module({
  imports: [AuthModule, MarketDataModule],
  controllers: [SimulationController],
  providers: [SimulationService, SimExecutionWorker],
  exports: [SimulationService],
})
export class SimulationModule {}

