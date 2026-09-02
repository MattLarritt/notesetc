import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { LocalDiskStorageService, StorageService } from './storage.service';

@Module({
  imports: [AuthModule], // for AuthGuard + CsrfGuard
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    { provide: StorageService, useClass: LocalDiskStorageService },
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
