# Provider Capture Integration Guide

> **Purpose:** This document tells any agent (or developer) exactly how to add a new AI chat
> provider to the capture pipeline — from asking the right questions, to writing the content
> scripts, to wiring up the UI.
> **Reference implementation:** Claude (`claude.ai`) — completed Feb 2026.
> **Next target example used throughout:** Gemini (`gemini.google.com`).

---

## 1. What This System Does

When a user opens an AI chat app in a browser tab, two Chrome content scripts run on that page:

1. **MAIN-world script** — patches `window.fetch()` to intercept the AI's streaming response
   before it reaches the page. It parses the stream, extracts the user prompt, search queries,
   search result citations, and the response-complete signal. Each extracted event is emitted
   via `window.postMessage`.

2. **Isolated-world script** — listens for those `postMessage` events and relays them through
   a persistent `chrome.runtime.connect()` port to the background service worker.

The **background service worker** receives all events, deduplicates them, keeps capture state,
and forwards them to the extension side-panel UI (`VisualizationPage`).

The **UI** accumulates a full turn (prompt → queries → results → done), builds a visual tree
instantly from RAM, then persists it to the backend via `POST /api/projects/:id/capture/ingest-turn`.

```
AI chat page (claude.ai / chatgpt.com / gemini.google.com / …)
  └─ [MAIN world]   {provider}StreamMain.ts
       └─ patches window.fetch()
       └─ parses SSE / streaming response
       └─ window.postMessage("AI_SEO_MAIN_TO_ISOLATED_BRIDGE", payload)
  └─ [Isolated world]  {provider}StreamContent.ts
       └─ listens for postMessage
       └─ chrome.runtime.connect({ name: "{provider}-stream" })
       └─ port.postMessage({ type: "AI_SEO_CHATGPT_EVENT", payload })
  └─ background.ts (service worker)
       └─ port.onMessage → handleStreamEvent(payload)
       └─ chrome.runtime.sendMessage("AI_SEO_CHATGPT_EVENT") → VisualizationPage
  └─ VisualizationPage.tsx (side panel)
       └─ accumulates turn events
       └─ builds RAM tree → shows instantly
       └─ POSTs to /api/projects/:id/capture/ingest-turn
```

---

## 2. Files Involved

### Created per provider
| File | World | Purpose |
|---|---|---|
| `extension/src/content/{provider}StreamMain.ts` | MAIN | Intercepts fetch, parses stream, emits events |
| `extension/src/content/{provider}StreamContent.ts` | Isolated | Relays postMessages to background via port |

### Modified per provider
| File | What changes |
|---|---|
| `extension/manifest.json` | Add two `content_scripts` entries + `host_permissions` |
| `extension/src/background.ts` | Add `inject{Provider}ListenersIntoTab()`, `startListeningOn{Provider}Tabs()`, handle new port name in `onConnect` |
| `extension/src/lib/project-chat.ts` | Add URL, label, logo for provider (already has all 5 providers declared) |

### UI — already provider-aware (no changes needed per provider)
| File | What it does |
|---|---|
| `extension/src/components/AppHeader.tsx` | Shows provider logo in header when `provider` prop set |
| `extension/src/components/LoadingStepper.tsx` | Shows provider logo + dynamic "Waiting for prompt from {Provider}" |
| `extension/src/components/ListeningDrawer.tsx` | Shows provider logo + name in follow-up drawer header |

---

## 3. Context You Must Gather From the User

Before writing a single line of code, ask the user to capture **5 things** from DevTools Network
tab while sending a message in the target app. Below is the exact checklist — use it verbatim.

---

### 3.1 — The streaming endpoint URL

**Action:** Open DevTools → Network tab → clear → send a message → find the long-lived
streaming request.

**Ask for:**
- The full **Request URL** (from the Headers tab of that request)
- The **Request Method** (usually POST)
- The response **Content-Type** header (should be `text/event-stream` for SSE, or could be
  `application/json` with chunked transfer for non-SSE providers)

**Example (Claude):**
```
https://claude.ai/api/organizations/62a742dc-.../chat_conversations/83f8666f-.../completion
POST
Content-Type: text/event-stream
```

**What to extract from the URL:**
- The URL pattern (with placeholders for IDs)
- Which segment is the **conversation ID** (capture group for the regex in the MAIN script)

---

### 3.2 — The full SSE/stream event sequence

**Action:** Click the streaming request → go to **Response** (or **EventStream**) tab → copy
the first 60–80 lines of the raw stream.

**What you need to see:**
1. The event that signals **response start** and carries conversation/message IDs
2. The event(s) that carry the **search query** text (if the provider does web search)
3. The event(s) that carry **search result citations** (URLs + titles)
4. The event that signals **response complete**

**For SSE format** (`event: xxx\ndata: {...}`), paste the raw lines.
**For chunked JSON** (NDJSON / one JSON object per line), paste those lines.
**For WebSocket**, paste the first few message payloads from the WS Frames tab.

**Minimum required events (3 examples):**
```
# Start event — must show where conversation ID / message ID / request ID live
event: message_start
data: {"type":"message_start","message":{"uuid":"...","request_id":"req_...",...}}

# Search query event — must show where the query string lives
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"best cars\""}}

# Completion event — must show the stop signal
event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}
```

---

### 3.3 — The POST request body format (to extract the user prompt)

For most providers, the user prompt is NOT in the SSE stream — it's in the POST body.

**Action:** Click the streaming request → Headers tab → scroll to **Request Payload** or
**Request Body** → copy the full JSON.

**What to look for:** Which key holds the human message text.

**Common shapes:**
```jsonc
// Shape A — top-level "prompt" key (Claude)
{ "prompt": "best german cars 2026", "parent_message_uuid": "...", ... }

// Shape B — messages array (OpenAI-style)
{ "messages": [{ "role": "user", "content": "best german cars 2026" }], ... }

// Shape C — contents array (Google-style, likely Gemini)
{ "contents": [{ "parts": [{ "text": "best german cars 2026" }], "role": "user" }], ... }
```

If the prompt IS in the SSE stream (like ChatGPT's `type: "input_message"` event), note that
instead — no POST body parsing needed.

---

### 3.4 — The conversation JSON (full REST response, if available)

Some providers expose a REST GET endpoint that returns the full conversation with all messages
and citations. This is the gold standard for understanding the data shape.

**Action:** In the Network tab, look for a GET request that returns the full conversation
history as JSON (e.g., Claude's `GET /api/.../chat_conversations/{id}`).

**Paste the full JSON response** — this shows:
- How conversation ID appears in the data
- How citations/search results are structured
- How human vs. assistant messages are distinguished

This is optional but speeds up implementation significantly.

---

### 3.5 — DOM selectors for the chat input and send button

These are needed to **fire prompts programmatically** (the `firePromptsSequentially` feature).

**Action:** In the browser console on the chat page, run:

```js
// Find the text input
document.querySelector('textarea')
document.querySelector('[contenteditable="true"]')
document.querySelector('[data-testid*="input"]')
document.querySelector('[role="textbox"]')

// Get all data-testid button values
[...document.querySelectorAll('button[data-testid]')].map(b => b.getAttribute('data-testid'))

// Find the send button
document.querySelector('button[aria-label*="Send"]')
document.querySelector('button[type="submit"]')
```

**Report back:** The exact selector for the textarea/editor element and for the send button.

**Note:** If the textarea is a `contenteditable` div (like Claude uses ProseMirror), note that
— it requires `document.execCommand('insertText')` instead of setting `.value`.

---

## 4. Architecture Decision: SSE vs. WebSocket vs. Chunked JSON

Once you have the network captures, determine which protocol the provider uses:

| Protocol | Detection | Parser approach |
|---|---|---|
| **SSE** (`text/event-stream`) | `Content-Type: text/event-stream` in response | Parse `event:` + `data:` lines. Use `flushEvent()` on blank lines. `data:` contains JSON object — dispatch on `obj.type` |
| **NDJSON** (chunked JSON, one object per line) | `Content-Type: application/json` with chunked transfer | Parse each line as a JSON object. No `event:` prefix, no blank-line flush needed |
| **WebSocket** | WS upgrade in Network tab | Use `window.WebSocket` patch instead of `window.fetch` patch. Intercept `ws.onmessage` |

**ChatGPT** → SSE (data-only, no `event:` prefix, `[DONE]` terminator)
**Claude** → SSE (named events: `event: message_start`, etc.)
**Gemini** → Likely chunked JSON or NDJSON (Google's typical pattern — confirm from network capture)
**Perplexity** → SSE
**Grok** → Confirm from network capture

---

## 5. The StreamEventPayload Contract

Every provider's MAIN script must ultimately emit these 4 event kinds:

```typescript
type StreamEventPayload = {
  kind:
    | "prompt_sent"       // User submitted a message
    | "search_queries"    // Provider issued web search query/queries
    | "search_results"    // Search citations/sources received
    | "response_finished"; // Response stream complete

  chat_provider: "chatgpt" | "claude" | "gemini" | "perplexity" | "grok" | "unknown";

  // Provider-level identifiers (all optional — fill what's available)
  conversationId?: string;    // The thread/conversation UUID
  requestId?: string;         // Per-request ID (if provider exposes one)
  turnExchangeId?: string;    // Per-turn ID (if provider exposes one)
  provider_chat_id?: string;  // Usually = conversationId
  chat_url?: string;          // Current page URL
  chat_title?: string;        // document.title

  // Payload per kind
  prompt?: string;            // present on prompt_sent
  queries?: string[];         // present on search_queries
  resultGroups?: unknown[];   // present on search_results — array of citation objects
  reason?: "status_finished_successfully" | "message_stream_complete" | "done_marker";
};
```

**Minimum viable:** `prompt_sent` + `response_finished` = the app works (no search tree, just
prompt tracking). `search_queries` + `search_results` unlock the full SEO visualization.

**Result group shape** (what the backend expects for citations — keep to this shape):
```typescript
// Each item in resultGroups array
{
  type: "knowledge",          // or whatever the provider calls it
  title: string,              // page title
  url: string,                // page URL
  metadata: {
    site_domain: string,
    site_name: string,
  }
}
```
The `extract_sites_by_query` utility in `VisualizationPage.tsx` (line ~147) handles any shape
as long as `url`, `title`, and `metadata.site_domain` are present.

---

## 6. Step-by-Step Integration Checklist

Use this list in order. Each step references exact file paths.

### Step 1 — Gather context (see Section 3)
Ask the user for all 5 network captures. Do not start coding until you have at minimum:
- [ ] Streaming endpoint URL pattern
- [ ] First ~40 lines of the SSE/stream response
- [ ] POST body format (or confirmation that prompt is in stream)

### Step 2 — Create `{provider}StreamMain.ts`

**File:** `extension/src/content/{provider}StreamMain.ts`
**World:** MAIN (runs in page context, can access `window.fetch`)
**Template:** Copy `claudeStreamMain.ts` and adapt — it is the cleanest reference.

**Required adaptations:**

```
MAIN_PATCH_FLAG   →  "__AI_SEO_{PROVIDER}_STREAM_PATCHED__"
DEBUG_PREFIX      →  "[AI-SEO][{PROVIDER}-MAIN]"
COMPLETION_URL_RE →  Regex matching the provider's streaming endpoint URL
                     Capture group 1 = conversation ID segment
chat_provider     →  "{provider}" (lowercase, matches ai_chat_provider type)
```

**SSE parser adaptations** — in `processDataObject(raw, state)`:

| What to find | Where it lives (Claude example) | Your task |
|---|---|---|
| Conversation ID | Regex from URL | Same approach — extract from URL |
| Request ID | `message_start.message.request_id` | Find equivalent in your stream's start event |
| Turn/message ID | `message_start.message.uuid` | Find equivalent |
| Search query text | `content_block_delta.delta.partial_json` accumulated on `content_block_start` where `name === "web_search"` | Find the equivalent block/event type |
| Search results | `content_block_delta.delta.partial_json` accumulated on `content_block_start` of `type === "tool_result"` | Find the equivalent |
| Response done | `message_delta.delta.stop_reason === "end_turn"` | Find the equivalent stop signal |

**Prompt extraction** — in `preparePromptExtraction(args)`:
- If prompt is in the POST body as `body.prompt` → already handled
- If prompt is in `body.messages[last].content` → adapt `preparePromptExtraction`
- If prompt is in `body.contents[last].parts[0].text` (Gemini-style) → adapt accordingly
- If prompt is in the SSE stream itself → emit `prompt_sent` inside `processDataObject` instead

**For non-SSE providers (NDJSON/WebSocket):**
- NDJSON: Replace `parseStream()` — parse each newline-delimited JSON object directly, no
  blank-line flush logic, no `event:` prefix stripping
- WebSocket: Replace `installFetchPatch()` with a `WebSocket` monkey-patch that intercepts
  `ws.onmessage` on connections matching the provider's WS URL pattern

### Step 3 — Create `{provider}StreamContent.ts`

**File:** `extension/src/content/{provider}StreamContent.ts`
**World:** Isolated (has `chrome.runtime` API)
**Template:** `claudeStreamContent.ts` — change only these 2 constants:

```typescript
const PORT_NAME = "{provider}-stream";   // e.g. "gemini-stream"
const DEBUG_PREFIX = "[AI-SEO][{PROVIDER}-CONTENT]";
// Everything else is identical — do not change RUNTIME_EVENT_TYPE or BRIDGE_MESSAGE_TYPE
```

### Step 4 — Update `manifest.json`

**File:** `extension/manifest.json`
Add two new entries to `content_scripts` and one to `host_permissions`:

```jsonc
// In content_scripts array:
{
  "matches": ["https://{provider-domain}/*"],
  "js": ["src/content/{provider}StreamContent.ts"],
  "run_at": "document_start"
},
{
  "matches": ["https://{provider-domain}/*"],
  "js": ["src/content/{provider}StreamMain.ts"],
  "run_at": "document_start",
  "world": "MAIN"
},

// In host_permissions array:
"https://{provider-domain}/*"
```

**Provider domains:**
| Provider | Domain |
|---|---|
| ChatGPT | `chatgpt.com`, `chat.openai.com` |
| Claude | `claude.ai` |
| Gemini | `gemini.google.com` |
| Perplexity | `perplexity.ai` |
| Grok | `grok.com` |

### Step 5 — Update `background.ts`

**File:** `extension/src/background.ts`

**Add two functions** after `startListeningOnClaudeTabs()` (around line 650):

```typescript
async function inject{Provider}ListenersIntoTab(tabId: number): Promise<boolean> {
    try {
        const manifest = chrome.runtime.getManifest();
        const allJsFiles = (manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []);
        const mainFiles = allJsFiles.filter((f) => f.includes("{provider}StreamMain"));
        const isolatedFiles = allJsFiles.filter((f) => f.includes("{provider}StreamContent"));

        if (mainFiles.length) {
            await chrome.scripting.executeScript({ target: { tabId }, files: mainFiles, world: "MAIN" });
        }
        if (isolatedFiles.length) {
            await chrome.scripting.executeScript({ target: { tabId }, files: isolatedFiles });
        }
        return true;
    } catch (error) {
        console.warn(DEBUG_PREFIX, "failed to inject {Provider} listeners", { tabId, error });
        return false;
    }
}

async function startListeningOn{Provider}Tabs() {
    const tabs = await chrome.tabs.query({ url: "https://{provider-domain}/*" });
    if (!tabs.length) return { injected: 0, attempted: 0 };

    let injected = 0;
    for (const tab of tabs) {
        if (!tab.id) continue;
        if (await inject{Provider}ListenersIntoTab(tab.id)) injected++;
    }
    return { injected, attempted: tabs.length };
}
```

**Add to `onInstalled` handler** — extend the `Promise.all`:
```typescript
Promise.all([
    startListeningOnChatGPTTabs(),
    startListeningOnClaudeTabs(),
    startListeningOn{Provider}Tabs(),   // ← add here
])
```

**Add to `AI_SEO_START_LISTENING` handler** — same `Promise.all`.

**Add to `AI_SEO_ENSURE_LISTENERS` handler** — same `Promise.all`.

**Add to `onConnect`** — extend the `knownPorts` Set:
```typescript
const knownPorts = new Set(["chatgpt-stream", "claude-stream", "{provider}-stream"]);
```

### Step 6 — Verify `project-chat.ts` (already complete)

**File:** `extension/src/lib/project-chat.ts`
All 5 providers are already declared in `provider_urls`, `provider_labels`, and `provider_logos`.
**No changes needed** unless adding a 6th provider.

```typescript
// Confirm your provider is present in all three maps:
provider_urls:   { chatgpt, claude, gemini, perplexity, grok }
provider_labels: { chatgpt, claude, gemini, perplexity, grok }
provider_logos:  { chatgpt, claude, gemini, perplexity, grok }
```

Logo files live in `extension/public/` — confirm the file exists:
```
/chatgpt.svg          /chatgpt-light.svg
/claude.svg           /claude-light.svg
/gemini-light.svg
/perplexity.svg       /perplexity-light.svg
/grok-(xai).svg       /grok-(xai)-light.svg
```
If missing, ask the user to drop the SVG into `extension/public/`.

### Step 7 — Type-check

```bash
cd extension
pnpm exec tsc --noEmit
```

Fix all errors before proceeding.

### Step 8 — Build and test manually

```bash
pnpm build
```

Load `extension/dist/` in `chrome://extensions` → Load unpacked.

**Manual test flow:**
1. Open the extension side panel
2. Click the provider logo on Dashboard → select a project → confirm you land on VisualizationPage
3. Check the header shows the provider logo
4. Check the Listening stage shows "Waiting for your prompt from {Provider}."
5. In the chat app, send a message
6. Confirm in background console: `[AI-SEO][{PROVIDER}-MAIN] emit prompt_sent`
7. Confirm `search_queries` fires if the provider did a web search
8. Confirm `search_results` fires
9. Confirm `response_finished` fires
10. Confirm the visualization tree appears in the extension

---

## 7. Claude Reference Implementation — Annotated

Claude was the first non-ChatGPT provider integrated. Use it as the canonical reference.

### Stream endpoint
```
POST https://claude.ai/api/organizations/{org_id}/chat_conversations/{conv_id}/completion
Response: text/event-stream
```
Conversation ID = `conv_id` from URL, extracted via regex capture group.

### SSE event sequence
```
event: message_start        → extract requestId (message.request_id), turnExchangeId (message.uuid)
                              → emit prompt_sent (prompt was read from POST body)
event: content_block_start  → if type=tool_use AND name=web_search: register block index
event: content_block_delta  → if delta.type=input_json_delta on tool_use block: accumulate JSON
event: content_block_stop   → parse accumulated JSON → emit search_queries([body.query])
event: content_block_start  → if type=tool_result: register block index
event: content_block_delta  → if delta.type=input_json_delta on tool_result block: accumulate JSON
event: content_block_stop   → parse → emit search_results(array of {type,title,url,metadata})
event: content_block_start  → type=text (assistant response starts)
event: content_block_delta  → type=text_delta (text chunks — not captured, ignored)
event: message_delta        → delta.stop_reason=end_turn → emit response_finished(status_finished_successfully)
event: message_stop         → emit response_finished(done_marker) — fallback, deduplicated by background
```

### Prompt extraction
Claude does NOT include the user prompt in the SSE stream.
Prompt is in the POST body: `{ "prompt": "user message here", ... }`.
The MAIN script reads `args[1].body` (string) synchronously before `await originalFetch(...)`.

### Key IDs
| Our field | Claude source |
|---|---|
| `conversationId` | URL: `/chat_conversations/{uuid}/completion` |
| `requestId` | `message_start.message.request_id` |
| `turnExchangeId` | `message_start.message.uuid` (assistant message UUID) |

### DOM selectors (for prompt firing)
| Element | Selector |
|---|---|
| Text input | `div[data-testid="chat-input"]` (ProseMirror/tiptap `contenteditable`) |
| Send button | Not found via `data-testid` or `aria-label*=Send` — appears dynamically when text is typed |

**Note on ProseMirror inputs:** Cannot use `.value =`. Use `document.execCommand('insertText', false, text)` to set content programmatically. For Enter submission, dispatch `KeyboardEvent('keydown', { key: 'Enter', ... })`.

---

## 8. ChatGPT Reference — Key Differences from Claude

Understanding the differences helps when adapting for a new provider.

### Stream format difference
ChatGPT uses SSE **without named events** — no `event:` lines, only `data:` lines, terminated
by `data: [DONE]`.

Claude uses SSE **with named events** — `event: xxx` lines precede each `data:` line. Both
formats are handled by checking `obj.type` in the parsed data JSON (the `event:` line is
redundant but ignored in the parser).

### Prompt source difference
ChatGPT **includes the prompt in the SSE stream** as `{ "type": "input_message", "input_message": { "content": { "parts": ["user text"] } } }`.
Claude does **not** — prompt must be read from the POST body.

### Search data difference
ChatGPT: Search queries in `metadata.search_model_queries.queries[]`, results in `metadata.search_result_groups[]` (large blobs, trimmed before ingest).
Claude: Search queries accumulated from `input_json_delta` fragments on `tool_use` blocks; results accumulated from `tool_result` blocks.

---

## 9. Background Deduplication & Turn Key

The background service worker deduplicates `response_finished` events using a turn key:

```typescript
function turnKey(payload): string | null {
    if (!payload.conversationId || !payload.requestId || !payload.turnExchangeId) return null;
    return `${payload.conversationId}::${payload.requestId}::${payload.turnExchangeId}`;
}
```

If a provider only provides 1 or 2 of these IDs (not all 3), `turnKey()` returns `null` and
deduplication is skipped — multiple `response_finished` events will be emitted to the UI. The
UI handles this gracefully but it's preferable to provide all 3 IDs.

If the provider has no equivalent to `requestId` or `turnExchangeId`, use a stable hash of
the prompt text + timestamp as a synthetic ID.

---

## 10. Common Pitfalls

| Pitfall | Cause | Fix |
|---|---|---|
| No events reaching background | Isolated script not injected, or port name mismatch | Check `PORT_NAME` in content script matches `knownPorts` Set in background `onConnect` |
| Prompt is empty | POST body is `FormData` or `ReadableStream`, not a JSON string | Try cloning the Request and reading `.text()` asynchronously; or capture from DOM |
| Duplicate `response_finished` | Multiple completion signals (e.g., both `message_delta` and `message_stop`) | Expected — background deduplication handles this if all 3 IDs are present |
| `window.fetch` patch flag not working | Provider uses `XMLHttpRequest` instead of `fetch` | Add an `XMLHttpRequest` patch alongside the fetch patch; same pattern |
| Stream events arrive but `search_queries` never fires | Provider doesn't do web search, or query is in a different event type | Check the stream dump more carefully; or accept that this provider won't have query data |
| Content script injection fails silently | Tab not fully loaded, or CSP on extension pages | `injectListenersIntoTab` catches errors — check the background console for warnings |
| Logo not showing in UI | SVG file missing from `extension/public/` | Add the SVG and confirm the path matches `provider_logos` in `project-chat.ts` |

---

## 11. Gemini Integration — Specific Prep Questions

When starting Gemini integration, ask the user for these specific things:

1. **Endpoint URL:** Gemini may hit `generativelanguage.googleapis.com` or a Bard/Gemini-specific internal URL. Ask for the full Request URL from Network tab.

2. **Response format:** Google often uses **chunked JSON** (NDJSON) rather than SSE. The `Content-Type` may be `application/json` with `Transfer-Encoding: chunked`. Ask for `Content-Type` header value.

3. **Conversation URL pattern:** The browser URL when chatting is `https://gemini.google.com/app/{conversation_id}`. Confirm if the API URL also contains this ID, or if it's a different session identifier.

4. **Search grounding:** Gemini has "grounding" (search results). Ask user to send a query that requires web search and capture the stream. The grounding results may be in a `groundingMetadata` field or similar.

5. **DOM selectors:** Ask user to run:
   ```js
   document.querySelector('rich-textarea')  // Gemini uses a custom element
   document.querySelector('[contenteditable]')
   document.querySelector('button[aria-label*="Send"]')
   ```

6. **Request body shape:** Likely Google's `GenerateContent` API format:
   ```json
   { "contents": [{ "parts": [{ "text": "user prompt" }], "role": "user" }] }
   ```
   Confirm from the Request Payload in DevTools.

---

## 12. Lessons Learned from the Claude Integration (Live Debugging)

These are concrete problems hit during the Claude go-live, documented so the next
integration doesn't repeat them.

---

### 12.1 — Always rebuild before testing

**What happened:** All source changes were complete and correct, but the extension was still
showing the old hardcoded "Waiting for your prompt from ChatGPT." text and no provider logo.

**Root cause:** The extension loads from `extension/dist/`, not from source. Source edits are
invisible until `pnpm build` is run and the extension is reloaded in `chrome://extensions`.

**Rule for every agent:** After any code change, the verification sequence is always:

```bash
cd extension
pnpm build          # compiles and bundles into dist/
```

Then in Chrome: `chrome://extensions` → find the extension → click **↺ (reload)** → reopen
the side panel. Never assume a source change is live without this step.

**Dev mode note:** `pnpm dev` starts Vite's HMR server for the React side-panel UI, but
**MAIN-world content scripts do not support HMR** (CRXJS prints a warning about this). If
you change `{provider}StreamMain.ts` during dev, you must still do a full `pnpm build` +
reload. HMR only reliably covers the side-panel React app.

---

### 12.2 — Provider state has two entry paths; both must supply the provider

**What happened:** The UI showed no provider logo and generic text when the user navigated
directly to an existing project from the project list (clicking the card), even though it
worked fine when entering via the "Start Chat" flow.

**Root cause:** `selected_chat_provider` was derived only from `location.state.chat_provider`.
That state is only set by `Dashboard.start_listening_with_provider()` which calls
`navigate("/visualization/new", { state: { chat_provider: provider } })`. When the user
clicks a project card directly, `navigate("/visualization/:id")` is called with no state —
`state` is null, `chat_provider` is undefined.

**Fix applied in `VisualizationPage.tsx`:**

```typescript
// Before — only read from route state
const selected_chat_provider = state?.chat_provider;

// After — three-tier resolution
const selected_chat_provider =
  state?.chat_provider ??
  (selected_project_id ? project_chat.get_provider(selected_project_id) ?? undefined : undefined);
```

**Rule for every agent:** Any time you read `state?.chat_provider`, also fall back to
`project_chat.get_provider(project_id)`. The localStorage map is always written when the
user starts a session via "Start Chat", so it is the correct persistent fallback.

**The two navigation paths into VisualizationPage:**

| Path | How | `state.chat_provider` | `project_chat.get_provider()` |
|---|---|---|---|
| Start Chat flow | `navigate("/visualization/new", { state: { chat_provider } })` | ✅ present | ✅ also written |
| Direct project open | `navigate("/visualization/:id")` (no state) | ❌ undefined | ✅ present (from prior session) |

---

### 12.3 — Claude's send button is dynamically rendered

**What happened:** `document.querySelectorAll('button[data-testid]')` returned 8 buttons,
none of which was a send button. `button[aria-label*="Send"]` returned null.

**Root cause:** Claude.ai's send button appears in the DOM only when text is present in the
editor. At idle (empty input), the button either doesn't exist or is replaced by a voice/mic
button.

**Confirmed DOM selectors for Claude:**

| Element | Selector | Type |
|---|---|---|
| Text input | `div[data-testid="chat-input"]` | ProseMirror `contenteditable` div |
| Send button | Not stable — appears dynamically | Must be discovered at fire-time |

**Strategy for programmatic prompt firing on Claude (for `firePromptsSequentially`):**

```typescript
// 1. Focus and set content (ProseMirror — cannot use .value)
const editor = document.querySelector('div[data-testid="chat-input"]');
editor.focus();
document.execCommand('selectAll', false);
document.execCommand('insertText', false, promptText);

// 2. Submit — try Enter key first (enterkeyhint="enter" confirms this works)
editor.dispatchEvent(new KeyboardEvent('keydown', {
  key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
}));

// 3. If Enter doesn't submit, look for button near the editor at fire-time:
const sendBtn = editor
  .closest('form, [role="form"]')
  ?.querySelector('button[type="button"]:not([disabled])')
  ?? document.querySelector('button[aria-label="Send message"]');
sendBtn?.click();
```

**General rule:** For any provider using a `contenteditable` editor (ProseMirror, Slate,
Quill, Tiptap), never use `.value =`. Always use `document.execCommand('insertText')`.
The `enterkeyhint` attribute on the editor element is a reliable signal that Enter submits.

---

### 12.4 — Named SSE events (`event:` lines) are safe to skip

**What happened:** Claude's SSE uses `event: message_start\ndata: {...}` format, while
ChatGPT only uses `data: {...}` with no `event:` prefix.

**Resolution:** The `event:` line is entirely redundant — the `data:` JSON object always
contains a `type` field with the same value. The parser simply skips `event:` lines and
dispatches on `obj.type` from the data. No provider-specific handling needed.

```typescript
// In parseStream():
if (line.startsWith("event:")) continue;  // skip — type is in data JSON
if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
```

This pattern works for both named-event SSE (Claude) and data-only SSE (ChatGPT) with
zero conditional logic.

---

### 12.5 — Prompt is emitted AFTER `message_start`, not before

**What happened (design decision):** The prompt text is read from the POST body synchronously
before `await originalFetch(...)`. But the IDs (`requestId`, `turnExchangeId`) only arrive
in the SSE stream's first event (`message_start`). If we emit `prompt_sent` immediately from
the fetch patch (before the stream starts), the IDs are missing.

**Solution:** Store the prompt text in `SessionState.promptText`, then emit `prompt_sent`
inside the `message_start` handler — at that point all three IDs are available.

```typescript
// In processDataObject, type === "message_start":
state.requestId = msg.request_id;
state.turnExchangeId = msg.uuid;

if (!state.promptEmitted && state.promptText) {
  state.promptEmitted = true;
  emit("prompt_sent", state, { prompt: state.promptText }); // ← all IDs present here
}
```

The `promptEmitted` flag prevents double-emission if `message_start` fires more than once
(edge case in retries).

---

### 12.6 — POST body is usually a plain JSON string, not a Request object

**What happened:** Two paths exist for reading the POST body in the fetch patch:

- `fetch(url, { body: jsonString })` — `args[1].body` is a plain string. Read synchronously,
  no clone needed. **This is the common path for all web apps including Claude.**
- `fetch(new Request(url, { body }))` — `args[0]` is a `Request` object whose body stream
  is consumed by `originalFetch`. Must clone before calling fetch.

**Rule:** Always try the sync path first (`typeof args[1]?.body === "string"`). Only fall back
to async clone if that fails. This avoids any latency between POST dispatch and stream start.

```typescript
function preparePromptExtraction(args) {
  // Fast path — plain string body (covers ~95% of real-world cases)
  const init = args[1] as RequestInit | undefined;
  if (init && typeof init.body === "string") {
    const bodyObj = JSON.parse(init.body);
    if (typeof bodyObj?.prompt === "string") return { promptText: bodyObj.prompt, bodyClone: null };
  }
  // Slow path — Request object (body consumed by fetch; must clone first)
  if (args[0] instanceof Request) {
    return { promptText: "", bodyClone: args[0].clone().text().catch(() => null) };
  }
  return { promptText: "", bodyClone: null };
}

---

## 13. Lessons Learned from the Perplexity Integration

---

### 13.1 — Write a DOM probe script BEFORE coding any provider's prompt-firing logic

**What happened:** The Perplexity prompt-firing code was written assuming a `<textarea>` (like
ChatGPT) based on a visual inspection of the page. The code failed silently — no textarea
existed, the composer was never found, and the sequential fire stalled.

**Root cause:** Perplexity uses Meta's **Lexical** rich-text editor framework — a
`div[contenteditable]` with `data-lexical-editor="true"`, **not** a `<textarea>` and **not**
a `<form>`. There is no submit button on the initial idle state. None of this is visible from
reading the page visually or guessing from other providers.

**Rule for every agent:** Before writing `getComposer()` or `getSendButton()` for any new
provider, run this DOM probe in the browser console **on the actual provider page**:

```javascript
// STEP 1 — run on idle page
({
  textareas: [...document.querySelectorAll('textarea')].map(el => ({
    id: el.id, placeholder: el.placeholder, visible: !!el.offsetParent
  })),
  contentEditables: [...document.querySelectorAll('[contenteditable]')].map(el => ({
    id: el.id, role: el.getAttribute('role'),
    dataAttrs: Object.fromEntries([...el.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value])),
    visible: !!el.offsetParent
  })),
  visibleButtons: [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => ({
    ariaLabel: b.getAttribute('aria-label'), type: b.type, disabled: b.disabled,
    dataAttrs: Object.fromEntries([...b.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value]))
  })),
  forms: [...document.querySelectorAll('form')].map(f => ({ id: f.id, class: f.className.slice(0,60) }))
})

// STEP 2 — type any character into the input box, then run:
({
  afterTypingButtons: [...document.querySelectorAll('button')].filter(b => b.offsetParent && !b.disabled).map(b => ({
    ariaLabel: b.getAttribute('aria-label'), type: b.type,
    dataAttrs: Object.fromEntries([...b.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value]))
  }))
})
```

This reveals in 30 seconds what would otherwise take hours of guessing:
- Whether the input is a `<textarea>` or `contenteditable` div
- What framework owns the editor (`data-slate-editor`, `data-lexical-editor`, etc.)
- Whether a send button exists at idle or only after typing
- Whether there is a `<form>` (which tells you if Enter or button click submits)

**Time saved: multiple full debug cycles.**

---

### 13.2 — Lexical editors require `execCommand('insertText')` — `.value` and `.textContent` do nothing

**What happened:** The first attempt set `composer.textContent = promptText` then dispatched an
`input` event. Lexical ignored this completely — the editor state didn't update, so the send
button never enabled and Enter didn't submit anything.

**Root cause:** Lexical (like ProseMirror, Slate, Tiptap) maintains its own internal virtual
document model. Directly mutating the DOM (`textContent`, `innerHTML`) bypasses Lexical's
event system entirely — Lexical never sees the change and never re-renders.

**The only correct approach** for all modern rich-text editors:

```typescript
editor.focus();
document.execCommand('selectAll', false);           // clear existing content
document.execCommand('insertText', false, text);    // inject — fires native input events that Lexical catches
await sleep(400);                                   // let React/Lexical state settle
editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
```

**Detection table — how to know which injection to use:**

| DOM attribute on editor element | Framework | Injection method |
|---|---|---|
| `data-lexical-editor="true"` | Meta Lexical | `execCommand('insertText')` |
| `data-slate-editor="true"` | Slate.js | `execCommand('insertText')` |
| `data-testid="chat-input"` (Claude) | ProseMirror variant | `execCommand('insertText')` |
| `data-gramm` or `class*="ql-editor"` | Quill | `execCommand('insertText')` |
| `class*="tiptap"` | Tiptap | `execCommand('insertText')` |
| **plain `<textarea>`** | Native | `nativeSetter.call(el, text)` + dispatch `input` event |

**Rule:** If the editor element has **any** `data-*-editor` attribute, assume `execCommand` is
the only safe injection method. When in doubt, use `execCommand` — it works for both `contenteditable` and `textarea`.

---

### 13.3 — Verify submission by checking if the editor clears, not by finding a button

**What happened:** Perplexity has no stable send button selector. The button that appears after
typing has no `aria-label`, no `data-testid`, and no `type="submit"`. Since there is also no
`<form>`, the conventional detection strategy fails completely.

**Solution:** After dispatching Enter, check whether the editor's `textContent` is now empty:

```typescript
await sleep(300);
const composerNow = getComposer();
const cleared = !composerNow || composerNow.textContent?.trim() === "";
if (cleared) {
    console.log("submitted successfully");
    return true;
}
// Otherwise retry — Lexical wasn't ready yet
```

This works because every rich-text chat editor clears its content on successful submission.
It is a **provider-agnostic success signal** that doesn't depend on finding any button.

**General rule:** For all providers, use "did the editor clear?" as the ground truth for
submission success — not "did I click a specific button?"

---

### 13.4 — Perplexity's SSE data model: everything is in the FINAL message

**What happened:** Initial parsing attempted to extract search queries and results from
intermediate SSE messages (PENDING status). Those messages contain only a `blocks` array
with `plan_block` objects — no `text` field, no search data.

**Actual Perplexity data model** (confirmed from live network capture):

```
Endpoint: POST https://www.perplexity.ai/rest/sse/perplexity_ask
Format:   SSE with named events ("event: message")

Each SSE message: { status: "PENDING" | "COMPLETED", final_sse_message: true/false, ... }

PENDING messages:  carry { blocks: [...] } — ignore, no useful data yet
FINAL message:     final_sse_message === true, carries:
  - context_uuid    → conversationId (thread ID)
  - backend_uuid    → requestId (answer ID)
  - uuid            → turnExchangeId (frontend request ID)
  - query_str       → the user's prompt (also available in POST body)
  - text            → JSON STRING containing array of step objects:
      [
        { step_type: "INITIAL_QUERY",   content: { query: "..." } }
        { step_type: "SEARCH_WEB",      content: { queries: [{ query: "..." }] } }
        { step_type: "SEARCH_RESULTS",  content: { web_results: [{ name, url, snippet, meta_data }] } }
        { step_type: "ANSWER",          content: { ... } }
      ]
```

**Rule for deferred-data providers:** If a provider sends all structured data only in the
final stream message, parse eagerly on `final_sse_message === true` (or equivalent signal),
not during streaming. Trying to accumulate partial data from intermediate messages will
produce empty or incorrect results.

---

### 13.5 — Prompt is in `query_str`, not `params.dsl_query`

**What happened:** The initial implementation extracted the prompt from
`body.params.dsl_query` — visible in the request body but a derived/processed field. The
actual user-typed prompt is in `body.query_str` at the top level.

**Perplexity POST body shape** (confirmed):
```json
{
  "query_str": "user typed prompt",       ← USE THIS
  "params": {
    "dsl_query": "processed version",     ← do not use — may differ from original
    "search_focus": "internet",
    ...
  },
  ...
}
```

**Rule:** Always use the field that most directly represents the raw user input. When multiple
candidates exist, prefer the top-level field over a nested/processed equivalent. Verify by
checking that the captured prompt matches exactly what the user typed.

---

### 13.6 — The general principle: investigate with scripts before writing capture code

The pattern that saved the most time across both Claude and Perplexity integrations:

**Write a throwaway diagnostic script → run it in the browser console → read the output → THEN write the code.**

This applies to three things for every new provider:

| Investigation | Script type | What it tells you |
|---|---|---|
| **DOM structure** | DOM probe (Section 13.1) | Input element type, framework, send button selectors |
| **Stream format** | Console SSE logger | Exact field names, which message carries what, completion signal |
| **POST body** | DevTools Network → Request Payload tab | Prompt field name and location |

**Stream logger template** — paste in console before sending a message:
```javascript
const orig = window.fetch.bind(window);
window.fetch = async (...args) => {
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
  const res = await orig(...args);
  if (url.includes('YOUR_ENDPOINT_PATTERN')) {  // ← fill this in
    const clone = res.clone();
    const reader = clone.body.getReader();
    const dec = new TextDecoder();
    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { console.log('[DONE]'); break; }
        console.log(dec.decode(value));
      }
    })();
  }
  return res;
};
console.log('fetch patched — now send a message');
```

**Time budget guideline:** Spend 10–15 minutes running diagnostic scripts before starting to
code. This reliably saves 2–4 hours of iterative debugging. For any integration where the
first attempt fails, the next action should always be "run a diagnostic script", not "adjust
the selector and try again blind."
```
