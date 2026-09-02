import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Principal } from '@notesetc/shared';
import { auditContext, type NotesEtcRequest } from '../common/request-context';
import { McpService } from './mcp.service';

// The SDK ships an `exports` map classic TS "Node" resolution can't follow; Node's
// require honours it at runtime (CJS build). See mcp.service.ts.
/* eslint-disable @typescript-eslint/no-require-imports */
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js') as {
  StreamableHTTPServerTransport: new (opts: {
    sessionIdGenerator: () => string;
    onsessioninitialized?: (sessionId: string) => void;
  }) => McpTransport;
};
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js') as {
  isInitializeRequest: (body: unknown) => boolean;
};
/* eslint-enable @typescript-eslint/no-require-imports */

interface McpTransport {
  sessionId?: string;
  onclose?: () => void;
  handleRequest(req: unknown, res: unknown, body?: unknown): Promise<void>;
}

/**
 * Model Context Protocol endpoint (streamable HTTP, stateful sessions). AI clients
 * POST JSON-RPC here with `Authorization: Bearer <api-token>`. The token is
 * verified on every request (so revocation is immediate); tool calls run through
 * Notes Etc's service layer with a token principal, so authz + audit are identical
 * to REST and the UI.
 */
@ApiExcludeController()
@Controller('mcp')
export class McpController {
  private readonly sessions = new Map<string, McpTransport>();

  constructor(private readonly mcp: McpService) {}

  private async auth(req: Request, res: Response): Promise<Principal | null> {
    const principal = await this.mcp.resolvePrincipal(req.headers.authorization);
    if (!principal) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: supply a valid API token as a Bearer credential.' },
        id: null,
      });
      return null;
    }
    return principal;
  }

  @Post()
  async post(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const principal = await this.auth(req, res);
    if (!principal) return;

    const sid = req.headers['mcp-session-id'] as string | undefined;
    const existing = sid ? this.sessions.get(sid) : undefined;

    if (existing) {
      await existing.handleRequest(req, res, body);
      return;
    }

    // A new session may only be opened by an `initialize` request.
    if (!isInitializeRequest(body)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'No valid session. Send an initialize request first.' },
        id: null,
      });
      return;
    }

    // Attribute AI edits to the connecting client (e.g. "mcp:Claude Desktop").
    const clientName = (body as { params?: { clientInfo?: { name?: string } } })?.params?.clientInfo?.name;
    const attributed = clientName
      ? { ...principal, agentLabel: `mcp:${String(clientName).slice(0, 60)}` }
      : principal;
    const server = this.mcp.buildServer(attributed, auditContext(req as unknown as NotesEtcRequest));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSid: string) => this.sessions.set(newSid, transport),
    });
    transport.onclose = () => {
      if (transport.sessionId) this.sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  // Server->client SSE stream for an established session.
  @Get()
  async get(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!(await this.auth(req, res))) return;
    const sid = req.headers['mcp-session-id'] as string | undefined;
    const transport = sid ? this.sessions.get(sid) : undefined;
    if (!transport) {
      res.status(400).end();
      return;
    }
    await transport.handleRequest(req, res);
  }

  // Client-initiated session teardown.
  @Delete()
  async del(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!(await this.auth(req, res))) return;
    const sid = req.headers['mcp-session-id'] as string | undefined;
    const transport = sid ? this.sessions.get(sid) : undefined;
    if (!transport) {
      res.status(400).end();
      return;
    }
    await transport.handleRequest(req, res);
  }
}
