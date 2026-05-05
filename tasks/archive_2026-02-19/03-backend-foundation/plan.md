# Backend Foundation Plan

## Goal
Set up backend-owned auth and core Prisma schema for project/session/tree data so extension and web can both use one secure API.

## Naming Convention
- Use `snake_case` consistently for schema fields, API payload keys, storage keys, and identifiers wherever practical.

## Scope
- OAuth entry from extension via web flow
- Backend callback, one-time auth code, token exchange
- JWT access + refresh rotation
- Prisma schema for users, projects, capture sessions/turns, prompt nodes, SEMrush snapshots, generation runs

## Subtasks
- [x] S1: Extend backend auth + Prisma foundation (snake_case schema and payloads)
- [x] S2: Add web app auth bootstrap (dashboard, OAuth callback, token storage)
- [x] S3: Add web-to-extension bridge flow (`/extension/connect`)
- [x] S4: Integrate extension auth pages with web + backend end-to-end
- [ ] S5: Install deps and run full build verification for backend/web/extension

## Auth Flow
1. Extension opens `GET /api/auth/google/start` with extension callback URL.
2. Backend redirects to Google OAuth.
3. Google callback (`/api/auth/google/callback`) upserts user/account.
4. Backend creates one-time auth code and redirects back to extension callback URL with `code`.
5. Extension exchanges `code` at `POST /api/auth/extension/exchange` for access/refresh tokens.
6. Extension refreshes with `POST /api/auth/token/refresh` and logs out with `POST /api/auth/logout`.

## Data Model
- `User`, `OAuthAccount`, `RefreshToken`, `AuthCode`
- `Project`
- `CaptureSession`, `CaptureTurn`
- `PromptNode` (self-relation for tree)
- `SemrushSnapshot`
- `GenerationRun`

## Append Behavior
- User picks project before prompt processing.
- Follow-up prompts in same ChatGPT conversation append into that project tree.
- Mapping key: `(projectId, conversationId, requestId, turnExchangeId)`.
- Writes are idempotent by unique constraints.

## Next Steps
1. Install deps and verify build in all apps.
2. Add project/session/tree APIs and ingestion APIs.
3. Add async queue worker for SEMrush + generation runs.

## Runtime Env Contract
- `backend/.env`: `PORT`, `DATABASE_URL`, `JWT_*`, `GOOGLE_*`, `OAUTH_DEFAULT_EXTENSION_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS`
- `web/.env`: `VITE_API_BASE_URL=http://localhost:4000`
- `extension/.env`: `VITE_API_BASE_URL=http://localhost:4000`, `VITE_WEB_APP_URL=http://localhost:5173`
