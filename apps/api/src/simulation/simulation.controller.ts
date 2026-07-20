import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { SimulationService } from './simulation.service';

class OpenOrderDto {
  @IsString()
  symbol!: string;

  @IsIn(['buy', 'sell'])
  side!: 'buy' | 'sell';

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  entryPrice?: number;

  @IsNumber()
  stopPrice!: number;

  @IsNumber()
  targetPrice!: number;
}

class CloseOrderDto {
  @IsNumber()
  exitPrice!: number;
}

@Controller('simulation')
@UseGuards(JwtAuthGuard)
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Get('account')
  getAccount(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.simulationService.getAccount(user.id);
  }

  @Post('orders')
  openOrder(@Req() req: Request, @Body() dto: OpenOrderDto) {
    const user = req.user as AuthenticatedUser;
    return this.simulationService.openOrder(user.id, {
      ...dto,
      source: 'manual',
    });
  }

  @Post('orders/:id/close')
  closeOrder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CloseOrderDto,
  ) {
    const user = req.user as AuthenticatedUser;
    return this.simulationService.closeOrder(user.id, id, dto.exitPrice);
  }
}
