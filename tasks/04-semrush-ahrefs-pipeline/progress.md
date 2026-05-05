# Progress

## Status
- completed

## Updates
- 2026-02-19: Task created.
- 2026-02-20: Added queue-backed Ahrefs adapter (`ahrefs_fetch_queue`) and initialized worker in queue bootstrap.
- 2026-02-20: Refactored prompt suggestion pipeline to fetch keyword insights via provider fallback order: SEMrush first, Ahrefs second.
- 2026-02-20: Added strict webhook URL validation (`SEMRUSH_URL` and `AHREFS_URL`) with expected path checks and explicit error messages.
- 2026-02-20: Added resilient domain inference for no-web-search turns by extracting probable domains from prompt/subquery/project text.
- 2026-02-20: Added source tagging (`semrush`/`ahrefs`) end-to-end in API payload and extension suggestion UI badges.
- 2026-02-20: Improved extension API error parsing for non-JSON backend failures so UX gets clean messages.
- 2026-02-20: Validated via `pnpm -C backend build` and `pnpm -C extension build`.

## Adapter Status
- completed
- Contracts:
  - SEMrush queue job payload normalized to site list + optional seed keyword.
  - Ahrefs queue job payload mirrors Semrush payload shape for swap-safe fallback.
  - Both adapters normalize into shared `SemrushSiteInsightResult` model with `source` tag.
- Trigger behavior:
  - `suggestPrompts` always attempts SEMrush first when configured.
  - If SEMrush throws/returns empty, Ahrefs is attempted automatically when configured.
  - If both providers fail/no-data, backend surfaces one consolidated `502` provider-failure message.

## Caching Status
- completed
- Queue-level dedupe cache is active via deterministic BullMQ `jobId` hashing on tenant/project/run/url/sites/seed prompt for both providers.
- This prevents duplicate provider calls for repeated generate requests with same context during queue retention window.

## Blockers
- none
