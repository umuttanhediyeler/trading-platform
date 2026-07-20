import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import Stripe from 'stripe';
import request from 'supertest';
import { BillingService } from '../src/billing/billing.service';
import { StripeWebhookController } from '../src/billing/stripe-webhook.controller';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Stripe webhook signature verification', () => {
  let app: INestApplication;
  const webhookSecret = 'whsec_test_secret';

  const prismaMock = {
    subscription: {
      upsert: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [StripeWebhookController],
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const eventPayload = JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        customer: 'cus_123',
        subscription: 'sub_123',
        metadata: { userId: 'user-1', planTier: 'premium' },
      },
    },
  });

  it('rejects requests without a signature header', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(eventPayload)
      .expect(400);
    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();
  });

  it('rejects requests with an invalid signature', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=123,v1=deadbeef')
      .send(eventPayload)
      .expect(400);
    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();
  });

  it('processes a correctly signed checkout.session.completed event', async () => {
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: eventPayload,
      secret: webhookSecret,
    });

    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(eventPayload)
      .expect(200);

    expect(res.body).toEqual({ received: true });
    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        update: expect.objectContaining({ planTier: 'premium', status: 'active' }),
      }),
    );
  });
});
