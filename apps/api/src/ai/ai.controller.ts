import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Action, type Principal } from '@notesetc/shared';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { AuthorizationService } from '../authz/authorization.service';
import { CsrfGuard } from '../common/csrf/csrf';
import { auditContext, type NotesEtcRequest } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AiChatsService } from './ai-chats.service';
import { AiMemoryService } from './ai-memory.service';
import { AiSettingsService } from './ai-settings.service';
import { AiService } from './ai.service';

const settingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['anthropic', 'openai', 'gemini', 'ollama']),
  model: z.string().max(120),
  baseUrl: z.string().url().max(300).optional().or(z.literal('')),
  apiKey: z.string().max(500).optional(),
  webSearch: z.boolean().optional(),
});
type SettingsDto = z.infer<typeof settingsSchema>;

const modelsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'gemini', 'ollama']),
  baseUrl: z.string().url().max(300).optional().or(z.literal('')),
  apiKey: z.string().max(500).optional(),
});
type ModelsDto = z.infer<typeof modelsSchema>;

const testSchema = z
  .object({
    provider: z.enum(['anthropic', 'openai', 'gemini', 'ollama']),
    model: z.string().min(1).max(120),
    baseUrl: z.string().url().max(300).optional().or(z.literal('')),
    apiKey: z.string().max(500).optional(),
  })
  .optional();
type TestDto = z.infer<typeof testSchema>;

const chatSchema = z.object({
  chatId: z.string().optional(),
  message: z.string().min(1).max(20_000),
});
type ChatDto = z.infer<typeof chatSchema>;

const estimateSchema = z.object({ attachmentId: z.string().min(1) });
type EstimateDto = z.infer<typeof estimateSchema>;

const suggestSchema = z.object({
  attachmentId: z.string().min(1),
  prompt: z.string().max(4000).optional(),
  includeContent: z.boolean(),
});
type SuggestDto = z.infer<typeof suggestSchema>;

const applySchema = z.object({
  attachmentId: z.string().min(1),
  pageId: z.string().min(1),
  appendMarkdown: z.string().min(1).max(20_000),
});
type ApplyDto = z.infer<typeof applySchema>;

@ApiTags('ai')
@ApiBearerAuth('api-token')
@Controller()
@UseGuards(AuthGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly chats: AiChatsService,
    private readonly memory: AiMemoryService,
    private readonly settings: AiSettingsService,
    private readonly authz: AuthorizationService,
  ) {}

  @Get('ai/status')
  @ApiOperation({ summary: 'Whether the AI agent is enabled (for showing the AI menu).' })
  async status() {
    return this.ai.status();
  }

  @Get('admin/ai/settings')
  @ApiOperation({ summary: 'Read AI agent settings (global admin). The API key is never returned.' })
  async getSettings(@CurrentPrincipal() principal: Principal, @Req() req: NotesEtcRequest) {
    await this.authz.authorize(principal, Action.AdminSettings, { type: 'global' }, auditContext(req));
    const cfg = await this.settings.getConfig();
    return {
      enabled: cfg?.enabled ?? false,
      provider: cfg?.provider ?? 'anthropic',
      model: cfg?.model ?? '',
      baseUrl: cfg?.baseUrl ?? '',
      webSearch: cfg?.webSearch ?? false,
      hasApiKey: await this.settings.hasApiKey(),
    };
  }

  @Put('admin/ai/settings')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Save AI agent settings (global admin). apiKey is write-only.' })
  async putSettings(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(settingsSchema)) dto: SettingsDto,
    @Req() req: NotesEtcRequest,
  ) {
    await this.authz.authorize(principal, Action.AdminSettings, { type: 'global' }, auditContext(req));
    const cfg = await this.settings.save(
      {
        enabled: dto.enabled,
        provider: dto.provider,
        model: dto.model,
        baseUrl: dto.baseUrl || undefined,
        apiKey: dto.apiKey || undefined,
        webSearch: dto.webSearch,
      },
      principal.userId ?? null,
    );
    return { ...cfg, hasApiKey: await this.settings.hasApiKey() };
  }

  @Post('admin/ai/models')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'List selectable models for a provider (global admin). Key optional if one is stored.' })
  async models(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(modelsSchema)) dto: ModelsDto,
    @Req() req: NotesEtcRequest,
  ) {
    await this.authz.authorize(principal, Action.AdminSettings, { type: 'global' }, auditContext(req));
    try {
      return { models: await this.ai.listAvailableModels({ provider: dto.provider, baseUrl: dto.baseUrl || undefined, apiKey: dto.apiKey || undefined }) };
    } catch (err) {
      return { models: [], error: (err as Error).message };
    }
  }

  @Post('admin/ai/test')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Test a model config (global admin). Pass the draft config to test without saving; omit to test the stored one.' })
  async test(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(testSchema)) dto: TestDto,
    @Req() req: NotesEtcRequest,
  ) {
    await this.authz.authorize(principal, Action.AdminSettings, { type: 'global' }, auditContext(req));
    return this.ai.testConnection(
      dto ? { provider: dto.provider, model: dto.model, baseUrl: dto.baseUrl || undefined, apiKey: dto.apiKey || undefined } : undefined,
    );
  }

  @Post('ai/chat')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Chat with the wiki-aware AI agent. Tools run with the caller’s permissions.' })
  async chat(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(chatSchema)) dto: ChatDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.ai.chat(principal, auditContext(req), dto);
  }

  @Get('ai/memory')
  @ApiOperation({ summary: 'The assistant’s long-term memory about the caller.' })
  async getMemory(@CurrentPrincipal() principal: Principal) {
    if (!principal.userId) return { entries: [] };
    const mem = await this.memory.get(principal.userId);
    return { entries: Object.entries(mem).map(([key, value]) => ({ key, value })) };
  }

  @Delete('ai/memory/:key')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Forget one remembered fact.' })
  async deleteMemory(@CurrentPrincipal() principal: Principal, @Param('key') key: string): Promise<void> {
    if (!principal.userId) throw new ForbiddenException('Requires a signed-in user.');
    await this.memory.removeKey(principal.userId, key);
  }

  @Get('ai/chats')
  @ApiOperation({ summary: 'List the caller’s saved AI chats, newest first.' })
  async listChats(@CurrentPrincipal() principal: Principal) {
    if (!principal.userId) return [];
    return this.chats.list(principal.userId);
  }

  @Get('ai/chats/:id')
  @ApiOperation({ summary: 'Load one of the caller’s saved chats.' })
  async getChat(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    if (!principal.userId) throw new ForbiddenException('Requires a signed-in user.');
    return this.chats.get(principal.userId, id);
  }

  @Delete('ai/chats/:id')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Delete one of the caller’s saved chats.' })
  async deleteChat(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<void> {
    if (!principal.userId) throw new ForbiddenException('Requires a signed-in user.');
    await this.chats.remove(principal.userId, id);
  }

  @Post('ai/estimate')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Token/cost estimate for including an attachment’s text in an AI request.' })
  async estimate(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(estimateSchema)) dto: EstimateDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.ai.estimate(principal, auditContext(req), dto.attachmentId);
  }

  @Post('ai/file-attachment')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Ask the agent to propose the best page for an attachment (+ summary).' })
  async suggest(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(suggestSchema)) dto: SuggestDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.ai.suggestFiling(principal, auditContext(req), dto);
  }

  @Post('ai/file-attachment/apply')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Apply a confirmed filing suggestion: embed on the page and link the file.' })
  async apply(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(applySchema)) dto: ApplyDto,
    @Req() req: NotesEtcRequest,
  ) {
    return this.ai.applyFiling(principal, auditContext(req), dto);
  }
}
