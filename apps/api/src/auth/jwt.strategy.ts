import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './auth.service';

export interface AuthenticatedUser {
  id: string;
  email: string;
  planTier: string;
  executionMode: string;
}

const CACHE_TTL_MS = 60_000;

/**
 * JWT validation with a short in-memory cache.
 * Every authenticated API call used to hit Postgres; under worker load that
 * exhausted the Prisma pool and made login return 500.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly cache = new Map<
    string,
    { user: AuthenticatedUser; expiresAt: number }
  >();

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev-secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const cached = this.cache.get(payload.sub);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    // Prefer claims embedded at issue time — avoids a DB round-trip when present.
    if (payload.planTier && payload.executionMode) {
      const fromClaims: AuthenticatedUser = {
        id: payload.sub,
        email: payload.email,
        planTier: payload.planTier,
        executionMode: payload.executionMode,
      };
      this.cache.set(payload.sub, {
        user: fromClaims,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return fromClaims;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { subscription: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    const authenticated: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      planTier: user.subscription?.planTier ?? 'free',
      executionMode: user.executionMode,
    };
    this.cache.set(payload.sub, {
      user: authenticated,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return authenticated;
  }
}
