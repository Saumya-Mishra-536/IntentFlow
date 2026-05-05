# Plan

## Goal
Synchronize the product language and behavior around `campaign`, `campaign_version`, and `refire` end-to-end across backend, web app, and extension.

## Why This Task
- Current system is mostly `project`-first in UI and extension.
- Product docs and launch plan require campaign/version/refire as first-class V1 workflow.
- We need one integration task to prevent drift between surfaces.

## Scope
- Backend:
  - finalize campaign + campaign_version APIs and service contracts.
  - define refire trigger/status/result endpoints.
  - ensure tenant/workspace scoping for all campaign reads/writes.
- Web:
  - add campaign-centric IA (campaign list/detail/version selector/refire action).
  - show version snapshots and source flags (`semrush`, `ahrefs`, `ai_response_scraping` mapping).
  - show execution/refire statuses (`queued`, `running`, `failed`, `completed`).
- Extension:
  - align terminology and payloads with campaign/version model.
  - map current project-bound actions to campaign context from backend.
  - ensure generated prompt execution and follow-up updates target the active campaign_version.
- Cross-surface:
  - define exact state handoff between web and extension (auth -> tenant/workspace -> campaign -> active version).
  - standardize naming in UI copy, API DTOs, and logs.

## Required Output
1. Canonical vocabulary map:
   - `campaign`: The root tenant-owned entity representing a broad SEO endeavor. Replaces the current top-level UX of a "Project".
   - `campaign_version`: A specific iterative state of the campaign. Every time a user changes the prompt tree significantly or hits "Refire", a new version is created.
   - `refire`: The action of taking the current configuration/context and generating a fresh `campaign_version`.
   - `project`: **DEPRECATED** in UI and API layers. (DB migration strategy pending).
2. API contract sheet:
   - **Campaign API**: `GET /api/campaigns`, `POST /api/campaigns`
   - **Version API**: `GET /api/campaigns/:campaign_id/versions`, `GET /api/campaigns/:campaign_id/versions/active`
   - **Refire API**: `POST /api/campaigns/:campaign_id/versions/:version_id/refire`
   - All payloads and path params strictly use `snake_case` (e.g., `campaign_id`, `version_number`, `status`).
3. UX contract:
   - Web: Sidebar lists `Campaigns`. Top bar has a `Version` dropdown and `Refire` action.
   - Extension: Users select a `Campaign` in the dashboard. The extension automatically resolves and writes to the `active` version of that campaign.
4. Migration/compatibility plan (APPROVED):
   - **Full Migration**: The `Project` model will be eliminated. 
   - A DB migration will convert existing `Project` records into a base `Campaign` with an initial `CampaignVersion` (version 1, active).
   - Foreign keys on `CaptureSession`, `PromptNode`, `SemrushSnapshot`, and `GenerationRun` will be moved from `project_id` to `campaign_version_id`.
   - The `/projects` API namespace will be replaced by `/campaigns` and `/campaigns/:id/versions`.
5. Rollout checklist:
   - backend db schema update & migration
   - backend campaign/version/refire contracts
   - web campaign-centric IA and version controls
   - extension alignment to active `campaign_version`
   - final cleanup to remove project-first paths
   - e2e sync validated

## Acceptance Criteria
- User can create/select a campaign, run prompts, and see results under a versioned campaign timeline.
- User can trigger refire and get a new campaign_version snapshot.
- Extension captures and appends data into the correct active campaign_version.
- Web and extension display consistent terms and status progression.
- No endpoint relies on client-provided tenant context; backend resolves from auth.

## Agent Instructions
- Read product docs context and current backend/web/extension flows before implementing.
- Treat this as integration-first: do not complete backend-only.
- Keep all keys and DTO fields in `snake_case`.
- Update `progress.md` after every meaningful change in backend, web, or extension.
- If any flow decision is unclear, ask the user and log the answer in `progress.md`.
