# Worker Breakdown + Retry Policy

## Implemented Worker
- `semrush_worker`
- file: `backend/src/queue/workers/semrush.worker.ts`
- queue: `semrush_fetch_queue`
- input: `SemrushInsightsJobPayload`
- output: `SemrushSiteInsightResult[]`

## Current Flow
1. API receives suggestion generation request.
2. Service enqueues SEMrush job with tenant/project/run metadata.
3. Worker executes SEMrush fetch + shaping logic.
4. Service waits for completion and continues AI suggestion generation.

## State Mapping
- BullMQ waiting -> `queued`
- BullMQ active -> `running`
- BullMQ failed + retries left -> `retrying`
- BullMQ failed terminal -> `failed`
- BullMQ completed -> `completed`

## Retry Policy
- `attempts=4`
- exponential backoff from 2s
- timeout budget for request wait path: 90s

## Planned Next Workers
- `ahrefs_worker` with same contract + limiter
- `prompt_execution_worker` for full backend-owned orchestration
