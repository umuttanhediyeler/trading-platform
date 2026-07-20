import {
  Body,
  Controller,
  Delete,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { ExecutionMode, ExecutionService } from './execution.service';

class SetModeDto {
  @IsIn(['manual', 'one_click', 'full_auto'])
  mode!: ExecutionMode;

  @IsOptional()
  @IsBoolean()
  riskAcknowledged?: boolean;
}

class KillSwitchDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('execution')
@UseGuards(JwtAuthGuard)
export class ExecutionController {
  constructor(private readonly executionService: ExecutionService) {}

  @Post('mode')
  setMode(@Req() req: Request, @Body() dto: SetModeDto) {
    const user = req.user as AuthenticatedUser;
    return this.executionService.setMode(
      user.id,
      user.planTier,
      dto.mode,
      dto.riskAcknowledged ?? false,
    );
  }

  @Post('kill-switch')
  activateKillSwitch(@Req() req: Request, @Body() dto: KillSwitchDto) {
    const user = req.user as AuthenticatedUser;
    return this.executionService.activateKillSwitch(user.id, dto.reason);
  }

  @Delete('kill-switch')
  deactivateKillSwitch(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.executionService.deactivateKillSwitch(user.id);
  }
}
