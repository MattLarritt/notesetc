import { BadRequestException, Injectable } from '@nestjs/common';
import { encryptVariable, decryptVariable } from '../automations/execution/variable-crypto';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AiProvider, AiProviderConfig } from './providers';

export interface AiConfig {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  baseUrl?: string;
  webSearch?: boolean;
}

const CONFIG_KEY = 'ai.config';
const API_KEY_KEY = 'ai.apiKey';
const PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'gemini', 'ollama'];

/**
 * Persistence for the optional AI agent configuration. Lives in the Setting
 * table; the API key is AES-256-GCM encrypted with MASTER_ENCRYPTION_KEY
 * (same scheme as secure automation variables) and is write-only through the
 * admin API.
 */
@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private masterKey(): string {
    const k = this.config.get('MASTER_ENCRYPTION_KEY');
    if (!k) throw new BadRequestException('MASTER_ENCRYPTION_KEY is not configured on the server.');
    return k;
  }

  async getConfig(): Promise<AiConfig | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
    if (!row) return null;
    try {
      return JSON.parse(row.value) as AiConfig;
    } catch {
      return null;
    }
  }

  async hasApiKey(): Promise<boolean> {
    return !!(await this.prisma.setting.findUnique({ where: { key: API_KEY_KEY } }));
  }

  /** Full provider config incl. decrypted key — internal use only, never serialized. */
  async getProviderConfig(): Promise<(AiProviderConfig & { enabled: boolean }) | null> {
    const cfg = await this.getConfig();
    if (!cfg) return null;
    let apiKey: string | undefined;
    const row = await this.prisma.setting.findUnique({ where: { key: API_KEY_KEY } });
    if (row) apiKey = decryptVariable(row.value, this.masterKey());
    return { ...cfg, apiKey };
  }

  async save(
    input: { enabled: boolean; provider: string; model: string; baseUrl?: string; apiKey?: string; webSearch?: boolean },
    updatedById: string | null,
  ): Promise<AiConfig> {
    if (!PROVIDERS.includes(input.provider as AiProvider)) {
      throw new BadRequestException(`Unknown provider "${input.provider}".`);
    }
    if (input.enabled && !input.model.trim()) {
      throw new BadRequestException('A model is required when AI is enabled.');
    }
    if (input.provider !== 'ollama' && input.enabled && !input.apiKey && !(await this.hasApiKey())) {
      throw new BadRequestException('An API key is required for this provider.');
    }
    const cfg: AiConfig = {
      enabled: input.enabled,
      provider: input.provider as AiProvider,
      model: input.model.trim(),
      webSearch: !!input.webSearch,
      ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim() } : {}),
    };
    await this.prisma.setting.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value: JSON.stringify(cfg), isEncrypted: false, updatedById },
      update: { value: JSON.stringify(cfg), updatedById },
    });
    if (input.apiKey) {
      const enc = encryptVariable(input.apiKey, this.masterKey());
      await this.prisma.setting.upsert({
        where: { key: API_KEY_KEY },
        create: { key: API_KEY_KEY, value: enc, isEncrypted: true, updatedById },
        update: { value: enc, updatedById },
      });
    }
    return cfg;
  }

  async clearApiKey(): Promise<void> {
    await this.prisma.setting.deleteMany({ where: { key: API_KEY_KEY } });
  }
}
