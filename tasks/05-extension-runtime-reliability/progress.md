# Progress

## Status
- in_progress

## Updates
- 2026-02-19: Task created.
- 2026-02-20: Added startup/runtime listener self-healing in background service worker.
- 2026-02-20: Added tab-load timeout + tab-close unblocking to prevent sequential run hangs.
- 2026-02-20: Added explicit sequential failure handling when prompt fire/capture fails (no long silent waits).
- 2026-02-20: Added per-task error surfacing in execution drawer for capture/ingest failures.
- 2026-02-20: Guarded extension start-chat UX to only allow providers with implemented capture runtime handlers.
- 2026-02-20: Replaced browser-native `prompt/confirm` flows with custom extension dialogs and added in-app toast feedback.
- 2026-02-20: Validated with `pnpm -C extension build`.

## Reliability Fixes
- Implemented
- Auto reinjection paths:
  - on install/update (`onInstalled`)
  - on extension startup (`onStartup`)
  - on provider tab navigation complete (`tabs.onUpdated`)
  - on provider tab activation (`tabs.onActivated`)
- Debounced per-tab reinjection to avoid noisy duplicate script execution.
- Sequential execution hardening:
  - `bgWaitForTabLoad` now has timeout and closes listeners cleanly on tab removal.
  - Fire failure now marks task error immediately instead of waiting full capture timeout.
  - Missing capture metadata after recording timeout now marks task error immediately.
- UX:
  - Execution drawer now shows task-level error reason from background capture errors.
  - Sequential start failure is now surfaced instead of silently failing when background rejects start.
  - Unsupported provider selections are clearly labeled in dashboard start flow to prevent broken listening sessions.
  - Project update/delete actions now use custom dialogs and toast feedback instead of browser dialogs.

## Known Bugs
- Remaining: capture scripts are currently implemented for `chatgpt`, `claude`, `perplexity` only.
- `gemini` and `grok` stream capture runtime handlers are not yet implemented (selection now intentionally blocked in extension start-listening UX).

## Blockers
- none
