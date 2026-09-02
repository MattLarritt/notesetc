import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { SystemGroupsBootstrap } from './system-groups.bootstrap';

@Module({
  imports: [AuthModule], // for AuthGuard + CsrfGuard
  controllers: [GroupsController],
  providers: [GroupsService, SystemGroupsBootstrap],
  exports: [GroupsService],
})
export class GroupsModule {}
