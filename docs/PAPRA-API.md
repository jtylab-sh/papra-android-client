# Papra server REST API

Inventory read from github.com/papra-hq/papra (`apps/papra-server/src/modules/*`,
branch `main`, 2026-08-27). All routes are mounted under `/api`. Guides which
features this client can implement.

## Authentication

- **Session** (what this app uses): better-auth cookie, endpoints under
  `/api/auth/*` (email/password, TOTP 2FA, `papra://` scheme trusted for Expo).
- **API key**: `Authorization: Bearer`, but scoped to only 4 resources
  (`organizations|documents|tags|custom-properties` x `create|read|update|delete`).
  Routes that declare no API-key permission are **session-only** — that includes
  restore, trash purge, webhooks, tagging rules, document views, members, users.

## Documents — `/api/organizations/:organizationId/documents`

| Method | Path | Notes |
|---|---|---|
| POST | `/documents` | multipart field `file`; dedupe by SHA-256 (409 `document.already_exists`; trashed duplicate is restored and untagged) |
| GET | `/documents` | list/search: `searchQuery` (max 1024 chars), `sortField` `createdAt|updatedAt|name|documentDate`, `sortOrder` `asc|desc`, `pageIndex` (0-based), `pageSize` (default and max **100**) -> `{documents, documentsCount}` |
| GET | `/documents/deleted` | trash; `pageIndex`/`pageSize` only, always `deletedAt DESC`; rows include `deletedAt` + `deletedBy` |
| GET | `/documents/statistics` | `{organizationStats: {documentsCount, documentsSize, deletedDocumentsCount, ...}}` |
| GET | `/documents/:documentId` | `{document}` incl. `tags[]`, `customProperties[]`, `content` |
| PATCH | `/documents/:documentId` | body (>=1 of): `name` (1-255), `content`, `documentDate`, `notes` (<=2048) |
| DELETE | `/documents/:documentId` | soft delete -> trash |
| POST | `/documents/:documentId/restore` | session-only; 204 |
| GET | `/documents/:documentId/file` | binary; `Content-Disposition` filename = **`document.name`** (display name), not originalName/storage key |
| DELETE | `/documents/trash/:documentId` | session-only; permanent delete of one |
| DELETE | `/documents/trash` | session-only; empty trash |
| GET | `/documents/:documentId/activity` | audit timeline, paginated |

### Batch — `/documents/batch/*`

| Method | Path | Body |
|---|---|---|
| POST | `/documents/batch/trash` | `{filter: {documentIds: [...]} | {query: "<search syntax>"}}` -> 204 |
| POST | `/documents/batch/tags` | `{filter, addTagIds?: [], removeTagIds?: []}` (disjoint, >=1 non-empty) -> 204 |

### Document object (API shape)

`id, organizationId, createdBy, originalName, originalSize, originalSha256Hash,
name, mimeType, content, documentDate, notes, deletedAt, deletedBy, isDeleted,
createdAt, updatedAt` plus enrichment:
- `tags`: `[{id, name, color (#RRGGBB), description}]`
- `customProperties`: `[{key, name, type, displayOrder, value}]` — one entry per
  org-wide property **definition**, `value: null` when unset. Types:
  `text | number | date | boolean | select | multi_select | user_relation | document_relation`.

## Search syntax (`searchQuery` on GET /documents, `query` in batch filters)

Parsed by `@papra/search-parser` into a boolean AST, compiled to SQLite FTS5.

- Operators: `AND` (implicit between terms), `OR`, `NOT`; leading `-` = `NOT`
  (`-tag:invoices`); `( )` grouping (AND binds tighter than OR).
- Quoted phrases: `"exact phrase"` (backslash escapes inside).
- Bare text: FTS prefix match over `name` + `content`.
- Field filters (`=` via `:`; comparisons `< <= > >=` where noted):
  - `tag:<name-or-id>` — `=` only
  - `name:<text>`, `content:<text>` — FTS, `=` only
  - `created:<date|now>`, `date:<date|now>` — all comparators
  - `has:tags`, `has:date`, `has:<customPropertyName>` — `=` only
  - `<customPropertyKey>:<value>` — typed comparator per property type
    (number/date get `< <= > >=`; text is exact-equality; boolean accepts
    true/yes/y/1/on/enabled etc.)
- **No `!=` operator** — negate with `NOT field:value` / `-field:value`.
- No user-facing wildcards; no relevance score in the response.
- Limits: 1024 chars, 200 tokens, nesting depth 10. Unknown fields are
  silently dropped from the query, not rejected.

## Trash retention

`deletedDocumentsRetentionDays` (server env, default **30**). A background
task purges documents whose `deletedAt` is older. No `purgeAt` field —
clients compute `deletedAt + retention`.

## Tags — `/api/organizations/:organizationId/...`

| Method | Path | Body / response |
|---|---|---|
| POST | `/tags` | `{name (1-64), color (#RRGGBB), description? (<=256)}` -> `{tag}` |
| GET | `/tags` | `{tags}` |
| PUT | `/tags/:tagId` | same fields, optional -> `{tag}` |
| DELETE | `/tags/:tagId` | 204 |
| POST | `/documents/:documentId/tags` | `{tagId}` -> 204 |
| DELETE | `/documents/:documentId/tags/:tagId` | 204 |

## Custom properties — `/custom-properties`

CRUD on definitions (`POST|GET|PUT|DELETE /custom-properties[/:id]`), plus
per-document values: `GET /documents/:id/custom-properties`,
`PUT /documents/:id/custom-properties/:defId` (`{value}`), `DELETE` same path.

## Other modules (mostly session-only; low priority for this client)

- **Organizations**: `GET|POST /organizations`, `GET|PUT|DELETE /organizations/:id`,
  restore, members, invitations. `GET/PATCH /organizations/:id/settings`
  (AI auto-tagging toggles).
- **Document views** (saved searches): CRUD on `{name, query, description?}` —
  `query` uses the search syntax above.
- **Share links**: per-document public links (optional password), managed via
  `.../documents/:id/share-links`; public fetch `GET /api/share-links/:token/document[/file]`.
- **Tagging rules**: CRUD + `POST /tagging-rules/:id/apply`.
- **Webhooks**: CRUD; events `document:created|deleted|updated|tag:added|tag:removed`.
- **Intake emails**, **API keys** (`POST|GET|DELETE /api-keys`, `GET /api-keys/current`),
  **users** (`GET|PUT /users/me`), **subscriptions/usage**, **admin** (instance admins),
  **`GET /api/config`** (public feature flags), **`GET /api/ping`** / **`GET /api/health`**.

## Feature map for this app

| App feature | API |
|---|---|
| Pagination | `pageIndex`/`pageSize` + `documentsCount` |
| Search-as-you-type | `GET /documents?searchQuery=...&pageSize=10` (debounced) |
| Tag/NOT search | search syntax above, verbatim |
| Mass delete | `POST /documents/batch/trash {filter:{documentIds}}` |
| Mass tag/untag | `POST /documents/batch/tags` |
| Per-doc tag add/remove | `POST|DELETE /documents/:id/tags[...]` |
| Tag manage | `/tags` CRUD |
| Trash countdown | `deletedAt` + 30-day default retention |
| Download filename | server already serves `document.name` |
| Custom properties UI | enriched `customProperties[]` (key/name/type/value) |
| Rename / notes / date | `PATCH /documents/:id` |
