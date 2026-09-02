import {
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
import {
  type CreateTemplateDto,
  type SetTemplateRefDto,
  type UpdateTemplateDto,
  createTemplateSchema,
  setTemplateRefSchema,
  updateTemplateSchema,
} from './dto';
import { TemplatesService } from './templates.service';

@ApiTags('templates')
@ApiBearerAuth('api-token')
@Controller()
@UseGuards(AuthGuard, CsrfGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('spaces/:spaceId/templates')
  @ApiOperation({ summary: 'List a space’s templates.' })
  async list(@CurrentPrincipal() p: Principal, @Param('spaceId') spaceId: string, @Req() req: NotesEtcRequest) {
    return { data: await this.templates.list(p, spaceId, auditContext(req)) };
  }

  @Post('spaces/:spaceId/templates')
  @ApiOperation({ summary: 'Create a template (space admin+).' })
  async create(
    @CurrentPrincipal() p: Principal,
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(createTemplateSchema)) dto: CreateTemplateDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.templates.create(p, spaceId, dto.name, auditContext(req));
  }

  @Put('spaces/:spaceId/default-template')
  @ApiOperation({ summary: 'Set the space’s default template for new pages (space admin+).' })
  async setDefault(
    @CurrentPrincipal() p: Principal,
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(setTemplateRefSchema)) dto: SetTemplateRefDto,
    @Req() req: NotesEtcRequest,
  ) {
    await this.templates.setSpaceDefault(p, spaceId, dto.templateId, auditContext(req));
    return { ok: true };
  }

  @Get('spaces/:spaceId/new-page-template')
  @ApiOperation({ summary: 'Resolve the template pre-filled for a new page (parent → space default).' })
  async resolve(
    @CurrentPrincipal() p: Principal,
    @Param('spaceId') spaceId: string,
    @Req() req: NotesEtcRequest,
    @Query('parentId') parentId?: string,
  ) {
    return this.templates.resolveForNewPage(p, spaceId, parentId, auditContext(req));
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Get a template with its content.' })
  async get(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Req() req: NotesEtcRequest) {
    return this.templates.get(p, id, auditContext(req));
  }

  @Patch('templates/:id')
  @ApiOperation({ summary: 'Update a template’s name/content (space admin+).' })
  async update(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) dto: UpdateTemplateDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.templates.update(p, id, dto, auditContext(req));
  }

  @Delete('templates/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a template (space admin+).' })
  async remove(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Req() req: NotesEtcRequest): Promise<void> {
    await this.templates.remove(p, id, auditContext(req));
  }

  @Put('pages/:id/child-template')
  @ApiOperation({ summary: 'Set the template pre-filled for a page’s new subpages (space admin+).' })
  async setChild(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setTemplateRefSchema)) dto: SetTemplateRefDto,
    @Req() req: NotesEtcRequest,
  ) {
    await this.templates.setPageChildTemplate(p, id, dto.templateId, auditContext(req));
    return { ok: true };
  }
}
