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
import {
  type AddMemberDto,
  type CreateGroupDto,
  type UpdateGroupDto,
  addMemberSchema,
  createGroupSchema,
  updateGroupSchema,
} from './dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@ApiBearerAuth('api-token')
@Controller('admin/groups')
@UseGuards(AuthGuard, CsrfGuard)
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'List all groups (global admin only).' })
  async list(@CurrentPrincipal() principal: Principal, @Req() req: NotesEtcRequest) {
    const data = await this.groups.list(principal, auditContext(req));
    return { data };
  }

  @Post()
  @ApiOperation({ summary: 'Create a group (global admin only).' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createGroupSchema)) dto: CreateGroupDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.groups.create(principal, dto, auditContext(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename / describe a custom group (global admin only).' })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGroupSchema)) dto: UpdateGroupDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.groups.update(principal, id, dto, auditContext(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a custom group (global admin only).' })
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ): Promise<void> {
    await this.groups.remove(principal, id, auditContext(req));
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List a group’s members (global admin only).' })
  async members(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    const data = await this.groups.listMembers(principal, id, auditContext(req));
    return { data };
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a user to a group (global admin only).' })
  async addMember(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addMemberSchema)) dto: AddMemberDto,
    @Req() req: NotesEtcRequest,
  ) {
    await this.groups.addMember(principal, id, dto.userId, auditContext(req));
    return { ok: true };
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a user from a group (global admin only).' })
  async removeMember(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: NotesEtcRequest,
  ): Promise<void> {
    await this.groups.removeMember(principal, id, userId, auditContext(req));
  }
}
