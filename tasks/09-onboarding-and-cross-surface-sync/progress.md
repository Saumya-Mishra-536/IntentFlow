# Progress

## Status
- in_progress

## Updates
- 2026-02-19: Task created to cover onboarding + tenant/workspace/project sync across web, backend, and extension.
- 2026-02-19: Added backend onboarding module with tenant-resolved context/bootstrap endpoints.
- 2026-02-19: Added `onboarding_context` to extension auth exchange response for cross-surface context sync.
- 2026-02-19: Updated web onboarding page to use backend onboarding bootstrap flow while keeping existing card/form UX style.
- 2026-02-19: Updated extension dashboard empty-state UX with web onboarding fallback action (style-consistent with existing controls).
- 2026-02-19: Added missing extension project flow for web-created empty projects:
  - visualization view now shows `Start Listening` when project has zero nodes.
  - CTA links provider context, opens chat tab, and transitions to `/visualization/new` first-capture flow.
- 2026-02-20: Updated web project creation UX to require selecting a start provider (matching extension flow):
  - dashboard new-project form now includes provider picker with chat app logos.
  - onboarding bootstrap form now includes same provider picker.
  - web creation flows now call `link_chat_thread` immediately after project creation/bootstrap using selected provider.
  - copied provider logo assets from extension public into web public for visual parity.
- 2026-02-19: Added onboarding deliverable docs:
  - `onboarding_api_contract.md`
  - `sequence_diagram.md`
  - `implementation_checklist.md`
- 2026-02-19: Verified builds pass for backend, web, and extension after onboarding integration.

## Surface Status
- backend: completed
- web: completed
- extension: completed

## Integration Notes
- Tenant/workspace resolution remains server-side from authenticated user context.
- Client payloads do not send `tenant_id`; only project/chat/onboarding fields are accepted.
- Empty project bootstrap path is now explicit in extension UX, enabling first root-node capture without returning to dashboard.
- Provider selection is now explicitly captured on both web and extension create/start flows.
- Manual end-to-end browser walkthrough is still pending (build-level validation complete).

## Blockers
- none
