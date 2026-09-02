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
import { AutomationsService } from './automations.service';
import {
  type CreateAutomationDto,
  type SetVariableDto,
  type TestAutomationDto,
  type UpdateAutomationDto,
  createAutomationSchema,
  setVariableSchema,
  testAutomationSchema,
  updateAutomationSchema,
  variableNameSchema,
} from './dto';

@ApiTags('automations')
@ApiBearerAuth('api-token')
@Controller('admin/automations')
@UseGuards(AuthGuard, CsrfGuard)
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  @ApiOperation({ summary: 'List automations (global admin only).' })
  async list(@CurrentPrincipal() principal: Principal, @Req() req: NotesEtcRequest) {
    const data = await this.automations.list(principal, auditContext(req));
    return { data };
  }

  @Post()
  @ApiOperation({ summary: 'Create an automation. Webhook secrets are returned once.' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createAutomationSchema)) dto: CreateAutomationDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.automations.create(principal, dto, auditContext(req));
  }

  // NOTE: /runs and /variables routes are declared before /:id so those words are
  // never captured as an automation id.

  @Get('variables')
  @ApiOperation({ summary: 'List GLOBAL automation variables. Secure values are never returned.' })
  async listVariables(@CurrentPrincipal() principal: Principal, @Req() req: NotesEtcRequest) {
    const data = await this.automations.listVariables(principal, auditContext(req));
    return { data };
  }

  @Put('variables/:name')
  @ApiOperation({ summary: 'Create or update a GLOBAL variable. isSecure encrypts it at rest (write-only).' })
  async setVariable(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(new ZodValidationPipe(setVariableSchema)) dto: SetVariableDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.automations.setVariable(
      principal,
      'global',
      this.validVariableName(name),
      dto.value,
      dto.isSecure,
      auditContext(req),
    );
  }

  @Delete('variables/:name')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a GLOBAL variable.' })
  async deleteVariable(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Req() req: NotesEtcRequest,
  ): Promise<void> {
    await this.automations.deleteVariable(principal, 'global', name, auditContext(req));
  }

  @Get(':id/variables')
  @ApiOperation({ summary: 'List an automation’s SCRIPT-SCOPED variables (they shadow globals of the same name).' })
  async listScopedVariables(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    const data = await this.automations.listVariables(principal, auditContext(req), id);
    return { data };
  }

  @Put(':id/variables/:name')
  @ApiOperation({ summary: 'Create or update a script-scoped variable for this automation.' })
  async setScopedVariable(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('name') name: string,
    @Body(new ZodValidationPipe(setVariableSchema)) dto: SetVariableDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.automations.setVariable(
      principal,
      id,
      this.validVariableName(name),
      dto.value,
      dto.isSecure,
      auditContext(req),
    );
  }

  @Delete(':id/variables/:name')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a script-scoped variable.' })
  async deleteScopedVariable(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('name') name: string,
    @Req() req: NotesEtcRequest,
  ): Promise<void> {
    await this.automations.deleteVariable(principal, id, name, auditContext(req));
  }

  private validVariableName(name: string): string {
    const parsed = variableNameSchema.safeParse(name);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    return parsed.data;
  }

  @Get('runs')
  @ApiOperation({ summary: 'List automation runs (global; newest first). Filters: automationId, status.' })
  async listRuns(
    @CurrentPrincipal() principal: Principal,
    @Req() req: NotesEtcRequest,
    @Query('automationId') automationId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.automations.listRuns(principal, auditContext(req), {
      automationId,
      status,
      limit: limit ? Number(limit) : undefined,
    });
    return { data };
  }

  @Get('runs/:runId')
  @ApiOperation({ summary: 'Get one run with its logs. ?afterSeq=N returns only newer log entries.' })
  async getRun(
    @CurrentPrincipal() principal: Principal,
    @Param('runId') runId: string,
    @Req() req: NotesEtcRequest,
    @Query('afterSeq') afterSeq?: string,
  ) {
    return this.automations.getRun(
      principal,
      runId,
      auditContext(req),
      afterSeq !== undefined ? Number(afterSeq) : undefined,
    );
  }

  @Post('runs/:runId/stop')
  @ApiOperation({ summary: 'Force-stop a running (or queued) run.' })
  async stopRun(
    @CurrentPrincipal() principal: Principal,
    @Param('runId') runId: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.automations.stopRun(principal, runId, auditContext(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an automation (never returns the webhook secret).' })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.automations.get(principal, id, auditContext(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an automation (fields incl. {enabled} toggle).' })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAutomationSchema)) dto: UpdateAutomationDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.automations.update(principal, id, dto, auditContext(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an automation and its run history.' })
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ): Promise<void> {
    await this.automations.delete(principal, id, auditContext(req));
  }

  @Post(':id/rotate-secret')
  @ApiOperation({ summary: 'Rotate a webhook automation’s secret. Returned once.' })
  async rotateSecret(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.automations.rotateWebhookSecret(principal, id, auditContext(req));
  }

  @Post(':id/test')
  @ApiOperation({
    summary:
      'Run the automation now (works while disabled). mockMode=true (default) dry-runs: real reads, intercepted writes.',
  })
  async test(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(testAutomationSchema)) dto: TestAutomationDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.automations.testRun(principal, id, dto, auditContext(req));
  }

  @Get(':id/runs')
  @ApiOperation({ summary: 'Run history for one automation (newest first).' })
  async runsFor(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
    @Query('limit') limit?: string,
  ) {
    const data = await this.automations.listRuns(principal, auditContext(req), {
      automationId: id,
      limit: limit ? Number(limit) : undefined,
    });
    return { data };
  }
}
