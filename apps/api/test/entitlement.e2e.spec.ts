import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SignalsModule } from '../src/signals/signals.module';

/**
 * FAZ 1 acceptance test: a Free user calling the AI signals endpoint must
 * receive 403, while a Premium user gets 200. Prisma is mocked so no
 * database is required.
 */
describe('Entitlement enforcement (GET /signals)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let planTier: string;

  const seedEntitlements = [
    { id: '1', planTier: 'free', key: 'ai_signals_enabled', value: 'false' },
    { id: '2', planTier: 'basic', key: 'ai_signals_enabled', value: 'false' },
    { id: '3', planTier: 'premium', key: 'ai_signals_enabled', value: 'true' },
  ];

  const prismaMock = {
    user: {
      findUnique: jest.fn(async () => ({
        id: 'user-1',
        email: 'user@example.com',
        executionMode: 'manual',
        subscription: { planTier },
      })),
    },
    entitlement: {
      findMany: jest.fn(async () => seedEntitlements),
    },
    signal: {
      findMany: jest.fn(async () => [
        {
          id: 'sig-1',
          symbol: 'AAPL',
          strategyId: 'strat-1',
          entryPrice: 100,
          stopPrice: 98,
          targetPrice: 105,
          confidence: 0.8,
          generatedAt: new Date('2026-01-01T15:30:00.000Z'),
          status: 'open',
        },
      ]),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.DISABLE_WORKERS = 'true';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        AuthModule,
        SignalsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenFor = (userId: string) =>
    jwt.sign({ sub: userId, email: 'user@example.com' });

  it('returns 401 without a token', async () => {
    await request(app.getHttpServer()).get('/signals').expect(401);
  });

  it('returns 403 for a Free user', async () => {
    planTier = 'free';
    const res = await request(app.getHttpServer())
      .get('/signals')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .expect(403);
    expect(res.body.message).toContain('free');
  });

  it('returns 403 for a Basic user', async () => {
    planTier = 'basic';
    await request(app.getHttpServer())
      .get('/signals')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .expect(403);
  });

  it('returns 200 with signals for a Premium user', async () => {
    planTier = 'premium';
    const res = await request(app.getHttpServer())
      .get('/signals')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].symbol).toBe('AAPL');
  });
});
