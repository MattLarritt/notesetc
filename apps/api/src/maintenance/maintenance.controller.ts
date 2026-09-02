import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
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
  type AddMaintainerDto,
  type SetScheduleDto,
  addMaintainerSchema,
  setScheduleSchema,
} from './dto';
import { MaintenanceService } from './maintenance.service';

@ApiTags('maintenance')
@ApiBearerAuth('api-token')
@Controller()
@UseGuards(AuthGuard, CsrfGuard)
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('maintenance/mine')
  @ApiOperation({ summary: 'Pages the caller maintains, by review due date.' })
  async mine(@CurrentPrincipal() principal: Principal) {
    const data = await this.maintenance.mine(principal);
    return { data };
  }

  @Get('pages/:id/maintenance')
  @ApiOperation({ summary: 'Get a page’s review schedule, maintainers and status.' })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.maintenance.getForPage(principal, id, auditContext(req));
  }

  @Put('pages/:id/maintenance')
  @ApiOperation({ summary: 'Set a page’s review schedule (space admin+).' })
  async setSchedule(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setScheduleSchema)) dto: SetScheduleDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.maintenance.setSchedule(
      principal,
      id,
      { intervalDays: dto.intervalDays ?? null, dueAt: dto.dueAt ?? null },
      auditContext(req),
    );
  }

  @Post('pages/:id/maintenance/reviewed')
  @ApiOperation({ summary: 'Mark a page reviewed (maintainer or editor); rolls the due date forward.' })
  async markReviewed(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() req: NotesEtcRequest,
  ) {
    return this.maintenance.markReviewed(principal, id, auditContext(req));
  }

  @Post('pages/:id/maintainers')
  @ApiOperation({ summary: 'Assign a user or group as a maintainer (space admin+).' })
  async addMaintainer(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addMaintainerSchema)) dto: AddMaintainerDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.maintenance.addMaintainer(principal, id, dto, auditContext(req));
  }

  @Delete('pages/:id/maintainers/:maintainerId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a maintainer (space admin+).' })
  async removeMaintainer(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('maintainerId') maintainerId: string,
    @Req() req: NotesEtcRequest,
  ): Promise<void> {
    await this.maintenance.removeMaintainer(principal, id, maintainerId, auditContext(req));
  }
}
