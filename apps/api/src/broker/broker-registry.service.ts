import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  BROKER_ADAPTERS,
  BrokerAdapter,
  BrokerName,
} from './broker-adapter.interface';

export interface BrokerProviderDescriptor {
  id: string;
  name: string;
  availability: 'available' | 'disabled' | 'unavailable';
  credentialLabels: { apiKey: string; apiSecret: string } | null;
  capabilities: BrokerAdapter['capabilities'] | null;
  description: string;
  setupRequirements?: string[];
}

@Injectable()
export class BrokerRegistry {
  private readonly adapters: ReadonlyMap<string, BrokerAdapter>;

  constructor(
    @Inject(BROKER_ADAPTERS) adapters: readonly BrokerAdapter[],
  ) {
    const entries = adapters.map((adapter) => [adapter.name, adapter] as const);
    if (new Set(entries.map(([name]) => name)).size !== entries.length) {
      throw new Error('Duplicate broker adapter registration');
    }
    this.adapters = new Map(entries);
  }

  get(name: string): BrokerAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new BadRequestException(
        `Broker "${name}" is unavailable. Supported adapters: ${[
          ...this.adapters.keys(),
        ].join(', ')}`,
      );
    }
    return adapter;
  }

  isSupported(name: string): name is BrokerName {
    return this.adapters.has(name);
  }

  providers(): BrokerProviderDescriptor[] {
    const available: BrokerProviderDescriptor[] = [
      {
        id: 'alpaca',
        name: 'Alpaca',
        availability: 'available',
        credentialLabels: { apiKey: 'API key ID', apiSecret: 'API secret key' },
        capabilities: this.get('alpaca').capabilities,
        description: 'US equities with paper and gated live order execution.',
      },
      {
        id: 'binance',
        name: 'Binance Spot',
        availability: 'available',
        credentialLabels: { apiKey: 'API key', apiSecret: 'Secret key' },
        capabilities: this.get('binance').capabilities,
        description:
          'Crypto spot trading. Paper uses Binance Spot Testnet; live remains behind server live-trading gates.',
      },
    ];
    return [
      ...available,
      {
        id: 'interactive_brokers',
        name: 'Interactive Brokers',
        availability: 'disabled',
        credentialLabels: null,
        capabilities: null,
        description:
          'Client Portal integration is disabled until a gateway-backed authenticated session can be operated safely.',
        setupRequirements: [
          'A reachable Client Portal Gateway HTTPS base URL configured server-side',
          'An authenticated brokerage session established through the gateway UI',
          'Session-cookie isolation per user, /iserver/auth/status verification, and periodic /tickle keepalive',
          'Explicit account selection and gateway TLS trust configuration',
        ],
      },
      {
        id: 'bank',
        name: 'Bank integration',
        availability: 'unavailable',
        credentialLabels: null,
        capabilities: null,
        description:
          'No generic bank trading API exists; a named bank and its reviewed API contract are required before an adapter can be implemented.',
      },
    ];
  }
}
