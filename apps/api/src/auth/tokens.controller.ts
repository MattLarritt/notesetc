import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@notesetc/shared';
import { CsrfGuard } from '../common/csrf/csrf';
import { auditContext, type NotesEtcRequest } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApiTokenService } from './api-token.service';
import { AuthGuard } from './auth.guard';
import { CurrentPrincipal } from './current-principal.decorator';
import { type CreateTokenDto, createTokenSchema } from './token.dto';

@ApiTags('api-tokens')
@ApiBearerAuth('api-token')
@Controller('admin/tokens')
@UseGuards(AuthGuard, CsrfGuard)
export class TokensController {
  constructor(private readonly tokens: ApiTokenService) {}

  @Get()
  @ApiOperation({ summary: 'List API tokens (global admin only). Secrets are never returned.' })
  async list(@CurrentPrincipal() principal: Principal, @Req() req: NotesEtcRequest) {
    const data = await this.tokens.list(principal, auditContext(req));
    return { data };
  }

  @Post()
  @ApiOperation({ summary: 'Create an API token (global admin only). Returns the secret once.' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createTokenSchema)) dto: CreateTokenDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.tokens.create(principal, dto, auditContext(req));
  }

  @Post(':id/rotate')
  @ApiOperation({ summary: 'Rotate a token in place (global admin): new secret, same identity. Returned once.' })
  async rotate(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.tokens.rotate(principal, id, auditContext(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an API token (global admin only).' })
  async revoke(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ): Promise<void> {
    await this.tokens.revoke(principal, id, auditContext(req));
  }
}
