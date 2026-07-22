import type { ConnectionOptions } from 'bullmq';

/** BullMQ connection options from REDIS_URL, including TLS for Upstash (rediss://). */
export function bullmqConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const connection: ConnectionOptions = {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
  if (url.protocol === 'rediss:') {
    connection.tls = {};
  }
  return connection;
}
