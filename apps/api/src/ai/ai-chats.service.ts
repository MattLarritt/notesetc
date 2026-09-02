import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ToolTraceEntry } from './ai.service';

export interface StoredChatMessage {
  role: 'user' | 'assistant';
  content: string;
  trace?: ToolTraceEntry[];
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: Date;
}

const MAX_MESSAGES = 60; // per chat; older turns roll off the model context anyway
const MAX_CHATS = 100; // per user; oldest pruned

/**
 * Per-user AI chat history. One row per chat, messages as JSON text — the
 * shape is owned by the AI module and never queried in SQL.
 */
@Injectable()
export class AiChatsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<ChatSummary[]> {
    const rows = await this.prisma.aiChat.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true },
      take: MAX_CHATS,
    });
    return rows;
  }

  async get(userId: string, id: string): Promise<{ id: string; title: string; messages: StoredChatMessage[] }> {
    const row = await this.prisma.aiChat.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Chat not found.');
    if (row.userId !== userId) throw new ForbiddenException('Not your chat.');
    let messages: StoredChatMessage[] = [];
    try {
      messages = JSON.parse(row.messages) as StoredChatMessage[];
    } catch {
      /* corrupted row -> empty history */
    }
    return { id: row.id, title: row.title, messages };
  }

  /**
   * Ensure a chat row exists BEFORE the agent runs, so tools fired during the
   * turn (e.g. create_page stamping its origin) already know the chat id.
   */
  async ensure(userId: string, chatId: string | undefined, firstMessage: string): Promise<string> {
    if (chatId) {
      await this.get(userId, chatId); // ownership check
      return chatId;
    }
    const title = firstMessage.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Chat';
    const row = await this.prisma.aiChat.create({
      data: { userId, title, messages: JSON.stringify([]) },
    });
    await this.prune(userId);
    return row.id;
  }

  /** Append a user/assistant exchange, creating the chat if needed. */
  async append(
    userId: string,
    chatId: string | undefined,
    exchange: StoredChatMessage[],
  ): Promise<{ id: string; title: string }> {
    if (chatId) {
      const existing = await this.get(userId, chatId);
      const messages = [...existing.messages, ...exchange].slice(-MAX_MESSAGES);
      await this.prisma.aiChat.update({
        where: { id: chatId },
        data: { messages: JSON.stringify(messages) },
      });
      return { id: chatId, title: existing.title };
    }
    const first = exchange.find((m) => m.role === 'user')?.content ?? 'Chat';
    const title = first.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Chat';
    const row = await this.prisma.aiChat.create({
      data: { userId, title, messages: JSON.stringify(exchange.slice(-MAX_MESSAGES)) },
    });
    await this.prune(userId);
    return { id: row.id, title };
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.get(userId, id); // ownership check
    await this.prisma.aiChat.delete({ where: { id } });
  }

  private async prune(userId: string): Promise<void> {
    const stale = await this.prisma.aiChat.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
      skip: MAX_CHATS,
    });
    if (stale.length) {
      await this.prisma.aiChat.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
    }
  }
}
