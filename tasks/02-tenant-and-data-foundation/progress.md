# Progress

## Status
- in_progress

## Updates
- 2026-02-19: Task created.
- 2026-02-19: Audited `backend/prisma/schema.prisma` and `backend/src/modules/project/project.repository.ts` for tenant boundaries and chat-thread capture paths.
- 2026-02-19: Confirmed current tenancy is implicit via `project.user_id`; no explicit tenant entity or tenant FK exists on downstream tables.
- 2026-02-19: Confirmed `capture_session` is already the canonical thread aggregate for provider conversation history, with turn linkage via `capture_turn.capture_session_id`.
- 2026-02-19: Drafted schema/index/query contract decisions for tenant-safe scaling and campaign/version lifecycle.
- 2026-02-19: Implemented Prisma schema updates for tenant/campaign/version foundation and tenant-scoped indexes.
- 2026-02-19: Updated project repository/service contracts to pass `tenant_id` across project, session, turn, node, run, and snapshot paths.
- 2026-02-19: Added default-tenant bootstrap in auth and user signup repositories.
- 2026-02-19: Ran `pnpm prisma:generate`, `pnpm prisma db push --force-reset`, and `pnpm build` successfully in `backend/`.
- 2026-02-19: Next phase added: full-stack tenant rollout (backend + extension + web) to remove backend-only gap.
- 2026-02-19: UX pass completed for tenant handling in UI clients:
  - extension API now shows workspace-scoped message for project 403/404 responses.
  - web API client now maps project 403/404 responses to tenant-aware guidance.
  - web project graph/list empty states now explicitly explain workspace/project access context.
- 2026-02-19: Re-ran web and extension production builds after UX updates; both succeeded.

## Schema Decisions
- Introduce explicit tenant layer:
  - `tenant` (workspace/account boundary).
  - `tenant_member` (user-to-tenant membership with role metadata).
- Keep `user` as principal identity; add `tenant_id` + `created_by_user_id` to `project`.
- Add `tenant_id` to major derived entities (`capture_session`, `capture_turn`, `prompt_node`, `semrush_snapshot`, `generation_run`) to enforce direct tenant scoping and support index-local reads.
- Add campaign/version model:
  - `campaign` (long-lived SEO objective/domain boundary).
  - `campaign_version` (working version lineage, status, archive pointer).
- Treat `capture_session` as canonical chat thread record:
  - session identity rooted in provider conversation semantics.
  - all turn and prompt lineage remains attached to session.
- Index plan (additive):
  - `capture_session`: `(tenant_id, project_id, last_event_at desc)`, `(tenant_id, project_id, chat_provider, started_at desc)`, `(tenant_id, project_id, chat_provider, provider_chat_id)`, `(tenant_id, project_id, chat_provider, chat_url)`.
  - `capture_turn`: `(tenant_id, capture_session_id, response_finished_at desc)`.
  - `prompt_node`: `(tenant_id, project_id, created_at desc)`, `(tenant_id, capture_session_id, created_at desc)`.
  - `campaign_version`: `(tenant_id, campaign_id, created_at desc)`, unique active guard per campaign.

## Migration Notes
- Phase 1 (expand, nullable-safe):
  - create `tenant`, `tenant_member`, `campaign`, `campaign_version`.
  - add nullable `tenant_id`/`created_by_user_id`/`campaign_id`/`campaign_version_id` columns where needed.
  - add non-unique indexes first to reduce lock duration.
- Phase 2 (backfill):
  - create one default tenant per existing user.
  - backfill `project.tenant_id` from `project.user_id`.
  - backfill downstream `tenant_id` using project join.
  - backfill campaign/version: one campaign per project + initial version record per project.
- Phase 3 (contract hardening):
  - switch repository methods to require tenant scope in signatures.
  - deploy app code using tenant-aware predicates.
  - enforce not-null and unique constraints after data verification.
- Phase 4 (cold history enablement):
  - mark non-active `campaign_version` rows archived with immutable archive pointer.
  - retain hot tables for active version; move historical heavy payloads to cold store references.
- Rollback posture:
  - additive-first migrations; defer destructive column removals (including legacy `project.user_id` usage) until after stable production validation.
- Applied execution path:
  - user-approved destructive reset was used (`prisma db push --force-reset`) because existing data was not needed.
  - schema is now fully applied on remote DB and Prisma client regenerated.

## Query Contract Decisions
- Repository method signatures must accept tenant context:
  - either explicit `tenant_id`
  - or `user_id` only at boundary methods that immediately resolve tenant membership.
- Disallow ID-only lookups for tenant-owned entities (project/session/turn/node/run/snapshot).
- Preferred pattern:
  - resolve project by `(tenant_id, project_id)`.
  - scope all downstream queries by both `tenant_id` and relevant FK.
- Ingestion/session upsert path must use tenant-scoped composite keys before fallback identity checks.
- List endpoints (dashboard/chat history/version history) must be tenant-scoped in SQL predicates, never post-filtered in memory.

## Blockers
- none

## Next Phase Scope (Active)
- Extension:
  - verify tenant is never client-controlled in payload.
  - ensure authenticated backend context resolves tenant for ingest/link/list actions.
- Web app:
  - audit all project/chat/version calls for tenant-scoped endpoint usage only.
  - remove/replace any unscoped reads.
- Backend:
  - verify all consumed endpoints enforce tenant scope from auth context consistently.
  - add missing guards where legacy paths still accept ID-only access.

## Notes For Assigned Agent
- Implement this phase end-to-end across frontend, extension, and backend.
- If any workflow context is unclear, ask the user first and then continue.
