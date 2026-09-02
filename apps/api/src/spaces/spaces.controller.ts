import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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
import { AllowAnonymous } from '../auth/allow-anonymous.decorator';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import {
  type CreateGrantDto,
  type CreateSpaceDto,
  type UpdateGrantDto,
  type UpdateSpaceDto,
  createGrantSchema,
  createSpaceSchema,
  updateGrantSchema,
  updateSpaceSchema,
} from './dto';
import { SpacesService } from './spaces.service';

@ApiTags('spaces')
@ApiBearerAuth('api-token')
@Controller('spaces')
@UseGuards(AuthGuard, CsrfGuard)
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get()
  @AllowAnonymous()
  @ApiOperation({ summary: 'List spaces the caller may read (public spaces for anonymous callers).' })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const data = await this.spaces.list(principal, includeArchived === 'true');
    return { data };
  }

  @Post()
  @ApiOperation({ summary: 'Create a space (global admin only).' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createSpaceSchema)) dto: CreateSpaceDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.spaces.create(principal, dto, auditContext(req));
  }

  @Get(':id')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Get a space by id.' })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.spaces.get(principal, id, auditContext(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a space (space admin+).' })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSpaceSchema)) dto: UpdateSpaceDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.spaces.update(principal, id, dto, auditContext(req));
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive a space (space admin+).' })
  async archive(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.spaces.archive(principal, id, auditContext(req));
  }

  @Post(':id/unarchive')
  @ApiOperation({ summary: 'Restore an archived space to active (space admin+).' })
  async unarchive(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.spaces.unarchive(principal, id, auditContext(req));
  }

  @Get(':id/grants')
  @ApiOperation({ summary: 'List permission grants on a space (space admin+).' })
  async listGrants(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    const data = await this.spaces.listGrants(principal, id, auditContext(req));
    return { data };
  }

  @Post(':id/grants')
  @ApiOperation({ summary: 'Grant a role on a space to a user or group (space admin+).' })
  async addGrant(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createGrantSchema)) dto: CreateGrantDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.spaces.addGrant(principal, id, dto, auditContext(req));
  }

  @Patch(':id/grants/:grantId')
  @ApiOperation({ summary: 'Change a grant’s role (space admin+).' })
  async updateGrant(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('grantId') grantId: string,
    @Body(new ZodValidationPipe(updateGrantSchema)) dto: UpdateGrantDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.spaces.updateGrant(principal, id, grantId, dto.role, auditContext(req));
  }

  @Delete(':id/grants/:grantId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a permission grant (space admin+).' })
  async removeGrant(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('grantId') grantId: string,
    @Req() req: NotesEtcRequest,
  ): Promise<void> {
    await this.spaces.removeGrant(principal, id, grantId, auditContext(req));
  }
}
