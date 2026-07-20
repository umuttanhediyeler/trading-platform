import { BadRequestException } from '@nestjs/common';
import { BrokerAdapter } from './broker-adapter.interface';
import { BrokerRegistry } from './broker-registry.service';

function adapter(name: 'alpaca' | 'binance'): BrokerAdapter {
  return {
    name,
    capabilities: {
      marketOrders: true,
      limitOrders: true,
      bracketOrders: name === 'alpaca',
      fractionalQuantity: true,
      positions: name === 'alpaca' ? 'full' : 'balances_only',
      paper: true,
      live: true,
    },
    placeOrder: jest.fn(),
    getOrderByClientOrderId: jest.fn(),
    cancelOrder: jest.fn(),
    getPositions: jest.fn(),
    getAccountBalance: jest.fn(),
  };
}

describe('BrokerRegistry', () => {
  it('resolves only explicitly registered adapters', () => {
    const alpaca = adapter('alpaca');
    const registry = new BrokerRegistry([alpaca, adapter('binance')]);

    expect(registry.get('alpaca')).toBe(alpaca);
    expect(() => registry.get('unknown')).toThrow(BadRequestException);
  });

  it('rejects duplicate registrations at startup', () => {
    expect(() => new BrokerRegistry([adapter('alpaca'), adapter('alpaca')])).toThrow(
      /Duplicate/,
    );
  });

  it('publishes exact disabled requirements without pretending IBKR or banks work', () => {
    const registry = new BrokerRegistry([adapter('alpaca'), adapter('binance')]);
    const providers = registry.providers();

    expect(providers.find((provider) => provider.id === 'interactive_brokers')).toEqual(
      expect.objectContaining({
        availability: 'disabled',
        setupRequirements: expect.arrayContaining([
          expect.stringContaining('Client Portal Gateway'),
        ]),
      }),
    );
    expect(providers.find((provider) => provider.id === 'bank')).toEqual(
      expect.objectContaining({ availability: 'unavailable' }),
    );
  });
});
