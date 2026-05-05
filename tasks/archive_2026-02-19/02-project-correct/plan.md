## HANDOVER CONTEXT: ChatGPT Stream Capture Working ✅ (2026-02-18)

## Naming Convention
- Use `snake_case` consistently for schema fields, API payload keys, storage keys, and identifiers wherever practical.

### Status: Foundation Complete, Ready for Analysis Pipeline

**What's working:**
- Extension intercepts ChatGPT conversation SSE stream at `document_start` via inline IIFE injection.
- Captures real user prompts from `input_message` events in the stream (no UI scraping).
- Detects response completion via `message_stream_complete` or `[DONE]` SSE markers (not UI heuristics).
- Side panel shows live stage progression: Listening → Intercepting → Analyzing → Generating → Complete.
- Header and visualization update with real captured prompt (first 40 chars).
- Mock tree children populate the visualization so you see the full tree structure.

**How to extend it:**
1. The `input_message` event in the SSE stream contains the user's prompt at:
   `obj.input_message.content.parts[0]` — already captured in VisualizationPage state.
2. Each SSE payload also contains metadata like `search_model_queries.queries` and `search_result_groups` — already parsed and forwarded as `search_queries` / `search_results` events.
3. In `VisualizationPage.tsx`, the `completedRootPrompt` useMemo builds the final tree from:
   - Root content: `capturedPrompt` (real)
   - Children: `MOCK_CHILDREN` (from `mockSessions[0]`)
4. Replace `MOCK_CHILDREN` with real subqueries/sites/generated nodes extracted from the stream payloads.

**Next steps (for analysis pipeline):**
1. Listen for `search_queries` events → build subquery nodes
2. Listen for `search_results` events → build site/generated nodes
3. Build a tree constructor that assembles these into the PromptNode hierarchy
4. Remove `MOCK_CHILDREN` dependency once real data flows through

**Data flow (from ChatGPT to visualization):**
```
ChatGPT SSE stream
  ↓
[AI-SEO][MAIN] fetch interceptor (injected IIFE in page context)
  ↓
Parses `type: input_message` → emits CustomEvent "ai-seo-chatgpt-stream"
  ↓
[AI-SEO][CONTENT] bridge (isolated content script)
  ↓
chrome.runtime.sendMessage({ type: "AI_SEO_CHATGPT_EVENT", payload })
  ↓
[AI-SEO][BG] background service worker
  ↓
Stores in latestCaptureState, forwards to extension pages
  ↓
[AI-SEO][VIS] VisualizationPage listener
  ↓
setCapturedPrompt() → completedRootPrompt built → ListView renders
```

---

Plan to implement

Runtime Capture Plan: ChatGPT Conversation Stream (No Reload)

Context
- UI revamp is already in progress.
- The blocking issue is runtime detection of ChatGPT prompt/response lifecycle without manual page reload.
- New confirmed source is the `conversation` SSE stream from ChatGPT network traffic.
- We can reliably read lifecycle from stream payloads:
  - Prompt sent: `type: "input_message"` (contains user text in `input_message.content.parts[0]`)
  - Query expansion: `message.metadata.search_model_queries.queries`
  - Search/source data: `message.metadata.search_result_groups` and incremental patches to that path
  - Completion: `delta` patch for `/message/status = finished_successfully` and/or `type: "message_stream_complete"`

Goal
- Capture prompt from network stream (`input_message`) only.
- Start extension processing only after GPT response is fully finished.
- Mark completion from final stream signals, not UI heuristics.
- Work without reload by intercepting early at `document_start`.

---

Implementation Sequence

Phase 1 — Manifest + Early Injection
1. Update `extension/manifest.json`
- Add content script at `document_start`:
  - Matches: `https://chatgpt.com/*`, `https://chat.openai.com/*`
  - JS: `src/content/chatgptStreamContent.ts`
- Ensure host permissions include both domains.

2. Create `extension/src/content/chatgptStreamContent.ts`
- Inject page-context script (not isolated-world only) to patch `window.fetch` early.
- Detect SSE responses (`content-type: text/event-stream`) for ChatGPT backend conversation endpoints.
- Stream-parse SSE lines (`event:` + `data:` blocks), parse JSON payloads, and emit normalized events to extension runtime.

---

Phase 2 — Normalize Stream Events
Create normalized events from SSE payload:
- `prompt_sent`
  - source: `type: input_message`
  - fields: prompt text, conversation_id, request_id, turn_exchange_id
- `search_queries`
  - source: `message.metadata.search_model_queries.queries`
- `search_results`
  - source: `message.metadata.search_result_groups` or patch appends to that path
- `response_finished`
  - source A: `delta` patch `/message/status` => `finished_successfully`
  - source B: `type: message_stream_complete`

Ignore noise events (`resume_conversation_token`, moderation, hidden/system deltas, etc.).

---

Phase 3 — Runtime Relay
Update `extension/src/background.ts`
- Receive `AI_SEO_CHATGPT_EVENT` messages from content script.
- Forward to extension pages (side panel UI) so live view can react.

---

Phase 4 — Visualization State Wiring (Finish-Gated)
Update `extension/src/pages/VisualizationPage.tsx`
- For `sessionId === "new"`:
  - Start at stage 0 (Listening).
  - On `prompt_sent`: save prompt text only; keep waiting.
  - On `response_finished`: trigger processing pipeline (stage 1 onward).
  - Complete after processing chain ends.
- Keep fallback button only as emergency path.

---

Phase 5 — Verification
1. `pnpm build` passes.
2. In ChatGPT tab, open DevTools network and send prompt (without reload).
3. Extension side panel stage flow should update automatically:
- Listening -> Intercepting -> SEMrush Analysis -> Generating -> Complete.
4. Completion should trigger only after final finish signal, not just first tokens.
5. Confirm extracted prompt text matches sent prompt.

---

Phase 6 — Debug Instrumentation
- Add console logs with prefixes in:
  - MAIN stream interceptor (`[AI-SEO][MAIN]`)
  - content bridge (`[AI-SEO][CONTENT]`)
  - background relay/state cache (`[AI-SEO][BG]`)
  - visualization runtime handling (`[AI-SEO][VIS]`)
- Treat only final finish signals as valid start triggers:
  - `message_stream_complete`
  - `[DONE]` marker fallback
- Ignore intermediate `/message/status=finished_successfully` for process start.

---

Phase 8 — Fix: Script-tag IIFE Injection (2026-02-18)
Root cause confirmed: CRXJS 2.0.0-beta.25 does NOT reliably inject world:MAIN content
scripts at runtime (it compiles the file but the HMR-less world:MAIN path has known
gaps in beta). No [AI-SEO][MAIN] logs appeared in the ChatGPT tab console.

Fix applied:
- `chatgptStreamContent.ts` now injects the full fetch-patching logic as an inline
  IIFE string via a <script> element appended to document.documentElement at
  document_start. The script element is immediately removed after injection.
- The PATCH_FLAG guard (`__AI_SEO_CHATGPT_STREAM_PATCHED__`) prevents double-patching
  if CRXJS ever does fire the world:MAIN entry as well.
- Added `console.log(DBG, "main-world script running")` at the top of the IIFE so
  successful injection is immediately visible in the ChatGPT tab console.
- Added `console.log(DBG, "SSE fetch detected", ...)` for every text/event-stream
  response, not just conversation ones, to catch URL mismatches.
- Added `console.log(DEBUG_PREFIX, "loaded – injecting main-world patch")` to the
  isolated content script for injection confirmation.
- Added startup log to chatgptStreamMain.ts for the world:MAIN path.
- `pnpm build` passes cleanly.

Expected logs in ChatGPT tab console after reload:
  [AI-SEO][CONTENT] loaded – injecting main-world patch
  [AI-SEO][MAIN] main-world script running
  [AI-SEO][MAIN] fetch patched successfully
  (on prompt send) [AI-SEO][MAIN] SSE fetch detected ...
  (on prompt send) [AI-SEO][MAIN] intercepted conversation stream ...
  (on prompt send) [AI-SEO][MAIN] emit prompt_sent ...
  (on finish)      [AI-SEO][MAIN] emit response_finished message_stream_complete

---

Phase 7 — Fallback Recovery Path
- Fix background `AI_SEO_GET_CAPTURE_STATE` response contract to always return a concrete object.
- Replace manual fallback action to read cached conversation stream state from background.
- Fallback should:
  - hydrate prompt from cached `input_message`
  - start only if cached final completion exists (`message_stream_complete` or `[DONE]`)
  - avoid synthetic progression when no final completion is present

---

Data Contract (for extension runtime)
- Message type: `AI_SEO_CHATGPT_EVENT`
- Payload shape:
  - `kind: 'prompt_sent' | 'search_queries' | 'search_results' | 'response_finished'`
  - `conversationId?: string`
  - `turnExchangeId?: string`
  - `requestId?: string`
  - `prompt?: string`
  - `queries?: string[]`
  - `resultGroups?: unknown[]`
  - `reason?: 'status_finished_successfully' | 'message_stream_complete' | 'done_marker'`

---

## Quick File Reference

| File | Role | Key Hooks |
|------|------|-----------|
| `src/content/chatgptStreamContent.ts` | Injects IIFE into page's main world; bridges events to extension runtime | Listen for `input_message`, `search_queries`, `search_results`, `message_stream_complete` SSE events |
| `src/content/chatgptStreamMain.ts` | Patched `window.fetch`, parses SSE; emits CustomEvents (loaded via manifest world:MAIN as fallback) | N/A (backup, IIFE in Content.ts is primary) |
| `src/background.ts` | Service worker relay & cache; stores latest capture state | Receives `AI_SEO_CHATGPT_EVENT`, forwards to pages; responds to `AI_SEO_GET_CAPTURE_STATE` |
| `src/pages/VisualizationPage.tsx` | Visualization UI; builds tree from captured prompt + mock children | `completedRootPrompt` useMemo — replace `MOCK_CHILDREN` with real nodes from events |
| `src/data/mockData.ts` | Mock session data (for development) | `mockSessions[0].rootPrompt.children` currently used as fallback children |

---

## Testing Flow

1. **Build:** `pnpm build`
2. **Load:** `chrome://extensions` → Load unpacked → `extension/dist/`
3. **Test:** Open `chatgpt.com`, open DevTools Console in that tab
4. **Expected logs on page load:**
   - `[AI-SEO][CONTENT] loaded – injecting main-world patch`
   - `[AI-SEO][MAIN] main-world script running`
   - `[AI-SEO][MAIN] fetch patched successfully`
5. **Send a prompt in ChatGPT:**
   - Side panel auto-updates with your real prompt in the header
   - Console shows `[AI-SEO][MAIN] emit prompt_sent ...`
   - Console shows `[AI-SEO][MAIN] emit response_finished message_stream_complete` (at end)
   - Stages auto-progress → ListView shows tree with your prompt as root
6. **Mock children:** Currently showing Maruti Suzuki tree branches — replace by wiring `search_queries` / `search_results` events in VisualizationPage listener

---

Phase 10 — Listening Reliability Regression Fix
- Widen SSE interception to parse all `text/event-stream` responses (not URL-filtered to `conversation` only).
- Accept `response_finished` with `status_finished_successfully` as fallback completion when final markers are missing.
- Keep a short delayed start (~300ms) after finish signal to avoid premature stage transitions.

---

Phase 11 — Fire Reimplementation + Auto-Start Hotfix
- Re-implemented subquery `Fire` action in ListView.
- `Fire` now opens `chatgpt.com` in a fresh tab, attempts `New chat`, fills composer, and submits the subquery prompt.
- Auto-start flow hotfix: `VisualizationPage` now starts processing on any `response_finished` signal reason, instead of only strict final markers.
- This prevents stalls when ChatGPT emits `status_finished_successfully` without `message_stream_complete`.

---

Phase 12 — End-to-End Observability
- Add detailed logs across all runtime boundaries to isolate drops quickly:
  - MAIN stream parsing (parse lifecycle, flush previews, payload summaries)
  - content bridge forwarding counters and send failures
  - background cache mutation snapshots and runtime event counters
  - visualization state checkpoints and finish/start decisions
  - subquery fire action + page-side composer/send diagnostics

---

Phase 13 — Forced Listener Injection
- Add explicit `AI_SEO_START_LISTENING` background command.
- On new session open, UI requests forced injection into all open ChatGPT tabs via `chrome.scripting.executeScript`:
  - `chatgptStreamMain.ts` (world MAIN)
  - `chatgptStreamContent.ts` (isolated bridge)
- Add `AI_SEO_CONTENT_READY` telemetry so background confirms content bridge is active.
- This bypasses unreliable auto content script attachment paths.

---

Phase 14 — New Session Stale Prompt Fix
- Root cause: startup race in visualization.
  - `AI_SEO_GET_CAPTURE_STATE` could run in parallel with `AI_SEO_START_LISTENING`.
  - UI occasionally read stale capture state from previous session before reset completed.
- Fixes applied:
  - Background now versions capture sessions with `captureSessionId`.
  - `AI_SEO_START_LISTENING` resets state and returns the new `captureSessionId`.
  - Forwarded runtime events now include `captureSessionId`.
  - Visualization startup is now sequenced:
    1. call `AI_SEO_START_LISTENING`
    2. store active `captureSessionId`
    3. then fetch `AI_SEO_GET_CAPTURE_STATE`
  - Visualization ignores runtime events and initial cached state when `captureSessionId` does not match active session.
  - Dashboard `New Session` navigation now passes `sessionNonce` so repeated New Session clicks force a clean visualization reset.
- Debug logs added/used:
  - `[AI-SEO][BG] capture state reset { captureSessionId }`
  - `[AI-SEO][VIS] ignoring stale initial capture state`
  - `[AI-SEO][VIS] ignoring event from stale capture session`

---

Phase 15 — Strict Turn Matching (Prompt/Finish Contract)
- Source-of-truth hooks confirmed from real stream:
  - Start: `type = input_message`
  - Finish: `type = message_stream_complete` OR `/message/status = finished_successfully` OR `[DONE]`
- Main-world parser hardened:
  - Finish signals now carry turn metadata (`conversationId`, `requestId`, `turnExchangeId`) using last-known turn context.
  - `[DONE]` and stream-close finish markers now include last turn metadata.
- Background relay hardened:
  - Normalizes every event by filling missing IDs from latest capture state.
  - Drops `response_finished` events when IDs conflict with active turn.
- Visualization hardened:
  - Maintains active turn context from `prompt_sent`.
  - Validates finish via background capture state before starting pipeline.
  - Rejects mismatched turn finishes and stale-session state.
  - Manual fallback now uses the same validated path, not a separate heuristic.

---

Phase 16 — Runtime Invalidation + Port Transport Hardening
- Root issue observed in logs: `Extension context invalidated` thrown by content bridge after extension reload/update.
- Fixes applied:
  - Switched content bridge from per-event `sendMessage` to long-lived `chrome.runtime.connect` Port (`chatgpt-stream`).
  - Added runtime-context checks and hard stop behavior:
    - if context invalidates, remove page message listener and stop forwarding.
  - Added reconnect path on port disconnect (short retry).
  - Background now consumes stream events through top-level `chrome.runtime.onConnect`.
  - Added exactly-once finish dedupe in background with per-turn key:
    - `conversationId::requestId::turnExchangeId`
  - Added service-worker keepalive during active turns (`prompt_sent` -> start, `response_finished` -> stop).
  - Added best-effort state persistence to `chrome.storage.session` and restore on worker wake.
  - Added `onInstalled` reinjection pass for ChatGPT tabs to reduce stale script windows after update.
