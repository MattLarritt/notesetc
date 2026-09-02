# Notes Etc — Architecture & Design

> Self-hosted, enterprise IT knowledgebase. Confluence-style spaces and nested
> pages, with enterprise auth, strong permissions, full auditability, and
> first-class API/MCP support so AI tools can safely help manage documentation.

Status: **Design / pre-implementation.** This document is the contract for the
MVP build. Code that contradicts it should change this doc first.

**Confirmed decisions (2026-07-01):** Backend = **NestJS** · DB access =
**Prisma** (Postgres POC → MSSQL prod, validated in CI) · Canonical content =
**Markdown / NEFM** with TipTap as a view · Backend is a **separate service** from
Next.js. Alternatives below are retained only as rejected-option rationale.

---

## 0. Guiding principles (decision tie-breakers)

1. **Security and correctness first** — when in doubt, choose the safer option.
2. **API-first** — the UI is just another API client. No capability exists in the
   UI that isn't expressible through the API.
3. **One service layer, three faces** — Web UI, REST API, and MCP all call the
   *same* application/service layer. Permissions and audit live there, never in a
   controller.
4. **Every write is auditable**, and every write records *who/what* did it
   (human / API token / AI tool) — traceability is a first-class column, not an
   afterthought.
5. **Propose, don't mutate** — AI and automated agents default to creating drafts
   or suggested changes, not silent edits.
6. **Portable persistence** — POC may run on Postgres/SQLite, but the code is
   structured so MSSQL drops in cleanly.

---

## 1. Recommended architecture

### 1.1 Topology

```
┌──────────────┐     HTTPS      ┌─────────────────────────────────────┐
│  Next.js web │ ─────────────► │            Notes Etc API             │
│  (React UI)  │   cookie auth  │  (Node.js / NestJS)                 │
└──────────────┘                │                                     │
                                │   ┌─────────────────────────────┐   │
┌──────────────┐  bearer token  │   │  HTTP layer (controllers)   │   │
│ External API │ ─────────────► │   │  - REST /api/v1             │   │
│  consumers   │                │   │  - validation (zod)         │   │
└──────────────┘                │   │  - authn (cookie / token)   │   │
                                │   └──────────────┬──────────────┘   │
┌──────────────┐  MCP (stdio /  │   ┌──────────────▼──────────────┐   │
│  MCP client  │   streamable   │   │   SERVICE / DOMAIN LAYER    │   │
│ (Claude etc) │ ─────────────► │   │  authorize() + audit() here │   │
└──────────────┘   HTTP)        │   │  Spaces/Pages/Versions/...  │   │
                                │   └──────────────┬──────────────┘   │
                                │   ┌──────────────▼──────────────┐   │
                                │   │  Repository interfaces       │   │
                                │   │  (DB-agnostic)               │   │
                                │   └──────────────┬──────────────┘   │
                                └──────────────────┼──────────────────┘
                                                   ▼
                                    ┌──────────────────────────────┐
                                    │ DB adapter: Postgres (POC)   │
                                    │           → MSSQL (prod)     │
                                    │ + object/file storage (vol)  │
                                    └──────────────────────────────┘
```

**Key decision: the API backend is a separate service from Next.js.** Next.js is
a pure frontend (SSR + client) that talks to the API over HTTP, exactly like any
other client. This keeps the API the real product, avoids hiding logic in
Next.js route handlers, and makes the MCP/API story honest. (A thin Next.js BFF
proxy is allowed for cookie handling, but it must not contain business logic.)

### 1.2 Layering (the rule that makes this work)

| Layer | Responsibility | May call |
|---|---|---|
| **Transport** (REST controllers, MCP tool handlers) | parse, validate input, resolve the **principal**, shape responses | Service layer only |
| **Service / domain** | business rules, `authorize()`, `audit()`, transactions, versioning, proposal workflow | Repositories, other services |
| **Repository** | persistence behind interfaces (`PageRepository`, `AuditRepository`, …) | DB adapter |
| **Adapter** | concrete DB (Postgres/MSSQL) + file storage | driver/ORM |

Controllers and MCP handlers are *thin*. They never touch the DB and never make
authorization decisions — they build a `Principal` and call a service method.
This is what guarantees "API and MCP enforce the same permissions as the UI": it
is structurally impossible to bypass.

### 1.3 Recommended stack

| Concern | Choice | Why |
|---|---|---|
| Backend framework | **NestJS** (TypeScript) | DI + modules + guards map cleanly onto the layered model; first-class OpenAPI generation; structured for enterprise auth. (Fastify is the lighter alternative if Nest feels heavy.) |
| Frontend | **Next.js (App Router) + React + TypeScript** | requirement; SSR for fast first paint, good auth ergonomics |
| DB access | **Repository interfaces + a single ORM that targets Postgres *and* MSSQL** (Prisma or TypeORM) | clean MSSQL swap; see §1.4 + Risks |
| POC DB | **PostgreSQL** | semantically closest to MSSQL (real types, transactions, FTS) — a better dress rehearsal than SQLite |
| Content format | **Markdown (constrained flavor) as canonical source of truth** | most AI-readable/writable, diff-friendly, editor-decoupled; see §1.5 |
| Editor | **TipTap** (ProseMirror) with Markdown serialization | clean WYSIWYG for non-technical users, round-trips to Markdown |
| Validation | **zod** schemas shared by REST + MCP | one source of truth for input shape |
| Auth | **openid-client** (Entra OIDC) + local accounts; **argon2id** hashing | standards-based SSO; strong local hashing |
| AuthZ | custom `authorize(principal, action, resource)` | hierarchical, deny-by-default |
| Search | DB full-text (Postgres `tsvector` / MSSQL FTS) behind a `SearchService` | no extra infra in MVP; swappable later |
| MCP | **@modelcontextprotocol/sdk** server in the same codebase, calling the service layer directly | true parity with the app |
| Deploy | Docker + docker-compose; Coolify-friendly | requirement |

### 1.4 Database portability

Define repository **interfaces** in the domain layer. Concrete implementations
use one ORM configured per environment (provider = `postgresql` in POC,
`sqlserver` in prod). Rules to keep the swap clean:

- No raw vendor SQL in services. Vendor-specific SQL (e.g. FTS) lives **only**
  inside a repository implementation, behind the interface.
- Avoid Postgres-only types (`jsonb`, arrays, `citext`). Use portable types:
  `NVARCHAR/text`, `DATETIME2/timestamptz`, `UNIQUEIDENTIFIER/uuid` or BIGINT
  identity. Store "JSON" columns as `NVARCHAR(MAX)`/`text` with app-level parsing.
- All IDs are **UUIDv7** (or ULID) generated by the app, not DB autoincrement —
  removes a class of cross-DB differences and helps audit/traceability.
- Migrations are checked in and run per provider; validate the MSSQL provider in
  CI **from M1**, not at the end (see Risks).

### 1.5 Content storage format (important)

**Canonical content is Markdown** in a documented, constrained flavor
("Notes Etc Flavored Markdown" — NEFM):

- CommonMark + GFM tables + fenced code blocks (with language) + links/images.
- **Callouts** via directive syntax: `:::note`, `:::warning`, `:::tip`, `:::info`
  … `:::` — stable, plain-text, AI-trivial to read and emit.
- No raw HTML permitted in stored content (stripped on ingest).

Pipeline:

```
Editor (TipTap) ⇄ Markdown (stored)  →  markdown-it  →  HTML AST  →  sanitize (allowlist)  →  rendered HTML (cached)
MCP / API read  →  Markdown (verbatim)
MCP / API write →  Markdown (validated against NEFM)  →  stored
```

**Internal links** are stored as `/pages/{id}` (link by page id, not path) so a
link survives page renames and moves. The render pipeline and editor both treat
these as first-class internal references; the editor's link dialog offers an
external-URL mode and a Notes Etc page picker.

Why Markdown as the source of truth: the spec explicitly requires a format
"stable and safe for AI tools to read and modify." Markdown is the most
AI-native, gives clean version diffs, and decouples storage from the editor.
The cost is round-trip fidelity for exotic constructs — addressed by constraining
the flavor and treating TipTap as a *view* over Markdown, not the source.
(Alternative considered — ProseMirror JSON as canonical — rejected for MVP: more
editor-coupled and less diff/AI-friendly. Revisit if rich-layout needs grow.)

---

## 2. Database / schema design

IDs are app-generated UUIDv7 (`CHAR(36)`/`uniqueidentifier`). Timestamps are
UTC. "JSON" columns are portable text. Soft-delete via `archived_at`/`status`
rather than physical deletes (auditability).

### 2.1 Identity & access

**users**
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| email | string unique | login identity |
| display_name | string | |
| auth_source | enum(`local`,`entra`) | |
| entra_oid | string null, unique | Entra object id |
| password_hash | string null | argon2id; local only |
| is_breakglass | bool | env-bootstrapped admin |
| global_role | enum(`global_admin`,`member`) | member = normal user |
| status | enum(`active`,`disabled`) | breakglass auto-disabled if env removed |
| created_at / updated_at / last_login_at | datetime | |

**groups** (`id, name, source(local|entra), entra_group_id null, description`)
**group_members** (`group_id, user_id`) — PK pair.
> Entra group/app-role claims map to `groups` on login (design hook for the
> future; MVP can sync lazily on login).

### 2.2 Authorization

**resource_grants** — the generic ACL that makes page-level permissions a future
no-op:
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| resource_type | enum(`space`,`page`) | **MVP only ever writes `space`** |
| resource_id | uuid | space id (later: page id) |
| principal_type | enum(`user`,`group`) | |
| principal_id | uuid | |
| role | enum(`space_admin`,`editor`,`viewer`) | |
| granted_by | uuid (user) | |
| created_at | datetime | |

Unique on (`resource_type`,`resource_id`,`principal_type`,`principal_id`,`role`).

### 2.3 Knowledge model

**spaces**
`id, key (unique slug, e.g. "IT"), name, description, owner_id, visibility(enum private|internal), status(active|archived), created_at, updated_at, archived_at`

**pages**
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| space_id | uuid FK | |
| parent_id | uuid null FK→pages | nesting |
| slug | string | unique within (space_id, parent_id) |
| title | string | |
| status | enum(`draft`,`published`,`archived`) | |
| owner_id | uuid FK→users | |
| current_version_id | uuid null FK→page_versions | published pointer |
| position | int | sibling ordering |
| created_by / updated_by | uuid | |
| created_at / updated_at / archived_at | datetime | |

Index: (`space_id`,`parent_id`,`slug`) unique; (`space_id`,`status`);
(`updated_at`) for stale-page queries. Path-by-slug lookups resolve by walking
`parent_id` (or an optional materialized `path` column for speed).

**page_versions** — append-only; every edit inserts one.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| page_id | uuid FK | |
| version_number | int | per-page incrementing |
| title | string | snapshot |
| content | text | Markdown (NEFM) snapshot |
| content_format | string | `hfm/1` |
| change_summary | string null | |
| **author_type** | enum(`human`,`api_token`,`ai_tool`) | traceability |
| author_user_id | uuid null | acting user (or token owner) |
| author_token_id | uuid null | API token used |
| ai_agent_label | string null | e.g. "claude-opus-4-8 via MCP" |
| created_at | datetime | |

Unique (`page_id`,`version_number`). Restoring a version creates a *new* version
whose content equals the restored one (history is never rewritten).

**page_proposals** — suggested changes as a first-class concept.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| page_id | uuid FK | |
| base_version_id | uuid FK→page_versions | what it was diffed against |
| proposed_title | string null | |
| proposed_content | text | Markdown |
| rationale | string null | why |
| status | enum(`open`,`approved`,`rejected`,`superseded`) | |
| origin_type | enum(`human`,`api_token`,`ai_tool`) | |
| created_by / created_token_id / ai_agent_label | | same traceability trio |
| reviewed_by | uuid null | |
| reviewed_at | datetime null | |
| created_at | datetime | |

Approve → applies content as a new `page_version` (author_type inherited as the
*approver* with `source_proposal_id` noted), sets proposal `approved`. Reject →
`rejected`. Concurrent edits → base version stale → `superseded`.

**tags** (`id, name unique`) + **page_tags** (`page_id, tag_id`) join table
(portable; avoids array columns).

**attachments**
`id, page_id FK, filename, content_type, size_bytes, storage_key (random),
checksum_sha256, scan_status(enum pending|clean|blocked), uploaded_by,
author_type, created_at`. Bytes live on a volume / object store, **never** in the
webroot; row holds metadata + opaque storage key.

### 2.4 Operations & config

**api_tokens**
`id, name, token_hash (argon2id of secret), token_prefix (for display/lookup),
owner_user_id FK, scopes (text/JSON), allowed_space_ids (null=all owner can see),
last_used_at, expires_at, revoked_at, created_at`. The **plaintext token is shown
once** at creation. A token can never exceed its owner's permissions (§3).

**audit_log** — append-only, the spine of the whole system.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| occurred_at | datetime | |
| actor_type | enum(`human`,`api_token`,`ai_tool`,`system`) | |
| actor_user_id / actor_token_id / ai_agent_label | | |
| action | string | e.g. `page.update`, `auth.login`, `grant.create` |
| target_type / target_id | string/uuid | |
| space_id | uuid null | for filtering |
| result | enum(`success`,`denied`,`error`) | denials are logged too |
| ip / user_agent / request_id | string | |
| metadata | text(JSON) | before/after deltas, never secrets |

Append-only (no UPDATE/DELETE granted to app role). Optional hardening: hash
chain (`prev_hash`) for tamper-evidence — flagged as post-MVP.

**settings** — runtime config store (the "manage config in-app" requirement).
`key (PK), value (text), is_encrypted (bool), updated_by, updated_at`. Encrypted
values (e.g. an SSO client secret) are sealed with a master key from env (§6).
Auth/Entra config, MCP/tool settings, and system settings all live here.

**sessions** (if server-side) `id, user_id, created_at, expires_at, revoked_at,
ip, user_agent` — or stateless signed cookies; see §6.

### 2.5 Entity relationships (summary)

```
users ─┬─< group_members >─ groups
       ├─< resource_grants >─ spaces ─< pages ─< page_versions
       │                                   │
       │                                   ├─< page_proposals
       │                                   ├─< page_tags >─ tags
       │                                   └─< attachments
       ├─< api_tokens
       └─< audit_log (actor)
```

---

## 3. Permission model

### 3.1 Principals

A request resolves to a **Principal**:
```
Principal {
  user            // the human/owner identity
  via             // 'session' | 'api_token' | 'mcp'
  token?          // API token (with scopes + space restriction)
  agentLabel?     // AI tool label, for traceability
  actorType       // 'human' | 'api_token' | 'ai_tool' | 'system'
}
```
Groups (incl. Entra groups) expand into the user's effective grants.

### 3.2 Roles

| Role | Scope | Capability summary |
|---|---|---|
| **global_admin** | global | everything, incl. admin portal, users, tokens, auth config |
| **space_admin** | per space | manage space settings + grants, all page ops in space |
| **editor** | per space | create/update/publish pages, propose, restore, upload |
| **viewer** | per space | read published pages, search, download attachments |
| **API/tool role** | via token | not a separate grant — a token *inherits its owner's* roles, **intersected** with the token's scopes and space restriction |

> Decision: tokens do **not** carry independent power. A token's effective
> permission = owner's permission ∩ token scopes ∩ allowed spaces. This means
> revoking a user neutralizes their tokens, and a token can never escalate.

### 3.3 Authorization function

One function, called by every service method, deny-by-default:

```
authorize(principal, action, resource) -> allow | deny
```

Resolution walks the **resource hierarchy** so page-level permissions slot in
later with no call-site changes:

```
page → (future: page grants) → its space grants → global_role
```

For MVP, grants only exist at the space level, so a page's effective role = the
user's role on its space (direct or via group), unioned with global_admin.

### 3.4 Capability matrix (excerpt)

| action | viewer | editor | space_admin | global_admin |
|---|:--:|:--:|:--:|:--:|
| space.read / page.read (published) | ✓ | ✓ | ✓ | ✓ |
| page.read (draft) | – | ✓ | ✓ | ✓ |
| search (within readable spaces) | ✓ | ✓ | ✓ | ✓ |
| page.create / page.update / page.publish | – | ✓ | ✓ | ✓ |
| proposal.create | ✓* | ✓ | ✓ | ✓ |
| proposal.approve / reject | – | ✓ | ✓ | ✓ |
| version.restore | – | ✓ | ✓ | ✓ |
| attachment.upload | – | ✓ | ✓ | ✓ |
| space.create | – | – | – | ✓ |
| space.settings / grants.manage | – | – | ✓ | ✓ |
| users / tokens / auth config / audit read | – | – | – | ✓ |

\* viewers proposing changes is configurable per space (default: editors+).

Every `deny` is written to the audit log with `result='denied'`.

---

## 4. API design

- Base: `/api/v1`. JSON in/out. OpenAPI 3.1 generated from code + served at
  `/api/v1/openapi.json` and a `/docs` UI.
- **Auth**: web → secure httpOnly session cookie (+ CSRF token); programmatic →
  `Authorization: Bearer <token>`.
- **Errors**: RFC 7807 `application/problem+json`
  (`type, title, status, detail, instance, errors[]`).
- **Pagination**: cursor-based (`?limit=&cursor=`), responses
  `{ data: [...], page: { nextCursor, hasMore } }`.
- **Concurrency**: page updates require `baseVersionNumber`; mismatch → `409`
  (prevents lost updates; powers proposal `superseded`).
- **Validation**: zod schemas (shared with MCP). **Idempotency-Key** header
  honored on creates.
- Every mutating endpoint runs the same `authorize()` + `audit()` as the UI.

### 4.1 Endpoints

| # | Method | Path | Permission | Notes |
|---|---|---|---|---|
| Spaces | GET | `/spaces` | any (filtered to readable) | list |
| | POST | `/spaces` | global_admin | create |
| | GET | `/spaces/{id}` | viewer+ | get |
| | PATCH | `/spaces/{id}` | space_admin+ | update |
| | POST | `/spaces/{id}:archive` | space_admin+ | archive |
| Grants | GET/POST/DELETE | `/spaces/{id}/grants` | space_admin+ | manage permissions |
| Pages | GET | `/spaces/{id}/pages` | viewer+ | list (tree or flat) |
| | GET | `/pages/{id}` | viewer+ (draft→editor+) | by id |
| | GET | `/spaces/{key}/pages/by-path?path=` | viewer+ | by path/slug |
| | POST | `/spaces/{id}/pages` | editor+ | create (draft default) |
| | PATCH | `/pages/{id}` | editor+ | update (+baseVersion) |
| | POST | `/pages/{id}:publish` | editor+ | draft→published |
| | POST | `/pages/{id}:archive` | editor+ | archive |
| Proposals | POST | `/pages/{id}/proposals` | per §3.4 | suggested update |
| | GET | `/pages/{id}/proposals` | viewer+ | list |
| | POST | `/proposals/{id}:approve` | editor+ | apply → new version |
| | POST | `/proposals/{id}:reject` | editor+ | |
| Versions | GET | `/pages/{id}/versions` | viewer+ | list history |
| | GET | `/versions/{id}` | viewer+ | get snapshot |
| | POST | `/pages/{id}:restore` | editor+ | restore (= new version) |
| Search | GET | `/search?q=&space=&tag=` | any (scoped to readable) | |
| Attachments | POST | `/pages/{id}/attachments` | editor+ | upload (multipart) |
| | GET | `/pages/{id}/attachments` | viewer+ | list |
| | GET | `/attachments/{id}/download` | viewer+ | stream, `Content-Disposition: attachment` |
| Admin | `/admin/users`,`/admin/tokens`,`/admin/auth-config`,`/admin/audit`,`/admin/settings` | global_admin | portal APIs |
| Health | GET | `/healthz`, `/readyz` | none | liveness/readiness |

> **Routing note (M2):** custom-method style paths written above as `:archive`
> are implemented as sub-resource paths (`POST /spaces/:id/archive`,
> `.../grants`, `DELETE .../grants/:grantId`) to avoid literal-colon parsing
> issues in Express routing. Behaviour is unchanged.

---

## 5. MCP tool design

The MCP server lives in the same codebase and **imports the service layer
directly** (no second implementation). Each MCP request carries a token →
resolves to a `Principal` with `via='mcp'`, `actorType='ai_tool'`, and an
`agentLabel`. Same `authorize()`, same `audit()`. **Write tools default to
drafts/proposals**; direct publish is gated behind an explicit token scope
(`mcp:write:direct`) that is off by default.

| Tool | Kind | Maps to | Default safety |
|---|---|---|---|
| `search_pages` | read | SearchService | scoped to readable spaces |
| `get_page` | read | PageService.get | published unless editor+ |
| `list_spaces` | read | SpaceService.list | filtered |
| `list_child_pages` | read | PageService.children | filtered |
| `create_page_draft` | write | PageService.create(status=draft) | **draft only** |
| `propose_page_update` | write | ProposalService.create | **proposal, never direct** |
| `append_page_note` | write | ProposalService.create (append callout) | proposal by default |
| `find_stale_pages` | read | PageService.listStale(olderThan) | `updated_at` threshold |

Tool I/O schemas are the **same zod schemas** as the REST endpoints. Each tool
result includes the created draft/proposal id and a deep link for a human to
review. Prompt-injection note: content read by tools is data, never instructions
(see Risks §8).

---

## 6. Security plan

**Authentication**
- Entra ID via OIDC (`openid-client`): auth-code + PKCE, validate `iss`/`aud`/
  `nonce`, map `oid`→user, `groups`/roles→`groups`. Preferred login path.
- Local accounts with **argon2id** (memory-hard params), per-user salt (built in).
- **Breakglass admin**: bootstrapped from env (`BREAKGLASS_ADMIN_EMAIL`,
  `BREAKGLASS_ADMIN_PASSWORD` or pre-hash). On every boot: if env present →
  upsert + ensure `is_breakglass, global_admin, active`; **if env absent → set
  that account `status=disabled`.** All breakglass logins are heavily audited and
  tightly rate-limited; force a strong password; MFA flagged post-MVP.

**Sessions & cookies**
- httpOnly, `Secure`, `SameSite=Lax` (Strict for admin), short-lived session +
  rotating refresh; server-side session records allow revocation.

**CSRF**: cookie-authenticated state-changing requests require a CSRF token
(double-submit) **and** a custom header check. Bearer-token (API/MCP) requests
are exempt (no ambient cookie auth).

**Rate limiting**: per-IP on `/auth/login` (strict, with lockout/backoff) and
per-token + per-IP on `/api/*`. Pluggable store (in-memory POC → Redis later).

**Input/output safety**
- All input validated by zod at the edge; reject unknown fields.
- Stored Markdown stripped of raw HTML; rendered HTML passed through an allowlist
  sanitizer (sanitize-html / DOMPurify). Strict **CSP** (no inline scripts).

**Attachments (untrusted)**: random storage keys outside webroot; enforce size +
content-type allowlist; sniff actual type; always serve with
`Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; never
render SVG/HTML inline; `scan_status` hook for AV (ClamAV) — block until clean in
prod.

**Secrets**: bootstrap-only in env (DB conn, breakglass, master encryption key).
Ongoing config in `settings`, with sensitive values **encrypted at rest**
(AES-256-GCM via the env master key; envelope encryption / KMS later). **Never
log secrets** — redaction middleware on logs and audit metadata.

**Audit integrity**: app DB role has INSERT-only on `audit_log` (no UPDATE/
DELETE). Optional hash-chain for tamper-evidence (post-MVP).

**Transport/headers**: TLS terminated at proxy; HSTS, CSP, `X-Frame-Options`,
`Referrer-Policy`, `nosniff`. Dependency + image scanning in CI.

---

## 7. MVP milestone plan

Each milestone is independently runnable and demoable. Tests land *with* the
feature, not after.

- **M0 — Skeleton & contracts (foundation).** Monorepo, Docker compose
  (api + web + Postgres), healthcheck, config loader, repository interfaces,
  migration tooling, CI running migrations against **both** Postgres and MSSQL,
  audit + authorize stubs, OpenAPI pipeline. *Exit: `/healthz` green in Docker.*
- **M1 — Auth + breakglass.** Local login, argon2id, sessions/cookies, CSRF,
  breakglass bootstrap + auto-disable, login rate limit, auth audit events.
  *Exit: log in as breakglass; removing env disables it; events audited.*
- **M2 — Spaces + permission model.** Spaces CRUD/archive, `resource_grants`,
  `authorize()` real implementation, capability matrix enforced, grant management.
  *Exit: viewer/editor/space_admin behave per matrix; denials audited.*
- **M3 — Nested pages + versioning.** Page CRUD, nesting, slugs/paths, draft/
  publish, `page_versions` on every edit, restore, optimistic concurrency.
  *Exit: edit history visible; restore creates a new version.*
- **M4 — Editor + content pipeline.** TipTap editor, NEFM Markdown storage,
  sanitize/render pipeline, callouts/tables/code. *Exit: non-technical user can
  author a page end-to-end.*
- **M5 — Proposals (suggested changes).** Proposal create/list/approve/reject,
  apply-as-new-version, supersede on stale base. *Exit: propose→review→approve.*
- **M6 — Search.** DB full-text behind `SearchService`, scoped to readable
  spaces. *Exit: search returns only permitted results.*
- **M7 — REST API + tokens + OpenAPI.** API tokens (hashed, scoped, owner-bound),
  bearer auth, full documented API, token usage audited. *Exit: published
  OpenAPI; external client drives the full flow.*
- **M8 — MCP tools.** MCP server over the service layer; the 8 tools; write =
  draft/proposal by default; fully audited. *Exit: an AI client searches, reads,
  drafts, and proposes — all within permissions, all audited.*
- **M9 — Admin portal + hardening.** Admin UI (users, grants, spaces, auth
  config, tokens, MCP settings, audit viewer, system settings), encrypted
  settings, rate limits, CSP/headers, attachment AV hook. *Exit: admin manages
  the system in-app; security checklist passes.*

Seed/demo data and a one-command local dev setup ship from M0 and grow each
milestone.

---

## 8. Risks & tradeoffs

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **MSSQL ORM feature gaps** (Prisma SQL Server caveats; type/FTS differences) | late-stage portability pain | repository interfaces; portable types; **run migrations + a smoke suite against MSSQL in CI from M0**; isolate vendor SQL. **Found in M0:** SQL Server forbids cascade cycles and multiple cascade paths to one table — the schema now sets explicit `onDelete/onUpdate: NoAction` on the Page self-relation, the Page↔PageVersion pointer, and the second path of each join table (GroupMember, PageTag). The CI `mssql-compat` job (provider-swapped schema → `prisma db push` on real SQL Server) is what surfaced this. |
| 2 | **Markdown round-trip fidelity** (TipTap ↔ NEFM loses exotic layout) | author frustration | constrain the flavor (NEFM); TipTap as a *view*; golden-file round-trip tests; document unsupported constructs |
| 3 | **Prompt injection via page content** (AI tool reads malicious "instructions" in a page) | unwanted AI actions | treat all read content as data; tools never execute embedded instructions; write tools produce *proposals* needing human approval; agent actions clearly labeled + audited |
| 4 | **Over-powerful tokens / privilege escalation** | data exposure | tokens inherit ∩ owner perms ∩ scopes ∩ spaces; revocable; usage audited; shown once |
| 5 | **Audit log volume & integrity** | storage growth, tamper risk | INSERT-only role; partition/retention policy; optional hash chain post-MVP |
| 6 | **Entra setup friction** (tenant config, group claims) | onboarding delay | local + breakglass work without Entra; Entra config in-app + validated; group mapping designed but lazy |
| 7 | **Search scaling** beyond DB FTS | slow search at volume | `SearchService` interface; swap to Meilisearch/OpenSearch later without touching callers |
| 8 | **Separate API vs Next.js complexity** (two services) | more infra | justified by API-first parity; compose handles it; optional thin BFF only |
| 9 | **Encryption key management** (master key in env) | key compromise = secret exposure | env master key for POC; envelope encryption/KMS path documented; never log secrets |
| 10 | **Scope creep toward Confluence parity** | MVP slips | explicit non-goals (no realtime collab, plugins, public sharing, comments, whiteboards, full import); proposals chosen over collab |

---

## Appendix B — Brand & theming ("Amber")

Notes Etc ships with an **Amber** theme as the default — warm, high-contrast,
amber-forward. Built as **CSS custom properties (design tokens)** so themes are
swappable and a dark variant can follow without touching components.

### Brand palette (from supplied swatches — confirm exact hexes)

| Token | Hex* | Role |
|---|---|---|
| `--brand-gold` | `#F2C200` | **primary** — gold/amber; key actions, highlights, logo |
| `--brand-amber` | `#D97B0E` | **secondary** — burnt orange; hover/active, secondary actions |
| `--brand-maroon` | `#6E2A2A` | **deep accent** — dark red; warnings/destructive emphasis, headers |
| `--brand-slate-blue` | `#8DA9C4` | **muted/info** — cool counterweight; info callouts, links-muted |
| `--brand-navy` | `#3E4259` | **ink** — dark navy/slate; primary text, dark surfaces, nav bar |

\* Eyeballed from the palette image — replace with the official brand hex values
when available.

### Semantic tokens (what components actually use)

```
--color-primary:        var(--brand-gold)
--color-primary-hover:  var(--brand-amber)
--color-on-primary:     var(--brand-navy)      /* navy text on gold = AA contrast */
--color-accent:         var(--brand-amber)
--color-text:           var(--brand-navy)
--color-text-muted:     #6b7280
--color-bg:             #fffdf7              /* warm off-white "comb" base */
--color-surface:        #ffffff
--color-border:         #ece3cf              /* warm neutral */
--color-info:           var(--brand-slate-blue)
--color-warning:        var(--brand-amber)
--color-danger:         var(--brand-maroon)
--color-link:           var(--brand-amber)
```

Callout (`:::note/info/warning/tip`) colors derive from these semantic tokens so
NEFM rendering and the editor share one source of truth.

### Application: light-touch theming

The theme is **deliberately restrained**. Color lives in the **chrome**, not the
content:

- **Themed:** the top title/brand bar and the left navigation/menu bar — amber
  accents, navy surfaces, gold signature.
- **Low-theme / high-readability:** the main document viewer and editor are a
  calm, near-neutral reading surface — navy text on warm off-white, generous
  whitespace, minimal color. Color appears only where it carries meaning (links,
  callouts, status). The reading experience is the priority; branding stays at
  the edges. (Details to be refined iteratively during the editor milestone.)

### Guidelines

- **Brand gold is the signature**, used sparingly for emphasis — not large fills
  (gold on white is low-contrast). Pair gold backgrounds with **navy** text.
- Body text is **navy** on a warm off-white (`--color-bg`), not pure black/white.
- The note-with-ellipsis logo motif allowed as a *light* decorative accent (empty states,
  loaders) — never behind body text.
- **Accessibility is a hard gate:** every text/background pair must meet WCAG AA
  (4.5:1 body, 3:1 large). Verify gold/amber/maroon pairings; adjust shades if a
  brand hex fails. This overrides aesthetic preference.
- Dark theme = a second token map (`navy` surfaces, gold accents) — post-MVP,
  but the token layer makes it a drop-in.

---

## Appendix A — Explicit non-goals (MVP)

Real-time collaborative editing · marketplace/plugins · public anonymous
sharing · complex comments · mobile app · workflow engine · whiteboards/canvas ·
full Confluence import · pixel-perfect WYSIWYG.
