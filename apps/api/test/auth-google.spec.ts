import { UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { AuthService } from '../src/auth/auth.service';

describe('AuthService Google login', () => {
  const jwt = {
    sign: jest
      .fn()
      .mockReturnValueOnce('access-token')
      .mockReturnValueOnce('refresh-token'),
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'GOOGLE_CLIENT_ID') return 'google-client-id';
      if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
      return fallback;
    }),
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jwt.sign
      .mockReset()
      .mockReturnValueOnce('access-token')
      .mockReturnValueOnce('refresh-token');
  });

  it('rejects an invalid Google ID token without querying users', async () => {
    (
      jest.spyOn(OAuth2Client.prototype, 'verifyIdToken') as unknown as jest.Mock
    )
      .mockRejectedValue(new Error('bad signature'));
    const prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    const service = new AuthService(
      prisma as any,
      jwt as any,
      config as any,
    );

    await expect(service.loginWithGoogle('forged-token')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('creates a Google user only after token verification', async () => {
    (
      jest.spyOn(OAuth2Client.prototype, 'verifyIdToken') as unknown as jest.Mock
    ).mockResolvedValue({
      getPayload: () => ({
        email: 'Verified@Example.com',
        email_verified: true,
      }),
    });
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'u-google',
          email: 'verified@example.com',
          executionMode: 'manual',
          subscription: { planTier: 'free' },
          riskSettings: { killSwitchActive: false },
        }),
      },
    };
    const service = new AuthService(
      prisma as any,
      jwt as any,
      config as any,
    );

    await expect(service.loginWithGoogle('valid-token')).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'u-google',
        email: 'verified@example.com',
        executionMode: 'manual',
        planTier: 'free',
        killSwitchActive: false,
      },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'verified@example.com' },
      include: { subscription: true, riskSettings: true },
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'verified@example.com',
        provider: 'google',
      }),
      include: { subscription: true, riskSettings: true },
    });
  });

  it('rejects a Google token whose email is not verified', async () => {
    (
      jest.spyOn(OAuth2Client.prototype, 'verifyIdToken') as unknown as jest.Mock
    ).mockResolvedValue({
      getPayload: () => ({
        email: 'unverified@example.com',
        email_verified: false,
      }),
    });
    const service = new AuthService(
      { user: {} } as any,
      jwt as any,
      config as any,
    );

    await expect(service.loginWithGoogle('valid-signature')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
