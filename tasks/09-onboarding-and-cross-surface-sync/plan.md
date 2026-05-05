# Plan

## Goal
Implement and lock the full onboarding flow across web app, backend, and extension so all three surfaces remain in sync.

## Why This Task Exists
Current planning had strong backend tenant work, but onboarding UX and cross-surface sync were not explicitly owned as one flow.

## Core Flow (V1)
1. User signs in on web app.
2. User provides initial domain/url in onboarding.
3. Backend creates/resolves tenant/workspace context and binds user membership.
4. Backend creates or suggests initial project/campaign context.
5. User connects extension using authenticated handoff.
6. Extension opens with same workspace/project context from backend source of truth.
7. All project/chat actions remain tenant/workspace scoped across web + extension.

## Scope
- Web onboarding screens and API integration.
- Backend onboarding endpoints/services for workspace/project bootstrap.
- Extension context bootstrap from backend (no local-only workspace truth).
- Cross-surface sync contract (auth token -> tenant/workspace/project resolution).
- Error/retry UX for onboarding failures.

## Deliverables
- Onboarding API contract (request/response examples in `snake_case`).
- Sequence diagram for web -> backend -> extension handoff.
- Implementation checklist by surface: backend, web, extension.
- E2E validation checklist for successful and failure states.

## Acceptance Criteria
- A new user can complete onboarding from web and land in a usable workspace/project context.
- Extension, when connected, resolves the same workspace/project context without manual repair.
- Tenant/workspace scoping is enforced server-side for all onboarding-created resources.
- Failed onboarding or sync states are recoverable with clear UI actions.

## Agent Instructions
- Explore current auth + onboarding + extension connect code before editing.
- Implement frontend, backend, and extension pieces together; do not leave this backend-only.
- Keep naming convention `snake_case` for payloads and persisted fields.
- Update `progress.md` after each surface-level change (web/backend/extension).
- If any flow context is missing, ask the user before assuming behavior.
