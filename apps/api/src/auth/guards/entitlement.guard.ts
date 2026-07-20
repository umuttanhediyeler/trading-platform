import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENTITLEMENT_KEY } from '../../common/decorators/requires-entitlement.decorator';
import { EntitlementsService } from '../entitlements.service';
import { AuthenticatedUser } from '../jwt.strategy';

/**
 * Enforces @RequiresEntitlement('...') on routes. Must run after JwtAuthGuard
 * so that request.user (with planTier) is populated. Returns 403 when the
 * user's plan does not include the entitlement — e.g. a Free user calling
 * GET /signals.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredKey = this.reflector.getAllAndOverride<string>(
      ENTITLEMENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    const enabled = await this.entitlements.isEnabled(
      user.planTier,
      requiredKey,
    );
    if (!enabled) {
      throw new ForbiddenException(
        `Your plan (${user.planTier}) does not include '${requiredKey}'. Upgrade to access this feature.`,
      );
    }
    return true;
  }
}
