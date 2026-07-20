import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';
import { Request } from 'express';
import { EntitlementsService } from '../auth/entitlements.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

class UpsertWatchlistDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  symbols!: string[];
}

@Controller('watchlists')
@UseGuards(JwtAuthGuard)
export class WatchlistsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get()
  list(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.prisma.watchlist.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: UpsertWatchlistDto) {
    const user = req.user as AuthenticatedUser;
    const max = await this.entitlements.getLimit(user.planTier, 'max_watchlists');
    const count = await this.prisma.watchlist.count({ where: { userId: user.id } });
    if (count >= max) {
      throw new ForbiddenException(
        `Your plan (${user.planTier}) allows at most ${max} watchlists`,
      );
    }
    const symbols = this.normalizeSymbols(dto.symbols);
    return this.prisma.watchlist.create({
      data: { userId: user.id, name: this.normalizeName(dto.name), symbols },
    });
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpsertWatchlistDto,
  ) {
    const user = req.user as AuthenticatedUser;
    const existing = await this.prisma.watchlist.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) throw new NotFoundException('Watchlist not found');
    return this.prisma.watchlist.update({
      where: { id },
      data: {
        name: this.normalizeName(dto.name),
        symbols: this.normalizeSymbols(dto.symbols),
      },
    });
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthenticatedUser;
    const existing = await this.prisma.watchlist.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) throw new NotFoundException('Watchlist not found');
    await this.prisma.watchlist.delete({ where: { id } });
    return { deleted: true };
  }

  private normalizeSymbols(symbols: string[]) {
    const cleaned = [
      ...new Set(
        symbols
          .map((s) => String(s).trim().toUpperCase())
          .filter((s) => /^[A-Z.]{1,10}$/.test(s)),
      ),
    ];
    if (cleaned.length === 0) {
      throw new BadRequestException('Watchlist needs at least one valid symbol');
    }
    return cleaned;
  }

  private normalizeName(name: string) {
    const normalized = name.trim();
    if (!normalized) throw new BadRequestException('Watchlist name is required');
    return normalized;
  }
}
