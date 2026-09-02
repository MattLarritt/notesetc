import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';

@Module({
  imports: [AuthModule], // for AuthGuard + CsrfGuard
  controllers: [SpacesController],
  providers: [SpacesService],
  exports: [SpacesService],
})
export class SpacesModule {}
