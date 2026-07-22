import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AlertsService } from './common/alerts.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RedisIoAdapter } from './common/redis-io.adapter';

function assertSecrets() {
  const jwt = process.env.JWT_SECRET ?? '';
  const refresh = process.env.JWT_REFRESH_SECRET ?? '';
  const enc = process.env.ENCRYPTION_KEY ?? '';
  const isProd = process.env.NODE_ENV === 'production';
  const weak =
    !jwt ||
    !refresh ||
    jwt === 'dev-secret' ||
    refresh === 'dev-refresh-secret' ||
    !enc ||
    /^0+$/.test(enc);

  if (weak && isProd) {
    throw new Error(
      'Refusing to boot: JWT_SECRET / JWT_REFRESH_SECRET / ENCRYPTION_KEY must be set to non-default values in production',
    );
  }
  if (weak) {
    Logger.warn(
      'Weak or default secrets detected — OK for local dev, never for production',
      'Bootstrap',
    );
  }
}

async function bootstrap() {
  assertSecrets();

  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: 0.1,
    });
  }

  // Prevent a single Redis disconnect from killing the Nest process.
  process.on('unhandledRejection', (reason) => {
    Logger.warn(
      `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      'Bootstrap',
    );
  });

  // rawBody is required for Stripe webhook signature verification.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const socketAdapter = new RedisIoAdapter(app);
    try {
      await socketAdapter.connect(redisUrl);
      app.useWebSocketAdapter(socketAdapter);
      app.getHttpServer().once('close', () => void socketAdapter.close());
      Logger.log('Socket.IO Redis adapter connected', 'Bootstrap');
    } catch (error) {
      Logger.warn(
        `Socket.IO Redis adapter unavailable; using single-instance mode: ${(error as Error).message}`,
        'Bootstrap',
      );
      await socketAdapter.close().catch(() => undefined);
    }
  }

  app.use(cookieParser());
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(app.get(AlertsService)));
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
