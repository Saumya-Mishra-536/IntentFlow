# Security Action List

Current security posture and prioritised actions for V1 readiness.

## P0 — Done (this task)

| Area | Action | Status |
|---|---|---|
| HTTP headers | Added `helmet()` middleware — sets CSP, X-Frame-Options, HSTS, nosniff etc | ✅ |
| Rate limiting | `express-rate-limit` on all `/api/auth/*` routes (15 req / 15 min) | ✅ |
| CORS | Wildcard `*` origin is blocked when `NODE_ENV=production` | ✅ |
| Secrets doc | `.env.example` created — real `.env` must never be committed | ✅ |
| JWT strength | Startup warning logged if `JWT_SECRET` < 32 chars | ✅ |

## P1 — Recommended before pilot launch

| Area | Action |
|---|---|
| **Secret rotation** | Current `.env` contains live OpenAI key, DB URL, and Google OAuth secret. Rotate all after this task — especially if the repo has ever been pushed to a remote. |
| **Rate limiting scope** | Also add rate-limit to `/api/projects/:id/suggest-prompts` (each request triggers OpenAI + Semrush billing calls). Suggested: 5 req / min per user. |
| **CORS lock-down** | Set explicit production origins in `CORS_ALLOWED_ORIGINS` — remove the wildcard extension exception if not needed. |
| **Input validation** | All request bodies should be validated with Zod before touching the database. Check every `controller.ts` for raw `req.body` access without schema parse. |

## P2 — Post-pilot

| Area | Action |
|---|---|
| **Token storage (extension)** | Extension uses `chrome.storage.local` — correct choice (no cookie exposure), but data is not encrypted at rest. Consider encrypting sensitive fields if storing full API tokens. |
| **OAuth state parameter** | Verify Google OAuth flow uses a `state` parameter to prevent CSRF on the redirect callback. |
| **Dependency audit** | Run `pnpm audit` on a clean install and review high/critical advisories. |
| **JWT RS256** | Consider switching from HS256 (shared secret) to RS256 (public/private key) for the JWT if the extension ever needs to verify tokens client-side. |
| **Request logging** | Add `morgan` or a custom request logger middleware to log HTTP method, path, status, and duration for every request, separate from the telemetry events. |

## Token storage assessment (Chrome extension)

The extension stores tokens using `chrome.storage.local`. This is:
- ✅ Better than `localStorage` (not accessible by page scripts)
- ✅ Appropriate for MV3 service workers
- ⚠️  Not encrypted at rest on disk — acceptable for dev/pilot, revisit for production
