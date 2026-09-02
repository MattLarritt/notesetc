import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Principal } from '@notesetc/shared';
import type { NotesEtcRequest } from '../common/request-context';

/**
 * Injects the request's Principal (set by AuthGuard) into a controller handler.
 * Use only on routes protected by AuthGuard, where the principal is guaranteed.
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<NotesEtcRequest>();
    if (!req.principal) {
      throw new Error('CurrentPrincipal used on an unauthenticated route.');
    }
    return req.principal;
  },
);
