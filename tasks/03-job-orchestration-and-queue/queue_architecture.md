# Queue Architecture (Task 03)

## Objectives
- Move external API processing off request-thread execution.
- Provide retry/backoff + dedupe for expensive jobs.
- Preserve tenant/project/provider metadata through orchestration.

## Stack
- Redis transport (`REDIS_URL`)
- BullMQ queues/workers in backend process (phase 1)

## Queues
1. `semrush_fetch_queue`
- purpose: SEMrush site insight fetch jobs
- producer: `ProjectService.suggestPrompts`
- consumer: `semrush.worker.ts`

2. `prompt_execution_queue` (planned)
- purpose: backend-owned prompt orchestration lifecycle

3. `ahrefs_fetch_queue` (planned)
- purpose: Ahrefs worker parity with SEMrush path

## Job Envelope
- `tenant_id`
- `project_id`
- `generation_run_id`
- `job_type`
- payload (`semrush_url`, sites, prompt context)

## Idempotency + Dedupe
- deterministic `job_id` derived from tenant/project/run/payload hash
- if identical in-flight/completed-in-retention job exists, reuse it

## Retry / Backoff
- attempts: `4`
- backoff: exponential, initial `2000ms`
- failed jobs retained (`removeOnFail`) for diagnosis

## Rate Limiting
- worker limiter (`max=6`, `duration=1000ms`)
- concurrency set to `2`

## Runtime Boot
- workers initialized in backend startup (`server.ts` -> `init_queue_workers()`)
- queue modules loaded from `/src/queue`
