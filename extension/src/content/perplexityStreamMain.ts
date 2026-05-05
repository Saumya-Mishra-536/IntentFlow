// ─── Constants ────────────────────────────────────────────────────────────────
//
// Verified against real Perplexity network traffic (Feb 2026):
//   Endpoint   : POST https://www.perplexity.ai/rest/sse/perplexity_ask
//   SSE format : named events — "event: message\ndata: {...}"
//   Prompt     : body.query_str  (top-level, NOT body.params.dsl_query)
//   IDs        : context_uuid (thread), backend_uuid (answer), uuid (frontend)
//   Completion : final_sse_message === true  (status goes PENDING → COMPLETED)
//   Data model : supports both legacy `text` JSON-string step arrays and newer
//                structured payloads with `entries/blocks/related_queries`.

const MAIN_PATCH_FLAG = "__AI_SEO_PERPLEXITY_STREAM_PATCHED__";
const DEBUG_PREFIX = "[AI-SEO][PERPLEXITY-MAIN]";
const BRIDGE_MESSAGE_TYPE = "AI_SEO_MAIN_TO_ISOLATED_BRIDGE";

/**
 * Matches: POST https://www.perplexity.ai/rest/sse/perplexity_ask
 * This is the ONLY streaming endpoint — confirmed from live traffic.
 */
const COMPLETION_URL_RE = /\/rest\/sse\/perplexity_ask(?:\?|$)/;

// ─── Types ────────────────────────────────────────────────────────────────────

type StreamEventPayload = {
    kind: "prompt_sent" | "search_queries" | "search_results" | "response_finished";
    chat_provider: "perplexity";
    provider_chat_id?: string;
    chat_url?: string;
    chat_title?: string;
    conversationId?: string;
    requestId?: string;
    turnExchangeId?: string;
    prompt?: string;
    queries?: string[];
    resultGroups?: unknown[];
    conversationPayload?: unknown;
    reason?: "status_finished_successfully" | "done_marker";
};

/** All mutable state for one in-flight completion stream. */
type SessionState = {
    /** context_uuid — the persistent thread/conversation identifier */
    conversationId: string | undefined;
    /** backend_uuid — the per-answer identifier */
    requestId: string | undefined;
    /** uuid / frontend_uuid — the frontend request identifier */
    turnExchangeId: string | undefined;
    /** User's prompt text, from POST body.query_str */
    promptText: string;
    /** Ensures prompt_sent fires exactly once */
    promptEmitted: boolean;
};

type MinimalPerplexityResult = {
    site_name: string;
    url?: string;
    title?: string;
};

declare global {
    interface Window {
        __AI_SEO_PERPLEXITY_STREAM_PATCHED__?: boolean;
    }
}

// ─── Emit ─────────────────────────────────────────────────────────────────────

function emit(
    kind: StreamEventPayload["kind"],
    state: Pick<SessionState, "conversationId" | "requestId" | "turnExchangeId">,
    extras: Omit<StreamEventPayload, "kind" | "chat_provider" | "conversationId" | "requestId" | "turnExchangeId"> = {},
) {
    const payload: StreamEventPayload = {
        kind,
        chat_provider: "perplexity",
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

// ─── Result normalizer ────────────────────────────────────────────────────────

const toRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const toArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toTrimmedString = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
};

const normalizeQueryKey = (value: string): string => value.trim().toLowerCase();

function hostFromUrl(url?: string): string | undefined {
    if (!url) return undefined;
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return undefined;
    }
}

function normalizeWebResult(value: unknown): MinimalPerplexityResult | null {
    const row = toRecord(value);
    if (!row) return null;

    const url =
        toTrimmedString(row.url) ??
        toTrimmedString(row.link) ??
        toTrimmedString(row.source_url) ??
        toTrimmedString(row.display_url);

    const title =
        toTrimmedString(row.title) ??
        toTrimmedString(row.name) ??
        toTrimmedString(row.headline);

    const meta = toRecord(row.meta_data) ?? {};
    const site_name =
        toTrimmedString(row.site_name) ??
        toTrimmedString(row.domain) ??
        toTrimmedString(meta.domain_name) ??
        hostFromUrl(url) ??
        title;

    if (!site_name && !url) return null;

    return {
        site_name: site_name ?? "unknown",
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
    };
}

function extractPromptFromPayload(value: unknown): string {
    const root = toRecord(value) ?? {};
    const top_prompt = toTrimmedString(root.query_str);
    if (top_prompt) return top_prompt;

    const entries = toArray(root.entries);
    for (const entry of entries) {
        const item = toRecord(entry);
        const prompt = toTrimmedString(item?.query_str);
        if (prompt) return prompt;
    }

    return "";
}

function extractIdsFromPayload(value: unknown): {
    conversationId?: string;
    requestId?: string;
    turnExchangeId?: string;
} {
    const root = toRecord(value) ?? {};
    const entries = toArray(root.entries);
    const first_entry = toRecord(entries[0]);

    const conversationId =
        toTrimmedString(root.context_uuid) ??
        toTrimmedString(first_entry?.context_uuid);
    const requestId =
        toTrimmedString(root.backend_uuid) ??
        toTrimmedString(first_entry?.backend_uuid);
    const turnExchangeId =
        toTrimmedString(root.frontend_uuid) ??
        toTrimmedString(root.uuid) ??
        toTrimmedString(first_entry?.frontend_uuid) ??
        toTrimmedString(first_entry?.uuid);

    return { conversationId, requestId, turnExchangeId };
}

function collectQueriesAndResults(value: unknown): {
    queries: string[];
    resultGroups: MinimalPerplexityResult[];
} {
    const queries: string[] = [];
    const query_seen = new Set<string>();
    const result_rows: MinimalPerplexityResult[] = [];
    const result_seen = new Set<string>();
    const visited = new Set<unknown>();

    const pushQuery = (raw?: string) => {
        if (!raw) return;
        const normalized = raw.trim();
        if (!normalized) return;
        const key = normalizeQueryKey(normalized);
        if (query_seen.has(key)) return;
        query_seen.add(key);
        queries.push(normalized);
    };

    const pushResult = (result: MinimalPerplexityResult | null) => {
        if (!result) return;
        const key = `${result.site_name}|${result.url ?? ""}|${result.title ?? ""}`;
        if (result_seen.has(key)) return;
        result_seen.add(key);
        result_rows.push(result);
    };

    const walk = (current: unknown, depth = 0) => {
        if (depth > 12 || current === null || current === undefined) return;
        if (typeof current !== "object") return;
        if (visited.has(current)) return;
        visited.add(current);

        if (Array.isArray(current)) {
            current.forEach((entry) => walk(entry, depth + 1));
            return;
        }

        const row = toRecord(current);
        if (!row) return;

        pushQuery(
            toTrimmedString(row.query) ??
            toTrimmedString(row.q) ??
            toTrimmedString(row.search_query) ??
            toTrimmedString(row.keyword),
        );

        toArray(row.related_queries).forEach((entry) => {
            const text = toTrimmedString(entry);
            if (text) pushQuery(text);
        });
        toArray(row.related_query_items).forEach((entry) => {
            const item = toRecord(entry);
            const text = toTrimmedString(item?.text);
            if (text) pushQuery(text);
        });

        toArray(row.queries).forEach((entry) => {
            const item = toRecord(entry);
            const text = toTrimmedString(entry) ?? toTrimmedString(item?.query) ?? toTrimmedString(item?.q);
            if (text) pushQuery(text);
        });

        toArray(row.web_results).forEach((entry) => {
            pushResult(normalizeWebResult(entry));
        });

        const single_web_result = normalizeWebResult(row.web_result);
        if (single_web_result) {
            pushResult(single_web_result);
        }

        Object.values(row).forEach((nested) => {
            if (nested && (typeof nested === "object" || Array.isArray(nested))) {
                walk(nested, depth + 1);
            }
        });
    };

    walk(value);
    return { queries, resultGroups: result_rows };
}

// ─── Final-message data extraction ───────────────────────────────────────────
//
// Perplexity has two payload shapes in current traffic:
// 1) Legacy: final SSE object has `text` with a JSON string of step objects.
// 2) Structured: final object contains `entries/blocks/related_queries/...`.
//
// This function handles both and emits the same bridge events.

function extractAndEmitFinalData(obj: Record<string, unknown>, state: SessionState): void {
    const textRaw = obj.text as string | undefined;
    let parsedTextPayload: unknown = null;
    if (typeof textRaw === "string" && textRaw.trim()) {
        try {
            parsedTextPayload = JSON.parse(textRaw);
        } catch {
            console.warn(DEBUG_PREFIX, "failed to parse final `text` JSON; using structured payload only");
        }
    }

    const aggregate = parsedTextPayload ? { parsed_text_payload: parsedTextPayload, response_payload: obj } : obj;
    const collected = collectQueriesAndResults(aggregate);

    if (collected.queries.length) {
        emit("search_queries", state, { queries: collected.queries });
    }
    if (collected.resultGroups.length) {
        emit("search_results", state, { resultGroups: collected.resultGroups });
    }

    const hasStructuredPayload = Array.isArray(obj.entries) || !!toRecord(obj.thread_metadata) || !!toRecord(obj.blocks);
    const conversationPayload =
        hasStructuredPayload
            ? obj
            : parsedTextPayload
                ? parsedTextPayload
                : undefined;

    emit("response_finished", state, {
        reason: "status_finished_successfully",
        ...(conversationPayload !== undefined ? { conversationPayload } : {}),
    });
}

// ─── SSE data-object processing ──────────────────────────────────────────────

function processDataObject(raw: string, state: SessionState): void {
    if (!raw || raw === "[DONE]") return;

    let obj: Record<string, unknown>;
    try {
        obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return; // malformed — skip silently
    }

    // ── Extract IDs (supports both legacy and structured payload shapes) ─────
    const extracted_ids = extractIdsFromPayload(obj);
    if (!state.conversationId && extracted_ids.conversationId) {
        state.conversationId = extracted_ids.conversationId;
    }
    if (!state.requestId && extracted_ids.requestId) {
        state.requestId = extracted_ids.requestId;
    }
    if (!state.turnExchangeId && extracted_ids.turnExchangeId) {
        state.turnExchangeId = extracted_ids.turnExchangeId;
    }

    // ── Emit prompt_sent once IDs are available ──────────────────────────────
    // Also try to grab prompt from stream payload if POST body extraction missed it.
    if (!state.promptText) {
        state.promptText = extractPromptFromPayload(obj);
    }

    if (!state.promptEmitted && state.promptText && state.conversationId) {
        state.promptEmitted = true;
        emit("prompt_sent", state, { prompt: state.promptText });
    }

    // ── Final message: extract all search data ───────────────────────────────
    const status = toTrimmedString(obj.status)?.toLowerCase();
    const has_structured_entries = Array.isArray(obj.entries);
    const is_structured_final = has_structured_entries && (status === "completed" || status === "success" || status === "done");

    if (obj.final_sse_message === true || is_structured_final) {
        extractAndEmitFinalData(obj, state);
        return;
    }
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

    /** Flush one complete SSE event (blank-line boundary). */
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

                // Named event lines (e.g. "event: message") — type info is in data JSON
                if (line.startsWith("event:")) continue;
                // SSE ping/comment lines
                if (line.startsWith(":")) continue;

                if (line.startsWith("data:")) {
                    dataLines.push(line.slice(5).trimStart());
                }
            }
        }
    } catch {
        console.warn(DEBUG_PREFIX, "stream read error");
    }

    // Fallback: if we captured IDs but never saw final_sse_message (e.g. connection dropped)
    if (state.promptEmitted) {
        emit("response_finished", state, { reason: "done_marker" });
    }
}

// ─── Request-body helpers ─────────────────────────────────────────────────────

/**
 * Extracts the prompt from the POST body.
 *
 * Perplexity POST body (confirmed from real traffic):
 *   {
 *     "params": { ..., "dsl_query": "user prompt", ... },
 *     "query_str": "user prompt"   ← use this — top-level, always present
 *   }
 */
function preparePromptExtraction(args: unknown[]): {
    promptText: string;
    bodyClone: Promise<string | null> | null;
} {
    const init = args[1] as RequestInit | undefined;

    // Fast path: plain string body (covers all real-world Perplexity requests)
    if (init && typeof init.body === "string") {
        try {
            const bodyObj = JSON.parse(init.body) as Record<string, unknown>;
            // Primary: top-level query_str
            if (typeof bodyObj.query_str === "string" && bodyObj.query_str.trim()) {
                return { promptText: bodyObj.query_str.trim(), bodyClone: null };
            }
            // Fallback: params.dsl_query
            const params = bodyObj.params as Record<string, unknown> | undefined;
            if (typeof params?.dsl_query === "string" && params.dsl_query.trim()) {
                return { promptText: params.dsl_query.trim(), bodyClone: null };
            }
        } catch {
            // fall through
        }
    }

    // Slow path: Request object
    if (args[0] instanceof Request) {
        const bodyClone = args[0].clone().text().catch(() => null);
        return { promptText: "", bodyClone };
    }

    return { promptText: "", bodyClone: null };
}

async function resolvePromptText(bodyClone: Promise<string | null> | null): Promise<string> {
    if (!bodyClone) return "";
    try {
        const raw = await bodyClone;
        if (!raw) return "";
        const bodyObj = JSON.parse(raw) as Record<string, unknown>;
        if (typeof bodyObj.query_str === "string") return bodyObj.query_str.trim();
        const params = bodyObj.params as Record<string, unknown> | undefined;
        if (typeof params?.dsl_query === "string") return params.dsl_query.trim();
        return "";
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

        const isCompletionRequest = COMPLETION_URL_RE.test(url);

        // Prepare prompt extraction (must clone Request body *before* fetch)
        const { promptText: syncPrompt, bodyClone } = isCompletionRequest
            ? preparePromptExtraction(args)
            : { promptText: "", bodyClone: null };

        // ── Execute the original fetch ────────────────────────────────────────
        const response = await originalFetch(...args);

        if (!isCompletionRequest) return response;

        try {
            // Perplexity SSE uses text/event-stream
            const contentType = response.headers.get("content-type") ?? "";
            const isStream =
                contentType.includes("text/event-stream") ||
                contentType.includes("application/x-ndjson") ||
                contentType.includes("application/octet-stream") ||
                contentType.includes("text/plain");

            if (!isStream || !response.body) {
                console.log(DEBUG_PREFIX, "not a stream response, skipping", { contentType });
                return response;
            }

            const promptText = syncPrompt || (await resolvePromptText(bodyClone));

            const state: SessionState = {
                conversationId: undefined,
                requestId: undefined,
                turnExchangeId: undefined,
                promptText,
                promptEmitted: false,
            };

            console.log(DEBUG_PREFIX, "intercepted completion stream", {
                promptPreview: promptText.slice(0, 60),
                contentType,
            });

            parseStream(response.clone().body!, state).catch(() => {
                console.warn(DEBUG_PREFIX, "stream parse aborted");
            });
        } catch {
            console.warn(DEBUG_PREFIX, "fetch interception setup failed");
        }

        return response;
    };
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

console.log(DEBUG_PREFIX, "world:MAIN script executing");
installFetchPatch();
