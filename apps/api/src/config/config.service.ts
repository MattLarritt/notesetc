import { Injectable } from '@nestjs/common';
import { type AppConfig, loadConfig } from './config.schema';

/**
 * Typed, validated access to bootstrap configuration. Inject this instead of
 * touching process.env anywhere else in the codebase.
 */
@Injectable()
export class ConfigService {
  private readonly config: AppConfig;

  constructor() {
    this.config = loadConfig();
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  /** True when a breakglass admin is configured via env. */
  get hasBreakglassAdmin(): boolean {
    return Boolean(this.config.BREAKGLASS_ADMIN_EMAIL);
  }
}
