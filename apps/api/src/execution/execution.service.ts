import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntitlementsService } from '../auth/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiskGuardService } from './risk-guard.service';

export type ExecutionMode = 'manual' | 'one_click' | 'full_auto';

@Injectable()
export class ExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsService,
    private readonly riskGuard: RiskGuardService,
  ) {}

  async setMode(
    userId: string,
    planTier: string,
    mode: ExecutionMode,
    riskAcknowledged: boolean,
  ) {
    if (mode === 'one_click' || mode === 'full_auto') {
      const key =
        mode === 'full_auto' ? 'auto_trade_enabled' : 'one_click_enabled';
      if (!(await this.entitlements.isEnabled(planTier, key))) {
        throw new ForbiddenException(
          `Your plan (${planTier}) does not allow '${mode}' execution mode`,
        );
      }
    }

    if (mode === 'full_auto') {
      // full_auto must never be enabled without explicit risk confirmation.
      if (!riskAcknowledged) {
        throw new BadRequestException(
          'full_auto requires riskAcknowledged: true after reviewing risk settings',
        );
      }
      const [settings, brokerLink] = await Promise.all([
        this.prisma.riskSettings.findUnique({ where: { userId } }),
        this.prisma.brokerLink.findUnique({ where: { userId } }),
      ]);
      if (!settings) {
        throw new BadRequestException(
          'Configure and review risk settings before enabling full_auto',
        );
      }
      // Explicit full_auto + risk ack means the user wants automation back —
      // clear a previously tripped kill switch instead of silently failing
      // and leaving the UI stuck on manual after refresh.
      if (settings.killSwitchActive) {
        await this.deactivateKillSwitch(userId);
      }
      if (!brokerLink) {
        throw new BadRequestException(
          'Connect a paper broker before enabling full_auto',
        );
      }
      if (
        brokerLink.mode === 'live' &&
        (this.config.get('ALLOW_LIVE_BROKER') !== 'true' ||
          this.config.get('ALLOW_FULL_AUTO_LIVE') !== 'true')
      ) {
        throw new ForbiddenException(
          'Full-auto requires a paper broker unless both live safety flags are explicitly enabled',
        );
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { executionMode: mode },
    });
    const risk = await this.prisma.riskSettings.findUnique({
      where: { userId },
      select: { killSwitchActive: true },
    });
    return {
      executionMode: user.executionMode,
      killSwitchActive: Boolean(risk?.killSwitchActive),
    };
  }

  async activateKillSwitch(userId: string, reason?: string) {
    await this.riskGuard.triggerKillSwitch(
      userId,
      reason ?? 'Manually activated by user',
    );
    return { killSwitchActive: true, executionMode: 'manual' as const };
  }

  async deactivateKillSwitch(userId: string) {
    await this.prisma.riskSettings.upsert({
      where: { userId },
      update: {
        killSwitchActive: false,
        killSwitchReason: null,
        killSwitchAt: null,
      },
      create: { userId, killSwitchActive: false },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { executionMode: true },
    });
    return {
      killSwitchActive: false,
      executionMode: user?.executionMode ?? 'manual',
    };
  }
}
