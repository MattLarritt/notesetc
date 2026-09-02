import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AutomationTriggerType } from '@notesetc/shared';
import { AutomationRepository } from '../../repositories/automation.repository';
import { ExecutionManagerService } from '../execution/execution-manager.service';
import type { TriggerInfo } from '../execution/protocol';
import type { PageEvent } from '../page-events';

/** Hard ceiling on automation→automation chains, even with allowTriggers: true. */
const MAX_CHAIN_DEPTH = 5;

/**
 * Bridges page events onto automations: every enabled page_event automation
 * whose filter matches gets a run. Listeners run detached ({async: true}) and
 * never throw back into the mutation path.
 */
@Injectable()
export class AutomationTriggerListener {
  private readonly logger = new Logger('AutomationTriggers');

  constructor(
    private readonly repo: AutomationRepository,
    private readonly executions: ExecutionManagerService,
  ) {}

  @OnEvent('page.*', { async: true, suppressErrors: true })
  async onPageEvent(event: PageEvent): Promise<void> {
    try {
      // Loop guard: automation-caused events don't re-trigger unless the write
      // opted in — and even then, chains stop at MAX_CHAIN_DEPTH.
      if (event.suppressAutomations) return;
      if (event.automationDepth > MAX_CHAIN_DEPTH) {
        this.logger.warn(
          `Automation chain depth ${event.automationDepth} exceeds ${MAX_CHAIN_DEPTH}; not triggering (page ${event.pageId}).`,
        );
        return;
      }

      const automations = await this.repo.listEnabledByTrigger(AutomationTriggerType.PageEvent);
      const matches = automations.filter((a) => {
        const events = Array.isArray(a.triggerConfig.events) ? (a.triggerConfig.events as string[]) : [];
        if (!events.includes(event.type)) return false;
        const spaceIds = Array.isArray(a.triggerConfig.spaceIds)
          ? (a.triggerConfig.spaceIds as string[])
          : null;
        if (spaceIds && spaceIds.length > 0 && !spaceIds.includes(event.spaceId)) return false;
        return true;
      });
      if (!matches.length) return;

      const triggerInfo: TriggerInfo = {
        type: event.type,
        pageId: event.pageId,
        spaceId: event.spaceId,
        title: event.title,
        slug: event.slug,
        updateKind: event.updateKind,
        move: event.move,
        deletedPageIds: event.deletedPageIds,
        actor: event.actor,
        firedAt: event.occurredAt,
      };

      await Promise.allSettled(
        matches.map((automation) =>
          this.executions.enqueue({
            automation,
            trigger: 'page_event',
            triggerInfo,
            dryRun: false,
            depth: event.automationDepth,
          }),
        ),
      );
    } catch (err) {
      // Never let trigger failures propagate anywhere near the mutation path.
      this.logger.error(`Trigger dispatch failed for ${event.type} on ${event.pageId}: ${String(err)}`);
    }
  }
}
