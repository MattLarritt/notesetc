import { Injectable } from '@nestjs/common';
import { ActorType, GlobalRole, type Principal, PrincipalVia } from '@notesetc/shared';
import { UserRepository } from '../../repositories/user.repository';
import type { AutomationRecord } from '../../repositories/automation.repository';

/**
 * Builds the Principal an automation runs as. Automations are authored by
 * global admins, so runs execute with global-admin-equivalent rights (v1);
 * accountability comes from actorType=automation + agentLabel, which flow
 * into every audit row and page-version author untouched.
 */
@Injectable()
export class AutomationPrincipalFactory {
  constructor(private readonly users: UserRepository) {}

  async forAutomation(automation: AutomationRecord): Promise<Principal> {
    const owner = automation.createdById
      ? await this.users.findById(automation.createdById)
      : null;
    return {
      userId: owner?.id ?? automation.createdById ?? 'automation',
      email: owner?.email ?? 'automation@notesetc.local',
      globalRole: GlobalRole.GlobalAdmin,
      grants: [],
      via: PrincipalVia.Automation,
      actorType: ActorType.Automation,
      agentLabel: `automation:${automation.name}`,
    };
  }
}
