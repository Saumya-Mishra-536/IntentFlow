# Plan

## Goal
Audit and align web app with product docs for V1 dashboard, versioning visibility, and chat/thread history.

## Scope
- Compare implemented pages with product flow requirements.
- Prioritize onboarding flow in web app: URL/domain intake -> tenant/workspace initialization -> project/campaign bootstrap.
- Add/align campaign-project-version hierarchy in UI.
- Add chat history module per project (thread-level, provider filter, open-in-new-tab).
- Define graph/list parity and empty/error/loading states.
- Add explicit source flags (`semrush`, `ai_response_scraping`).
- Ensure web app handoff to extension is deterministic (auth/session/workspace/project context sync).

## Deliverables
- Drift audit checklist (implemented vs required).
- Prioritized gap list with severity.
- UI implementation plan for missing V1 scope.
- Onboarding-to-extension sync specification with backend API contract references.

## Agent Instructions
- Explore current web routes/components before proposing changes.
- Keep scope tied to V1 docs; avoid speculative V2 work.
- Update `progress.md` after each audit pass and screen-level decision.
