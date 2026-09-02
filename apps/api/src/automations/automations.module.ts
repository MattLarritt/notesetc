import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PagesModule } from '../pages/pages.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { WebhooksController } from './webhooks.controller';
import { AutomationPrincipalFactory } from './execution/automation-principal';
import { BridgeDispatcher } from './execution/bridge-dispatcher.service';
import { ExecutionManagerService } from './execution/execution-manager.service';
import { VariableResolver } from './execution/variable-resolver.service';
import { AutomationSchedulerService } from './triggers/automation-scheduler.service';
import { AutomationTriggerListener } from './triggers/automation-trigger.listener';

/**
 * User-authored JavaScript automations: page-event / cron / webhook triggers,
 * sandboxed worker execution with the netc.* bridge, run logs, and admin CRUD.
 */
@Module({
  imports: [AuthModule, PagesModule],
  controllers: [AutomationsController, WebhooksController],
  providers: [
    AutomationsService,
    AutomationPrincipalFactory,
    BridgeDispatcher,
    VariableResolver,
    ExecutionManagerService,
    AutomationSchedulerService,
    AutomationTriggerListener,
  ],
  exports: [AutomationsService],
})
export class AutomationsModule {}
