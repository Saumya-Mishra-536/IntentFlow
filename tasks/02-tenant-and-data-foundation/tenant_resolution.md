# Tenant Resolution Path (Agent Reference)

## Source of Truth
- Tenant context is resolved server-side from authenticated `user_id`.
- Clients (extension/web) must never send `tenant_id` in API payloads.

## Resolution Flow
1. Request arrives with bearer token.
2. Auth middleware resolves `req.user.id`.
3. Project boundary is resolved through membership (`project` joined via `tenant_member`).
4. Service reads `project.tenant_id` and passes it to repository methods.
5. Repository queries include tenant-scoped predicates for project/session/turn/node/run/snapshot operations.

## Client Contract
- Allowed identifiers from client:
  - `project_id`
  - chat/thread identifiers (`conversation_id`, `provider_chat_id`, `chat_thread_id`, `chat_url`)
- Disallowed:
  - `tenant_id` in request payload or query params.

## Endpoint Safety Rules
- Any project-bound operation must resolve project by user membership before DB writes.
- Never run ID-only reads/writes for tenant-owned entities.
- Prefer composite identity for chat thread upsert:
  - `(tenant_id, project_id, chat_provider, conversation_id)`
  - fallback: provider chat id / canonical chat URL scoped by tenant + project.

## Validation Checklist
- `GET /api/projects` returns only tenant-member projects.
- `GET /api/projects/:project_id/tree` blocks cross-tenant access.
- Chat thread list/link/open endpoints are tenant-scoped.
- Ingest/suggestion endpoints do not accept or trust tenant from client.

## Notes
- Current implementation supports auto-creating a default tenant for new users at signup/OAuth time.
- Campaign/version entities exist in schema for next-phase product rollout.
