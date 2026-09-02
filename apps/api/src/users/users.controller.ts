import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@notesetc/shared';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { CsrfGuard } from '../common/csrf/csrf';
import { auditContext, type NotesEtcRequest } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type CreateUserDto, type UpdateUserDto, createUserSchema, updateUserSchema } from './dto';
import { UsersService } from './users.service';

@ApiTags('admin-users')
@ApiBearerAuth('api-token')
@Controller('admin/users')
@UseGuards(AuthGuard, CsrfGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users (global admin).' })
  async list(@CurrentPrincipal() principal: Principal, @Req() req: NotesEtcRequest) {
    const data = await this.users.list(principal, auditContext(req));
    return { data };
  }

  @Post()
  @ApiOperation({ summary: 'Create a local user (global admin).' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.users.create(principal, dto, auditContext(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user’s status or global role (global admin).' })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.users.update(principal, id, dto, auditContext(req));
  }
}
