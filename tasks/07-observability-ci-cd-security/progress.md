# Progress

## Status
- in_progress

## Updates
- 2026-02-19: Task created.
- 2026-02-20: Observability and security hardening implemented. CI/CD deferred.

## Instrumentation
- ✅ `logger.ts` upgraded — env-aware structured JSON (prod) / pretty (dev)
- ✅ `telemetry.ts` created — stable event name constants, `track()`, `startTimer()`
- ✅ `project.service.ts` instrumented — `prompt.run.*`, `semrush.fetch.*`, `openai.request.*`
- ✅ `event-matrix.md` created — full event reference table

## CI/CD
- deferred (out of scope for this sprint per user decision)

## Security
- ✅ `helmet` middleware added to Express loader (HTTP security headers)
- ✅ `express-rate-limit` on `/api/auth/*` — 15 req / 15 min per IP
- ✅ Wildcard CORS (`*`) blocked at startup in production
- ✅ JWT_SECRET entropy warning on startup if < 32 chars
- ✅ `.env.example` created with all required vars documented
- ✅ `security-actions.md` created — P0/P1/P2 priority action list
- ⏳ `pnpm install` required to activate `helmet` + `express-rate-limit`
  - Run after stopping `pnpm dev` in backend terminal, or use a new terminal:
    `cd backend && pnpm install`

## Blockers
- EPERM on `node_modules` prevents `pnpm add` while dev server is running.
  Fix: run `pnpm install` manually in backend/ once dev server is stopped or in a fresh terminal.
