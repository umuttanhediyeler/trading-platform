import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { BillingService, PlanTier } from './billing.service';

class CheckoutDto {
  @IsIn(['basic', 'premium'])
  planTier!: PlanTier;
}

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  checkout(@Req() req: Request, @Body() dto: CheckoutDto) {
    const user = req.user as AuthenticatedUser;
    return this.billingService.createCheckoutSession(user.id, dto.planTier);
  }

  @Post('portal')
  portal(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.billingService.createPortalSession(user.id);
  }
}
