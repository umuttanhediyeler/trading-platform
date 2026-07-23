import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Request, Response } from 'express';
import { AuthService, AuthTokens } from './auth.service';

class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

class RefreshDto {
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

class GoogleLoginDto {
  @IsString()
  idToken!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // match longest refresh
const REFRESH_SHORT_MS = 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.register(dto.email, dto.password);
    return this.respond(res, tokens, false);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rememberMe = Boolean(dto.rememberMe);
    const tokens = await this.authService.login(
      dto.email,
      dto.password,
      rememberMe,
    );
    return this.respond(res, tokens, rememberMe);
  }

  @Post('google')
  @HttpCode(200)
  async google(
    @Body() dto: GoogleLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rememberMe = dto.rememberMe !== false;
    const tokens = await this.authService.loginWithGoogle(
      dto.idToken,
      rememberMe,
    );
    return this.respond(res, tokens, rememberMe);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Cookie for browser flows; body for server-side clients (e.g. NextAuth).
    const token = req.cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const tokens = await this.authService.refresh(token);
    return this.respond(res, tokens, true);
  }

  /**
   * Refresh token goes into an httpOnly cookie and is also returned in the
   * body so the NextAuth server (a different origin in dev) can store and
   * rotate it inside its own encrypted session cookie.
   * Login also returns `user` so the web client skips a second /users/me hop.
   */
  private respond(res: Response, tokens: AuthTokens, rememberMe: boolean) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: rememberMe ? REFRESH_MAX_AGE_MS : REFRESH_SHORT_MS,
      path: '/auth',
    });
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: tokens.user,
    };
  }
}
