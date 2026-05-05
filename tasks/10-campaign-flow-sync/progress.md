# Progress

## Status
- not_started

## Updates
- 2026-02-20: Task created for campaign/version/refire sync across backend, web, and extension.
- 2026-02-20: Added to global execution order as a primary integration stream.

## Current Drift Snapshot
- **Backend**: DB schema has `Campaign` and `CampaignVersion`, but they are unused. REST APIs (`/project/:project_id/*`) and services are 100% `project`-driven. `Project` model holds all relations (`PromptNode`, `CaptureSession`, etc.).
- **Web UX**: IA is `project`-first (`ProjectGraphPage`, `ProjectListPage`). No campaign/version/refire concepts exist in the UI.
- **Extension**: Dashboard fetches projects. Captures and prompts are bound to `project_id`.
- **Refire/Version**: Not implemented anywhere; `Project` is a mutable, single-version container.

## Work Breakdown
- **Phase 1: DB Schema & Migration (In Progress)**: Modify Prisma schema to drop `Project` logic and point relations (`CaptureSession`, `PromptNode`, etc.) to `CampaignVersion`. Write safe data migration.
- **Phase 2: Backend API Contracts (Pending)**: Build `/campaigns`, `/campaigns/:id/versions`, and refire logic (`POST /campaigns/:id/versions/:vid/refire`). Implement services to match new schema.
- **Phase 3: Web UX (Pending)**: Rebuild dashboard/sidebar to list Campaigns. Add Version selector and Refire button.
- **Phase 4: Extension & Cross-Surface (Pending)**: Update extension to target active `campaign_version`. Map handoff context.
- **Phase 5: Cleanup & Validation (Pending)**: Remove old `/projects` routes and UI code. Verify full cycle.

## Blockers
- none
