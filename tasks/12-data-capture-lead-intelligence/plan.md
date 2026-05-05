# Plan

## Task ID
12-data-capture-lead-intelligence

## Why This Task Exists
We have a strong base for provider stream capture and campaign tree persistence, but the broader data-capture and lead-intelligence surface described in the strategy doc is only partially implemented. The next agent needs a clear, code-grounded map of:
- what is already captured,
- what is only available transiently,
- what is missing in schema/API/UI/events,
- and exactly where to implement each gap.

This task is planning + gap mapping only (no implementation in this task).

## Brief Project Context (for next agent)
This product has three running surfaces:
1. Extension (`/extension`): captures provider stream events (ChatGPT/Claude/Perplexity), builds RAM preview tree, persists normalized turn payloads to backend.
2. Backend (`/backend`): multi-tenant auth, campaigns, versions, capture sessions/turns, prompt tree nodes, suggestion generation via SEMrush/Ahrefs queue workers.
3. Web app (`/web`): onboarding, campaign list/graph/list views, chat thread history, version switch.

Recent relevant baseline already in repo:
- Campaign versioning is active and selectable.
- Refire endpoint exists and clones version trees.
- Stream parsers and backend normalization persist `prompt -> subquery -> site` with deterministic refs.
- Suggestion pipeline uses Redis/BullMQ queue for SEMrush/Ahrefs jobs.
- Follow-up append flow exists and has cancellation support in extension UI.

## Scope Of This Task
Create a complete implementation roadmap for high-value data capture + lead intelligence, by comparing the strategy doc against current codebase capability.

Out of scope for this task:
- actual schema migration
- actual UI/API implementation
- CRM integration
- production analytics warehouse integration

## Additional Product Requirement (New)
After core data-capture + lead-intelligence implementation, next agent must also implement:
- full RBAC (`admin`, `user`) across backend, web app, and extension
- a dedicated admin dashboard in web app with comprehensive filters and analytics graphs
- background historical chat ingestion (read user chat history in background and backfill normalized turns safely)

This is now part of this task plan (same execution track), not a separate future task.

## Current State Audit (Code-Verified)

### A) What is already captured and persisted
1. User identity basics
- `User.email`, `User.name`, `User.avatar_url` in `backend/prisma/schema.prisma`.
- OAuth account linkage in `OAuthAccount`.
- Source: Google OAuth profile fetch in `backend/src/modules/auth/auth.service.ts`.

2. Campaign + versioning core
- `Campaign`, `CampaignVersion`, active version selection, refire cloning.
- Source: `backend/src/modules/campaign/campaign.repository.ts`, `backend/src/modules/campaign/campaign.service.ts`.

3. Provider stream ingestion
- Ingest payload includes provider IDs, prompt, queries, result groups.
- Persisted in `CaptureSession`, `CaptureTurn.raw_event_json`, and materialized `PromptNode` tree.
- Source: `backend/src/modules/campaign/dto/campaign.dto.ts`, `backend/src/modules/campaign/campaign.service.ts`.

4. Citation/site core fields
- Persisted as site node metadata: `url`, inferred `domain`, `citation_title`, refs.
- Source: `backend/src/modules/campaign/campaign.service.ts`.

5. Provider-specific parsing
- ChatGPT, Claude, Perplexity main-world stream parsers + isolated bridge forwarding.
- Source: `extension/src/content/chatgptStreamMain.ts`, `extension/src/content/claudeStreamMain.ts`, `extension/src/content/perplexityStreamMain.ts`.

6. SEMrush/Ahrefs queued enrichment for suggestion generation
- Jobs enqueued + waited via BullMQ.
- Source: `backend/src/queue/semrush.queue.ts`, `backend/src/queue/ahrefs.queue.ts`, `backend/src/modules/campaign/campaign.service.ts`.

### B) What exists but is not robust enough for lead-intelligence use
1. Telemetry helper exists but no persistent analytics pipeline
- `backend/src/utils/telemetry.ts` defines stable events, but no event table/warehouse sink usage.

2. Session behavior signals are weak
- Extension has focus/visibility handlers for UI refresh behavior, but not persisted behavioral analytics events.

3. Result payload trimming currently drops snippets intentionally
- Frontend trims result groups to keep payload light and avoids snippet persistence.
- Source: `trim_result_groups` in `extension/src/pages/VisualizationPage.tsx`.
- Tradeoff: great for tree cleanliness, but reduces lead-intel richness unless raw facts retained elsewhere.

### C) Major missing capabilities versus strategy doc
1. Missing onboarding/profile fields
- No explicit fields for LinkedIn URL, social URLs, role/title, company name, locale/timezone persistence.
- Onboarding only asks domain + campaign name/description.
- Source: `web/src/pages/onboarding-page.tsx`, `web/src/shared/components/create-campaign-form.tsx`, `backend` schema.

2. No dedicated lead score model
- No lead score table/columns/job, no cold/warm/hot segmentation.

3. No explicit product analytics event store
- No `analytics_events` table or event ingestion endpoint for behavior timeline.
- No event taxonomy implemented from strategy doc (install, activation, inactivity, export, etc.).

4. No NLP intent extraction pipeline
- No persisted extraction for competitor entities, pain keywords, location intent, vertical tags, budget signals.

5. No CRM/webhook automation layer
- No HubSpot/Pipedrive lead push integration with threshold triggers.

6. No inactivity/churn scheduled jobs
- No 7-day inactivity detector + follow-up workflow.

7. No explicit extension install event persisted to backend
- `onInstalled` currently injects listeners, but no backend event capture.

8. No background historical chat backfill
- We capture live streams, but do not backfill older provider conversations/turns in background.
- This leaves major intent history uncaptured for leads and trend analysis.

## Strategy Doc To Code Gap Matrix

### 1) Chrome Extension Behavioral Layer
1.1 Identity/Auth
- Email/name/avatar: Implemented.
- Company domain derivation from email: Not persisted explicitly.
- Install timestamp: Missing (needs extension event -> backend).
- Browser locale/timezone: Missing persistence.
- LinkedIn/profile URL: Missing input + persistence.

1.2 Prompt behavior
- Raw prompt text: Implemented (`CaptureTurn.prompt`).
- Prompt frequency/session/week: Missing aggregated metrics tables/jobs.
- Competitor domains in prompt text: Missing extraction.
- Tab time spent and weekly sessions: Partially available client-side; not persisted.
- Refire triggered prompts: Version-level behavior exists; no analytics model.

1.3 SERP/network metadata
- URLs in AI response: Implemented as site nodes.
- Search queries fired: Implemented via queries and normalized events.
- Click-through outbound domains from user interactions: Missing.
- Prompt timestamp: Implemented (`created_at`, `prompt_detected_at`).
- Campaign linkage: Implemented.

### 2) Web App Campaign & Engagement
2.1 Onboarding/profile
- Target domain: Implemented.
- Campaign goal/name: Implemented.
- Industry inference: Missing.
- Plan/tier surfaced: not modeled beyond auth/provider plan assumptions.

2.2 Engagement
- Campaign create/update dates: Implemented.
- Prompt/campaign depth: Derivable from `PromptNode`.
- Refire/version usage: Implemented and derivable.
- Prompt failures/errors: No dedicated event history table.
- Dashboard/session analytics: Missing robust instrumentation.

2.3 SEO intelligence
- Competitor domains + ranking keywords via providers: Partially implemented.
- KD/CPC/traffic/backlink fields: available only if provider payload contains, but not normalized into dedicated analytics tables.

### 3) Backend Intent + Lead Intelligence
3.1 Event tracking
- Desired event matrix from doc is mostly missing.
- Need canonical `analytics_event` ingestion, storage, and query API.

3.2 Lead scoring
- Missing entirely.

3.3 Prompt/response NLP extraction
- Missing entirely beyond structural normalization.

## Required Deliverables For Next Agent

### Deliverable A: Data Capture Contract v2
Define and implement a cross-surface contract for high-signal fields.

A1. New profile/account fields
- Add schema + API + UI capture for:
  - `company_name` (optional)
  - `company_domain` (derived + editable)
  - `linkedin_url` (optional)
  - `x_url` / `twitter_url` (optional)
  - `timezone` and `locale` (captured from client, override allowed)
  - `job_role` (optional)

A2. Campaign-level enrichment fields
- Add `target_location`, `industry_tag`, `business_type`, `primary_goal` optional fields.

A3. Capture metadata envelope
- Extend capture payload metadata with:
  - `client_ts`
  - `tab_id` (hashed/anonymized if needed)
  - `surface` (`extension` | `web`)
  - `capture_mode` (`normal` | `follow_up` | `bulk_fire`)

### Deliverable B: Behavioral Event Pipeline
B1. Add persistent analytics table(s)
- `analytics_event` (append-only)
- optional rollup tables/materialized views.

B2. Event taxonomy implementation (minimum)
- `extension_installed`
- `first_campaign_created`
- `campaign_created`
- `prompt_run_started`
- `prompt_run_completed`
- `prompt_run_failed`
- `refire_started`
- `refire_completed`
- `suggestions_generated`
- `session_long` (>= configured threshold)
- `user_inactive_7d_detected`

B3. Instrument extension/web/backend emitters
- Extension: install/start/listen/fire/cancel events.
- Web: onboarding/campaign/dashboard actions.
- Backend: ingest/suggestion/refire/provider failures.

### Deliverable C: Lead Intelligence Derivation
C1. Add extraction worker/job
- Parse prompt/turn text + normalized events for:
  - competitor domains/entities
  - pain keywords
  - location mentions
  - vertical/industry terms
  - budget/commercial intent terms

C2. Persist structured outputs
- Create `lead_signal` table or equivalent JSON schema with typed fields and confidence.

C3. Add lead score computation
- Deterministic score formula (doc baseline) with configurable weights.
- Persist `lead_score_current`, `lead_segment` and `updated_at`.

### Deliverable D: CRM/Automation Hooks (stub-ready)
- Add webhook dispatcher contract for lead score threshold crossings.
- Add internal “follow-up queue” row creation for sales ops (even before full CRM integration).

### Deliverable E: LinkedIn/Social URL intake (explicit ask)
Add input fields (web onboarding + extension new campaign flow) and persist to backend:
- `linkedin_url`
- `company_website_url` (if different from target domain)
- optional `other_social_urls[]`

Validation:
- Strict URL validation
- no hard failure if omitted
- sanitize and normalize hostnames

### Deliverable F: RBAC + Admin Dashboard (new mandatory)

F1. Role model and permissions (backend)
- Add role model with at least:
  - `admin`
  - `user`
- Enforce authorization in backend for all sensitive endpoints and datasets.
- Ensure tenant boundaries still apply; admin permissions must be explicit and auditable.
- Add role claims to auth tokens/session payloads.

F2. Backend policy enforcement (no gaps)
- Enforce RBAC on:
  - campaign read/write/refire
  - chat thread history
  - capture ingestion and event analytics read APIs
  - lead score/signal views
  - any admin-only aggregate endpoints
- Add middleware/policy helpers so route-level checks are consistent (no ad-hoc scattered checks).

F3. Web app RBAC wiring
- Add role-aware route guards.
- Add admin-only navigation and pages.
- Hide/disable unauthorized actions in UI (not only backend-blocked).
- Ensure non-admin users cannot access admin routes via direct URL.

F4. Extension RBAC wiring
- Include role in extension auth session bootstrap payload.
- Gate extension actions/features based on role where required by product rules.
- Ensure extension cannot call admin-only APIs successfully.
- Show clear UX states for unauthorized actions.

F5. Admin dashboard (web)
- New admin dashboard with:
  - global filters (time range, tenant/workspace, campaign, provider, role segment, activity range)
  - key metrics cards (activation, engagement, churn risk, lead score bands, provider usage, failure rates)
  - graphs/charts for trends and distributions
  - tabular drill-down for user/campaign/tenant-level inspection
  - export-ready filtered views (CSV/JSON optional but recommended)
- Dashboard should consume the new analytics/event/lead-signal data model from this plan.

F6. Auditability and safety
- Log role changes and admin-sensitive actions with actor + timestamp.
- Add deny-by-default policy for new endpoints until permission is defined.

F7. Acceptance criteria for RBAC + admin dashboard
1. Role is consistently available and enforced across backend, web, and extension.
2. Admin-only endpoints cannot be accessed by normal users.
3. Admin dashboard renders real filtered metrics from persisted data.
4. UI and API behavior are aligned (no hidden-but-callable admin behavior for users).
5. Role changes are auditable.

### Deliverable G: Background Historical Chat Backfill (new mandatory)
G1. Backfill contract and safety model
- Add explicit opt-in setting for historical ingestion per user (and per provider if needed).
- Add provider capability flags so unsupported providers are skipped gracefully.
- Add strict rate limiting, retry/backoff, and pause/resume/cancel controls.

G2. Historical ingestion pipeline
- Implement background worker/loop that reads provider conversation history incrementally.
- Track sync cursor/watermark per provider thread (`last_synced_at`, `cursor`, `backfill_status`).
- Avoid full re-scan each run; use incremental sync.

G3. Normalization and storage
- Normalize historical turns into the same deterministic capture contract used by live ingestion.
- Preserve source mode in metadata (`capture_mode = history_backfill`) for traceability.
- Ensure tenant-scoping and user ownership checks for every imported record.

G4. Dedupe and idempotency
- Deduplicate by stable provider identifiers (`provider_chat_id`, provider turn/message id where available) plus content hash fallback.
- Re-running backfill should be safe and not duplicate turns/nodes.

G5. UX and observability
- Show backfill status in extension/web surfaces (queued, running, complete, failed, paused).
- Emit analytics events for `history_backfill_started`, `history_backfill_progress`, `history_backfill_completed`, `history_backfill_failed`.
- Log summary metrics: imported chats, imported turns, duplicates skipped, errors.

## Implementation Order (recommended)
1. Schema design + migration plan (backward compatible).
2. API contract updates and DTO validation.
3. Web + extension form updates for new fields.
4. Event ingestion endpoint + emitter wiring.
5. Background historical chat backfill pipeline + status APIs.
6. Lead-signal extraction worker + storage.
7. Lead score computation + read API.
8. RBAC model + backend policy enforcement.
9. Web + extension role-aware wiring.
10. Admin dashboard implementation with filters and graphs.
11. Dashboards/queries for operations and validation.

## Guardrails
- Keep `snake_case` for DB + payload keys.
- Do not break current deterministic tree ingestion path.
- Preserve lightweight tree payload strategy; if richer content (snippets/full text) is needed, store separately in analytics facts rather than prompt-node tree.
- All new capture must be tenant-scoped.

## Acceptance Criteria
1. New onboarding/campaign profile fields are captured and persisted with validation.
2. Behavioral events are stored as queryable records (not just logs).
3. Lead score is computed and updated from real events.
4. Competitor/pain/location/intent signals are extracted and persisted per tenant/user/campaign.
5. RBAC (`admin`/`user`) is enforced end-to-end in backend, web, and extension.
6. Admin dashboard is available only to admins and supports comprehensive filtering + analytics graphs.
7. Existing campaign tree and versioning flows remain stable.
8. Extension + web emit compatible event contracts.
9. Historical chat backfill runs in background with opt-in, incremental sync, and idempotent dedupe.
10. Backfilled turns are queryable and distinguishable from live captures via metadata.

## File Focus For Next Agent
Backend:
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/backend/prisma/schema.prisma`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/backend/src/modules/auth/*`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/backend/src/modules/onboarding/*`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/backend/src/modules/campaign/*`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/backend/src/utils/telemetry.ts`

Web:
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/web/src/pages/onboarding-page.tsx`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/web/src/shared/components/create-campaign-form.tsx`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/web/src/shared/lib/auth.ts`

Extension:
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/extension/src/pages/Dashboard.tsx`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/extension/src/pages/VisualizationPage.tsx`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/extension/src/background.ts`
- `/Users/abhishekverma/Desktop/Cluster/Projects/ai-seo/extension/src/lib/api.ts`

## Non-Goals (for this next task)
- Rewriting provider parsers from scratch.
- Reworking graph UI layout logic.
- Replacing BullMQ.

## Open Questions To Resolve Early
1. Do we store social/profile data at user level, campaign level, or both?
2. Should lead score be tenant-level, user-level, campaign-level, or all three?
3. Which retention policy applies to raw analytics events?
4. Do we need explicit consent toggles for behavioral analytics capture?
5. Should admins be tenant-scoped admins only, or should there be a global/super-admin role?
6. Which admin actions need explicit audit logs and approval safeguards?
7. For each provider, what are the supported limits for safe history pagination/rate limits?
8. Where should users control history backfill permissions (web settings, extension settings, or both)?
