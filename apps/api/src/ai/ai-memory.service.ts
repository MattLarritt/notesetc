import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MAX_KEYS = 60;
const MAX_KEY_LEN = 64;
const MAX_VALUE_LEN = 300;

/**
 * The assistant's long-term memory about one user: a small key/value store
 * (preferred shops, home town, family facts…) the agent maintains through its
 * update_memory tool. Rendered into the system prompt on every request so the
 * assistant knows these things without re-searching the notes.
 */
@Injectable()
export class AiMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<Record<string, string>> {
    const row = await this.prisma.aiMemory.findUnique({ where: { userId } });
    if (!row) return {};
    try {
      return JSON.parse(row.content) as Record<string, string>;
    } catch {
      return {};
    }
  }

  /** Apply a set/remove batch from the update_memory tool. Returns the new size. */
  async apply(
    userId: string,
    set: Record<string, string>,
    remove: string[],
  ): Promise<{ keys: number; applied: string[]; rejected: string[] }> {
    const mem = await this.get(userId);
    const applied: string[] = [];
    const rejected: string[] = [];

    for (const key of remove) {
      if (key in mem) {
        delete mem[key];
        applied.push(`-${key}`);
      }
    }
    for (const [rawKey, rawValue] of Object.entries(set)) {
      const key = rawKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, MAX_KEY_LEN);
      const value = String(rawValue).trim().slice(0, MAX_VALUE_LEN);
      if (!key || !value) {
        rejected.push(rawKey);
        continue;
      }
      if (!(key in mem) && Object.keys(mem).length >= MAX_KEYS) {
        rejected.push(`${rawKey} (memory full, ${MAX_KEYS} facts max — remove something first)`);
        continue;
      }
      mem[key] = value;
      applied.push(key);
    }

    await this.prisma.aiMemory.upsert({
      where: { userId },
      create: { userId, content: JSON.stringify(mem) },
      update: { content: JSON.stringify(mem) },
    });
    return { keys: Object.keys(mem).length, applied, rejected };
  }

  async removeKey(userId: string, key: string): Promise<void> {
    await this.apply(userId, {}, [key]);
  }

  /** Prompt block, or empty string when nothing is remembered yet. */
  async renderForPrompt(userId: string): Promise<string> {
    const mem = await this.get(userId);
    const entries = Object.entries(mem);
    if (!entries.length) return '';
    const lines = entries.map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n');
    return `\n\nLong-term memory about this user (facts saved from earlier conversations — trust these before searching):\n${lines}`;
  }
}
