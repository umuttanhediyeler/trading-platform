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
      this.logger.log(`Cached ${assets.length} Alpaca US equity assets`);
      return assets;
    } catch (error) {
      this.logger.warn(
        `Failed to load Alpaca assets; using curated symbol fallback: ${(error as Error).message}`,
      );
      return this.fallbackAssets();
    }
  }

  /** Fire-and-forget warm of the full catalog (safe to call repeatedly). */
  warmCache(): void {
    void this.getAssets().catch(() => undefined);
  }

  /** Instant map from in-memory cache only (empty if not warmed yet). */
  async getCachedNameMap(): Promise<Map<string, string>> {
    if (cachedAssets && Date.now() - cacheTimestamp < ASSET_CACHE_TTL_MS) {
      return new Map(cachedAssets.map((asset) => [asset.symbol, asset.name]));
    }
    return new Map(
      this.fallbackAssets().map((asset) => [asset.symbol, asset.name]),
    );
  }

  /**
   * Search the full Alpaca catalog by ticker/name. Prefix matches on symbol
   * rank first so typeahead feels progressive (“A” → “AA” → “AAPL”).
   */
  async searchAssets(query: string, limit = 100): Promise<MarketAsset[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const assets = await this.getAssets().catch(() => this.fallbackAssets());

    const scored: Array<{ asset: MarketAsset; score: number }> = [];
    for (const asset of assets) {
      const symbol = asset.symbol.toLowerCase();
      const name = asset.name.toLowerCase();
      let score = -1;
      if (symbol === needle) score = 300;
      else if (symbol.startsWith(needle)) score = 200 - Math.min(symbol.length, 50);
      else if (symbol.includes(needle)) score = 100;
      else if (name.startsWith(needle)) score = 80;
      else if (name.includes(needle)) score = 40;
      if (score >= 0) scored.push({ asset, score });
    }

    return scored
      .sort(
        (a, b) =>
          b.score - a.score || a.asset.symbol.localeCompare(b.asset.symbol),
      )
      .slice(0, limit)
      .map(({ asset }) => asset);
  }

  private fallbackAssets(): MarketAsset[] {
    return UNIVERSE_INFO.map(({ symbol, name }) => ({ symbol, name }));
  }
}
