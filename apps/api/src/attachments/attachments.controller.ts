import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Principal } from '@notesetc/shared';
import { CsrfGuard } from '../common/csrf/csrf';
import { auditContext, type NotesEtcRequest } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { AllowAnonymous } from '../auth/allow-anonymous.decorator';
import { AttachmentsService, MAX_UPLOAD_BYTES, type UploadedFile as MulterFile } from './attachments.service';

@ApiTags('attachments')
@ApiBearerAuth('api-token')
@Controller()
@UseGuards(AuthGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('spaces/:spaceId/attachments')
  @UseGuards(CsrfGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an image to a space (editor+). Returns its serve URL.' })
  async upload(
    @CurrentPrincipal() principal: Principal,
    @Param('spaceId') spaceId: string,
    @UploadedFile() file: MulterFile | undefined,
    @Query('pageId') pageId: string | undefined,
    @Req() req: NotesEtcRequest,
  ) {
    return this.attachments.upload(principal, spaceId, file, pageId, auditContext(req));
  }

  @Get('attachments/:id/meta')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Attachment metadata (filename, type, size) without the bytes.' })
  async meta(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.attachments.getMeta(principal, id, auditContext(req));
  }

  @Get('attachments/:id')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Serve attachment bytes (requires read access to its space).' })
  async serve(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Req() req: NotesEtcRequest,
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, record } = await this.attachments.getBytes(principal, id, auditContext(req));
    // Office formats are never inlined: a browser can't render them anyway, and
    // forcing download keeps any future type additions on the safe path.
    const inline = !download && AttachmentsService.isInline(record.contentType);
    const text = record.contentType.startsWith('text/');
    res.setHeader('Content-Type', text ? `${record.contentType}; charset=utf-8` : record.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(record.filename)}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Length', String(bytes.length));
    res.end(bytes);
  }
}
