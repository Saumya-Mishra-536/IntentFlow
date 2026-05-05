# Plan

## Goal
Implement robust async orchestration for bulk prompt execution, follow-ups, and external API processing.

## Scope
- Introduce Redis-backed queue design (BullMQ preferred).
- Define job states (`queued`, `running`, `failed`, `completed`, `retrying`).
- Add rate-limited workers for Semrush/Ahrefs calls.
- Preserve provider/thread metadata end-to-end in job payloads.
- Define idempotency keys and dedupe policy.

## Deliverables
- Queue architecture doc in this folder.
- Worker breakdown and retry/backoff policy.
- API/UI status contract for showing progress and failures.

## Agent Instructions
- Inspect current background queueing behavior before changes.
- Do not parallel-call Semrush/Ahrefs directly from request thread.
- Update `progress.md` for each implemented worker and state transition.
