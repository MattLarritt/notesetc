import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { SYSTEM_GROUP } from '@notesetc/shared';
import { GroupRepository } from '../repositories/group.repository';

/**
 * Ensures the non-deletable system groups exist on every boot:
 *   - "Administrators" — a view over global-admins (breakglass is one).
 *   - "All Users"      — implicit; every signed-in user belongs, so its space
 *                        grants apply to everyone authenticated.
 *   - "Public"         — implicit + anonymous; its grants apply to everyone,
 *                        signed in or not. Nobody can be a member.
 * Idempotent: creates each only if missing.
 */
@Injectable()
export class SystemGroupsBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemGroupsBootstrap.name);

  constructor(private readonly groups: GroupRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensure(SYSTEM_GROUP.Administrators, 'Global administrators. Members can manage everything.');
    await this.ensure(SYSTEM_GROUP.AllUsers, 'Every signed-in user. Grant this group a role to apply it to everyone.');
    await this.ensure(
      SYSTEM_GROUP.Public,
      'Anyone, including people who are not signed in. Grant a space to this group to make it publicly readable. Nobody can be added — it is implicit.',
    );
  }

  private async ensure(name: string, description: string): Promise<void> {
    if (await this.groups.findByName(name)) return;
    await this.groups.create({ name, description, source: 'local', system: true });
    this.logger.log(`Seeded system group: ${name}`);
  }
}
