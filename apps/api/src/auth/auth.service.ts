import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  planTier?: string;
  executionMode?: string;
}

export interface AuthUserProfile {
  id: string;
  email: string;
  executionMode: string;
  planTier: string;
  killSwitchActive: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUserProfile;
}

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: normalized,
        passwordHash,
        // Every user starts on the free plan with a simulation account.
        subscription: { create: { planTier: 'free', status: 'active' } },
        simAccount: { create: {} },
        riskSettings: { create: {} },
      },
      include: { subscription: true, riskSettings: true },
    });

    return this.issueTokens(user, false);
  }

  async login(email: string, password: string, rememberMe = false) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      include: { subscription: true, riskSettings: true },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokens(user, rememberMe);
  }

  /** Verify Google's signed ID token before issuing an API session. */
  async loginWithGoogle(idToken: string, rememberMe = true) {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new UnauthorizedException('Google login is not configured');
    }
    let email: string;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.email || payload.email_verified !== true) {
        throw new Error('Google email is not verified');
      }
      email = payload.email.toLowerCase();
    } catch {
      throw new UnauthorizedException('Invalid Google identity token');
    }

    let user = await this.prisma.user.findUnique({
      where: { email },
      include: { subscription: true, riskSettings: true },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          provider: 'google',
          subscription: { create: { planTier: 'free', status: 'active' } },
          simAccount: { create: {} },
          riskSettings: { create: {} },
        },
        include: { subscription: true, riskSettings: true },
      });
    }
    // A verified Google token proves ownership of the email. Keep an existing
    // credentials provider unchanged so password login continues to work.
    return this.issueTokens(user, rememberMe);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    try {
      const payload = this.jwt.verify<JwtPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { subscription: true, riskSettings: true },
      });
      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      // Preserve remaining remember window from refresh JWT exp when possible.
      const rememberMe =
        typeof (payload as { exp?: number }).exp === 'number' &&
        (payload as { exp: number }).exp * 1000 - Date.now() >
          7 * 24 * 60 * 60 * 1000;
      return this.issueTokens(user, rememberMe);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private issueTokens(
    user: {
      id: string;
      email: string;
      executionMode: string;
      subscription?: { planTier: string } | null;
      riskSettings?: { killSwitchActive: boolean } | null;
    },
    rememberMe: boolean,
  ): AuthTokens {
    const planTier = user.subscription?.planTier ?? 'free';
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      planTier,
      executionMode: user.executionMode,
    };
    const profile: AuthUserProfile = {
      id: user.id,
      email: user.email,
      executionMode: user.executionMode,
      planTier,
      killSwitchActive: Boolean(user.riskSettings?.killSwitchActive),
    };
    return {
      accessToken: this.jwt.sign(payload, {
        // Longer access token when remembered → fewer refresh/DB round-trips.
        expiresIn: rememberMe ? '2h' : '30m',
      }),
      refreshToken: this.jwt.sign(payload, {
        secret: this.refreshSecret,
        expiresIn: rememberMe ? '30d' : '1d',
      }),
      user: profile,
    };
  }

  private get refreshSecret(): string {
    return this.config.get<string>('JWT_REFRESH_SECRET', 'dev-refresh-secret');
  }
}
