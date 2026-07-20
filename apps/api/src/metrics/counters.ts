import { Counter, Gauge, register } from 'prom-client';

/**
 * Domain counters shared with hot paths. Module-level singletons on the
 * default registry so services can increment them without dependency
 * injection (keeps constructors and tests unchanged).
 */

function counter(name: string, help: string, labelNames: string[] = []) {
  return (
    (register.getSingleMetric(name) as Counter | undefined) ??
    new Counter({ name, help, labelNames })
  );
}

export const signalsCreatedTotal = counter(
  'api_signals_created_total',
  'AI signals created',
);

export const brokerOrdersSubmittedTotal = counter(
  'api_broker_orders_submitted_total',
  'Broker orders submitted (paper or live)',
  ['mode'],
);

export const killSwitchTriggersTotal = counter(
  'api_kill_switch_triggers_total',
  'Kill switch activations',
);

export const wsConnectionsGauge: Gauge =
  (register.getSingleMetric('api_ws_connections') as Gauge | undefined) ??
  new Gauge({
    name: 'api_ws_connections',
    help: 'Authenticated WebSocket connections',
  });
