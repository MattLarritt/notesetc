import { Injectable } from '@nestjs/common';
import {
  AutomationRepository,
  GLOBAL_VARIABLE_SCOPE,
} from '../../repositories/automation.repository';
import { ConfigService } from '../../config/config.service';
import { decryptVariable } from './variable-crypto';

/**
 * Resolves an automation variable to its PLAIN value (decrypting secure ones).
 * Resolution order: the automation's own scoped variable wins, then the global
 * one. Used by the netc bridge (netc.variable) — kept separate from
 * AutomationsService to avoid a DI cycle (service -> execution manager -> dispatcher).
 */
@Injectable()
export class VariableResolver {
  constructor(
    private readonly repo: AutomationRepository,
    private readonly config: ConfigService,
  ) {}

  async resolve(
    name: string,
    automationId: string,
  ): Promise<{ value: string; isSecure: boolean } | null> {
    const v =
      (await this.repo.findVariable(automationId, name)) ??
      (await this.repo.findVariable(GLOBAL_VARIABLE_SCOPE, name));
    if (!v) return null;
    if (!v.isSecure) return { value: v.value, isSecure: false };
    const masterKey = this.config.get('MASTER_ENCRYPTION_KEY');
    if (!masterKey) throw new Error('MASTER_ENCRYPTION_KEY is not configured.');
    return { value: decryptVariable(v.value, masterKey), isSecure: true };
  }
}
