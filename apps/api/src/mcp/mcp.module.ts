import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { PagesModule } from '../pages/pages.module';
import { SearchModule } from '../search/search.module';
import { SpacesModule } from '../spaces/spaces.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [AuthModule, AttachmentsModule, SpacesModule, PagesModule, SearchModule, AutomationsModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
