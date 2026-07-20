import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WatchlistsController } from './watchlists.controller';

@Module({
  imports: [AuthModule],
  controllers: [WatchlistsController],
})
export class WatchlistsModule {}
