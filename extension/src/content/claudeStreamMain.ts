// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_PATCH_FLAG = "__AI_SEO_CLAUDE_STREAM_PATCHED__";
const DEBUG_PREFIX = "[AI-SEO][CLAUDE-MAIN]";
const BRIDGE_MESSAGE_TYPE = "AI_SEO_MAIN_TO_ISOLATED_BRIDGE";

/**
 * Matches Claude chat conversation stream endpoints:
 * - /api/organizations/{org}/chat_conversations/{conv_id}/completion
 * - /api/organizations/{org}/chat_conversations/{conv_id}
 * Capture group 1 = conversation UUID
 */
const COMPLETION_URL_RE =
  /\/api\/organizations\/[^/]+\/chat_conversations\/([^/?]+)(?:\/completion)?(?:\?|$)/;

// ─── Types ────────────────────────────────────────────────────────────────────

type StreamEventPayload = {
  kind: "prompt_sent" | "search_queries" | "search_results" | "response_finished";
  chat_provider: "claude";
  provider_chat_id?: string;
  chat_url?: string;
  chat_title?: string;
  conversationId?: string;
  requestId?: string;
  turnExchangeId?: string;
  prompt?: string;
  queries?: string[];
  resultGroups?: unknown[];
  reason?: "status_finished_successfully" | "done_marker";
};

/**
 * Tracks partial JSON accumulation for a single SSE content block.
 *
 * - "web_search_input"  → tool_use block whose name is "web_search"
 * - "web_search_result" → tool_result block associated with a web_search
 * - "other"             → any other block (text, thinking, …) — ignored
 */
type BlockKind = "web_search_input" | "web_search_result" | "other";

type BlockAccum = {
  kind: BlockKind;
  /** Concatenated input_json_delta fragments — parsed on content_block_stop. */
  json: string;
};

/** All mutable state for one in-flight completion stream. */
type SessionState = {
  conversationId: string | undefined;
  /** Populated from message_start → message.request_id */
  requestId: string | undefined;
  /** Populated from message_start → message.uuid (assistant message UUID) */
  turnExchangeId: string | undefined;
  /** Human prompt text, extracted from the POST request body. */
  promptText: string;
  /** Ensures prompt_sent is emitted exactly once per turn. */
  promptEmitted: boolean;
  /** Active content blocks keyed by their SSE index. */
  blocks: Map<number, BlockAccum>;
};

declare global {
  interface Window {
    __AI_SEO_CLAUDE_STREAM_PATCHED__?: boolean;
  }
}

// ─── Emit ─────────────────────────────────────────────────────────────────────

function emit(
  kind: StreamEventPayload["kind"],
  state: Pick<SessionState, "conversationId" | "requestId" | "turnExchangeId">,
  extras: Omit<
    StreamEventPayload,
    "kind" | "chat_provider" | "conversationId" | "requestId" | "turnExchangeId"
  > = {},
) {
  const payload: StreamEventPayload = {
    kind,
    chat_provider: "claude",
    provider_chat_id: state.conversationId,
    chat_url: window.location.href,
    chat_title: document.title,
    conversationId: state.conversationId,
    requestId: state.requestId,
    turnExchangeId: state.turnExchangeId,
    ...extras,
  };

  console.log(DEBUG_PREFIX, "emit", kind, extras.reason ?? "-", {
    conversationId: payload.conversationId,
    requestId: payload.requestId,
    turnExchangeId: payload.turnExchangeId,
    promptPreview: payload.prompt?.slice(0, 60),
    queryCount: payload.queries?.length ?? 0,
    resultCount: payload.resultGroups?.length ?? 0,
  });

  window.postMessage({ type: BRIDGE_MESSAGE_TYPE, payload }, "*");
}

// ─── SSE data-object processing ──────────────────────────────────────────────

function processDataObject(raw: string, state: SessionState): void {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return; // malformed line — skip silently
  }

  const type = obj.type as string | undefined;

  // ── message_start: extract IDs, then emit prompt_sent ───────────────────
  if (type === "message_start") {
    const msg = (obj.message as Record<string, unknown> | undefined) ?? {};
    state.requestId = (msg.request_id as string | undefined) ?? state.requestId;
    state.turnExchangeId = (msg.uuid as string | undefined) ?? state.turnExchangeId;

    if (!state.promptEmitted && state.promptText) {
      state.promptEmitted = true;
      emit("prompt_sent", state, { prompt: state.promptText });
    }
    return;
  }

  // ── content_block_start: register block by index ─────────────────────────
  if (type === "content_block_start") {
    const index = obj.index as number;
    const block = (obj.content_block as Record<string, unknown> | undefined) ?? {};
    const blockType = block.type as string;

    if (blockType === "tool_use" && block.name === "web_search") {
      state.blocks.set(index, { kind: "web_search_input", json: "" });
    } else if (blockType === "tool_result") {
      state.blocks.set(index, { kind: "web_search_result", json: "" });
    } else {
      state.blocks.set(index, { kind: "other", json: "" });
    }
    return;
  }

  // ── content_block_delta: accumulate JSON fragments ───────────────────────
  if (type === "content_block_delta") {
    const index = obj.index as number;
    const delta = (obj.delta as Record<string, unknown> | undefined) ?? {};
    const deltaType = delta.type as string;
    const block = state.blocks.get(index);

    if (
      deltaType === "input_json_delta" &&
      block &&
      (block.kind === "web_search_input" || block.kind === "web_search_result")
    ) {
      block.json += (delta.partial_json as string) ?? "";
    }
    return;
  }

  // ── content_block_stop: parse + emit ────────────────────────────────────
  if (type === "content_block_stop") {
    const index = obj.index as number;
    const block = state.blocks.get(index);
    if (!block) return;

    if (block.kind === "web_search_input" && block.json) {
      try {
        const parsed = JSON.parse(block.json) as Record<string, unknown>;
        const queryCandidates: string[] = [];
        if (typeof parsed.query === "string" && parsed.query.trim()) {
          queryCandidates.push(parsed.query.trim());
        }
        if (typeof parsed.q === "string" && parsed.q.trim()) {
          queryCandidates.push(parsed.q.trim());
        }
        if (Array.isArray(parsed.queries)) {
          for (const entry of parsed.queries) {
            if (typeof entry === "string" && entry.trim()) {
              queryCandidates.push(entry.trim());
            }
          }
        }
        if (queryCandidates.length) {
          emit("search_queries", state, { queries: Array.from(new Set(queryCandidates)) });
        }
      } catch {
        console.warn(DEBUG_PREFIX, "failed to parse web_search input JSON");
      }
    }

    if (block.kind === "web_search_result" && block.json) {
      try {
        const parsed = JSON.parse(block.json) as unknown;
        const resultGroups = toResultGroups(parsed);
        if (resultGroups.length) {
          emit("search_results", state, { resultGroups });
        }
      } catch {
        console.warn(DEBUG_PREFIX, "failed to parse web_search result JSON");
      }
    }

    state.blocks.delete(index);
    return;
  }

  // ── message_delta: primary completion signal ─────────────────────────────
  if (type === "message_delta") {
    const delta = (obj.delta as Record<string, unknown> | undefined) ?? {};
    const stopReason = delta.stop_reason as string | undefined;
    if (stopReason === "end_turn" || stopReason === "stop_sequence") {
      emit("response_finished", state, { reason: "status_finished_successfully" });
    }
    return;
  }

  // ── message_stop: fallback completion signal ─────────────────────────────
  if (type === "message_stop") {
    // Background deduplication guards against double response_finished.
    emit("response_finished", state, { reason: "done_marker" });
    return;
  }
}

function toResultGroups(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const row = value as Record<string, unknown>;
  const containerCandidates = [
    row.resultGroups,
    row.result_groups,
    row.results,
    row.items,
    row.content,
    row.data,
    row.sources,
  ];
  for (const candidate of containerCandidates) {
    if (Array.isArray(candidate) && candidate.length) {
      return candidate;
    }
  }
  if (typeof row.url === "string" && row.url.trim()) {
    return [row];
  }
  return [];
}

// ─── Stream reader ────────────────────────────────────────────────────────────

async function parseStream(
  body: ReadableStream<Uint8Array>,
  state: SessionState,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let dataLines: string[] = [];

  /** Flush one complete SSE event (blank-line separator). */
  const flushEvent = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    dataLines = [];
    processDataObject(raw, state);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        flushEvent();
        break;
      }

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

        if (!line) {
          flushEvent();
          continue;
        }

        // Named event lines (e.g. "event: message_start") — data line carries type
        if (line.startsWith("event:")) continue;

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
  } catch {
    console.warn(DEBUG_PREFIX, "stream read error");
  }

  // Emit a final fallback if we have IDs but the stream closed without message_stop
  if ((state.requestId || state.turnExchangeId) && !state.blocks.size) {
    emit("response_finished", state, { reason: "done_marker" });
  }
}

// ─── Request-body helpers ─────────────────────────────────────────────────────

function extractConversationId(url: string): string | undefined {
  return COMPLETION_URL_RE.exec(url)?.[1];
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractTextFromContent(value: unknown): string {
  const direct = toText(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (!entry || typeof entry !== "object") return "";
        const row = entry as Record<string, unknown>;
        return toText(row.text) || toText(row.value) || extractTextFromContent(row.content);
      })
      .filter(Boolean);
    if (parts.length) return parts.join("\n").trim();
  }

  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return (
      toText(row.text) ||
      toText(row.value) ||
      toText(row.prompt) ||
      toText(row.query) ||
      extractTextFromContent(row.content)
    );
  }

  return "";
}

function extractPromptFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const role = toText(record.role).toLowerCase();
    if (role && role !== "user" && role !== "human") continue;
    const text =
      extractTextFromContent(record.content) ||
      extractTextFromContent(record.text) ||
      extractTextFromContent(record.message);
    if (text) return text;
  }
  return "";
}

function extractPromptFromBody(bodyObj: Record<string, unknown>): string {
  const direct =
    toText(bodyObj.prompt) ||
    extractTextFromContent(bodyObj.input) ||
    extractTextFromContent(bodyObj.message) ||
    toText(bodyObj.query) ||
    toText(bodyObj.text);
  if (direct) return direct;

  const nestedContainers = [
    bodyObj.completion,
    bodyObj.params,
    bodyObj.data,
    bodyObj.payload,
    bodyObj.input,
  ];
  for (const container of nestedContainers) {
    if (!container || typeof container !== "object") continue;
    const nested = container as Record<string, unknown>;
    const nestedPrompt =
      toText(nested.prompt) ||
      extractTextFromContent(nested.input) ||
      extractTextFromContent(nested.message) ||
      toText(nested.query) ||
      toText(nested.text);
    if (nestedPrompt) return nestedPrompt;
  }

  const messageLists = [
    bodyObj.messages,
    bodyObj.chat_messages,
    bodyObj.input_messages,
    (bodyObj.completion as Record<string, unknown> | undefined)?.messages,
    (bodyObj.data as Record<string, unknown> | undefined)?.messages,
  ];
  for (const list of messageLists) {
    const from_messages = extractPromptFromMessages(list);
    if (from_messages) return from_messages;
  }

  return "";
}

/**
 * Tries to read the human prompt from the fetch init body (sync) or from a
 * cloned Request body (async).  Returns { promptText, bodyClone? }.
 *
 * We must clone the Request *before* calling originalFetch because fetch
 * consumes the body stream.
 */
function preparePromptExtraction(args: unknown[]): {
  promptText: string;
  bodyClone: Promise<string | null> | null;
} {
  // Most common path: fetch(url, { method: "POST", body: jsonString })
  const init = args[1] as RequestInit | undefined;
  if (init && typeof init.body === "string") {
    try {
      const bodyObj = JSON.parse(init.body) as Record<string, unknown>;
      const promptText = extractPromptFromBody(bodyObj);
      if (promptText) return { promptText, bodyClone: null };
    } catch {
      // fall through
    }
  }

  // Less common path: fetch(new Request(url, { body }))
  if (args[0] instanceof Request) {
    const bodyClone = args[0].clone().text().catch(() => null);
    return { promptText: "", bodyClone };
  }

  return { promptText: "", bodyClone: null };
}

async function resolvePromptText(
  bodyClone: Promise<string | null> | null,
): Promise<string> {
  if (!bodyClone) return "";
  try {
    const raw = await bodyClone;
    if (!raw) return "";
    const bodyObj = JSON.parse(raw) as Record<string, unknown>;
    return extractPromptFromBody(bodyObj);
  } catch {
    return "";
  }
}

// ─── Fetch patch ──────────────────────────────────────────────────────────────

function installFetchPatch(): void {
  if (window[MAIN_PATCH_FLAG]) {
    console.log(DEBUG_PREFIX, "fetch already patched — skipping");
    return;
  }
  window[MAIN_PATCH_FLAG] = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args): Promise<Response> => {
    // ── Identify URL ──────────────────────────────────────────────────────
    const rawArg = args[0];
    const url =
      typeof rawArg === "string"
        ? rawArg
        : rawArg instanceof Request
          ? rawArg.url
          : rawArg instanceof URL
            ? rawArg.href
            : "";

    const conversationId = extractConversationId(url);

    // Prepare prompt extraction (must clone Request body *before* fetch)
    const { promptText: syncPrompt, bodyClone } = conversationId
      ? preparePromptExtraction(args)
      : { promptText: "", bodyClone: null };

    // ── Execute the original fetch ────────────────────────────────────────
    const response = await originalFetch(...args);

    // ── Intercept only Claude completion SSE streams ──────────────────────
    if (!conversationId) return response;

    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream") || !response.body) {
        return response;
      }

      // Resolve prompt (may be async if body was a Request object)
      const promptText = syncPrompt || (await resolvePromptText(bodyClone));

      const state: SessionState = {
        conversationId,
        requestId: undefined,
        turnExchangeId: undefined,
        promptText,
        promptEmitted: false,
        blocks: new Map(),
      };

      console.log(DEBUG_PREFIX, "intercepted completion stream", {
        conversationId,
        promptPreview: promptText.slice(0, 60),
      });

      parseStream(response.clone().body!, state).catch(() => {
        console.warn(DEBUG_PREFIX, "stream parse aborted");
      });
    } catch {
      // Never block the original fetch response.
      console.warn(DEBUG_PREFIX, "fetch interception setup failed");
    }

    return response;
  };
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

console.log(DEBUG_PREFIX, "world:MAIN script executing");
installFetchPatch();
