# Tasks Workspace (Multi-Agent)

## Rules
- Every task folder must contain `plan.md` and `progress.md`.
- Agents must update both files regularly as work progresses (not only at the end).
- Use `snake_case` naming for DB fields, API payload keys, job payloads, and persisted metadata.
- Keep tasks independent; avoid cross-task file overlap where possible.
- If blocked by another task, log dependency in `progress.md` immediately.

## Execution Order
1. `01-program-governance`
2. `02-tenant-and-data-foundation`
3. `09-onboarding-and-cross-surface-sync`
4. `10-campaign-flow-sync`
5. `03-job-orchestration-and-queue`
6. `04-semrush-ahrefs-pipeline`
7. `05-extension-runtime-reliability`
8. `06-web-app-v1-alignment`
9. `07-observability-ci-cd-security`
10. `08-pilot-readiness-and-launch`

## Archive
- Previous completed task docs are moved to `tasks/archive_2026-02-19/`.
