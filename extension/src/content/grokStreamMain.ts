const MAIN_PATCH_FLAG = "__AI_SEO_GROK_STREAM_PATCHED__";
const XHR_PATCH_FLAG = "__AI_SEO_GROK_XHR_PATCHED__";
const FETCH_WATCHDOG_FLAG = "__AI_SEO_GROK_FETCH_WATCHDOG__";
const DEBUG_PREFIX = "[AI-SEO][GROK-MAIN]";
const BRIDGE_MESSAGE_TYPE = "AI_SEO_MAIN_TO_ISOLATED_BRIDGE";
const APP_CHAT_PATH_RE = /\/rest\/app-chat\//i;
const CONVERSATION_ID_IN_PATH_RE = /\/conversations\/([^/?]+)(?:\/|$)/i;
const CONVERSATION_ID_IN_PAGE_PATH_RE = /\/c\/([^/?]+)(?:\/|$)/i;
const PLACEHOLDER_CONVERSATION_IDS = new Set(["new"]);

const MAX_EMITTED_TURNS = 160;

type StreamEventPayload = {
  kind: "prompt_sent" | "search_queries" | "search_results" | "response_finished";
  chat_provider: "grok";
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

type SessionState = {
  conversationId?: string;
  requestId?: string;
  turnExchangeId?: string;
};

type ParsedConversationApiTarget = {
  conversationId?: string;
  rid?: string;
  normalizedUrl: string;
};

type ResolvePayloadContextResult = {
  state: SessionState;
  prompt: string;
  assistant: Record<string, unknown> | null;
  assistantIsPartial: boolean;
};

declare global {
  interface Window {
    __AI_SEO_GROK_STREAM_PATCHED__?: boolean;
    __AI_SEO_GROK_XHR_PATCHED__?: boolean;
    __AI_SEO_GROK_FETCH_WATCHDOG__?: number;
  }

  interface XMLHttpRequest {
    __AI_SEO_GROK_URL__?: string;
    __AI_SEO_GROK_WATCHED__?: boolean;
  }
}

const emittedTurnKeys = new Set<string>();

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const toArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const sanitizeConversationId = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return PLACEHOLDER_CONVERSATION_IDS.has(value.toLowerCase()) ? undefined : value;
};

const toLowerSender = (value: unknown): string => (toTrimmedString(value) ?? "").toLowerCase();

const normalizeQueryKey = (value: string): string => value.trim().toLowerCase();

function hostFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function parseConversationApiTarget(rawUrl: unknown): ParsedConversationApiTarget | null {
  if (!(typeof rawUrl === "string" || rawUrl instanceof URL)) return null;

  const value = typeof rawUrl === "string" ? rawUrl : rawUrl.toString();
  if (!value) return null;

  try {
    const parsed = new URL(value, window.location.origin);
    if (!APP_CHAT_PATH_RE.test(parsed.pathname)) return null;
    const pageUrl = new URL(window.location.href);

    const conversationIdFromPath = sanitizeConversationId(toTrimmedString(CONVERSATION_ID_IN_PATH_RE.exec(parsed.pathname)?.[1]));
    const conversationIdFromQuery =
      sanitizeConversationId(toTrimmedString(parsed.searchParams.get("conversationId") ?? undefined))
      ?? sanitizeConversationId(toTrimmedString(parsed.searchParams.get("conversation_id") ?? undefined))
      ?? sanitizeConversationId(toTrimmedString(parsed.searchParams.get("cid") ?? undefined));
    const conversationIdFromPage = sanitizeConversationId(toTrimmedString(CONVERSATION_ID_IN_PAGE_PATH_RE.exec(pageUrl.pathname)?.[1]));
    const ridFromRequest = toTrimmedString(parsed.searchParams.get("rid") ?? undefined);
    const ridFromPage = toTrimmedString(pageUrl.searchParams.get("rid") ?? undefined);

    return {
      conversationId: conversationIdFromPath ?? conversationIdFromQuery ?? conversationIdFromPage,
      rid: ridFromRequest ?? ridFromPage,
      normalizedUrl: parsed.toString(),
    };
  } catch {
    return null;
  }
}

function appendJsonRecord(target: Record<string, unknown>[], value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      const row = toRecord(entry);
      if (row) target.push(row);
    });
    return;
  }
  const row = toRecord(value);
  if (row) target.push(row);
}

function parseConcatenatedJsonRecords(raw: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const text = raw.trim();
  if (!text) return records;

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start < 0) {
      if (char === "{" || char === "[") {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        const segment = text.slice(start, index + 1);
        try {
          appendJsonRecord(records, JSON.parse(segment));
        } catch {
          // Continue scanning remaining segments.
        }
        start = -1;
      }
    }
  }

  return records;
}

function parseJsonRecords(raw: string): Record<string, unknown>[] {
  const text = raw.trim();
  if (!text) return [];

  try {
    const parsed: Record<string, unknown>[] = [];
    appendJsonRecord(parsed, JSON.parse(text));
    if (parsed.length) return parsed;
  } catch {
    // Try streaming-style concatenated chunks below.
  }

  const concatenatedRecords = parseConcatenatedJsonRecords(text);
  if (concatenatedRecords.length) {
    return concatenatedRecords;
  }

  const lineRecords: Record<string, unknown>[] = [];
  text.split(/\r?\n/).forEach((line) => {
    const candidate = line.trim();
    if (!candidate) return;
    try {
      appendJsonRecord(lineRecords, JSON.parse(candidate));
    } catch {
      // Ignore malformed lines; caller handles empty results.
    }
  });
  return lineRecords;
}

function collectConversationPayloadCandidates(records: Record<string, unknown>[]): Record<string, unknown>[] {
  const directCandidates: Record<string, unknown>[] = [];
  const assembledResponses: Record<string, unknown>[] = [];
  const responseSeen = new Set<string>();

  let conversationId: string | undefined;
  let rid: string | undefined;

  const pushResponse = (value: unknown) => {
    const row = toRecord(value);
    if (!row) return;

    const sender = toLowerSender(row.sender);
    if (!(sender === "human" || sender === "user" || sender.startsWith("assistant"))) {
      return;
    }

    const responseId = toTrimmedString(row.responseId);
    const createTime = toTrimmedString(row.createTime);
    const messagePreview = toTrimmedString(row.message)?.slice(0, 80);
    const dedupeKey = responseId ?? `${sender}|${createTime ?? ""}|${messagePreview ?? ""}`;
    if (responseSeen.has(dedupeKey)) return;
    responseSeen.add(dedupeKey);
    assembledResponses.push(row);
  };

  records.forEach((record) => {
    if (toArray(record.responses).length) {
      directCandidates.push(record);
    }
    pushResponse(record.userResponse);
    pushResponse(record.modelResponse);

    conversationId =
      sanitizeConversationId(toTrimmedString(record.conversationId))
      ?? conversationId;
    rid = toTrimmedString(record.rid) ?? rid;

    const rootConversation = toRecord(record.conversation);
    if (rootConversation) {
      conversationId =
        sanitizeConversationId(toTrimmedString(rootConversation.conversationId))
        ?? conversationId;
      rid = toTrimmedString(rootConversation.rid) ?? rid;
    }

    const result = toRecord(record.result);
    const envelope = result ?? record;

    const envelopeConversation = toRecord(envelope.conversation);
    if (envelopeConversation) {
      conversationId =
        sanitizeConversationId(toTrimmedString(envelopeConversation.conversationId))
        ?? conversationId;
      rid = toTrimmedString(envelopeConversation.rid) ?? rid;
    }

    const envelopeResponse = toRecord(envelope.response);
    if (!envelopeResponse) return;

    rid = toTrimmedString(envelopeResponse.responseId) ?? rid;
    pushResponse(envelopeResponse);
    pushResponse(envelopeResponse.userResponse);
    pushResponse(envelopeResponse.modelResponse);

    const nestedResponse = toRecord(envelopeResponse.response);
    pushResponse(nestedResponse);
  });

  if (assembledResponses.length) {
    directCandidates.push({
      ...(conversationId ? { conversationId } : {}),
      ...(rid ? { rid } : {}),
      responses: assembledResponses,
    });
  }

  return directCandidates;
}

async function parsePayloadsFromFetchResponse(response: Response): Promise<Record<string, unknown>[]> {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const parsed: Record<string, unknown>[] = [];
        appendJsonRecord(parsed, await response.clone().json());
        if (parsed.length) return parsed;
      } catch {
        // Fall back to parsing the raw text body.
      }
    }

    return parseJsonRecords(await response.clone().text());
  } catch {
    return [];
  }
}

function parsePayloadsFromXhr(xhr: XMLHttpRequest): Record<string, unknown>[] {
  try {
    if (xhr.responseType === "json") {
      const parsed: Record<string, unknown>[] = [];
      appendJsonRecord(parsed, xhr.response);
      return parsed;
    }

    if (xhr.responseType === "" || xhr.responseType === "text") {
      return parseJsonRecords(xhr.responseText ?? "");
    }

    if (typeof xhr.response === "string") {
      return parseJsonRecords(xhr.response);
    }

    return [];
  } catch {
    return [];
  }
}

function emit(
  kind: StreamEventPayload["kind"],
  state: SessionState,
  extras: Omit<StreamEventPayload, "kind" | "chat_provider" | "conversationId" | "requestId" | "turnExchangeId"> = {},
) {
  const payload: StreamEventPayload = {
    kind,
    chat_provider: "grok",
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

function parseToolQueriesFromText(raw: string): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();

  const pushQuery = (value?: string) => {
    if (!value) return;
    const query = value.trim();
    if (!query) return;
    const key = normalizeQueryKey(query);
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(query);
  };

  const toolArgsRegex = /<xai:tool_args><!\[CDATA\[(.*?)\]\]><\/xai:tool_args>/gs;
  let match: RegExpExecArray | null;
  while ((match = toolArgsRegex.exec(raw)) !== null) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      pushQuery(toTrimmedString(parsed.query) ?? toTrimmedString(parsed.q));
      toArray(parsed.queries).forEach((entry) => {
        const row = toRecord(entry);
        pushQuery(toTrimmedString(entry) ?? toTrimmedString(row?.query) ?? toTrimmedString(row?.q));
      });
    } catch {
      // Fallback regex extraction below.
    }
  }

  const fallbackRegex = /"query"\s*:\s*"([^"]+)"/g;
  let fallbackMatch: RegExpExecArray | null;
  while ((fallbackMatch = fallbackRegex.exec(raw)) !== null) {
    pushQuery(fallbackMatch[1]);
  }

  return queries;
}

function normalizeWebResult(value: unknown): { site_name: string; url?: string; title?: string } | null {
  const row = toRecord(value);
  if (!row) return null;

  const url = toTrimmedString(row.url) ?? toTrimmedString(row.link);
  const title = toTrimmedString(row.title) ?? toTrimmedString(row.metadataTitle);
  const siteName = toTrimmedString(row.siteName) ?? hostFromUrl(url) ?? title;
  if (!siteName && !url) return null;

  return {
    site_name: siteName ?? "unknown",
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  };
}

function collectSearchData(assistant: Record<string, unknown>): {
  queries: string[];
  resultGroups: Array<{ site_name: string; url?: string; title?: string }>;
} {
  const queries: string[] = [];
  const querySeen = new Set<string>();
  const results: Array<{ site_name: string; url?: string; title?: string }> = [];
  const resultSeen = new Set<string>();

  const pushQuery = (value?: string) => {
    if (!value) return;
    const normalized = value.trim();
    if (!normalized) return;
    const key = normalizeQueryKey(normalized);
    if (querySeen.has(key)) return;
    querySeen.add(key);
    queries.push(normalized);
  };

  const pushResult = (value: unknown) => {
    const result = normalizeWebResult(value);
    if (!result) return;
    const key = `${result.site_name}|${result.url ?? ""}|${result.title ?? ""}`;
    if (resultSeen.has(key)) return;
    resultSeen.add(key);
    results.push(result);
  };

  const collectResultsArray = (value: unknown) => {
    toArray(value).forEach((entry) => pushResult(entry));
  };

  collectResultsArray(assistant.webSearchResults);
  collectResultsArray(assistant.citedWebSearchResults);
  collectResultsArray(assistant.webpageUrls);

  toArray(assistant.steps).forEach((step) => {
    const stepRow = toRecord(step);
    if (!stepRow) return;

    toArray(stepRow.text).forEach((entry) => {
      const text = toTrimmedString(entry);
      if (!text) return;
      parseToolQueriesFromText(text).forEach((query) => pushQuery(query));
    });

    collectResultsArray(stepRow.webSearchResults);
    collectResultsArray(stepRow.citedWebSearchResults);

    toArray(stepRow.toolUsageResults).forEach((toolUsage) => {
      const usage = toRecord(toolUsage);
      const webSearchResults = toRecord(usage?.webSearchResults);
      collectResultsArray(webSearchResults?.results);
    });
  });

  return { queries, resultGroups: results };
}

function resolvePayloadContext(
  payload: Record<string, unknown>,
  conversationId: string | undefined,
  ridFromRequest: string | undefined,
): ResolvePayloadContextResult {
  const responses = toArray(payload.responses)
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  const assistants = responses.filter((entry) => toLowerSender(entry.sender).startsWith("assistant"));
  const humans = responses.filter((entry) => {
    const sender = toLowerSender(entry.sender);
    return sender === "human" || sender === "user";
  });

  const latestAssistant = assistants.sort((a, b) => {
    const aTime = new Date(toTrimmedString(a.createTime) ?? "").getTime();
    const bTime = new Date(toTrimmedString(b.createTime) ?? "").getTime();
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  })[0] ?? null;

  const parentResponseId = toTrimmedString(latestAssistant?.parentResponseId);
  const parentHuman = parentResponseId
    ? humans.find((entry) => toTrimmedString(entry.responseId) === parentResponseId) ?? null
    : null;

  const latestHuman = humans.sort((a, b) => {
    const aTime = new Date(toTrimmedString(a.createTime) ?? "").getTime();
    const bTime = new Date(toTrimmedString(b.createTime) ?? "").getTime();
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  })[0] ?? null;

  const human = parentHuman ?? latestHuman;
  const prompt = toTrimmedString(human?.message) ?? "";

  const requestId = toTrimmedString(latestAssistant?.responseId) ?? ridFromRequest;
  const turnExchangeId = ridFromRequest ?? requestId;
  const assistantIsPartial = latestAssistant?.partial === true;
  const payloadConversationId =
    sanitizeConversationId(toTrimmedString(payload.conversationId))
    ?? sanitizeConversationId(toTrimmedString(toRecord(payload.conversation)?.conversationId))
    ?? sanitizeConversationId(toTrimmedString(toRecord(toRecord(payload.result)?.conversation)?.conversationId))
    ?? sanitizeConversationId(toTrimmedString(latestAssistant?.conversationId));

  return {
    state: {
      conversationId: payloadConversationId ?? conversationId,
      requestId,
      turnExchangeId,
    },
    prompt,
    assistant: latestAssistant,
    assistantIsPartial,
  };
}

function rememberTurn(turnKey: string): boolean {
  if (emittedTurnKeys.has(turnKey)) return false;
  emittedTurnKeys.add(turnKey);

  if (emittedTurnKeys.size > MAX_EMITTED_TURNS) {
    const first = emittedTurnKeys.values().next().value;
    if (typeof first === "string") {
      emittedTurnKeys.delete(first);
    }
  }

  return true;
}

function processConversationPayload(
  payload: Record<string, unknown>,
  target: ParsedConversationApiTarget,
  source: "fetch" | "xhr",
): void {
  const resolved = resolvePayloadContext(payload, target.conversationId, target.rid);
  const { state, prompt, assistant, assistantIsPartial } = resolved;
  if (!assistant || !state.conversationId || !state.requestId) {
    return;
  }

  if (assistantIsPartial) {
    console.log(DEBUG_PREFIX, `skip partial assistant payload (${source})`, {
      conversationId: state.conversationId,
      requestId: state.requestId,
    });
    return;
  }

  const turnKey = `${state.conversationId}|${state.requestId}|${state.turnExchangeId ?? state.requestId}`;
  if (!rememberTurn(turnKey)) {
    return;
  }

  if (prompt) {
    emit("prompt_sent", state, { prompt });
  }

  const searchData = collectSearchData(assistant);
  if (searchData.queries.length) {
    emit("search_queries", state, { queries: searchData.queries });
  }
  if (searchData.resultGroups.length) {
    emit("search_results", state, { resultGroups: searchData.resultGroups });
  }

  emit("response_finished", state, {
    reason: "status_finished_successfully",
    conversationPayload: payload,
  });
}

function installFetchPatch(): void {
  let currentPatchedFetch: typeof window.fetch | null = null;

  const applyFetchPatch = () => {
    const baseFetch = window.fetch.bind(window);

    const patchedFetch: typeof window.fetch = async (...args) => {
      const rawArg = args[0];
      const rawUrl =
        typeof rawArg === "string"
          ? rawArg
          : rawArg instanceof Request
            ? rawArg.url
            : rawArg instanceof URL
              ? rawArg.href
              : "";

      const target = parseConversationApiTarget(rawUrl);
      const response = await baseFetch(...args);

      if (!target) return response;

      try {
        const payloadRecords = await parsePayloadsFromFetchResponse(response);
        if (!payloadRecords.length) {
          console.warn(DEBUG_PREFIX, "fetch payload parse skipped (no JSON records)", {
            url: target.normalizedUrl,
            status: response.status,
          });
          return response;
        }
        const payloadCandidates = collectConversationPayloadCandidates(payloadRecords);
        payloadCandidates.forEach((payload) => processConversationPayload(payload, target, "fetch"));
      } catch (error) {
        console.warn(DEBUG_PREFIX, "failed to parse Grok fetch payload", error);
      }

      return response;
    };

    currentPatchedFetch = patchedFetch;
    window.fetch = patchedFetch;
  };

  applyFetchPatch();

  if (typeof window[FETCH_WATCHDOG_FLAG] !== "number") {
    window[FETCH_WATCHDOG_FLAG] = window.setInterval(() => {
      if (window.fetch !== currentPatchedFetch) {
        console.log(DEBUG_PREFIX, "window.fetch changed; reapplying patch");
        applyFetchPatch();
      }
    }, 2_000);
  }
}

function installXhrPatch(): void {
  if (window[XHR_PATCH_FLAG]) {
    console.log(DEBUG_PREFIX, "XHR already patched — skipping");
    return;
  }
  window[XHR_PATCH_FLAG] = true;

  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  proto.open = (function (this: XMLHttpRequest, ...args: unknown[]): void {
    const rawUrl = args[1];
    this.__AI_SEO_GROK_URL__ = typeof rawUrl === "string" ? rawUrl : rawUrl instanceof URL ? rawUrl.toString() : undefined;
    this.__AI_SEO_GROK_WATCHED__ = false;
    return (originalOpen as (...openArgs: unknown[]) => void).apply(this, args);
  }) as XMLHttpRequest["open"];

  proto.send = function (...args: Parameters<XMLHttpRequest["send"]>): void {
    const target = parseConversationApiTarget(this.__AI_SEO_GROK_URL__);
    if (target && !this.__AI_SEO_GROK_WATCHED__) {
      this.__AI_SEO_GROK_WATCHED__ = true;
      this.addEventListener("loadend", () => {
        try {
          const payloadRecords = parsePayloadsFromXhr(this);
          if (!payloadRecords.length) return;
          const payloadCandidates = collectConversationPayloadCandidates(payloadRecords);
          payloadCandidates.forEach((payload) => processConversationPayload(payload, target, "xhr"));
        } catch (error) {
          console.warn(DEBUG_PREFIX, "failed to parse Grok XHR payload", error);
        }
      });
    }

    return originalSend.apply(this, args);
  };
}

function installNetworkPatches(): void {
  if (window[MAIN_PATCH_FLAG]) {
    console.log(DEBUG_PREFIX, "network patches already installed — skipping");
    return;
  }
  window[MAIN_PATCH_FLAG] = true;

  installFetchPatch();
  installXhrPatch();
}

console.log(DEBUG_PREFIX, "world:MAIN script executing");
installNetworkPatches();
