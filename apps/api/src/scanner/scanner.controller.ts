import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { IsNotEmpty, IsObject, IsString } from 'class-validator';
import { Request } from 'express';
import { EntitlementsService } from '../auth/entitlements.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { SCAN_UNIVERSE } from '../market-data/scan-universe';
import { PrismaService } from '../prisma/prisma.service';
import {
  FilterGroup,
  countConditions,
  validateDSL,
} from './filters/filter.types';
import { ScanExecutionService } from './scan-execution.service';
import { SCAN_TEMPLATES } from './scan-templates';
import { ScannerGateway } from './scanner.gateway';

class CreateScanDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsObject()
  filterDSL!: FilterGroup;
}

@Controller('scans')
@UseGuards(JwtAuthGuard)
export class ScannerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly gateway: ScannerGateway,
    private readonly scanExecution: ScanExecutionService,
  ) {}

  @Get('templates')
  getTemplates() {
    return SCAN_TEMPLATES;
  }

  @Get()
  async list(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.prisma.scanDefinition.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateScanDto) {
    const user = req.user as AuthenticatedUser;
    const name = this.normalizeName(dto.name);

    const errors = validateDSL(dto.filterDSL);
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Invalid filter DSL', errors });
    }

    const maxFilters = await this.entitlements.getLimit(
      user.planTier,
      'max_scan_filters',
    );
    const used = countConditions(dto.filterDSL);
    if (used > maxFilters) {
      throw new ForbiddenException(
        `Your plan (${user.planTier}) allows at most ${maxFilters} scan filters; this scan uses ${used}.`,
      );
    }

    return this.prisma.scanDefinition.create({
      data: {
        userId: user.id,
        name,
        filterDSL: dto.filterDSL as object,
      },
    });
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateScanDto,
  ) {
    const user = req.user as AuthenticatedUser;
    const name = this.normalizeName(dto.name);
    const existing = await this.prisma.scanDefinition.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) throw new NotFoundException('Scan not found');
    await this.assertValidAndAllowed(user, dto.filterDSL);
    return this.prisma.scanDefinition.update({
      where: { id },
      data: { name, filterDSL: dto.filterDSL as object },
    });
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthenticatedUser;
    const deleted = await this.prisma.scanDefinition.deleteMany({
      where: { id, userId: user.id },
    });
    if (deleted.count === 0) throw new NotFoundException('Scan not found');
    return { deleted: true };
  }

  @Post(':id/run')
  async run(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const user = req.user as AuthenticatedUser;
    const scan = await this.prisma.scanDefinition.findFirst({
      where: { id, userId: user.id },
    });
    if (!scan) {
      throw new NotFoundException('Scan not found');
    }

    const dsl = scan.filterDSL as unknown as FilterGroup;
    const universe = SCAN_UNIVERSE;
    const offset = Math.max(0, Number(offsetRaw) || 0);
    const requested = Number(limitRaw);
    // Default = full universe (Scanner page). Dashboard passes a small limit
    // for first paint, then expands with offset.
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(1, Math.floor(requested)), universe.length)
      : universe.length;
    const slice = universe.slice(offset, offset + limit);

    try {
      const { rows, scannedSymbols } = await this.scanExecution.execute(
        dsl,
        slice,
      );

      if (scannedSymbols === 0 && slice.length > 0) {
        throw new ServiceUnavailableException(
          'Market data was unavailable for every symbol in this scan batch',
        );
      }
      this.gateway.emitScanResult(user.id, scan.id, rows);
      const nextOffset = offset + limit;
      return {
        scanId: scan.id,
        rows,
        scannedSymbols,
        batchSize: slice.length,
        totalSymbols: universe.length,
        offset,
        limit,
        hasMore: nextOffset < universe.length,
        nextOffset: nextOffset < universe.length ? nextOffset : null,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/connection pool|P2024|Timed out fetching/i.test(message)) {
        throw new ServiceUnavailableException(
          'Database is busy — please retry the scan in a few seconds',
        );
      }
      throw new ServiceUnavailableException(
        `Scan failed: ${message.slice(0, 200)}`,
      );
    }
  }

  private async assertValidAndAllowed(
    user: AuthenticatedUser,
    filterDSL: FilterGroup,
  ) {
    const errors = validateDSL(filterDSL);
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Invalid filter DSL', errors });
    }
    const maxFilters = await this.entitlements.getLimit(
      user.planTier,
      'max_scan_filters',
    );
    const used = countConditions(filterDSL);
    if (used > maxFilters) {
      throw new ForbiddenException(
        `Your plan (${user.planTier}) allows at most ${maxFilters} scan filters; this scan uses ${used}.`,
      );
    }
  }

  private normalizeName(name: string) {
    const normalized = name.trim();
    if (!normalized) throw new BadRequestException('Scan name is required');
    return normalized;
  }
}
