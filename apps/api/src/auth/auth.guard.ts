import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NotesEtcRequest } from '../common/request-context';
import { UserRepository } from '../repositories/user.repository';
import { ALLOW_ANONYMOUS, ALLOW_UNAUTHENTICATED } from './allow-anonymous.decorator';
import { ApiTokenService } from './api-token.service';
import { SESSION_COOKIE } from './cookies';
import { PrincipalResolver } from './principal-resolver.service';
import { SessionService } from './session.service';

/**
 * Resolves the caller and attaches a Principal to the request. Accepts either an
 * `Authorization: Bearer <api-token>` header (API / MCP callers) or the session
 * cookie (web). Rejects with 401 when neither yields a valid, enabled principal.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly users: UserRepository,
    private readonly resolver: PrincipalResolver,
    private readonly apiTokens: ApiTokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<NotesEtcRequest & { cookies?: Record<string, string> }>();

    // Bearer token takes precedence (API / MCP callers).
    const authz = req.headers?.authorization as string | undefined;
    if (authz && authz.toLowerCase().startsWith('bearer ')) {
      const principal = await this.apiTokens.resolvePrincipal(authz.slice(7));
      if (!principal) throw new UnauthorizedException('Invalid or expired API token.');
      req.principal = principal;
      return true;
    }

    const token = req.cookies?.[SESSION_COOKIE];
    const session = token ? await this.sessions.validate(token) : null;
    const user = session ? await this.users.findById(session.userId) : null;

    if (!session || !user || user.status === 'disabled') {
      // No valid session. If this is a GET on an endpoint that opted into public
      // access, fall back to an anonymous principal (Public-group grants only).
      // Everything else requires authentication.
      const allowAnon = this.reflector.getAllAndOverride<boolean>(ALLOW_ANONYMOUS, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (allowAnon && req.method === 'GET') {
        req.principal = await this.resolver.anonymous();
        return true;
      }
      // Endpoints that authenticate the request themselves (e.g. the automation
      // webhook's X-Hook-Secret) may opt out of session/token auth for any method.
      const allowUnauthenticated = this.reflector.getAllAndOverride<boolean>(
        ALLOW_UNAUTHENTICATED,
        [context.getHandler(), context.getClass()],
      );
      if (allowUnauthenticated) {
        req.principal = await this.resolver.anonymous();
        return true;
      }
      throw new UnauthorizedException('Authentication required.');
    }

    req.principal = await this.resolver.fromSessionUser(user);
    return true;
  }
}
