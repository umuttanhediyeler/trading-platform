import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SignalsModule } from '../signals/signals.module';
import { ModelLifecycleService } from './model-lifecycle.service';
import { ModelsController } from './models.controller';

@Module({
  imports: [AuthModule, SignalsModule],
  controllers: [ModelsController],
  providers: [ModelLifecycleService],
})
export class ModelsModule {}
