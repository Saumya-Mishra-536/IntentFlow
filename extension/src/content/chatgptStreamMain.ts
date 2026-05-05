const MAIN_PATCH_FLAG = "__AI_SEO_CHATGPT_STREAM_PATCHED__";
const DEBUG_PREFIX = "[AI-SEO][MAIN]";
const MAX_LOG_PREVIEW = 160;

type StreamEventPayload = {
  kind: "prompt_sent" | "search_queries" | "search_results" | "response_finished";
  chat_provider?: "chatgpt";
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
  reason?: "status_finished_successfully" | "message_stream_complete" | "done_marker";
};

type TurnMeta = {
  conversationId?: string;
  requestId?: string;
  turnExchangeId?: string;
};

declare global {
  interface Window {
    __AI_SEO_CHATGPT_STREAM_PATCHED__?: boolean;
  }
}

function emit(payload: StreamEventPayload) {
  const enriched_payload: StreamEventPayload = {
    ...payload,
    chat_provider: "chatgpt",
    provider_chat_id: payload.provider_chat_id ?? payload.conversationId,
    chat_url: payload.chat_url ?? window.location.href,
    chat_title: payload.chat_title ?? document.title,
  };
  console.log(DEBUG_PREFIX, "emit", payload.kind, payload.reason ?? "-", {
    conversationId: enriched_payload.conversationId,
    requestId: enriched_payload.requestId,
    turnExchangeId: enriched_payload.turnExchangeId,
    promptPreview: enriched_payload.prompt?.slice(0, 60),
    promptLength: enriched_payload.prompt?.length ?? 0,
    queryCount: enriched_payload.queries?.length ?? 0,
    resultGroupCount: enriched_payload.resultGroups?.length ?? 0,
  });
  // Use postMessage to cross world boundary (CustomEvents don't cross in MV3)
  window.postMessage({
    type: "AI_SEO_MAIN_TO_ISOLATED_BRIDGE",
    payload: enriched_payload,
  }, "*");
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(DEBUG_PREFIX, "safeParse failed", raw.slice(0, MAX_LOG_PREVIEW));
    return null;
  }
}

function extractTurnMeta(obj: Record<string, unknown>): TurnMeta {
  const value = (obj.v as Record<string, unknown> | undefined) || {};
  const message = (value.message as Record<string, unknown> | undefined) || {};
  const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
  const inputMessage = (obj.input_message as Record<string, unknown> | undefined) || {};
  const inputMetadata = (inputMessage.metadata as Record<string, unknown> | undefined) || {};

  return {
    conversationId: (value.conversation_id as string | undefined) || (obj.conversation_id as string | undefined),
    requestId: (metadata.request_id as string | undefined) || (inputMetadata.request_id as string | undefined),
    turnExchangeId:
      (metadata.turn_exchange_id as string | undefined) || (inputMetadata.turn_exchange_id as string | undefined),
  };
}

function mergeTurnMeta(base: TurnMeta, next: TurnMeta): TurnMeta {
  return {
    conversationId: next.conversationId ?? base.conversationId,
    requestId: next.requestId ?? base.requestId,
    turnExchangeId: next.turnExchangeId ?? base.turnExchangeId,
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function hostFromUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) {
    return undefined;
  }
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function normalizeQueryKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeQueryList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of input) {
    const asRecord = toRecord(entry);
    const text =
      toTrimmedString(entry) ??
      toTrimmedString(asRecord?.q) ??
      toTrimmedString(asRecord?.query);
    if (!text) continue;
    const key = normalizeQueryKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

type MinimalResult = {
  site_name: string;
  url?: string;
  title?: string;
};

type MinimalResultGroup = {
  query: string;
  results: MinimalResult[];
};

function extractCitationGroups(input: unknown): MinimalResultGroup[] {
  const groups = new Map<string, { query: string; results: MinimalResult[]; dedupe: Set<string> }>();
  const MAX_DEPTH = 8;

  const ensureGroup = (query: string) => {
    const key = normalizeQueryKey(query);
    const existing = groups.get(key);
    if (existing) return existing;
    const created = { query, results: [], dedupe: new Set<string>() };
    groups.set(key, created);
    return created;
  };

  const addResult = (query: string, result: MinimalResult) => {
    const group = ensureGroup(query);
    const dedupe = `${result.site_name}|${result.url ?? ""}|${result.title ?? ""}`;
    if (group.dedupe.has(dedupe)) return;
    group.dedupe.add(dedupe);
    group.results.push(result);
  };

  const walk = (value: unknown, queryContext?: string, depth = 0) => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, queryContext, depth + 1));
      return;
    }
    const obj = toRecord(value);
    if (!obj) return;

    const query =
      toTrimmedString(obj.image_search_query) ??
      toTrimmedString(obj.query) ??
      toTrimmedString(obj.search_query) ??
      toTrimmedString(obj.keyword) ??
      toTrimmedString(obj.q) ??
      queryContext ??
      "__unscoped__";

    const url =
      toTrimmedString(obj.url) ??
      toTrimmedString(obj.link) ??
      toTrimmedString(obj.content_url) ??
      toTrimmedString(obj.source_url) ??
      toTrimmedString(obj.display_url);
    const title =
      toTrimmedString(obj.title) ??
      toTrimmedString(obj.headline) ??
      toTrimmedString(obj.heading);
    const site_name =
      toTrimmedString(obj.site_name) ??
      toTrimmedString(obj.domain) ??
      toTrimmedString(obj.source) ??
      hostFromUrl(url);

    if (site_name) {
      addResult(query, {
        site_name,
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
      });
    }

    const safeUrls = Array.isArray(obj.safe_urls) ? obj.safe_urls : [];
    safeUrls.forEach((safe) => {
      const safeUrl = toTrimmedString(safe);
      if (!safeUrl) return;
      const safeHost = hostFromUrl(safeUrl);
      if (!safeHost) return;
      addResult(query, { site_name: safeHost, url: safeUrl });
    });

    Object.values(obj).forEach((nested) => {
      if (nested && (Array.isArray(nested) || typeof nested === "object")) {
        walk(nested, query, depth + 1);
      }
    });
  };

  walk(input);
  return Array.from(groups.values())
    .filter((group) => group.results.length)
    .map((group) => ({ query: group.query, results: group.results.slice(0, 12) }));
}

type ConversationMessageNode = {
  id: string;
  order: number;
  role: string;
  authorName?: string;
  createTime?: number;
  message: Record<string, unknown>;
};

function extractConversationMessages(payload: Record<string, unknown>): ConversationMessageNode[] {
  const mapping = toRecord(payload.mapping);
  if (!mapping) return [];

  const nodes: ConversationMessageNode[] = [];
  Object.entries(mapping).forEach(([id, entry], index) => {
    const node = toRecord(entry);
    if (!node) return;
    const message = toRecord(node.message);
    if (!message) return;
    const author = toRecord(message.author) ?? {};
    const role = toTrimmedString(author.role) ?? "unknown";
    const authorName = toTrimmedString(author.name);
    const createTimeRaw = message.create_time ?? node.create_time;
    const createTime = typeof createTimeRaw === "number" ? createTimeRaw : undefined;
    nodes.push({ id, order: index, role, authorName, createTime, message });
  });
  return nodes;
}

function extractCurrentNodeChainRank(payload: Record<string, unknown>): Map<string, number> {
  const mapping = toRecord(payload.mapping);
  const currentNode = toTrimmedString(payload.current_node);
  if (!mapping || !currentNode) {
    return new Map();
  }

  const rank = new Map<string, number>();
  const seen = new Set<string>();
  let cursor: string | undefined = currentNode;
  let index = 0;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    rank.set(cursor, index);
    index += 1;
    const entry = toRecord(mapping[cursor]);
    cursor = toTrimmedString(entry?.parent);
  }

  return rank;
}

function pickLatestMessage(nodes: ConversationMessageNode[], role: string, payload: Record<string, unknown>): ConversationMessageNode | null {
  const scoped = nodes.filter((node) => node.role === role);
  if (!scoped.length) return null;
  const withCreateTime = scoped.filter((node) => node.createTime !== undefined);
  if (withCreateTime.length) {
    return withCreateTime.sort((a, b) => {
      const aTime = a.createTime ?? -1;
      const bTime = b.createTime ?? -1;
      if (aTime !== bTime) return bTime - aTime;
      return b.order - a.order;
    })[0] ?? null;
  }

  const chainRank = extractCurrentNodeChainRank(payload);
  const chainScoped = scoped
    .map((node) => ({ node, rank: chainRank.get(node.id) }))
    .filter((entry): entry is { node: ConversationMessageNode; rank: number } => entry.rank !== undefined)
    .sort((a, b) => a.rank - b.rank);
  if (chainScoped.length) {
    return chainScoped[0].node;
  }

  return scoped.sort((a, b) => {
    const aTime = a.createTime ?? -1;
    const bTime = b.createTime ?? -1;
    if (aTime !== bTime) return bTime - aTime;
    return b.order - a.order;
  })[0] ?? null;
}

function extractPromptFromConversationMessage(node: ConversationMessageNode | null): string | undefined {
  if (!node) return undefined;
  const content = toRecord(node.message.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  for (const part of parts) {
    const text = toTrimmedString(part);
    if (text) return text;
  }
  return undefined;
}

function extractQueriesFromConversationMessages(nodes: ConversationMessageNode[]): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  nodes
    .filter((node) => node.role === "tool" && node.authorName === "web.run")
    .forEach((node) => {
      const metadata = toRecord(node.message.metadata) ?? {};
      const searchModelQueries = toRecord(metadata.search_model_queries);
      const rawQueries = Array.isArray(searchModelQueries?.queries) ? searchModelQueries.queries : [];
      rawQueries.forEach((rawQuery) => {
        const queryRecord = toRecord(rawQuery);
        const query = toTrimmedString(rawQuery) ?? toTrimmedString(queryRecord?.q) ?? toTrimmedString(queryRecord?.query);
        if (!query) return;
        const key = normalizeQueryKey(query);
        if (seen.has(key)) return;
        seen.add(key);
        queries.push(query);
      });
    });
  return queries;
}

function extractConversationResultGroups(payload: Record<string, unknown>, assistantMetadata: Record<string, unknown> | null, fallbackQuery: string): MinimalResultGroup[] {
  const groups: MinimalResultGroup[] = [];
  if (assistantMetadata) {
    const searchResultGroups = Array.isArray(assistantMetadata.search_result_groups) ? assistantMetadata.search_result_groups : [];
    if (searchResultGroups.length) {
      groups.push(...extractCitationGroups(searchResultGroups));
    }
    const contentReferences = Array.isArray(assistantMetadata.content_references) ? assistantMetadata.content_references : [];
    if (contentReferences.length) {
      groups.push(...extractCitationGroups(contentReferences));
    }
    const safeUrls = Array.isArray(assistantMetadata.safe_urls) ? assistantMetadata.safe_urls : [];
    if (safeUrls.length) {
      groups.push({
        query: fallbackQuery,
        results: safeUrls
          .map((entry) => toTrimmedString(entry))
          .filter((entry): entry is string => Boolean(entry))
          .map((url) => ({
            site_name: hostFromUrl(url) ?? "unknown",
            url,
          })),
      });
    }
  }

  if (!groups.length) {
    const topSafeUrls = Array.isArray(payload.safe_urls) ? payload.safe_urls : [];
    if (topSafeUrls.length) {
      groups.push({
        query: fallbackQuery,
        results: topSafeUrls
          .map((entry) => toTrimmedString(entry))
          .filter((entry): entry is string => Boolean(entry))
          .map((url) => ({
            site_name: hostFromUrl(url) ?? "unknown",
            url,
          })),
      });
    }
  }

  return groups.filter((group) => group.results.length);
}

function emitConversationCapture(payload: Record<string, unknown>) {
  const messages = extractConversationMessages(payload);
  const latestUser = pickLatestMessage(messages, "user", payload);
  const latestAssistant = pickLatestMessage(messages, "assistant", payload);
  const assistantMetadata = latestAssistant ? (toRecord(latestAssistant.message.metadata) ?? null) : null;

  const conversationId =
    toTrimmedString(payload.conversation_id) ??
    toTrimmedString((assistantMetadata ?? {}).conversation_id) ??
    undefined;
  const requestId = toTrimmedString((assistantMetadata ?? {}).request_id);
  const turnExchangeId = toTrimmedString((assistantMetadata ?? {}).turn_exchange_id);
  const prompt = extractPromptFromConversationMessage(latestUser);
  const queries = extractQueriesFromConversationMessages(messages);
  const resultGroups = extractConversationResultGroups(payload, assistantMetadata, queries[0] ?? "__unscoped__");

  if (prompt) {
    emit({
      kind: "prompt_sent",
      conversationId,
      requestId,
      turnExchangeId,
      prompt,
    });
  }
  if (queries.length) {
    emit({
      kind: "search_queries",
      conversationId,
      requestId,
      turnExchangeId,
      queries,
    });
  }
  if (resultGroups.length) {
    emit({
      kind: "search_results",
      conversationId,
      requestId,
      turnExchangeId,
      resultGroups,
      conversationPayload: payload,
    });
  }
  emit({
    kind: "response_finished",
    conversationId,
    requestId,
    turnExchangeId,
    reason: "done_marker",
  });
}

function handleDataObject(obj: Record<string, unknown>, lastTurnMeta: TurnMeta): TurnMeta {
  const currentTurnMeta = mergeTurnMeta(lastTurnMeta, extractTurnMeta(obj));
  const objType = obj.type as string | undefined;
  if (objType && objType !== "message_stream_complete" && objType !== "input_message") {
    console.log(DEBUG_PREFIX, "handleDataObject type", objType);
  }

  if (obj.type === "input_message") {
    const inputMessage = (obj.input_message as Record<string, unknown> | undefined) || {};
    const metadata = (inputMessage.metadata as Record<string, unknown> | undefined) || {};
    const content = (inputMessage.content as Record<string, unknown> | undefined) || {};
    const parts = (content.parts as unknown[]) || [];

    emit({
      kind: "prompt_sent",
      conversationId: obj.conversation_id as string | undefined,
      requestId: metadata.request_id as string | undefined,
      turnExchangeId: metadata.turn_exchange_id as string | undefined,
      prompt: parts.length ? String(parts[0] || "") : "",
    });

    return mergeTurnMeta(currentTurnMeta, {
      conversationId: obj.conversation_id as string | undefined,
      requestId: metadata.request_id as string | undefined,
      turnExchangeId: metadata.turn_exchange_id as string | undefined,
    });
  }

  if (obj.type === "message_stream_complete") {
    emit({
      kind: "response_finished",
      ...currentTurnMeta,
      reason: "message_stream_complete",
    });
    return currentTurnMeta;
  }

  if (obj.p === "/message/status" && obj.v === "finished_successfully") {
    emit({ kind: "response_finished", ...currentTurnMeta, reason: "status_finished_successfully" });
    return currentTurnMeta;
  }

  if (obj.o === "patch" && Array.isArray(obj.v)) {
    const patchCitationGroups: MinimalResultGroup[] = [];
    obj.v.forEach((patch) => {
      const patchObj = patch as Record<string, unknown>;
      if (patchObj.p === "/message/status" && patchObj.v === "finished_successfully") {
        emit({ kind: "response_finished", ...currentTurnMeta, reason: "status_finished_successfully" });
      }
      const patchPath = typeof patchObj.p === "string" ? patchObj.p : "";
      if (patchPath.includes("/message/metadata/content_references") || patchPath.includes("/message/metadata/citations")) {
        patchCitationGroups.push(...extractCitationGroups(patchObj.v));
      }
    });
    if (patchCitationGroups.length) {
      emit({ kind: "search_results", ...currentTurnMeta, resultGroups: patchCitationGroups });
    }
  }

  const value = (obj.v as Record<string, unknown> | undefined) || {};
  const message = (value.message as Record<string, unknown> | undefined) || {};
  const metadata = (message.metadata as Record<string, unknown> | undefined) || {};

  const searchModelQueries = metadata.search_model_queries as Record<string, unknown> | undefined;
  const queries = normalizeQueryList(searchModelQueries?.queries);
  if (queries.length) {
    emit({ kind: "search_queries", ...currentTurnMeta, queries });
  }

  const searchResultGroups = metadata.search_result_groups;
  if (Array.isArray(searchResultGroups) && searchResultGroups.length) {
    emit({ kind: "search_results", ...currentTurnMeta, resultGroups: searchResultGroups });
  }

  const contentReferences = metadata.content_references;
  if (Array.isArray(contentReferences) && contentReferences.length) {
    const groups = extractCitationGroups(contentReferences);
    if (groups.length) {
      emit({ kind: "search_results", ...currentTurnMeta, resultGroups: groups });
    }
  }

  const citations = metadata.citations;
  if (Array.isArray(citations) && citations.length) {
    const groups = extractCitationGroups(citations);
    if (groups.length) {
      emit({ kind: "search_results", ...currentTurnMeta, resultGroups: groups });
    }
  }

  if (Array.isArray(obj.v)) {
    const patchGroupsFromArray = extractCitationGroups(obj.v);
    if (patchGroupsFromArray.length) {
      emit({ kind: "search_results", ...currentTurnMeta, resultGroups: patchGroupsFromArray });
    }

    const hasSearchData = obj.v.some((entry) => {
      const item = entry as Record<string, unknown>;
      return item.type === "search_result_group" || item.type === "search_result";
    });

    if (hasSearchData) {
      emit({ kind: "search_results", ...currentTurnMeta, resultGroups: obj.v });
    }
  }

  if (typeof obj.p === "string" && obj.p.includes("/search_result_groups") && Array.isArray(obj.v) && obj.v.length) {
    emit({ kind: "search_results", ...currentTurnMeta, resultGroups: obj.v });
  }

  return currentTurnMeta;
}

async function parseSseStream(stream: ReadableStream<Uint8Array>) {
  console.log(DEBUG_PREFIX, "parseSseStream start");
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentDataLines: string[] = [];
  let lastTurnMeta: TurnMeta = {};

  const flushEvent = () => {
    if (!currentDataLines.length) {
      return;
    }

    const rawData = currentDataLines.join("\n");
    currentDataLines = [];
    console.log(DEBUG_PREFIX, "flushEvent", {
      bytes: rawData.length,
      preview: rawData.slice(0, MAX_LOG_PREVIEW),
    });

    if (rawData === "[DONE]") {
      console.log(DEBUG_PREFIX, "received [DONE] marker");
      emit({ kind: "response_finished", ...lastTurnMeta, reason: "done_marker" });
      return;
    }

    const parsed = safeParse(rawData);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      lastTurnMeta = handleDataObject(obj, lastTurnMeta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      flushEvent();
      console.log(DEBUG_PREFIX, "stream reader done");
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (!line) {
        flushEvent();
        continue;
      }

      if (line.startsWith("data:")) {
        currentDataLines.push(line.slice(5).trimStart());
      }
    }
  }

  if (lastTurnMeta.conversationId || lastTurnMeta.requestId || lastTurnMeta.turnExchangeId) {
    console.log(DEBUG_PREFIX, "emitting terminal done_marker from stream close", lastTurnMeta);
    emit({
      kind: "response_finished",
      reason: "done_marker",
      ...lastTurnMeta,
    });
  }
}

function installFetchPatch() {
  if (window[MAIN_PATCH_FLAG]) {
    console.log(DEBUG_PREFIX, "fetch already patched");
    return;
  }

  window[MAIN_PATCH_FLAG] = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const request = args[0];
      const url =
        typeof request === "string"
          ? request
          : request instanceof Request
            ? request.url
            : request instanceof URL
              ? request.href
              : "";
      const contentType = response.headers.get("content-type") || "";

      const isConversationGet =
        url.includes("/backend-api/conversation/") &&
        contentType.includes("application/json");
      const isConversationStream =
        contentType.includes("text/event-stream") &&
        !!response.body;

      if (isConversationGet) {
        console.log(DEBUG_PREFIX, "intercepted conversation payload", { url, contentType });
        const cloned = response.clone();
        cloned.json()
          .then((jsonPayload) => {
            const record = toRecord(jsonPayload);
            if (!record) return;
            emitConversationCapture(record);
          })
          .catch(() => {
            console.warn(DEBUG_PREFIX, "failed to parse conversation payload json");
          });
      } else if (isConversationStream && response.body) {
        console.log(DEBUG_PREFIX, "intercepted conversation stream", { url, contentType });
        const cloned = response.clone();
        if (cloned.body) {
          parseSseStream(cloned.body).catch(() => {
            // Ignore parse errors from aborted streams.
            console.warn(DEBUG_PREFIX, "stream parse aborted");
          });
        }
      } else if (contentType.includes("text/event-stream")) {
        console.log(DEBUG_PREFIX, "sse detected without body", { url, contentType });
      }
    } catch {
      // Never block fetch response.
      console.warn(DEBUG_PREFIX, "fetch interception failed");
    }

    return response;
  };
}

console.log(DEBUG_PREFIX, "world:MAIN script executing");
installFetchPatch();
