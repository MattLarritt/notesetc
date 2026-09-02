import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AutomationsModule } from '../automations/automations.module';
import { AuthModule } from '../auth/auth.module';
import { PagesModule } from '../pages/pages.module';
import { SearchModule } from '../search/search.module';
import { SpacesModule } from '../spaces/spaces.module';
import { AiChatsService } from './ai-chats.service';
import { AiMemoryService } from './ai-memory.service';
import { AiSettingsService } from './ai-settings.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [AuthModule, AttachmentsModule, AutomationsModule, PagesModule, SearchModule, SpacesModule],
  controllers: [AiController],
  providers: [AiService, AiSettingsService, AiChatsService, AiMemoryService],
})
export class AiModule {}
