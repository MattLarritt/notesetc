import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';

@Module({
  imports: [AuthModule], // for AuthGuard + CsrfGuard
  controllers: [ProposalsController],
  providers: [ProposalsService],
  exports: [ProposalsService],
})
export class ProposalsModule {}
