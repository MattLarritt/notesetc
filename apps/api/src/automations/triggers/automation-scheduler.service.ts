import { Injectable, Logger, type OnModuleInit, forwardRef, Inject } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob, CronTime } from 'cron';
import { AutomationTriggerType } from '@notesetc/shared';
import {
  type AutomationRecord,
  AutomationRepository,
} from '../../repositories/automation.repository';
import { ExecutionManagerService } from '../execution/execution-manager.service';

const JOB_PREFIX = 'automation:';

/**
 * Dynamic cron scheduling for schedule-triggered automations, plus the
 * housekeeping crons (dead-run sweep, retention prune). Jobs are registered at
 * boot and resynced whenever an automation is created/updated/deleted.
 */
@Injectable()
export class AutomationSchedulerService implements OnModuleInit {
  private readonly logger = new Logger('AutomationScheduler');

  constructor(
    private readonly repo: AutomationRepository,
    private readonly registry: SchedulerRegistry,
    @Inject(forwardRef(() => ExecutionManagerService))
    private readonly executions: ExecutionManagerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const scheduled = await this.repo.listEnabledByTrigger(AutomationTriggerType.Schedule);
    for (const automation of scheduled) this.register(automation);
    if (scheduled.length) this.logger.log(`Registered ${scheduled.length} scheduled automation(s).`);
  }

  /** null = valid; otherwise the error message. Uses the same parser as the runtime. */
  validateCronExpression(expr: string): string | null {
    try {
      new CronTime(expr);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  /** Re-register (or deregister) the job for an automation after any change. */
  async resync(automation: AutomationRecord): Promise<void> {
    await this.remove(automation.id);
    if (automation.triggerType !== AutomationTriggerType.Schedule) return;
    if (!automation.enabled) return;
    this.register(automation);
  }

  async remove(automationId: string): Promise<void> {
    const name = JOB_PREFIX + automationId;
    try {
      this.registry.deleteCronJob(name);
    } catch {
      /* not registered */
    }
  }

  private register(automation: AutomationRecord): void {
    const cron = String(automation.triggerConfig.cron ?? '');
    const timezone = automation.triggerConfig.timezone
      ? String(automation.triggerConfig.timezone)
      : undefined;
    if (this.validateCronExpression(cron)) {
      this.logger.error(`Automation "${automation.name}" has an invalid cron "${cron}"; not scheduled.`);
      return;
    }
    const job = new CronJob(cron, () => void this.tick(automation.id), null, false, timezone);
    this.registry.addCronJob(JOB_PREFIX + automation.id, job as never);
    job.start();
  }

  private async tick(automationId: string): Promise<void> {
    try {
      // Re-read: the row may have been edited/disabled since registration.
      const automation = await this.repo.findById(automationId);
      if (!automation || !automation.enabled) return;
      // Overlap guard: never stack runs of the same automation.
      if (await this.repo.hasActiveRun(automationId)) {
        this.logger.warn(`Skipping tick for "${automation.name}": a run is already active.`);
        return;
      }
      await this.executions.enqueue({
        automation,
        trigger: 'schedule',
        triggerInfo: { type: 'cron', firedAt: new Date().toISOString() },
        dryRun: false,
        depth: 0,
      });
    } catch (err) {
      this.logger.error(`Cron tick failed for automation ${automationId}: ${String(err)}`);
    }
  }

  // ------------------------------------------------------------ housekeeping

  /** DB-side dead-run sweep: catches rows orphaned by crashes the in-memory sweep can't see. */
  @Cron('*/1 * * * *')
  async sweepOrphanedRuns(): Promise<void> {
    try {
      const active = await this.repo.listRuns({ status: 'running' as never, limit: 200 });
      const queued = await this.repo.listRuns({ status: 'queued' as never, limit: 200 });
      const orphans = [...active, ...queued]
        .filter((r) => !this.executions.isTracked(r.id))
        // Grace period: enqueue() writes the row before the manager tracks it.
        .filter((r) => Date.now() - r.createdAt.getTime() > 30_000)
        .map((r) => r.id);
      if (orphans.length) {
        const n = await this.repo.markStaleRunsDead('orphaned', orphans);
        this.logger.warn(`Sweep: marked ${n} orphaned run(s) dead.`);
      }
    } catch (err) {
      this.logger.warn(`Orphan sweep failed: ${String(err)}`);
    }
  }

  /** Retention: prune finished runs older than 30 days (daily, off-peak). */
  @Cron('0 3 * * *')
  async pruneOldRuns(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const n = await this.repo.pruneRunsOlderThan(cutoff);
      if (n > 0) this.logger.log(`Pruned ${n} run(s) older than 30 days.`);
    } catch (err) {
      this.logger.warn(`Run prune failed: ${String(err)}`);
    }
  }
}
