import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { AuditResult } from '@notesetc/shared';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { UserRepository } from '../repositories/user.repository';
import { PasswordService } from './password.service';

/**
 * Bootstraps the breakglass local admin from environment configuration on every
 * startup, enforcing the design's core rule:
 *
 *   - BREAKGLASS_ADMIN_EMAIL present  -> upsert the account as an active
 *     global_admin with the configured password.
 *   - BREAKGLASS_ADMIN_EMAIL absent   -> DISABLE any existing breakglass account.
 *
 * Both outcomes are audited as `system` actions. This runs once, at boot.
 */
@Injectable()
export class BreakglassService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BreakglassService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get('BREAKGLASS_ADMIN_EMAIL');

    if (!email) {
      await this.disableIfPresent();
      return;
    }

    await this.upsert(email);
  }

  private async disableIfPresent(): Promise<void> {
    const existing = await this.users.findBreakglass();
    if (existing && existing.status !== 'disabled') {
      await this.users.setStatus(existing.id, 'disabled');
      this.logger.warn(
        'Breakglass admin DISABLED: BREAKGLASS_ADMIN_EMAIL is no longer configured.',
      );
      await this.audit.record(null, {
        action: 'auth.breakglass.disabled',
        result: AuditResult.Success,
        targetType: 'user',
        targetId: existing.id,
        metadata: { reason: 'env_removed' },
      });
    } else {
      this.logger.log('No breakglass admin configured; none active.');
    }
  }

  private async upsert(email: string): Promise<void> {
    const passwordHash = await this.resolvePasswordHash();
    if (!passwordHash) {
      this.logger.error(
        'BREAKGLASS_ADMIN_EMAIL is set but neither BREAKGLASS_ADMIN_PASSWORD nor ' +
          'BREAKGLASS_ADMIN_PASSWORD_HASH is provided. Breakglass admin NOT created.',
      );
      await this.audit.record(null, {
        action: 'auth.breakglass.bootstrap',
        result: AuditResult.Error,
        metadata: { reason: 'missing_password' },
      });
      return;
    }

    const user = await this.users.upsertBreakglass({
      email,
      displayName: 'Breakglass Admin',
      passwordHash,
    });
    this.logger.log(`Breakglass admin ready: ${email}`);
    await this.audit.record(null, {
      action: 'auth.breakglass.bootstrap',
      result: AuditResult.Success,
      targetType: 'user',
      targetId: user.id,
    });
  }

  /** Prefer a pre-computed hash; otherwise hash the plaintext password. */
  private async resolvePasswordHash(): Promise<string | null> {
    const preHash = this.config.get('BREAKGLASS_ADMIN_PASSWORD_HASH');
    if (preHash && this.passwords.isHash(preHash)) return preHash;

    const plaintext = this.config.get('BREAKGLASS_ADMIN_PASSWORD');
    if (plaintext) return this.passwords.hash(plaintext);

    return null;
  }
}
