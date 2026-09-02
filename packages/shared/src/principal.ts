import type { ActorType, GlobalRole, PrincipalVia, ResourceRole } from './enums';

/**
 * A resolved caller. Every entry point (web session, API token, MCP) builds one
 * of these and hands it to the service layer. The service layer authorizes and
 * audits using ONLY the Principal — it never inspects transport details.
 *
 * This is the linchpin of "API and MCP enforce the same permissions as the UI".
 */
export interface Principal {
  /** The acting user (token owner for api/mcp callers). */
  userId: string;
  email: string;
  globalRole: GlobalRole;
  /** Effective resource-role grants resolved from direct + group grants. */
  grants: ResolvedGrant[];
  /** How the request arrived. */
  via: PrincipalVia;
  /** For audit traceability. */
  actorType: ActorType;
  /** Present when via = api_token | mcp. */
  tokenId?: string;
  /**
   * Spaces the token is restricted to (intersected with owner perms).
   * Undefined = no token restriction (full owner scope).
   */
  allowedSpaceIds?: string[];
  /** Label for an AI tool, e.g. "claude-opus-4-8 via MCP". */
  agentLabel?: string;
}

/** A role the principal holds on a specific resource. */
export interface ResolvedGrant {
  resourceType: 'space' | 'page';
  resourceId: string;
  role: ResourceRole;
}
