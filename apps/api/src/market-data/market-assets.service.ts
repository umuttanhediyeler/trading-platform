import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UNIVERSE_INFO } from './universe';

const ALPACA_TRADING_URL = 'https://paper-api.alpaca.markets';
const ASSET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface MarketAsset {
  symbol: string;
  name: string;
  exchange?: string;
}

interface AlpacaAsset {
  symbol?: string;
  name?: string;
  exchange?: string;
  tradable?: boolean;
}

let cachedAssets: MarketAsset[] | null = null;
let cacheTimestamp = 0;

@Injectable()
export class MarketAssetsService {
  private readonly logger = new Logger(MarketAssetsService.name);

  constructor(private readonly config: ConfigService) {}

  async getAssets(): Promise<MarketAsset[]> {
    if (cachedAssets && Date.now() - cacheTimestamp < ASSET_CACHE_TTL_MS) {
      return cachedAssets;
    }

    const apiKey = this.config.get<string>('ALPACA_API_KEY', '');
    const apiSecret = this.config.get<string>('ALPACA_SECRET_KEY', '');
    if (!apiKey || !apiSecret) {
      this.logger.warn('Alpaca credentials missing; using curated symbol fallback');
      return this.fallbackAssets();
    }

    try {
      const params = new URLSearchParams({
        status: 'active',
        asset_class: 'us_equity',
      });
      const response = await fetch(`${ALPACA_TRADING_URL}/v2/assets?${params.toString()}`, {
        headers: {
          'APCA-API-KEY-ID': apiKey,
          'APCA-API-SECRET-KEY': apiSecret,
        },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const assets = ((await response.json()) as AlpacaAsset[])
        .filter((asset) => asset.tradable && asset.symbol)
        .map((asset) => ({
          symbol: asset.symbol!.trim().toUpperCase(),
          name: asset.name?.trim() || asset.symbol!.trim().toUpperCase(),
          ...(asset.exchange ? { exchange: asset.exchange } : {}),
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));

      if (assets.length === 0) {
        throw new Error('Alpaca returned no tradable US equities');
      }

      cachedAssets = assets;
      cacheTimestamp = Date.now();
      return assets;
    } catch (error) {
      this.logger.warn(
        `Failed to load Alpaca assets; using curated symbol fallback: ${(error as Error).message}`,
      );
      return this.fallbackAssets();
    }
  }

  private fallbackAssets(): MarketAsset[] {
    return UNIVERSE_INFO.map(({ symbol, name }) => ({ symbol, name }));
  }
}
