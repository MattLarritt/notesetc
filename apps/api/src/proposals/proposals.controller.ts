import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@notesetc/shared';
import { CsrfGuard } from '../common/csrf/csrf';
import { auditContext, type NotesEtcRequest } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { type CreateProposalDto, createProposalSchema } from './dto';
import { ProposalsService } from './proposals.service';

@ApiTags('proposals')
@ApiBearerAuth('api-token')
@Controller()
@UseGuards(AuthGuard, CsrfGuard)
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Post('pages/:id/proposals')
  @ApiOperation({ summary: 'Propose a change to a page (creates a suggested change).' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createProposalSchema)) dto: CreateProposalDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.proposals.create(principal, id, dto, auditContext(req));
  }

  @Get('pages/:id/proposals')
  @ApiOperation({ summary: 'List proposals for a page.' })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    const data = await this.proposals.listForPage(principal, id, auditContext(req));
    return { data };
  }

  @Post('proposals/:id/approve')
  @ApiOperation({ summary: 'Approve a proposal — applies it as a new page version.' })
  async approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.proposals.approve(principal, id, auditContext(req));
  }

  @Post('proposals/:id/reject')
  @ApiOperation({ summary: 'Reject a proposal.' })
  async reject(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.proposals.reject(principal, id, auditContext(req));
  }
}
