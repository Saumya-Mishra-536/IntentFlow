# Plan

## Goal
Stabilize extension runtime so capture, follow-up detection, and multi-provider execution are reliable without manual reloads.

## Scope
- Ensure provider capture handlers are consistent (chatgpt, claude, gemini, perplexity, grok).
- Fix tab focus/flow for sequential firing and skip-at-runtime UX.
- Ensure project chat opening uses exact thread URL when available.
- Harden failure recovery: refresh/retry flows and stale session handling.
- Keep loading states accurate (not mocked) and error-aware.
- Align extension startup and project-entry flow with web onboarding context (active workspace/project/chat provider linkage from backend).
- Ensure extension never depends on local-only tenant/workspace assumptions; server remains source of truth.

## Deliverables
- Runtime reliability checklist.
- Event contract validation matrix per provider.
- UX behavior list for execution drawer and project open flow.

## Agent Instructions
- Explore current background/content/page messaging flow first.
- Do not introduce mocked completion behavior.
- Update `progress.md` after each bug fix and reproduction note.
