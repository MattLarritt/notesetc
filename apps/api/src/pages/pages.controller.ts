import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
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
  type CreatePageDto,
  type MovePageDto,
  type RenamePageDto,
  type RestorePageDto,
  type SetMetadataDto,
  type UpdatePageDto,
  createPageSchema,
  movePageSchema,
  renamePageSchema,
  restorePageSchema,
  setMetadataSchema,
  updatePageSchema,
} from './dto';
import { PagesService } from './pages.service';

@ApiTags('pages')
@ApiBearerAuth('api-token')
@Controller()
@UseGuards(AuthGuard, CsrfGuard)
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  // --- space-scoped ---

  @Get('spaces/:spaceId/pages')
  @AllowAnonymous()
  @ApiOperation({
    summary:
      'List pages in a space (drafts hidden from viewers). Optional ?parentId=root|<id> for lazy tree loading.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Param('spaceId') spaceId: string,
    @Req() req: NotesEtcRequest,
    @Query('parentId') parentId?: string,
  ) {
    const data = await this.pages.list(principal, spaceId, auditContext(req), parentId);
    return { data };
  }

  @Get('spaces/:spaceKey/pages/by-path')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Resolve a page by slash-separated slug path within a space.' })
  async byPath(
    @CurrentPrincipal() principal: Principal,
    @Param('spaceKey') spaceKey: string,
    @Query('path') path: string,
    @Req() req: NotesEtcRequest,
  ) {
    if (!path) throw new BadRequestException('Query parameter "path" is required.');
    return this.pages.getByPath(principal, spaceKey, path, auditContext(req));
  }

  @Post('spaces/:spaceId/pages')
  @ApiOperation({ summary: 'Create a page (draft). Editor+.' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(createPageSchema)) dto: CreatePageDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.create(principal, spaceId, dto, auditContext(req));
  }

  // --- page-scoped ---

  @Get('pages/:id')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Get a page with its current version content.' })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.getById(principal, id, auditContext(req));
  }

  @Patch('pages/:id')
  @ApiOperation({ summary: 'Update a page (creates a new version). Requires baseVersionNumber.' })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePageSchema)) dto: UpdatePageDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.update(principal, id, dto, auditContext(req));
  }

  @Put('pages/:id/metadata')
  @ApiOperation({
    summary:
      'Replace a page’s integration metadata (JSON object). Editor+. Does NOT create a content version.',
  })
  async putMetadata(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setMetadataSchema)) dto: SetMetadataDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.setMetadata(principal, id, dto.metadata, { merge: false }, auditContext(req));
  }

  @Patch('pages/:id/metadata')
  @ApiOperation({
    summary:
      'Merge into a page’s metadata (top-level keys; a null value deletes a key). Editor+. No version created.',
  })
  async patchMetadata(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setMetadataSchema)) dto: SetMetadataDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.setMetadata(principal, id, dto.metadata, { merge: true }, auditContext(req));
  }

  @Post('pages/:id/publish')
  @ApiOperation({ summary: 'Publish a page (draft -> published). Editor+.' })
  async publish(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.publish(principal, id, auditContext(req));
  }

  @Post('pages/:id/archive')
  @ApiOperation({ summary: 'Archive a page. Editor+.' })
  async archive(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.archive(principal, id, auditContext(req));
  }

  @Delete('pages/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Hard-delete a page and its history. Space-admin; no subpages.' })
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    await this.pages.delete(principal, id, auditContext(req));
  }

  @Post('pages/:id/restore')
  @ApiOperation({ summary: 'Restore a prior version as a new version. Editor+.' })
  async restore(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(restorePageSchema)) dto: RestorePageDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.restore(principal, id, dto.versionId, auditContext(req));
  }

  @Post('pages/:id/move')
  @ApiOperation({ summary: 'Reorder, re-parent, or move a page (and its subtree) to another space. Space admin — reorganize.' })
  async move(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(movePageSchema)) dto: MovePageDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.move(principal, id, dto, auditContext(req));
  }

  @Post('pages/:id/sort-children')
  @ApiOperation({ summary: 'Sort a page’s direct subpages alphabetically. Space admin — reorganize.' })
  async sortChildren(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    await this.pages.sortChildren(principal, id, auditContext(req));
    return { ok: true };
  }

  @Post('spaces/:spaceId/sort-pages')
  @ApiOperation({ summary: 'Sort a space’s top-level pages alphabetically. Space admin — reorganize.' })
  async sortSpacePages(
    @CurrentPrincipal() principal: Principal,
    @Param('spaceId') spaceId: string,
    @Req() req: NotesEtcRequest,
  ) {
    await this.pages.sortSpacePages(principal, spaceId, auditContext(req));
    return { ok: true };
  }

  @Post('pages/:id/rename')
  @ApiOperation({ summary: 'Rename a page (title only). Editor+.' })
  async rename(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renamePageSchema)) dto: RenamePageDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.rename(principal, id, dto.title, auditContext(req));
  }

  @Get('pages/:id/versions')
  @AllowAnonymous()
  @ApiOperation({ summary: 'List a page version history (newest first).' })
  async versions(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    const data = await this.pages.listVersions(principal, id, auditContext(req));
    return { data };
  }

  // --- version-scoped ---

  @Get('versions/:id')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Get a specific version snapshot (with content).' })
  async version(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.pages.getVersion(principal, id, auditContext(req));
  }
}
