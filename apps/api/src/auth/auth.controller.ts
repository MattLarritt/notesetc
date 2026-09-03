import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Principal } from '@notesetc/shared';
import { ConfigService } from '../config/config.service';
import { CsrfGuard, issueCsrfToken } from '../common/csrf/csrf';
import { RateLimit, RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { auditContext, type NotesEtcRequest } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, clearSessionCookie, sessionCookieOptions } from './cookies';
import { CurrentPrincipal } from './current-principal.decorator';
import { type LoginDto, loginSchema } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private get secure(): boolean {
    // Follow the deployment's actual protocol, not NODE_ENV: a production
    // container served over plain HTTP (LAN/self-hosted without TLS) must not
    // set Secure cookies, or browsers silently drop them and login breaks.
    const origin = this.config.get('WEB_ORIGIN');
    if (origin) return origin.startsWith('https://');
    return this.config.isProduction;
  }

  @Get('csrf')
  @ApiOperation({ summary: 'Issue a CSRF token (sets the double-submit cookie).' })
  csrf(@Res({ passthrough: true }) res: Response): { csrfToken: string } {
    return { csrfToken: issueCsrfToken(res, this.secure) };
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard, CsrfGuard)
  @RateLimit({ name: 'login', limit: 5, windowMs: 60_000 })
  @ApiOperation({ summary: 'Log in with a local account (e.g. breakglass admin).' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Req() req: NotesEtcRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: unknown }> {
    const result = await this.auth.login(dto, auditContext(req));
    res.cookie(
      SESSION_COOKIE,
      result.session.token,
      sessionCookieOptions(this.secure, result.session.expiresAt),
    );
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Log out — revokes the session and clears the cookie.' })
  async logout(
    @Req() req: NotesEtcRequest & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE];
    await this.auth.logout(token, req.principal?.userId, auditContext(req));
    clearSessionCookie(res, this.secure);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Return the currently authenticated principal.' })
  me(@CurrentPrincipal() principal: Principal): { principal: Principal } {
    return { principal };
  }
}
