import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@notesetc/shared';
import { CsrfGuard } from '../common/csrf/csrf';
import { auditContext, type NotesEtcRequest } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { AllowAnonymous } from '../auth/allow-anonymous.decorator';
import {
  type CreateCommentDto,
  type ResolveCommentDto,
  type UpdateCommentDto,
  createCommentSchema,
  resolveCommentSchema,
  updateCommentSchema,
} from './dto';
import { CommentsService } from './comments.service';

@ApiTags('comments')
@ApiBearerAuth('api-token')
@Controller()
@UseGuards(AuthGuard, CsrfGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('pages/:pageId/comments')
  @AllowAnonymous()
  @ApiOperation({ summary: 'List a page’s comment threads.' })
  async list(@CurrentPrincipal() p: Principal, @Param('pageId') pageId: string, @Req() req: NotesEtcRequest) {
    return this.comments.list(p, pageId, auditContext(req));
  }

  @Post('pages/:pageId/comments')
  @ApiOperation({ summary: 'Post a comment or reply (editor+).' })
  async create(
    @CurrentPrincipal() p: Principal,
    @Param('pageId') pageId: string,
    @Body(new ZodValidationPipe(createCommentSchema)) dto: CreateCommentDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.comments.create(p, pageId, dto, auditContext(req));
  }

  @Patch('comments/:id')
  @ApiOperation({ summary: 'Edit your own comment.' })
  async update(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCommentSchema)) dto: UpdateCommentDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.comments.update(p, id, dto.body, auditContext(req));
  }

  @Delete('comments/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a comment (author, or space admin to moderate).' })
  async remove(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Req() req: NotesEtcRequest): Promise<void> {
    await this.comments.remove(p, id, auditContext(req));
  }

  @Post('comments/:id/resolve')
  @ApiOperation({ summary: 'Resolve or reopen a comment thread (editor+).' })
  async resolve(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveCommentSchema)) dto: ResolveCommentDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.comments.setResolved(p, id, dto.resolved, auditContext(req));
  }
}
