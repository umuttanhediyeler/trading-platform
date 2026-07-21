import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlpacaDataProvider } from './providers/alpaca.provider';
import { AlphaVantageProvider } from './providers/alpha-vantage.provider';
import { MARKET_DATA_PROVIDER } from './providers/market-data-provider.interface';
import { PolygonProvider } from './providers/polygon.provider';
import { BarAggregatorService } from './bar-aggregator.service';
import { DailyBarsService } from './daily-bars.service';
import { IngestionWorker } from './ingestion.worker';
import { MarketAssetsService } from './market-assets.service';
import { MarketDataController } from './market-data.controller';
import { QuoteCacheService } from './quote-cache.service';
import { SignalUniverseService } from './signal-universe.service';

@Module({
  controllers: [MarketDataController],
  providers: [
    PolygonProvider,
    AlphaVantageProvider,
    AlpacaDataProvider,
    {
      // Selected via MARKET_DATA_PROVIDER env: alpaca | polygon | alpha_vantage.
      provide: MARKET_DATA_PROVIDER,
      inject: [ConfigService, AlpacaDataProvider, PolygonProvider, AlphaVantageProvider],
      useFactory: (
        config: ConfigService,
        alpaca: AlpacaDataProvider,
        polygon: PolygonProvider,
        alphaVantage: AlphaVantageProvider,
      ) => {
        const name = config.get<string>('MARKET_DATA_PROVIDER', 'alpaca');
        switch (name) {
          case 'polygon':
            return polygon;
          case 'alpha_vantage':
            return alphaVantage;
          default:
            return alpaca;
        }
      },
    },
    QuoteCacheService,
    MarketAssetsService,
    BarAggregatorService,
    DailyBarsService,
    IngestionWorker,
    SignalUniverseService,
  ],
  exports: [
    MARKET_DATA_PROVIDER,
    QuoteCacheService,
    BarAggregatorService,
    DailyBarsService,
    SignalUniverseService,
  ],
})
export class MarketDataModule {}
