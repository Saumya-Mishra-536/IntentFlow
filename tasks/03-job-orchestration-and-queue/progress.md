# Progress

## Status
- in_progress

## Updates
- 2026-02-19: Task created.
- 2026-02-20: Audited current execution architecture across backend + extension.
- 2026-02-20: Confirmed no backend queue/worker layer exists yet; sequential orchestration currently runs in extension background worker.
- 2026-02-20: Confirmed SEMrush calls are executed from backend request flow (`project.service.ts`) and need to move to queued workers for task compliance.
- 2026-02-20: Added backend queue infrastructure (`bullmq`) and Redis-backed connection config (`REDIS_URL`).
- 2026-02-20: Added `semrush_fetch_queue` producer + worker and moved SEMrush insight fetch execution into worker path.
- 2026-02-20: Added suggestion run status endpoint contract + implementation:
  - `GET /api/projects/:project_id/suggestions/runs/:generation_run_id/status`
- 2026-02-20: Added task deliverable docs:
  - `queue_architecture.md`
  - `worker_and_retry_policy.md`
  - `status_contract.md`
- 2026-02-20: Backend TypeScript build passes after queue integration.

## Current Baseline (Audit)
- Prompt firing orchestration: extension service-worker sequential runner (`AI_SEO_SEQ_*` messages), not backend queue.
- Follow-up ingest buffering: extension-side in-memory queue and staged DB writes.
- External API processing: backend synchronous call path in `suggestPrompts` (`getSemrushSiteInsights` / `fetchSemrushMetricsForSite`).
- Queue infra dependencies (`bullmq`, `ioredis`) are not present in backend `package.json`.

## Queue Decisions
- BullMQ + Redis will be introduced in backend with separate queues:
  - `prompt_execution_queue`
  - `semrush_fetch_queue`
  - `ahrefs_fetch_queue` (scaffold for parity)
- Job states contract:
  - `queued`, `running`, `retrying`, `failed`, `completed`
- Idempotency key pattern:
  - `tenant_id:project_id:job_type:deterministic_hash(payload)`
- Dedupe policy:
  - enqueue with deterministic `job_id`; drop duplicates still in queue lifecycle window.
- Queue boot:
  - workers initialized at backend startup (`server.ts` -> `init_queue_workers()`).
- Connection:
  - queue connection uses `REDIS_URL` from backend config.

## Worker Status
- `semrush_worker`: implemented
  - queue: `semrush_fetch_queue`
  - concurrency: `2`
  - limiter: `6 jobs / second`
  - retries: `attempts=4`, exponential backoff (`2s` base)
- `ahrefs_worker`: pending
- `prompt_execution_worker`: pending

## Blockers
- none
