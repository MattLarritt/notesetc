import { SetMetadata } from '@nestjs/common';

export const ALLOW_ANONYMOUS = 'allowAnonymous';

/**
 * Marks a read endpoint as reachable without authentication. When no session or
 * token is present, the AuthGuard attaches an anonymous Principal (holding only
 * the "Public" group's grants) instead of returning 401. Deny-by-default
 * authorization still gates every action, so anonymous callers can only read
 * resources explicitly shared with the Public group. Only honored for GET.
 */
export const AllowAnonymous = () => SetMetadata(ALLOW_ANONYMOUS, true);

export const ALLOW_UNAUTHENTICATED = 'allowUnauthenticated';

/**
 * Marks an endpoint as reachable without a session or API token REGARDLESS of
 * HTTP method — for endpoints that authenticate the request themselves (e.g.
 * the automation webhook, which validates its own X-Hook-Secret header).
 * The handler gets an anonymous Principal; it must never pass it to
 * authorize()-gated writes. Use @AllowAnonymous for ordinary public GET reads.
 */
export const AllowUnauthenticated = () => SetMetadata(ALLOW_UNAUTHENTICATED, true);
