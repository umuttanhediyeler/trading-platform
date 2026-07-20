import { ConfigService } from '@nestjs/config';
import { AlertsService } from './alerts.service';

describe('AlertsService', () => {
  const RESEND_KEY = 'rsnd_super_secret_key_should_never_be_logged';

  let config: { get: jest.Mock };
  let configValues: Record<string, string | undefined>;
  let service: AlertsService;
  let fetchMock: jest.Mock;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    configValues = {};
    config = {
      get: jest.fn((key: string) => configValues[key]),
    };
    service = new AlertsService(config as unknown as ConfigService);

    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    // Silence and capture the logger.
    warnSpy = jest
      .spyOn((service as unknown as { logger: any }).logger, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn((service as unknown as { logger: any }).logger, 'error')
      .mockImplementation(() => undefined);
    logSpy = jest
      .spyOn((service as unknown as { logger: any }).logger, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function requestBodies(): Array<{ url: string; body: any; headers: any }> {
    return fetchMock.mock.calls.map(([url, init]) => ({
      url,
      body: init?.body ? JSON.parse(init.body) : undefined,
      headers: init?.headers ?? {},
    }));
  }

  it('does nothing over the network when no channel is configured', async () => {
    await service.send('boot', 'info', { a: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it('posts to the webhook when ALERT_WEBHOOK_URL is set', async () => {
    configValues.ALERT_WEBHOOK_URL = 'https://hooks.example.com/abc';
    await service.send('order.rejected', 'warning', { symbol: 'AAPL' });

    const calls = requestBodies();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://hooks.example.com/abc');
    expect(calls[0].body).toMatchObject({
      event: 'order.rejected',
      severity: 'warning',
      detail: { symbol: 'AAPL' },
    });
    expect(calls[0].body.text).toContain('[WARNING] order.rejected');
  });

  it('sends both webhook and Resend email when both channels are configured', async () => {
    configValues.ALERT_WEBHOOK_URL = 'https://hooks.example.com/abc';
    configValues.RESEND_API_KEY = RESEND_KEY;
    configValues.ALERT_EMAIL_FROM = 'alerts@apexscan.dev';
    configValues.ALERT_EMAIL_TO = 'oncall@apexscan.dev, ops@apexscan.dev';

    await service.send('kill_switch', 'critical', { reason: 'loss limit' });

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toContain('https://hooks.example.com/abc');
    expect(urls).toContain('https://api.resend.com/emails');

    const emailCall = requestBodies().find(
      (c) => c.url === 'https://api.resend.com/emails',
    )!;
    expect(emailCall.body).toMatchObject({
      from: 'alerts@apexscan.dev',
      to: ['oncall@apexscan.dev', 'ops@apexscan.dev'],
      subject: '[CRITICAL] kill_switch',
    });
    expect(emailCall.headers.Authorization).toBe(`Bearer ${RESEND_KEY}`);
  });

  it('never logs the Resend API key, even on failure', async () => {
    configValues.RESEND_API_KEY = RESEND_KEY;
    configValues.ALERT_EMAIL_FROM = 'alerts@apexscan.dev';
    configValues.ALERT_EMAIL_TO = 'oncall@apexscan.dev';
    fetchMock.mockRejectedValue(new Error('network down'));

    await service.send('db.down', 'critical', {});

    const logged = [...warnSpy.mock.calls, ...errorSpy.mock.calls, ...logSpy.mock.calls]
      .flat()
      .map((v) => String(v))
      .join('\n');
    expect(logged).not.toContain(RESEND_KEY);
  });

  it('suppresses email below ALERT_EMAIL_MIN_SEVERITY but still logs', async () => {
    configValues.RESEND_API_KEY = RESEND_KEY;
    configValues.ALERT_EMAIL_FROM = 'alerts@apexscan.dev';
    configValues.ALERT_EMAIL_TO = 'oncall@apexscan.dev';
    configValues.ALERT_EMAIL_MIN_SEVERITY = 'critical';

    await service.send('cache.stale', 'warning', {});

    const emailCalls = fetchMock.mock.calls.filter(
      ([url]) => url === 'https://api.resend.com/emails',
    );
    expect(emailCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('defaults the email threshold to warning (info is suppressed)', async () => {
    configValues.RESEND_API_KEY = RESEND_KEY;
    configValues.ALERT_EMAIL_FROM = 'alerts@apexscan.dev';
    configValues.ALERT_EMAIL_TO = 'oncall@apexscan.dev';

    await service.send('heartbeat', 'info', {});
    expect(
      fetchMock.mock.calls.filter(([url]) => url === 'https://api.resend.com/emails'),
    ).toHaveLength(0);

    await service.send('heartbeat', 'warning', {});
    expect(
      fetchMock.mock.calls.filter(([url]) => url === 'https://api.resend.com/emails'),
    ).toHaveLength(1);
  });

  it('does not throw when the webhook delivery fails', async () => {
    configValues.ALERT_WEBHOOK_URL = 'https://hooks.example.com/abc';
    fetchMock.mockRejectedValue(new Error('timeout'));

    await expect(service.send('x', 'critical', {})).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Alert webhook delivery failed'),
    );
  });
});
