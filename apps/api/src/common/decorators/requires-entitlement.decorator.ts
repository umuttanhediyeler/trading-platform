import { SetMetadata } from '@nestjs/common';

export const ENTITLEMENT_KEY = 'required_entitlement';

/**
 * Marks a route as requiring a boolean entitlement (e.g. 'ai_signals_enabled').
 * Enforced by EntitlementGuard: the user's plan tier must have the entitlement
 * set to "true" in the Entitlement table, otherwise a 403 is returned.
 */
export const RequiresEntitlement = (key: string) =>
  SetMetadata(ENTITLEMENT_KEY, key);
