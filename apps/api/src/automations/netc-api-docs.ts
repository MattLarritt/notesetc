/**
 * Canonical documentation for the automation scripting environment. Exposed
 * through the MCP `automation_docs` tool (and referenced by the create/update
 * tool descriptions) so an LLM has everything needed to author an automation.
 * Keep this in sync with runtime/automation.worker.ts + bridge-dispatcher.
 */
export const NETC_API_DOCS = `# Notes Etc Automations — script authoring reference

An automation is plain JavaScript executed in a sandboxed worker with top-level
\`await\` support. It has NO require/import, NO filesystem, NO direct network —
everything goes through the \`netc\` API below. Scripts are killed at their
timeout (default 60s, max 600s). console.* output is captured only when the
automation's debugMode is on.

## Trigger types & triggerConfig shapes
- page_event: { "events": ["page.created"|"page.updated"|"page.moved"|"page.deleted", ...], "spaceIds": ["<uuid>", ...]? }
  Fires on page mutations (optionally limited to specific spaces).
- schedule:   { "cron": "<standard 5-field cron>", "timezone": "Australia/Sydney"? }
  Overlapping runs are skipped (a tick is dropped if a run is still active).
- webhook:    {} — the automation gets a URL POST /api/v1/hooks/<webhookSlug>.
  Callers authenticate with the X-Hook-Secret header (secret is returned ONCE at
  creation / rotation). Request body, query and select headers reach the script.

## The netc API
- netc.trigger — why the script ran:
  { type: 'page.created'|'page.updated'|'page.moved'|'page.deleted'|'cron'|'webhook'|'manual',
    pageId?, spaceId?, title?, slug?, updateKind?, move?, deletedPageIds?,
    actor?: {type, userId, label}, webhook?: {method, headers, query, body}, firedAt }
- netc.log({ state?: 'info'|'success'|'warning'|'error', message: string, data?: any })
  Structured run-log entry, browsable in the admin UI. Prefer this over console.
- netc.variable(name) -> string. Named config values managed by admins.
  Resolution order: this automation's SCRIPT-SCOPED variable first, then the
  GLOBAL one (scoped shadows global). Secure variables (API keys, passwords)
  are decrypted only at this call and automatically redacted from run logs.
  Throws code 'not_found' if undefined in both scopes.
- netc.pages.get(id) -> { page, content, versionNumber }
- netc.pages.children(id) -> page[] (direct children)
- netc.pages.findByPath(spaceKey, 'slug/slug') -> { page, content } | null
- netc.pages.create({ spaceId, title, content, parentId?, slug?, icon?, changeSummary? }, opts?) -> page
- netc.pages.update(id, { title?, content?, changeSummary? }, opts?) -> page (last-write-wins)
- netc.pages.delete(id, opts?) — deletes the page AND its subtree
- netc.pages.publish(id, opts?) — publish a draft page (created pages start as 'draft')
- netc.pages.move(id, { parentId?, position, spaceId? }, opts?) -> page
- netc.pages.setMetadata(id, object, opts? & { merge?: boolean }) -> page
  Page metadata is a JSON object for integration state; it is NOT versioned.
- netc.spaces.list() -> [{ id, key, name, status }]
- netc.fetch(url, { method?, headers?, body? }?) -> { status, headers, body }
  Outbound HTTP(S), 10s timeout, 1MB response cap, body returned as text.
- netc.sleep(ms)

## Rules & behaviors
- LOOP GUARD: writes made by an automation do NOT trigger other automations,
  unless that specific call passes { allowTriggers: true } as its opts. Even
  then chains are hard-capped at depth 5.
- MOCK MODE (test runs): reads and netc.variable are real; every write and every
  netc.fetch is intercepted — logged as "MOCK: would ..." and answered with an
  echo object carrying mocked: true. Nothing is persisted.
- Errors from netc calls throw Error with a .code ('not_found', 'conflict',
  'denied', 'invalid_args', 'fetch_failed') — catchable with try/catch.
- Every write is audited and versioned as automation:<name>.
- Run log caps: 1000 entries / 1MB; messages truncate at 2000 chars.

## Example — webhook that upserts a status page
\`\`\`js
const body = netc.trigger.webhook.body;
const token = await netc.variable('serviceApiToken'); // secure variable
const existing = await netc.pages.findByPath('IT', 'service-status');
if (existing) {
  await netc.pages.update(existing.page.id, { content: '# Status\\n\\n' + body.status });
} else {
  const spaces = await netc.spaces.list();
  const it = spaces.find(s => s.key === 'IT');
  await netc.pages.create({ spaceId: it.id, title: 'Service Status', slug: 'service-status', content: '# Status' });
}
netc.log({ state: 'success', message: 'status page updated' });
\`\`\`
`;
