# Plan

## Goal
Make backend data model production-safe for multi-tenant growth, versioning scale, and thread-level chat history.

## Next Task (Full-Stack Tenant Rollout)
Apply tenant-safe contracts end-to-end across backend, extension, and web app so tenancy is not backend-only.

## Scope
- Add explicit tenant/user provenance path on all major entities.
- Add campaign/version storage strategy (hot vs cold history design).
- Validate `capture_session` as canonical thread record for multi-provider usage.
- Add indexes for tenant-scoped reads and dashboard queries.
- Document archival approach for historical versions.

## Deliverables
- Prisma schema update plan.
- Migration/backfill strategy.
- Query contract for tenant-safe repository methods.
- Extension API contract update plan (tenant resolved server-side from auth token only).
- Web app API usage audit and fixes for tenant-scoped endpoints.
- End-to-end validation checklist for tenant-safe flows.

## Execution Plan
1. Audit current schema and repository methods for tenant boundaries and ID-only lookups.
2. Define tenant provenance model (`tenant`, `tenant_member`, `created_by_user_id`) and propagation rules.
3. Define campaign/version model and hot vs cold storage split.
4. Define `capture_session` contract as canonical chat thread root, including provider identity rules.
5. Define indexes for tenant/project/provider dashboard and ingestion paths.
6. Write phased migration + backfill plan with rollback-safe order.
7. Document tenant-safe repository query contract for all new/updated methods.

## Target Schema Changes
- Add `tenant` and `tenant_member` entities; keep `user` as identity principal.
- Add `tenant_id` and `created_by_user_id` to `project`; keep existing `user_id` during transition.
- Add `tenant_id` to `capture_session`, `capture_turn`, `prompt_node`, `semrush_snapshot`, `generation_run` for direct row-level scoping and index locality.
- Add campaign/version entities:
  - `campaign` as long-lived business container (tenant-scoped).
  - `campaign_version` as mutable working slice with `is_active`, `archived_at`, and storage pointers for cold history.
- Keep `capture_session` as thread root; all turn/prompt lineage remains session-linked.

## Query Contract (Draft)
- Every repository read/write must receive either `tenant_id` directly or `(user_id + tenant_membership)` and scope queries at DB level.
- Avoid ID-only methods without tenant/project scope checks.
- For project-scoped methods, require `tenant_id + project_id` or resolve project by `(tenant_id, project_id)` before downstream queries.
- For capture/session ingestion, use composite identity:
  - preferred: `(tenant_id, project_id, chat_provider, conversation_id)`
  - fallback lookups: provider chat id and canonical chat URL scoped by tenant/project/provider.
- Dashboard list endpoints must sort on indexed tenant/project timestamp keys and avoid client-side filtering for tenancy.

## Full-Stack Rollout Plan
1. Audit extension API payloads and remove any client-controlled tenant fields if present.
2. Ensure extension sends only project/chat identifiers; backend resolves `tenant_id` from authenticated user context.
3. Audit web app API calls and block any unscoped/global fetch paths.
4. Update backend controllers/services where needed so tenant scoping is enforced uniformly across old and new endpoints.
5. Add integration checks:
   - project list and project details return only current tenant data.
   - chat thread listing/linking/opened actions remain tenant-scoped.
   - cross-tenant ID access attempts return safe errors.
6. Add concise docs for future agents about tenant resolution path.

## Agent Instructions
- Explore existing Prisma schema and repository/service query paths first.
- Use only `snake_case` fields and payload keys.
- Update `progress.md` after every schema, migration, or contract decision.
- For this next task, implement frontend + extension + backend alignment completely, not backend-only.
- If any context is missing or ambiguous, ask the user before assumptions.
