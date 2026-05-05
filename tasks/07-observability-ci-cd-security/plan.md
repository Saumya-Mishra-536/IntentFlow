# Plan

## Goal
Close V1 readiness gaps in monitoring, CI/CD, and security hardening.

## Scope
- Event instrumentation for prompt run/refire/external API failures.
- Error tracking setup and log structure standards.
- CI/CD checks for backend/web/extension build + tests.
- Security review checklist: OAuth, token storage, CORS, input validation.
- Basic load/perf test coverage for queue workers.

## Deliverables
- Observability event matrix.
- CI/CD checklist and pipeline status report.
- Security action list with priorities.

## Agent Instructions
- Explore existing scripts/pipelines first; do not replace blindly.
- Keep telemetry names stable and documented.
- Update `progress.md` each time a check is added or validated.
