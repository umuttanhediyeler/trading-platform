import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AlertSeverity = 'info' | 'warning' | 'critical';

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

/**
 * Operational alerting. Every event is always logged locally, then fanned out
 * to any configured delivery channels:
 *
 *   1. Webhook  — posts a Slack/Discord-compatible JSON body to
 *      ALERT_WEBHOOK_URL (plus the raw event for machine consumers).
 *   2. Email    — optional, dependency-free HTTP call to the Resend API
 *      (https://resend.com). Enabled only when RESEND_API_KEY, ALERT_EMAIL_FROM
 *      and ALERT_EMAIL_TO are all set. Gated by ALERT_EMAIL_MIN_SEVERITY so
 *      routine info events don't spam inboxes.
 *
 * Channels are delivered concurrently and independently: a failure in one never
 * throws and never blocks the other, because an alerting outage must not break
 * trading paths. Secrets (the API key, auth headers) are NEVER logged.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly config: ConfigService) {}

  async send(
    event: string,
    severity: AlertSeverity,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    const message = `[${severity.toUpperCase()}] ${event} ${JSON.stringify(detail)}`;
    if (severity === 'critical') this.logger.error(message);
    else if (severity === 'warning') this.logger.warn(message);
    else this.logger.log(message);

    await Promise.allSettled([
      this.deliverWebhook(message, event, severity, detail),
      this.deliverEmail(message, event, severity, detail),
    ]);
  }

  private async deliverWebhook(
    message: string,
    event: string,
    severity: AlertSeverity,
    detail: Record<string, unknown>,
  ): Promise<void> {
    const url = this.config.get<string>('ALERT_WEBHOOK_URL');
    if (!url) return;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          event,
          severity,
          detail,
          ts: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(4000),
      });
    } catch (err) {
      this.logger.warn(`Alert webhook delivery failed: ${(err as Error).message}`);
    }
  }

  /**
   * Sends the alert as an email via Resend's REST API. No SDK dependency — a
   * single fetch keeps the container slim and avoids supply-chain surface.
   * Returns silently (never throws) when the channel is unconfigured, below the
   * severity threshold, or the provider call fails.
   */
  private async deliverEmail(
    message: string,
    event: string,
    severity: AlertSeverity,
    detail: Record<string, unknown>,
  ): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('ALERT_EMAIL_FROM');
    const toRaw = this.config.get<string>('ALERT_EMAIL_TO');
    if (!apiKey || !from || !toRaw) return;

    const minSeverity = this.resolveMinSeverity();
    if (SEVERITY_RANK[severity] < SEVERITY_RANK[minSeverity]) return;

    const to = toRaw
      .split(',')
      .map((addr) => addr.trim())
      .filter(Boolean);
    if (to.length === 0) return;

    const subject = `[${severity.toUpperCase()}] ${event}`;
    const text = `${message}\n\nEvent: ${event}\nSeverity: ${severity}\nWhen: ${new Date().toISOString()}\n\nDetail:\n${JSON.stringify(detail, null, 2)}`;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ from, to, subject, text }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        // Log status only — never the request (which carries the API key).
        this.logger.warn(`Alert email delivery failed: HTTP ${res.status}`);
      }
    } catch (err) {
      this.logger.warn(`Alert email delivery failed: ${(err as Error).message}`);
    }
  }

  private resolveMinSeverity(): AlertSeverity {
    const raw = (this.config.get<string>('ALERT_EMAIL_MIN_SEVERITY') ?? 'warning')
      .trim()
      .toLowerCase();
    if (raw === 'info' || raw === 'warning' || raw === 'critical') return raw;
    return 'warning';
  }
}
