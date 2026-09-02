import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';

@Module({
  imports: [AuthModule], // for AuthGuard + CsrfGuard
  controllers: [PagesController],
  providers: [PagesService],
  exports: [PagesService],
})
export class PagesModule {}
