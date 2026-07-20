import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutoTradeWorker } from '../execution/auto-trade.worker';
import { ExecutionModule } from '../execution/execution.module';
import { BrokerController } from './broker.controller';
import { BrokerOrderService } from './broker-order.service';

@Module({
  // The broker registry is provided (and exported) by ExecutionModule.
  imports: [AuthModule, ExecutionModule],
  controllers: [BrokerController],
  providers: [BrokerOrderService, AutoTradeWorker],
  exports: [ExecutionModule, BrokerOrderService],
})
export class BrokerModule {}
