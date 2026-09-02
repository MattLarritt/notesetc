import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Action, type Principal } from '@notesetc/shared';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { AuthorizationService } from '../authz/authorization.service';
import { auditContext, type NotesEtcRequest } from '../common/request-context';
import { AuditRepository } from '../repositories/audit.repository';

/**
 * Read side of the audit log (global admin only). Authorization is performed here
 * rather than in AuditService to avoid an Audit<->Authz DI cycle (Authz depends on
 * AuditService for recording denials).
 */
@ApiTags('audit')
@ApiBearerAuth('api-token')
@Controller('admin/audit')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(
    private readonly authz: AuthorizationService,
    private readonly audit: AuditRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read recent audit-log entries (global admin only).' })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Req() req: NotesEtcRequest,
    @Query('action') action?: string,
    @Query('actorType') actorType?: string,
    @Query('result') result?: string,
    @Query('limit') limit?: string,
  ) {
    await this.authz.authorize(principal, Action.AdminAuditRead, { type: 'global' }, auditContext(req));
    const data = await this.audit.query({
      action,
      actorType,
      result,
      limit: limit ? Number(limit) : 200,
    });
    return { data };
  }
}
