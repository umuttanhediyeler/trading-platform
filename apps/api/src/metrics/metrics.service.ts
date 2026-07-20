import { Injectable } from '@nestjs/common';
import { Gauge, Registry, collectDefaultMetrics, register } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Prometheus metrics: Node process defaults plus scrape-time gauges for
 * business state (open signals, active models, open broker orders). Domain
 * counters incremented by hot paths live in ./counters.ts on the default
 * registry; scrape output merges both.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  constructor(prisma: PrismaService) {
    collectDefaultMetrics({ register: this.registry, prefix: 'api_' });

    new Gauge({
      name: 'api_signals_open',
      help: 'Signals currently open',
      registers: [this.registry],
      collect: async function (this: Gauge) {
        const count = await prisma.signal
          .count({ where: { status: 'open' } })
          .catch(() => 0);
        this.set(count);
      },
    });
    new Gauge({
      name: 'api_models_active',
      help: 'Models currently active in the registry',
      registers: [this.registry],
      collect: async function (this: Gauge) {
        const count = await prisma.modelRegistry
          .count({ where: { isActive: true } })
          .catch(() => 0);
        this.set(count);
      },
    });
    new Gauge({
      name: 'api_broker_orders_open',
      help: 'Broker ledger orders in a non-terminal state',
      registers: [this.registry],
      collect: async function (this: Gauge) {
        const count = await prisma.brokerOrderLedger
          .count({
            where: { status: { in: ['pending', 'submitted'] } },
          })
          .catch(() => 0);
        this.set(count);
      },
    });
  }

  metrics(): Promise<string> {
    return Registry.merge([this.registry, register]).metrics();
  }
}
