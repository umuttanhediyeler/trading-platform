import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';
import { BillingService } from './billing.service';

@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly billingService: BillingService) {}

  /**
   * Stripe webhook receiver. The signature MUST be verified against the raw
   * request body via stripe.webhooks.constructEvent — unverified events are
   * never processed. Requires rawBody:true in NestFactory.create (main.ts).
   */
  @Post('stripe')
  @HttpCode(200)
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    let event: Stripe.Event;
    try {
      event = this.billingService.stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        this.billingService.webhookSecret,
      );
    } catch (err) {
      throw new BadRequestException(
        `Webhook signature verification failed: ${(err as Error).message}`,
      );
    }

    await this.billingService.handleWebhookEvent(event);
    return { received: true };
  }
}
