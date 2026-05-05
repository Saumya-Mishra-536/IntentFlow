# Plan

## Goal
Harden keyword intelligence pipeline with real Semrush integration and Ahrefs fallback behavior.

## Scope
- Finalize Semrush request/response adapter (GET-based contract).
- Normalize provider response shapes into internal keyword model.
- Implement strict failure handling and user-facing error surfaces.
- Add response caching for repeated domains within campaign/version.
- Define Ahrefs fallback trigger and source tagging.

## Deliverables
- Adapter + transformer contract.
- Caching strategy and cache key design.
- Error taxonomy mapped to extension/web UX messages.

## Agent Instructions
- Start by tracing current `suggest_prompts` flow.
- Keep logs actionable and minimal (no noisy payload dumps in normal mode).
- Update `progress.md` after each endpoint/transformer/cache decision.
