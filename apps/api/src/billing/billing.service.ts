import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

export type PlanTier = 'basic' | 'premium';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(
      this.config.get<string>('STRIPE_SECRET_KEY', 'sk_test_placeholder'),
      { apiVersion: '2024-04-10' },
    );
  }

  get webhookSecret(): string {
    return this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
  }

  private priceIdFor(planTier: PlanTier): string {
    const key =
      planTier === 'basic' ? 'STRIPE_PRICE_ID_BASIC' : 'STRIPE_PRICE_ID_PREMIUM';
    const priceId = this.config.get<string>(key);
    if (!priceId) {
      throw new BadRequestException(`Price not configured for plan '${planTier}'`);
    }
    return priceId;
  }

  private assertBillingEnabled() {
    if (this.config.get<string>('BILLING_ENABLED', 'false') !== 'true') {
      throw new ServiceUnavailableException(
        'Billing is temporarily disabled. Existing plan entitlements remain active.',
      );
    }
  }

  async createCheckoutSession(userId: string, planTier: PlanTier) {
    this.assertBillingEnabled();
    if (planTier !== 'basic' && planTier !== 'premium') {
      throw new BadRequestException('planTier must be "basic" or "premium"');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const webOrigin = this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: user.subscription?.stripeCustomerId ?? undefined,
      customer_email: user.subscription?.stripeCustomerId ? undefined : user.email,
      line_items: [{ price: this.priceIdFor(planTier), quantity: 1 }],
      success_url: `${webOrigin}/settings/billing?status=success`,
      cancel_url: `${webOrigin}/pricing?status=canceled`,
      metadata: { userId, planTier },
      subscription_data: { metadata: { userId, planTier } },
    });
    return { url: session.url };
  }

  async createPortalSession(userId: string) {
    this.assertBillingEnabled();
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    if (!subscription?.stripeCustomerId) {
      throw new BadRequestException('No Stripe customer for this user');
    }
    const webOrigin = this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
    const session = await this.stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${webOrigin}/settings/billing`,
    });
    return { url: session.url };
  }

  /** Processes a signature-verified Stripe event. */
  async handleWebhookEvent(event: Stripe.Event) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const planTier = session.metadata?.planTier;
        if (!userId || !planTier) {
          this.logger.warn('checkout.session.completed missing metadata');
          return;
        }
        await this.prisma.subscription.upsert({
          where: { userId },
          update: {
            planTier,
            status: 'active',
            stripeCustomerId: (session.customer as string) ?? undefined,
            stripeSubId: (session.subscription as string) ?? undefined,
          },
          create: {
            userId,
            planTier,
            status: 'active',
            stripeCustomerId: (session.customer as string) ?? null,
            stripeSubId: (session.subscription as string) ?? null,
          },
        });
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const status =
          sub.status === 'active' || sub.status === 'trialing'
            ? 'active'
            : sub.status === 'past_due'
              ? 'past_due'
              : 'canceled';
        await this.prisma.subscription.updateMany({
          where: { stripeSubId: sub.id },
          data: {
            status,
            planTier: (sub.metadata?.planTier as string) ?? undefined,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
          },
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        // Downgrade to free on cancellation.
        await this.prisma.subscription.updateMany({
          where: { stripeSubId: sub.id },
          data: { status: 'canceled', planTier: 'free', stripeSubId: null },
        });
        break;
      }
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  }
}
