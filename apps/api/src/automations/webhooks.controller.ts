import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AllowUnauthenticated } from '../auth/allow-anonymous.decorator';
import { RateLimiter } from '../common/rate-limit/rate-limiter';
import type { NotesEtcRequest } from '../common/request-context';
import { AutomationsService } from './automations.service';

const BODY_CAP = 256_000; // 256 KB of webhook body reaches the script
const RATE_LIMIT = 60; // calls per slug+ip per minute

/**
 * Public webhook entry point for webhook-triggered automations.
 * Auth is the X-Hook-Secret header (never in the URL — URLs leak into
 * proxy/access logs). Unknown slug and bad secret are both 404, so slugs
 * cannot be enumerated.
 */
@ApiTags('hooks')
@Controller('hooks')
@UseGuards(AuthGuard)
export class WebhooksController {
  constructor(
    private readonly automations: AutomationsService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Post(':slug')
  @AllowUnauthenticated() // POST; authenticates itself via X-Hook-Secret
  @HttpCode(202)
  @ApiOperation({ summary: 'Fire a webhook automation. Requires the X-Hook-Secret header. Returns 202 {runId}.' })
  async fire(
    @Param('slug') slug: string,
    @Headers('x-hook-secret') secret: string | undefined,
    @Body() body: unknown,
    @Query() query: Record<string, string>,
    @Req() req: NotesEtcRequest,
  ) {
    const ip = req.ip ?? 'unknown';
    const rl = this.rateLimiter.hit(`hook:${slug}:${ip}`, RATE_LIMIT, 60_000);
    if (!rl.allowed) {
      throw new HttpException('Too many requests.', 429);
    }

    const automation = await this.automations.resolveWebhook(slug, secret);
    if (!automation) throw new NotFoundException();

    // Pass the script a bounded, useful subset of the request.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (key === 'content-type' || key === 'user-agent' || key.startsWith('x-hook-')) {
        if (key === 'x-hook-secret') continue; // never expose the secret to the script
        headers[key] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
      }
    }
    let payload: unknown = body ?? null;
    const asText = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);
    if (asText.length > BODY_CAP) payload = `${asText.slice(0, BODY_CAP)}…[truncated]`;

    return this.automations.fireWebhook(automation, {
      method: 'POST',
      headers,
      query,
      body: payload,
    });
  }
}
