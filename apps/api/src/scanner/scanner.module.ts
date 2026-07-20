import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { RealtimeQuotesService } from './realtime-quotes.service';
import { ScanExecutionService } from './scan-execution.service';
import { ScannerController } from './scanner.controller';
import { ScannerGateway } from './scanner.gateway';

@Module({
  imports: [AuthModule, MarketDataModule],
  controllers: [ScannerController],
  providers: [ScannerGateway, RealtimeQuotesService, ScanExecutionService],
  exports: [ScannerGateway],
})
export class ScannerModule {}
