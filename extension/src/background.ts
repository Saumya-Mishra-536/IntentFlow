import { analytics_api } from './lib/api';
import {
    providerByStreamPortName,
    providerStreamConfigs,
    providerStreamRegistry,
    type SeqProvider,
} from './lib/provider-stream-registry';

chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

type StreamProvider = 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'unknown';

interface StreamEventPayload {
    kind: 'prompt_sent' | 'search_queries' | 'search_results' | 'response_finished';
    chat_provider?: StreamProvider;
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
    reason?: 'status_finished_successfully' | 'message_stream_complete' | 'done_marker';
}

interface PassiveCaptureBuffer {
    chat_provider?: StreamProvider;
    provider_chat_id?: string;
    chat_url?: string;
    chat_title?: string;
    prompt: string;
    queries: string[];
    resultGroups: unknown[];
    conversationPayload?: unknown;
    conversationId?: string;
    requestId?: string;
    turnExchangeId?: string;
    finishReason?: string;
    sourceTabId?: number;
}

interface BridgePromptTask {
    text: string;
    promptId?: string;
    provider: SeqProvider;
    index: number;
}

type ExecutionTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface ExecutionCapture {
    prompt: string;
    sourcePromptId?: string;
    chat_provider?: StreamProvider;
    provider_chat_id?: string;
    chat_url?: string;
    chat_title?: string;
    queries: string[];
    resultGroups: unknown[];
    conversationPayload?: unknown;
    conversationId?: string;
    requestId?: string;
    turnExchangeId?: string;
    finishReason?: string;
}

interface ActiveExecutionTask {
    task: BridgePromptTask;
    status: ExecutionTaskStatus;
    tabId: number | null;
    capture: ExecutionCapture;
    captureResolve: (() => void) | null;
    captureTimeout: ReturnType<typeof setTimeout> | null;
    finishDebounce: ReturnType<typeof setTimeout> | null;
    captureNoStreamTimer: ReturnType<typeof setTimeout> | null;
    captureEventCount: number;
    captureEarlyFailureReason: 'no_stream_events' | null;
}

interface ActiveExecution {
    executionId: string;
    campaignId: string;
    versionId?: string;
    tasks: BridgePromptTask[];
    accessToken: string;
    apiBaseUrl: string;
    ingestInBackground: boolean;
    currentIndex: number | null;
    completedCount: number;
    failedCount: number;
    runningCount: number;
    isCancelled: boolean;
    taskByIndex: Map<number, ActiveExecutionTask>;
    runningTaskIndexByTabId: Map<number, number>;
    pendingIndexesByProvider: Record<SeqProvider, number[]>;
    isFinished: boolean;
}

interface ExecutedPromptPayload {
    id: string;
    text: string;
    provider: StreamProvider;
    status: 'completed' | 'failed';
    lastExecutionAt: string;
    sourcePromptId?: string;
    searchedKeywords: Array<{
        query: string;
        sourceProvider: StreamProvider;
        sourcePromptId?: string;
        firstSeenAt: string;
    }>;
    crawledWebsites: Array<{
        url: string;
        host: string;
        source: string;
        firstSeenAt: string;
    }>;
    placesFound: Array<{
        name: string;
        address?: string;
        rating?: number;
        reviewCount?: number;
        websiteUrl?: string;
        category?: string;
    }>;
}

const DEBUG_PREFIX = '[AI-SEO][BG]';
const REQUEST_BODY_LIMIT_BYTES = 2 * 1024 * 1024; // Mirrors backend default REQUEST_BODY_LIMIT=2mb.
const PROVIDER_INGEST_PAYLOAD_SAFE_BYTES = Math.floor(REQUEST_BODY_LIMIT_BYTES * 0.85);
const NO_STREAM_EVENT_TIMEOUT_MS = 120_000;
const PASSIVE_INGEST_CACHE_STORAGE_KEY = 'ai_seo_passive_ingest_turn_cache_v1';
const PASSIVE_INGEST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSIVE_INGEST_CACHE_MAX_PER_CAMPAIGN = 400;
const providerHostPatterns = Object.fromEntries(
    (Object.keys(providerStreamRegistry) as SeqProvider[]).map((provider) => [provider, providerStreamRegistry[provider].hostPatterns]),
) as Record<SeqProvider, readonly string[]>;
const providerUrls = Object.fromEntries(
    (Object.keys(providerStreamRegistry) as SeqProvider[]).map((provider) => [provider, providerStreamRegistry[provider].appUrl]),
) as Record<SeqProvider, string>;
const recentInjectionByTabId = new Map<number, number>();
const INJECTION_DEBOUNCE_MS = 4_000;

const validateProviderStreamRegistry = () => {
    const seenPorts = new Set<string>();
    providerStreamConfigs.forEach((config) => {
        if (!config.hostPatterns.length) {
            console.warn(DEBUG_PREFIX, 'provider stream config missing host patterns', { provider: config.provider });
        }
        if (seenPorts.has(config.streamPortName)) {
            console.warn(DEBUG_PREFIX, 'provider stream config has duplicate stream port', {
                provider: config.provider,
                streamPortName: config.streamPortName,
            });
        }
        seenPorts.add(config.streamPortName);
    });
};
validateProviderStreamRegistry();

let activeCampaignId: string | null = null;
let activeExecution: ActiveExecution | null = null;
let passiveCaptureBuffer: PassiveCaptureBuffer = { prompt: '', queries: [], resultGroups: [] };
let lastPassiveIngestTurnKey: string | null = null;
const finishedTurnKeys = new Map<string, number>();
let passiveIngestInFlight = false;
let passiveFinishDebounce: ReturnType<typeof setTimeout> | null = null;
let passiveIngestTurnCache: Record<string, Record<string, number>> = {};
let passiveIngestTurnCacheLoadPromise: Promise<void> | null = null;

const toProvider = (value: unknown): SeqProvider => {
    if (typeof value === 'string' && value in providerStreamRegistry) {
        return value as SeqProvider;
    }
    return 'chatgpt';
};

const get_error_message_from_response = async (response: Response): Promise<string> => {
    const content_type = response.headers.get('content-type') ?? '';
    if (content_type.includes('application/json')) {
        try {
            const payload = (await response.json()) as { message?: string; error?: string };
            if (payload?.message) return payload.message;
            if (payload?.error) return payload.error;
        } catch {
            return `Request failed (${response.status})`;
        }
    }
    try {
        const text = (await response.text()).trim();
        if (text) return text.slice(0, 300);
    } catch {
        // Ignore and fall back.
    }
    return `Request failed (${response.status})`;
};

const dedupeStrings = (values: unknown[]): string[] => {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(trimmed);
    }
    return output;
};

const estimateJsonPayloadBytes = (value: unknown): number => {
    try {
        const serialized = JSON.stringify(value);
        if (!serialized) return 0;
        return new TextEncoder().encode(serialized).length;
    } catch {
        return Number.MAX_SAFE_INTEGER;
    }
};

const isPayloadTooLargeError = (error: unknown): boolean => {
    const message = String(error ?? '').toLowerCase();
    return message.includes('413') || message.includes('payload too large') || message.includes('entity too large');
};

const shouldUseProviderConversationIngest = (params: {
    provider: StreamProvider;
    conversationPayload?: unknown;
    conversationId?: string;
    context: 'passive' | 'execution';
}): boolean => {
    if (params.provider === 'unknown') return false;
    if (!params.conversationPayload || !params.conversationId) return false;
    const payloadBytes = estimateJsonPayloadBytes(params.conversationPayload);
    if (payloadBytes >= PROVIDER_INGEST_PAYLOAD_SAFE_BYTES) {
        console.warn(DEBUG_PREFIX, 'provider conversation ingest fallback due payload size', {
            context: params.context,
            provider: params.provider,
            conversationId: params.conversationId,
            payloadBytes,
            thresholdBytes: PROVIDER_INGEST_PAYLOAD_SAFE_BYTES,
        });
        return false;
    }
    return true;
};

const prunePassiveIngestTurnCache = (now = Date.now()) => {
    const campaignIds = Object.keys(passiveIngestTurnCache);
    for (const campaignId of campaignIds) {
        const rows = passiveIngestTurnCache[campaignId] ?? {};
        const filteredEntries = Object.entries(rows)
            .filter(([, seenAt]) => Number.isFinite(seenAt) && now - seenAt <= PASSIVE_INGEST_CACHE_TTL_MS)
            .sort((a, b) => b[1] - a[1])
            .slice(0, PASSIVE_INGEST_CACHE_MAX_PER_CAMPAIGN);

        if (!filteredEntries.length) {
            delete passiveIngestTurnCache[campaignId];
            continue;
        }

        passiveIngestTurnCache[campaignId] = Object.fromEntries(filteredEntries);
    }
};

const ensurePassiveIngestTurnCacheLoaded = async () => {
    if (!passiveIngestTurnCacheLoadPromise) {
        passiveIngestTurnCacheLoadPromise = (async () => {
            try {
                const storage = await chrome.storage.local.get([PASSIVE_INGEST_CACHE_STORAGE_KEY]);
                const raw = storage[PASSIVE_INGEST_CACHE_STORAGE_KEY];
                if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                    passiveIngestTurnCache = raw as Record<string, Record<string, number>>;
                } else {
                    passiveIngestTurnCache = {};
                }
            } catch {
                passiveIngestTurnCache = {};
            }
            prunePassiveIngestTurnCache();
        })();
    }
    await passiveIngestTurnCacheLoadPromise;
};

const hasPassiveTurnBeenIngested = (campaignId: string, key: string): boolean => {
    const rows = passiveIngestTurnCache[campaignId];
    if (!rows) return false;
    const seenAt = rows[key];
    if (!Number.isFinite(seenAt)) return false;
    if (Date.now() - seenAt > PASSIVE_INGEST_CACHE_TTL_MS) return false;
    return true;
};

const markPassiveTurnIngested = async (campaignId: string, key: string): Promise<void> => {
    const now = Date.now();
    const rows = passiveIngestTurnCache[campaignId] ?? {};
    rows[key] = now;
    passiveIngestTurnCache[campaignId] = rows;
    prunePassiveIngestTurnCache(now);
    try {
        await chrome.storage.local.set({ [PASSIVE_INGEST_CACHE_STORAGE_KEY]: passiveIngestTurnCache });
    } catch {
        // Ignore cache write failures; this cache is best-effort.
    }
};

const isImportedPromptFallback = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return normalized === 'imported conversation prompt' || normalized.startsWith('imported conversation prompt ');
};

const turnKey = (payload: Pick<StreamEventPayload, 'conversationId' | 'requestId' | 'turnExchangeId'>): string | null => {
    if (!payload.conversationId || !payload.requestId || !payload.turnExchangeId) {
        return null;
    }
    return `${payload.conversationId}::${payload.requestId}::${payload.turnExchangeId}`;
};

const hasSeenFinishForTurn = (payload: StreamEventPayload): boolean => {
    const key = turnKey(payload);
    if (!key) return false;
    if (finishedTurnKeys.has(key)) return true;
    finishedTurnKeys.set(key, Date.now());
    if (finishedTurnKeys.size > 60) {
        const first = finishedTurnKeys.keys().next().value;
        if (first) finishedTurnKeys.delete(first);
    }
    return false;
};

const resetPassiveCapture = () => {
    if (passiveFinishDebounce) {
        clearTimeout(passiveFinishDebounce);
        passiveFinishDebounce = null;
    }
    passiveCaptureBuffer = { prompt: '', queries: [], resultGroups: [] };
    lastPassiveIngestTurnKey = null;
    finishedTurnKeys.clear();
};

const broadcastWorkflowIngestEvent = (ok: boolean, extra?: { provider?: StreamProvider; prompt?: string; error?: string }) => {
    chrome.runtime.sendMessage({
        type: 'AI_SEO_WORKFLOW_INGESTED',
        ok,
        campaignId: activeCampaignId,
        timestamp: new Date().toISOString(),
        ...(extra?.provider ? { provider: extra.provider } : {}),
        ...(extra?.prompt ? { prompt: extra.prompt } : {}),
        ...(extra?.error ? { error: extra.error } : {}),
    }).catch(() => { });
};

const broadcastWorkflowIngestStarted = (provider: StreamProvider, prompt: string) => {
    chrome.runtime.sendMessage({
        type: 'AI_SEO_WORKFLOW_INGEST_STARTED',
        campaignId: activeCampaignId,
        provider,
        prompt,
        timestamp: new Date().toISOString(),
    }).catch(() => { });
};

const broadcastBridgeEvent = (
    event: 'executionStarted' | 'promptStarted' | 'promptCompleted' | 'promptFailed' | 'executionFinished',
    payload: Record<string, unknown>,
) => {
    chrome.runtime.sendMessage({
        type: 'AI_SEO_BRIDGE_EVENT',
        event,
        payload: {
            ...payload,
            timestamp: new Date().toISOString(),
        },
    }).catch(() => { });
};

async function postIngestPayload(params: {
    accessToken: string;
    apiBaseUrl: string;
    path: string;
    payload: unknown;
}): Promise<unknown> {
    const response = await fetch(`${params.apiBaseUrl}${params.path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${params.accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params.payload),
    });
    if (!response.ok) {
        throw new Error(await get_error_message_from_response(response));
    }
    const text = await response.text();
    if (!text.trim()) return null;
    try {
        const parsed = JSON.parse(text) as { success?: boolean; data?: unknown };
        return parsed?.data ?? null;
    } catch {
        return null;
    }
}

async function getPassiveIngestContext(): Promise<{ accessToken: string; apiBaseUrl: string } | null> {
    try {
        const storage = await chrome.storage.local.get(['ai_seo_access_token', 'ai_seo_api_base_url']);
        const accessToken = typeof storage.ai_seo_access_token === 'string' ? storage.ai_seo_access_token.trim() : '';
        if (!accessToken) return null;
        const apiBase = typeof storage.ai_seo_api_base_url === 'string' ? storage.ai_seo_api_base_url.trim() : '';
        return {
            accessToken,
            apiBaseUrl: (apiBase || 'https://ai-seo-monorepo.onrender.com').replace(/\/+$/, ''),
        };
    } catch {
        return null;
    }
}

async function ingestPassiveCaptureBuffer() {
    if (passiveIngestInFlight) return;
    if (!activeCampaignId) return;
    const prompt = passiveCaptureBuffer.prompt.trim();
    if (!prompt) return;
    if (isImportedPromptFallback(prompt)) return;
    passiveIngestInFlight = true;

    const provider = passiveCaptureBuffer.chat_provider ?? 'unknown';
    const key =
        passiveCaptureBuffer.conversationId && passiveCaptureBuffer.requestId && passiveCaptureBuffer.turnExchangeId
            ? `${provider}::${passiveCaptureBuffer.conversationId}::${passiveCaptureBuffer.requestId}::${passiveCaptureBuffer.turnExchangeId}`
            : null;
    if (key && key === lastPassiveIngestTurnKey) {
        passiveIngestInFlight = false;
        return;
    }

    const ctx = await getPassiveIngestContext();
    if (!ctx) {
        console.warn(DEBUG_PREFIX, 'passive ingest skipped: missing auth context');
        passiveIngestInFlight = false;
        return;
    }

    if (key) {
        await ensurePassiveIngestTurnCacheLoaded();
        if (hasPassiveTurnBeenIngested(activeCampaignId, key)) {
            passiveIngestInFlight = false;
            return;
        }
    }

    const conversation_id = passiveCaptureBuffer.conversationId ?? passiveCaptureBuffer.provider_chat_id ?? `${Date.now()}`;

    if (provider === 'chatgpt') {
        await hydrateChatgptConversationCaptureFromTab(passiveCaptureBuffer.sourceTabId, passiveCaptureBuffer);
    }

    try {
        broadcastWorkflowIngestStarted(provider, prompt);

        const canUseProviderIngest = shouldUseProviderConversationIngest({
            provider,
            conversationPayload: passiveCaptureBuffer.conversationPayload,
            conversationId: passiveCaptureBuffer.conversationId,
            context: 'passive',
        });

        if (canUseProviderIngest) {
            try {
                await postIngestPayload({
                    accessToken: ctx.accessToken,
                    apiBaseUrl: ctx.apiBaseUrl,
                    path: `/api/campaigns/${encodeURIComponent(activeCampaignId)}/providers/${encodeURIComponent(provider)}/conversations/ingest`,
                    payload: {
                        conversationId: passiveCaptureBuffer.conversationId,
                        payload: passiveCaptureBuffer.conversationPayload,
                        prompt,
                        source: 'extension_background_passive',
                    },
                });
            } catch (error) {
                if (!isPayloadTooLargeError(error)) throw error;
                console.warn(DEBUG_PREFIX, 'provider ingest rejected due payload size; retrying with ingest-turn fallback', {
                    provider,
                    conversationId: passiveCaptureBuffer.conversationId,
                });
                await postIngestPayload({
                    accessToken: ctx.accessToken,
                    apiBaseUrl: ctx.apiBaseUrl,
                    path: `/api/campaigns/${encodeURIComponent(activeCampaignId)}/capture/ingest-turn`,
                    payload: {
                        conversation_id,
                        chat_provider: provider,
                        provider_chat_id: passiveCaptureBuffer.provider_chat_id,
                        chat_url: passiveCaptureBuffer.chat_url,
                        chat_title: passiveCaptureBuffer.chat_title,
                        request_id: passiveCaptureBuffer.requestId,
                        turn_exchange_id: passiveCaptureBuffer.turnExchangeId,
                        prompt,
                        finished_reason: passiveCaptureBuffer.finishReason,
                        queries: passiveCaptureBuffer.queries,
                        result_groups: passiveCaptureBuffer.resultGroups,
                        metadata: {
                            source: 'extension_background_passive',
                        },
                    },
                });
            }
        } else {
            await postIngestPayload({
                accessToken: ctx.accessToken,
                apiBaseUrl: ctx.apiBaseUrl,
                path: `/api/campaigns/${encodeURIComponent(activeCampaignId)}/capture/ingest-turn`,
                payload: {
                    conversation_id,
                    chat_provider: provider,
                    provider_chat_id: passiveCaptureBuffer.provider_chat_id,
                    chat_url: passiveCaptureBuffer.chat_url,
                    chat_title: passiveCaptureBuffer.chat_title,
                    request_id: passiveCaptureBuffer.requestId,
                    turn_exchange_id: passiveCaptureBuffer.turnExchangeId,
                    prompt,
                    finished_reason: passiveCaptureBuffer.finishReason,
                    queries: passiveCaptureBuffer.queries,
                    result_groups: passiveCaptureBuffer.resultGroups,
                    metadata: {
                        source: 'extension_background_passive',
                    },
                },
            });
        }

        if (key) lastPassiveIngestTurnKey = key;
        if (key) await markPassiveTurnIngested(activeCampaignId, key);
        broadcastWorkflowIngestEvent(true, { provider, prompt });
    } catch (error) {
        broadcastWorkflowIngestEvent(false, {
            provider,
            prompt,
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        passiveIngestInFlight = false;
    }
}

async function ingestCaptureForExecution(exec: ActiveExecution, task_state: ActiveExecutionTask): Promise<ExecutedPromptPayload | null> {
    const capture = task_state.capture;
    const task = task_state.task;
    if (!capture.prompt.trim() || isImportedPromptFallback(capture.prompt)) {
        throw new Error('Skipped ingest because resolved prompt text is missing.');
    }
    const provider = capture.chat_provider ?? task.provider;
    const conversation_id = capture.conversationId ?? capture.provider_chat_id ?? `${exec.executionId}:${task.index}`;

    const canUseProviderIngest = shouldUseProviderConversationIngest({
        provider,
        conversationPayload: capture.conversationPayload,
        conversationId: capture.conversationId,
        context: 'execution',
    });

    if (canUseProviderIngest) {
        try {
            const result = await postIngestPayload({
                accessToken: exec.accessToken,
                apiBaseUrl: exec.apiBaseUrl,
                path: `/api/campaigns/${encodeURIComponent(exec.campaignId)}/providers/${encodeURIComponent(provider)}/conversations/ingest${exec.versionId ? `?version_id=${encodeURIComponent(exec.versionId)}` : ''}`,
                payload: {
                    conversationId: capture.conversationId,
                    payload: capture.conversationPayload,
                    prompt: capture.prompt,
                    source: 'extension_background_seq',
                    ...(capture.sourcePromptId ? { sourcePromptId: capture.sourcePromptId } : {}),
                    ...(exec.versionId ? { promptVersionId: exec.versionId } : {}),
                },
            });
            const record = result && typeof result === 'object' ? (result as { executedPrompt?: ExecutedPromptPayload | null }) : null;
            return record?.executedPrompt ?? null;
        } catch (error) {
            if (!isPayloadTooLargeError(error)) {
                throw error;
            }
            console.warn(DEBUG_PREFIX, 'provider ingest rejected due payload size; using ingest-turn fallback', {
                provider,
                conversationId: capture.conversationId,
            });
        }
    }

    const result = await postIngestPayload({
        accessToken: exec.accessToken,
        apiBaseUrl: exec.apiBaseUrl,
        path: `/api/campaigns/${encodeURIComponent(exec.campaignId)}/capture/ingest-turn${exec.versionId ? `?version_id=${encodeURIComponent(exec.versionId)}` : ''}`,
        payload: {
            conversation_id,
            chat_provider: provider,
            provider_chat_id: capture.provider_chat_id,
            chat_url: capture.chat_url,
            chat_title: capture.chat_title,
            request_id: capture.requestId,
            turn_exchange_id: capture.turnExchangeId,
            prompt: capture.prompt,
            finished_reason: capture.finishReason,
            queries: capture.queries,
            result_groups: capture.resultGroups,
            metadata: {
                source: 'extension_background_seq',
                execution_id: exec.executionId,
                prompt_index: task.index,
                ...(capture.sourcePromptId ? { source_prompt_id: capture.sourcePromptId } : {}),
            },
        },
    });
    const record = result && typeof result === 'object' ? (result as { executedPrompt?: ExecutedPromptPayload | null }) : null;
    return record?.executedPrompt ?? null;
}

const recentlyInjected = (tabId: number): boolean => {
    const now = Date.now();
    const last = recentInjectionByTabId.get(tabId) ?? 0;
    recentInjectionByTabId.set(tabId, now);
    return now - last < INJECTION_DEBOUNCE_MS;
};

const extractChatgptConversationIdFromUrl = (rawUrl?: string): string | undefined => {
    if (!rawUrl) return undefined;
    try {
        const parsed = new URL(rawUrl);
        const match = parsed.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
        const value = match?.[1]?.trim();
        return value ? value : undefined;
    } catch {
        return undefined;
    }
};

async function resolveChatgptConversationIdFromTab(tabId: number): Promise<string | undefined> {
    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => window.location.href,
        });
        const href = typeof result?.result === 'string' ? result.result : undefined;
        return extractChatgptConversationIdFromUrl(href);
    } catch {
        return undefined;
    }
}

const isHttpUrl = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const hasChatgptWebsiteSignals = (payload: unknown): boolean => {
    const root = asRecord(payload);
    if (!root) return false;
    const topSafeUrls = Array.isArray(root.safe_urls) ? root.safe_urls : [];
    if (topSafeUrls.some((entry) => isHttpUrl(entry))) return true;

    const mapping = asRecord(root.mapping);
    if (!mapping) return false;
    for (const nodeValue of Object.values(mapping)) {
        const node = asRecord(nodeValue);
        const message = asRecord(node?.message);
        const author = asRecord(message?.author);
        if ((author?.role as string | undefined) !== 'assistant') continue;
        const metadata = asRecord(message?.metadata);
        if (!metadata) continue;

        const safeUrls = Array.isArray(metadata.safe_urls) ? metadata.safe_urls : [];
        if (safeUrls.some((entry) => isHttpUrl(entry))) return true;

        const groups = Array.isArray(metadata.search_result_groups) ? metadata.search_result_groups : [];
        for (const group of groups) {
            const groupRecord = asRecord(group);
            const entries = Array.isArray(groupRecord?.entries) ? groupRecord.entries : [];
            for (const entry of entries) {
                const entryRecord = asRecord(entry);
                if (isHttpUrl(entryRecord?.url)) return true;
            }
        }

        const refs = Array.isArray(metadata.content_references) ? metadata.content_references : [];
        for (const ref of refs) {
            const refRecord = asRecord(ref);
            if ((refRecord?.type as string | undefined) !== 'grouped_webpages') continue;
            const items = Array.isArray(refRecord?.items) ? refRecord.items : [];
            for (const item of items) {
                const itemRecord = asRecord(item);
                if (isHttpUrl(itemRecord?.url)) return true;
                const supporting = Array.isArray(itemRecord?.supporting_websites) ? itemRecord.supporting_websites : [];
                for (const site of supporting) {
                    const siteRecord = asRecord(site);
                    if (isHttpUrl(siteRecord?.url)) return true;
                }
            }
        }
    }
    return false;
};

async function fetchChatgptConversationPayloadFromTab(
    tabId: number,
    conversationId: string,
): Promise<unknown | null> {
    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (id: string) => {
                try {
                    const response = await fetch(`/backend-api/conversation/${encodeURIComponent(id)}`, {
                        method: 'GET',
                        credentials: 'include',
                    });
                    if (!response.ok) return null;
                    return await response.json();
                } catch {
                    return null;
                }
            },
            args: [conversationId],
        });
        return result?.result ?? null;
    } catch {
        return null;
    }
}

async function hydrateChatgptConversationCaptureFromTab(
    tabId: number | undefined,
    capture: {
        conversationId?: string;
        chat_url?: string;
        provider_chat_id?: string;
        queries: string[];
        conversationPayload?: unknown;
    },
): Promise<void> {
    if (tabId === undefined) return;

    let resolved_conversation_id =
        capture.conversationId ??
        extractChatgptConversationIdFromUrl(capture.chat_url) ??
        capture.provider_chat_id;

    if (!resolved_conversation_id) {
        const idDelays = [0, 500, 1000, 1500, 2200, 3000];
        for (const delay of idDelays) {
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
            resolved_conversation_id = await resolveChatgptConversationIdFromTab(tabId);
            if (resolved_conversation_id) break;
        }
    }

    if (!resolved_conversation_id) return;

    const should_wait_for_website_signals = capture.queries.length > 0;
    const existing_has_website_signals = hasChatgptWebsiteSignals(capture.conversationPayload);
    const fetchDelays =
        should_wait_for_website_signals && !existing_has_website_signals
            ? [0, 500, 900, 1400, 2000, 2800]
            : [0];

    let latest_payload = capture.conversationPayload ?? null;
    for (const delay of fetchDelays) {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        const payload = await fetchChatgptConversationPayloadFromTab(tabId, resolved_conversation_id);
        if (!payload) continue;
        latest_payload = payload;
        if (!should_wait_for_website_signals || hasChatgptWebsiteSignals(payload)) break;
    }

    capture.conversationId = resolved_conversation_id;
    if (latest_payload) {
        capture.conversationPayload = latest_payload;
    }
}

const matchesUrl = (url: string | undefined, patterns: readonly string[]): boolean => {
    if (!url) return false;
    return patterns.some((pattern) => {
        const prefix = pattern.replace('*', '');
        return url.startsWith(prefix);
    });
};

const detectProviderFromUrl = (url: string | undefined): SeqProvider | null => {
    for (const config of providerStreamConfigs) {
        if (matchesUrl(url, config.hostPatterns)) {
            return config.provider;
        }
    }
    return null;
};

async function getActiveTabProvider(): Promise<SeqProvider | null> {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return detectProviderFromUrl(tab?.url);
    } catch {
        return null;
    }
}

async function injectScriptsByPattern(tabId: number, mainPattern: string, contentPattern: string): Promise<boolean> {
    try {
        const manifest = chrome.runtime.getManifest();
        const scripts = (manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []);
        const mainFiles = scripts.filter((file) => file.includes(mainPattern));
        const contentFiles = scripts.filter((file) => file.includes(contentPattern));

        if (mainFiles.length) {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: mainFiles,
                world: 'MAIN',
            });
        }
        if (contentFiles.length) {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: contentFiles,
            });
        }

        return true;
    } catch (error) {
        console.warn(DEBUG_PREFIX, 'failed to inject scripts', { tabId, error });
        return false;
    }
}

async function injectProviderListenersIntoTab(tabId: number, provider: SeqProvider): Promise<boolean> {
    const config = providerStreamRegistry[provider];
    return injectScriptsByPattern(tabId, config.mainScriptPattern, config.contentScriptPattern);
}

async function ensureProviderListeners(provider: SeqProvider) {
    const urlPatterns = providerHostPatterns[provider];
    const tabs = await chrome.tabs.query({ url: [...urlPatterns] });
    let injected = 0;
    for (const tab of tabs) {
        if (!tab.id) continue;
        const ok = await injectProviderListenersIntoTab(tab.id, provider);
        if (ok) injected += 1;
    }
    return { attempted: tabs.length, injected };
}

async function ensureAllProviderListeners() {
    const entries = await Promise.all(
        (Object.keys(providerStreamRegistry) as SeqProvider[]).map(async (provider) => {
            const payload = await ensureProviderListeners(provider);
            return [provider, payload] as const;
        }),
    );
    return Object.fromEntries(entries) as Record<SeqProvider, { attempted: number; injected: number }>;
}

async function maybeInjectListenersForTab(tabId: number, url?: string) {
    if (recentlyInjected(tabId)) return;
    const provider = detectProviderFromUrl(url);
    if (!provider) return;
    await injectProviderListenersIntoTab(tabId, provider);
}

async function waitForTabLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.onRemoved.removeListener(onRemoved);
            clearTimeout(timeoutId);
            resolve();
        };
        const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
            if (updatedTabId === tabId && info.status === 'complete') finish();
        };
        const onRemoved = (removedTabId: number) => {
            if (removedTabId === tabId) finish();
        };
        const timeoutId = setTimeout(finish, timeoutMs);
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.onRemoved.addListener(onRemoved);
    });
}

async function executePromptInTab(tabId: number, prompt: string, provider: SeqProvider): Promise<boolean> {
    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (promptText: string, activeProvider: SeqProvider) => {
                const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

                const clickNewChat = () => {
                    const controls = Array.from(document.querySelectorAll<HTMLElement>('button,a'));
                    const entry = controls.find((el) => {
                        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                        const text = (el.textContent || '').toLowerCase().trim();
                        return (
                            aria.includes('new chat')
                            || aria.includes('new conversation')
                            || aria.includes('new thread')
                            || text === 'new chat'
                            || text === 'new conversation'
                            || text === 'new thread'
                        );
                    });
                    entry?.click();
                };

                const getComposer = () => {
                    if (activeProvider === 'claude') {
                        return (
                            (document.querySelector("div[contenteditable='true'][data-slate-editor='true']") as HTMLDivElement | null)
                            || (document.querySelector("div[contenteditable='true'][role='textbox']") as HTMLDivElement | null)
                            || (document.querySelector("div[contenteditable='true']") as HTMLDivElement | null)
                        );
                    }
                    if (activeProvider === 'perplexity') {
                        return (
                            (document.querySelector('div#ask-input') as HTMLDivElement | null)
                            || (document.querySelector("div[data-lexical-editor='true']") as HTMLDivElement | null)
                            || (document.querySelector("div[contenteditable='true'][role='textbox']") as HTMLDivElement | null)
                        );
                    }
                    if (activeProvider === 'grok') {
                        return (
                            (document.querySelector("textarea[placeholder*='Ask']") as HTMLTextAreaElement | null)
                            || (document.querySelector("textarea[placeholder*='Message']") as HTMLTextAreaElement | null)
                            || (document.querySelector("textarea[data-testid*='composer']") as HTMLTextAreaElement | null)
                            || (document.querySelector("div[contenteditable='true'][role='textbox']") as HTMLDivElement | null)
                            || (document.querySelector("div[contenteditable='true']") as HTMLDivElement | null)
                        );
                    }
                    return (
                        (document.querySelector("textarea[data-id='root']") as HTMLTextAreaElement | null)
                        || (document.querySelector('textarea#prompt-textarea') as HTMLTextAreaElement | null)
                        || (document.querySelector("div#prompt-textarea[contenteditable='true']") as HTMLDivElement | null)
                    );
                };

                const getSendButton = () => {
                    if (activeProvider === 'claude') {
                        return (
                            (document.querySelector("button[aria-label*='Send']") as HTMLButtonElement | null)
                            || (document.querySelector("button[data-testid='send-message-button']") as HTMLButtonElement | null)
                        );
                    }
                    if (activeProvider === 'grok') {
                        return (
                            (document.querySelector("button[aria-label*='Send']") as HTMLButtonElement | null)
                            || (document.querySelector("button[data-testid*='send']") as HTMLButtonElement | null)
                            || (document.querySelector("button[type='submit']") as HTMLButtonElement | null)
                        );
                    }
                    return (
                        (document.querySelector("button[data-testid='send-button']") as HTMLButtonElement | null)
                        || (document.querySelector("button[aria-label*='Send']") as HTMLButtonElement | null)
                    );
                };

                clickNewChat();
                await sleep(350);

                for (let attempt = 0; attempt < 50; attempt += 1) {
                    const composer = getComposer();
                    if (!composer) {
                        await sleep(200);
                        continue;
                    }

                    composer.focus();
                    await sleep(80);

                    if (activeProvider === 'perplexity') {
                        document.execCommand('selectAll', false);
                        document.execCommand('insertText', false, promptText);
                        await sleep(300);
                        composer.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true,
                        }));
                        await sleep(200);
                        const composerNow = getComposer();
                        const cleared = !composerNow || composerNow.textContent?.trim() === '';
                        if (cleared) return true;
                        continue;
                    }

                    if (composer instanceof HTMLTextAreaElement) {
                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                        nativeSetter?.call(composer, promptText);
                        composer.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        composer.textContent = promptText;
                        composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: promptText }));
                    }

                    await sleep(160);

                    const sendButton = getSendButton();
                    if (sendButton && !sendButton.disabled) {
                        sendButton.click();
                        return true;
                    }

                    if (activeProvider === 'grok') {
                        composer.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true,
                        }));
                        await sleep(180);

                        const composerNow = getComposer();
                        if (composerNow instanceof HTMLTextAreaElement) {
                            if (!composerNow.value.trim()) return true;
                        } else if (!composerNow || !composerNow.textContent?.trim()) {
                            return true;
                        }
                    }
                }

                return false;
            },
            args: [prompt, provider],
        });
        return Boolean(result?.result);
    } catch (error) {
        console.warn(DEBUG_PREFIX, 'executePromptInTab failed', { tabId, error });
        return false;
    }
}

const createExecutionCapture = (task: BridgePromptTask): ExecutionCapture => ({
    prompt: task.text,
    ...(task.promptId ? { sourcePromptId: task.promptId } : {}),
    chat_provider: task.provider,
    queries: [],
    resultGroups: [],
});

const clearExecutionTaskTimers = (task_state: ActiveExecutionTask) => {
    if (task_state.finishDebounce) {
        clearTimeout(task_state.finishDebounce);
        task_state.finishDebounce = null;
    }
    if (task_state.captureNoStreamTimer) {
        clearTimeout(task_state.captureNoStreamTimer);
        task_state.captureNoStreamTimer = null;
    }
    if (task_state.captureTimeout) {
        clearTimeout(task_state.captureTimeout);
        task_state.captureTimeout = null;
    }
};

const resolveExecutionTaskCapture = (task_state: ActiveExecutionTask) => {
    clearExecutionTaskTimers(task_state);
    if (task_state.captureResolve) {
        const resolve = task_state.captureResolve;
        task_state.captureResolve = null;
        resolve();
    }
};

const resetExecutionTaskForRun = (task_state: ActiveExecutionTask) => {
    clearExecutionTaskTimers(task_state);
    task_state.capture = createExecutionCapture(task_state.task);
    task_state.captureEventCount = 0;
    task_state.captureEarlyFailureReason = null;
    task_state.captureResolve = null;
};

const getExecutionCurrentIndex = (exec: ActiveExecution): number | null => {
    let running_min: number | null = null;
    let pending_min: number | null = null;
    for (const task_state of exec.taskByIndex.values()) {
        if (task_state.status === 'running') {
            running_min = running_min === null ? task_state.task.index : Math.min(running_min, task_state.task.index);
            continue;
        }
        if (task_state.status === 'pending') {
            pending_min = pending_min === null ? task_state.task.index : Math.min(pending_min, task_state.task.index);
        }
    }
    return running_min ?? pending_min;
};

const updateExecutionCurrentIndex = (exec: ActiveExecution) => {
    exec.currentIndex = getExecutionCurrentIndex(exec);
};

const buildPendingIndexesByProvider = (tasks: BridgePromptTask[]): Record<SeqProvider, number[]> => {
    const pending_by_provider = Object.fromEntries(
        (Object.keys(providerStreamRegistry) as SeqProvider[]).map((provider) => [provider, [] as number[]]),
    ) as Record<SeqProvider, number[]>;
    for (const task of tasks) {
        pending_by_provider[task.provider].push(task.index);
    }
    return pending_by_provider;
};

const finalizeExecution = (exec: ActiveExecution, reason: 'completed' | 'cancelled' | 'runtime_error', error?: string) => {
    if (exec.isFinished) return;
    exec.isFinished = true;

    for (const task_state of exec.taskByIndex.values()) {
        clearExecutionTaskTimers(task_state);
        task_state.captureResolve = null;
        if (task_state.tabId !== null) {
            exec.runningTaskIndexByTabId.delete(task_state.tabId);
            task_state.tabId = null;
        }
        if (task_state.status === 'running') {
            task_state.status = 'failed';
            exec.failedCount += 1;
            exec.runningCount = Math.max(0, exec.runningCount - 1);
        }
    }

    updateExecutionCurrentIndex(exec);
    broadcastBridgeEvent('executionFinished', {
        executionId: exec.executionId,
        successCount: exec.completedCount,
        failedCount: exec.failedCount,
        totalCount: exec.tasks.length,
        reason,
        ...(error ? { error } : {}),
    });
    if (activeExecution?.executionId === exec.executionId) {
        activeExecution = null;
    }
};

async function runExecutionTask(exec: ActiveExecution, task_state: ActiveExecutionTask) {
    const task = task_state.task;
    task_state.status = 'running';
    exec.runningCount += 1;
    updateExecutionCurrentIndex(exec);
    broadcastBridgeEvent('promptStarted', {
        executionId: exec.executionId,
        promptIndex: task.index,
        provider: task.provider,
        prompt: task.text,
    });
    console.log(DEBUG_PREFIX, 'execution task started', {
        executionId: exec.executionId,
        provider: task.provider,
        promptIndex: task.index,
    });

    let tabId: number | null = null;
    try {
        const tab = await chrome.tabs.create({ url: providerUrls[task.provider], active: false });
        tabId = tab.id ?? null;
        if (!tabId) {
            throw new Error('Could not create provider tab');
        }
        task_state.tabId = tabId;
        exec.runningTaskIndexByTabId.set(tabId, task.index);
        resetExecutionTaskForRun(task_state);

        await waitForTabLoad(tabId);
        await injectProviderListenersIntoTab(tabId, task.provider);

        const fired = await executePromptInTab(tabId, task.text, task.provider);
        if (!fired) {
            throw new Error('Failed to send prompt. Provider UI was not ready.');
        }

        task_state.captureNoStreamTimer = setTimeout(() => {
            if (!activeExecution || activeExecution.executionId !== exec.executionId) return;
            if (task_state.captureEventCount > 0) return;
            task_state.captureEarlyFailureReason = 'no_stream_events';
            resolveExecutionTaskCapture(task_state);
        }, NO_STREAM_EVENT_TIMEOUT_MS);

        await new Promise<void>((resolve) => {
            task_state.captureResolve = resolve;
            task_state.captureTimeout = setTimeout(() => {
                task_state.captureResolve = null;
                task_state.captureTimeout = null;
                resolve();
            }, 120_000);
        });

        if (task_state.captureEarlyFailureReason === 'no_stream_events') {
            throw new Error(`Capture failed: no_stream_events (no provider stream events within ${NO_STREAM_EVENT_TIMEOUT_MS / 1000}s).`);
        }

        const hasPrompt = Boolean(task_state.capture.prompt?.trim());
        if (!hasPrompt) {
            throw new Error('Capture timed out before prompt metadata was detected.');
        }

        if (task.provider === 'chatgpt') {
            await hydrateChatgptConversationCaptureFromTab(tabId, task_state.capture);
        }

        const hasCaptureFacts = Boolean(
            task_state.capture.conversationPayload ||
            task_state.capture.conversationId ||
            task_state.capture.provider_chat_id ||
            task_state.capture.requestId ||
            task_state.capture.turnExchangeId ||
            task_state.capture.queries.length > 0 ||
            task_state.capture.resultGroups.length > 0,
        );
        if (!hasCaptureFacts) {
            throw new Error('Capture timed out before stream facts were detected.');
        }

        if (exec.ingestInBackground) {
            broadcastWorkflowIngestStarted(task_state.capture.chat_provider ?? task.provider, task_state.capture.prompt);
            const ingested_prompt = await ingestCaptureForExecution(exec, task_state);
            broadcastWorkflowIngestEvent(true, {
                provider: task_state.capture.chat_provider ?? task.provider,
                prompt: task_state.capture.prompt,
            });
            broadcastBridgeEvent('promptCompleted', {
                executionId: exec.executionId,
                promptIndex: task.index,
                provider: task.provider,
                ...(ingested_prompt ? { ingestedExecutedPrompt: ingested_prompt } : {}),
            });
        } else {
            broadcastBridgeEvent('promptCompleted', {
                executionId: exec.executionId,
                promptIndex: task.index,
                provider: task.provider,
            });
        }
        task_state.status = 'completed';
        exec.completedCount += 1;
    } catch (error) {
        if (exec.ingestInBackground && task_state.capture.prompt.trim()) {
            broadcastWorkflowIngestEvent(false, {
                provider: task_state.capture.chat_provider ?? task.provider,
                prompt: task_state.capture.prompt,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        broadcastBridgeEvent('promptFailed', {
            executionId: exec.executionId,
            promptIndex: task.index,
            provider: task.provider,
            error: error instanceof Error ? error.message : String(error),
        });
        task_state.status = 'failed';
        exec.failedCount += 1;
    } finally {
        clearExecutionTaskTimers(task_state);
        task_state.captureResolve = null;
        if (tabId !== null) {
            exec.runningTaskIndexByTabId.delete(tabId);
            chrome.tabs.remove(tabId).catch(() => { });
        }
        task_state.tabId = null;
        exec.runningCount = Math.max(0, exec.runningCount - 1);
        updateExecutionCurrentIndex(exec);
        console.log(DEBUG_PREFIX, 'execution task finished', {
            executionId: exec.executionId,
            provider: task.provider,
            promptIndex: task.index,
            status: task_state.status,
        });
    }
}

async function runProviderWorker(exec: ActiveExecution, provider: SeqProvider) {
    const pending_indexes = exec.pendingIndexesByProvider[provider];
    if (!pending_indexes.length) return;

    console.log(DEBUG_PREFIX, 'provider worker started', {
        executionId: exec.executionId,
        provider,
        queueSize: pending_indexes.length,
    });
    while (pending_indexes.length > 0) {
        if (exec.isCancelled) break;
        const next_index = pending_indexes.shift();
        if (next_index === undefined) break;
        const task_state = exec.taskByIndex.get(next_index);
        if (!task_state) {
            console.warn(DEBUG_PREFIX, 'provider worker missing task state', {
                executionId: exec.executionId,
                provider,
                promptIndex: next_index,
            });
            continue;
        }
        if (task_state.status !== 'pending') continue;
        await runExecutionTask(exec, task_state);
    }
    console.log(DEBUG_PREFIX, 'provider worker drained', {
        executionId: exec.executionId,
        provider,
    });
}

async function runExecution(exec: ActiveExecution) {
    broadcastBridgeEvent('executionStarted', {
        executionId: exec.executionId,
        campaignId: exec.campaignId,
        totalCount: exec.tasks.length,
    });

    const workers = (Object.keys(exec.pendingIndexesByProvider) as SeqProvider[])
        .filter((provider) => exec.pendingIndexesByProvider[provider].length > 0)
        .map((provider) => runProviderWorker(exec, provider));
    try {
        await Promise.all(workers);
        finalizeExecution(exec, exec.isCancelled ? 'cancelled' : 'completed');
    } catch (error) {
        console.warn(DEBUG_PREFIX, 'runExecution error', error);
        finalizeExecution(exec, 'runtime_error', error instanceof Error ? error.message : String(error));
    }
}

function handleStreamEvent(rawPayload: StreamEventPayload, senderTabId?: number) {
    const payload: StreamEventPayload = {
        ...rawPayload,
        chat_provider: rawPayload.chat_provider ?? 'unknown',
    };

    if (payload.kind === 'response_finished' && hasSeenFinishForTurn(payload)) {
        return;
    }

    if (activeExecution && senderTabId !== undefined) {
        const running_task_index = activeExecution.runningTaskIndexByTabId.get(senderTabId);
        if (running_task_index !== undefined) {
            const running_task = activeExecution.taskByIndex.get(running_task_index);
            if (!running_task) {
                console.warn(DEBUG_PREFIX, 'stream event routed to missing execution task', {
                    executionId: activeExecution.executionId,
                    senderTabId,
                    promptIndex: running_task_index,
                });
                return;
            }
            running_task.captureEventCount += 1;
            if (running_task.captureNoStreamTimer) {
                clearTimeout(running_task.captureNoStreamTimer);
                running_task.captureNoStreamTimer = null;
            }
            if (payload.conversationPayload !== undefined) {
                running_task.capture.conversationPayload = payload.conversationPayload;
            }
            if (payload.kind === 'prompt_sent') {
                if (payload.prompt?.trim()) running_task.capture.prompt = payload.prompt.trim();
                running_task.capture.chat_provider = payload.chat_provider ?? running_task.capture.chat_provider;
                running_task.capture.provider_chat_id = payload.provider_chat_id ?? running_task.capture.provider_chat_id;
                running_task.capture.chat_url = payload.chat_url ?? running_task.capture.chat_url;
                running_task.capture.chat_title = payload.chat_title ?? running_task.capture.chat_title;
                running_task.capture.conversationId = payload.conversationId ?? running_task.capture.conversationId;
                running_task.capture.requestId = payload.requestId ?? running_task.capture.requestId;
                running_task.capture.turnExchangeId = payload.turnExchangeId ?? running_task.capture.turnExchangeId;
                return;
            }
            if (payload.kind === 'search_queries' && payload.queries?.length) {
                running_task.capture.queries = dedupeStrings([...running_task.capture.queries, ...payload.queries]);
                running_task.capture.chat_provider = payload.chat_provider ?? running_task.capture.chat_provider;
                running_task.capture.provider_chat_id = payload.provider_chat_id ?? running_task.capture.provider_chat_id;
                running_task.capture.chat_url = payload.chat_url ?? running_task.capture.chat_url;
                running_task.capture.chat_title = payload.chat_title ?? running_task.capture.chat_title;
                return;
            }
            if (payload.kind === 'search_results' && payload.resultGroups?.length) {
                running_task.capture.resultGroups = [...running_task.capture.resultGroups, ...payload.resultGroups];
                running_task.capture.chat_provider = payload.chat_provider ?? running_task.capture.chat_provider;
                running_task.capture.provider_chat_id = payload.provider_chat_id ?? running_task.capture.provider_chat_id;
                running_task.capture.chat_url = payload.chat_url ?? running_task.capture.chat_url;
                running_task.capture.chat_title = payload.chat_title ?? running_task.capture.chat_title;
                return;
            }
            if (payload.kind === 'response_finished') {
                running_task.capture.finishReason = payload.reason;
                running_task.capture.chat_provider = payload.chat_provider ?? running_task.capture.chat_provider;
                running_task.capture.provider_chat_id = payload.provider_chat_id ?? running_task.capture.provider_chat_id;
                running_task.capture.chat_url = payload.chat_url ?? running_task.capture.chat_url;
                running_task.capture.chat_title = payload.chat_title ?? running_task.capture.chat_title;
                running_task.capture.conversationId = payload.conversationId ?? running_task.capture.conversationId;
                running_task.capture.requestId = payload.requestId ?? running_task.capture.requestId;
                running_task.capture.turnExchangeId = payload.turnExchangeId ?? running_task.capture.turnExchangeId;
                if (running_task.finishDebounce) {
                    clearTimeout(running_task.finishDebounce);
                }
                running_task.finishDebounce = setTimeout(() => {
                    resolveExecutionTaskCapture(running_task);
                }, payload.reason === 'done_marker' ? 2500 : 1500);
            }
            return;
        }

        if (payload.kind === 'prompt_sent' && activeExecution.runningCount > 0) {
            console.warn(DEBUG_PREFIX, 'stream event did not match a running execution tab; treating as passive', {
                executionId: activeExecution.executionId,
                senderTabId,
                provider: payload.chat_provider ?? 'unknown',
            });
        }
    }

    if (payload.kind === 'prompt_sent') {
        if (passiveFinishDebounce) {
            clearTimeout(passiveFinishDebounce);
            passiveFinishDebounce = null;
        }
        passiveCaptureBuffer = {
            chat_provider: payload.chat_provider,
            provider_chat_id: payload.provider_chat_id,
            chat_url: payload.chat_url,
            chat_title: payload.chat_title,
            prompt: payload.prompt?.trim() ?? '',
            queries: [],
            resultGroups: [],
            conversationPayload: payload.conversationPayload,
            conversationId: payload.conversationId,
            requestId: payload.requestId,
            turnExchangeId: payload.turnExchangeId,
            ...(senderTabId !== undefined ? { sourceTabId: senderTabId } : {}),
        };
        return;
    }

    passiveCaptureBuffer = {
        ...passiveCaptureBuffer,
        chat_provider: payload.chat_provider ?? passiveCaptureBuffer.chat_provider,
        provider_chat_id: payload.provider_chat_id ?? passiveCaptureBuffer.provider_chat_id,
        chat_url: payload.chat_url ?? passiveCaptureBuffer.chat_url,
        chat_title: payload.chat_title ?? passiveCaptureBuffer.chat_title,
        conversationId: payload.conversationId ?? passiveCaptureBuffer.conversationId,
        requestId: payload.requestId ?? passiveCaptureBuffer.requestId,
        turnExchangeId: payload.turnExchangeId ?? passiveCaptureBuffer.turnExchangeId,
        ...(payload.conversationPayload !== undefined ? { conversationPayload: payload.conversationPayload } : {}),
        ...(senderTabId !== undefined ? { sourceTabId: senderTabId } : {}),
    };

    if (payload.kind === 'search_queries' && payload.queries?.length) {
        passiveCaptureBuffer.queries = dedupeStrings([...passiveCaptureBuffer.queries, ...payload.queries]);
        return;
    }
    if (payload.kind === 'search_results' && payload.resultGroups?.length) {
        passiveCaptureBuffer.resultGroups = [...passiveCaptureBuffer.resultGroups, ...payload.resultGroups];
        return;
    }
    if (payload.kind === 'response_finished') {
        passiveCaptureBuffer.finishReason = payload.reason;
        if (passiveFinishDebounce) {
            clearTimeout(passiveFinishDebounce);
        }
        passiveFinishDebounce = setTimeout(() => {
            passiveFinishDebounce = null;
            void ingestPassiveCaptureBuffer();
        }, payload.reason === 'done_marker' ? 2500 : 1500);
    }
}

function startExecutionFromMessage(message: {
    executionId?: string;
    campaignId?: string;
    versionId?: string;
    provider?: unknown;
    prompts?: unknown[];
    accessToken?: string;
    apiBaseUrl?: string;
    ingestInBackground?: boolean;
}): { ok: boolean; error?: string } {
    if (activeExecution && !activeExecution.isCancelled) {
        return { ok: false, error: 'Execution already in progress' };
    }

    const fallbackProvider = toProvider(message.provider);
    const prompts = Array.isArray(message.prompts) ? message.prompts : [];
    const tasks: BridgePromptTask[] = prompts
        .map((entry, index) => {
            const row = entry as { text?: unknown; prompt?: unknown; promptId?: unknown; provider?: unknown };
            const text = String(row.text ?? row.prompt ?? '').trim();
            if (!text) return null;
            return {
                text,
                ...(typeof row.promptId === 'string' && row.promptId.trim() ? { promptId: row.promptId.trim() } : {}),
                provider: toProvider(row.provider ?? fallbackProvider),
                index,
            } satisfies BridgePromptTask;
        })
        .filter((row): row is BridgePromptTask => Boolean(row));

    if (!tasks.length) {
        return { ok: false, error: 'No valid prompts to execute' };
    }

    const accessToken = typeof message.accessToken === 'string' ? message.accessToken.trim() : '';
    if (!accessToken) {
        return { ok: false, error: 'Missing access token for bridge execution' };
    }

    const task_states: ActiveExecutionTask[] = tasks.map((task) => ({
        task,
        status: 'pending',
        tabId: null,
        capture: createExecutionCapture(task),
        captureResolve: null,
        captureTimeout: null,
        finishDebounce: null,
        captureNoStreamTimer: null,
        captureEventCount: 0,
        captureEarlyFailureReason: null,
    }));
    const task_by_index = new Map<number, ActiveExecutionTask>(
        task_states.map((task_state) => [task_state.task.index, task_state]),
    );

    const exec: ActiveExecution = {
        executionId: typeof message.executionId === 'string' && message.executionId.trim() ? message.executionId.trim() : crypto.randomUUID(),
        campaignId: typeof message.campaignId === 'string' && message.campaignId.trim() ? message.campaignId.trim() : activeCampaignId ?? 'unknown',
        versionId: typeof message.versionId === 'string' && message.versionId.trim() ? message.versionId.trim() : undefined,
        tasks,
        accessToken,
        apiBaseUrl: (typeof message.apiBaseUrl === 'string' && message.apiBaseUrl.trim() ? message.apiBaseUrl.trim() : 'https://ai-seo-monorepo.onrender.com').replace(/\/+$/, ''),
        ingestInBackground: message.ingestInBackground !== false,
        currentIndex: null,
        completedCount: 0,
        failedCount: 0,
        runningCount: 0,
        isCancelled: false,
        taskByIndex: task_by_index,
        runningTaskIndexByTabId: new Map<number, number>(),
        pendingIndexesByProvider: buildPendingIndexesByProvider(tasks),
        isFinished: false,
    };
    updateExecutionCurrentIndex(exec);

    activeExecution = exec;
    void runExecution(exec);

    return { ok: true };
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        analytics_api.track_event({
            event_name: 'extension_installed',
            properties: { version: chrome.runtime.getManifest().version },
        }).catch((error) => {
            console.error(DEBUG_PREFIX, 'failed to track install', error);
        });
    }

    if (details.reason === 'install' || details.reason === 'update') {
        ensureAllProviderListeners().catch((error) => {
            console.warn(DEBUG_PREFIX, 'onInstalled listener ensure failed', error);
        });
    }
});

chrome.runtime.onStartup.addListener(() => {
    ensureAllProviderListeners().catch((error) => {
        console.warn(DEBUG_PREFIX, 'onStartup listener ensure failed', error);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    void maybeInjectListenersForTab(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId).then((tab) => {
        void maybeInjectListenersForTab(tabId, tab.url);
    }).catch(() => {
        // Ignore failures.
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (!activeExecution) return;
    const running_task_index = activeExecution.runningTaskIndexByTabId.get(tabId);
    if (running_task_index === undefined) return;
    const running_task = activeExecution.taskByIndex.get(running_task_index);
    if (running_task) {
        resolveExecutionTaskCapture(running_task);
    }
    activeExecution.runningTaskIndexByTabId.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'AI_SEO_SET_ACTIVE_CAMPAIGN') {
        activeCampaignId = typeof message.campaignId === 'string' && message.campaignId.trim() ? message.campaignId.trim() : null;
        resetPassiveCapture();
        sendResponse({ ok: true });
        return true;
    }

    if (message?.type === 'AI_SEO_START_LISTENING') {
        resetPassiveCapture();
        ensureAllProviderListeners()
            .then((listeners) => sendResponse({ ok: true, listeners }))
            .catch((error) => sendResponse({ ok: false, error: String(error) }));
        return true;
    }

    if (message?.type === 'AI_SEO_BRIDGE_GET_STATUS') {
        void (async () => {
            const active_tab_provider = await getActiveTabProvider();
            const current_index = activeExecution ? getExecutionCurrentIndex(activeExecution) : null;
            sendResponse({
                ok: true,
                connected: true,
                activeCampaignId,
                isExecuting: Boolean(activeExecution && !activeExecution.isCancelled),
                executionId: activeExecution?.executionId ?? null,
                currentIndex: current_index,
                totalCount: activeExecution?.tasks.length ?? 0,
                runningCount: activeExecution?.runningCount ?? 0,
                completedCount: activeExecution?.completedCount ?? 0,
                failedCount: activeExecution?.failedCount ?? 0,
                activeTabProvider: active_tab_provider,
            });
        })();
        return true;
    }

    if (message?.type === 'AI_SEO_BRIDGE_REFRESH_CONVERSATION') {
        resetPassiveCapture();
        ensureAllProviderListeners()
            .then((listeners) => sendResponse({ ok: true, listeners }))
            .catch((error) => sendResponse({ ok: false, error: String(error) }));
        return true;
    }

    if (message?.type === 'AI_SEO_BRIDGE_EXECUTE_PROMPTS') {
        const result = startExecutionFromMessage({
            executionId: message.executionId as string | undefined,
            campaignId: message.campaignId as string | undefined,
            versionId: message.versionId as string | undefined,
            provider: message.provider,
            prompts: message.prompts as unknown[] | undefined,
            accessToken: message.accessToken as string | undefined,
            apiBaseUrl: message.apiBaseUrl as string | undefined,
            ingestInBackground: message.ingestInBackground as boolean | undefined,
        });
        sendResponse(result);
        return true;
    }

    if (message?.type === 'AI_SEO_CHATGPT_EVENT' && !message?.forwarded) {
        handleStreamEvent(message.payload as StreamEventPayload, sender.tab?.id);
        sendResponse({ ok: true });
        return true;
    }

    return undefined;
});

chrome.runtime.onConnect.addListener((port) => {
    if (!port.name.endsWith('-stream')) return;

    const expectedProvider = providerByStreamPortName.get(port.name);
    if (!expectedProvider) {
        console.warn(DEBUG_PREFIX, 'unknown stream port connection rejected', {
            portName: port.name,
            tabId: port.sender?.tab?.id,
        });
        return;
    }

    port.onMessage.addListener((message: { type?: string; payload?: StreamEventPayload }) => {
        if (message?.type !== 'AI_SEO_CHATGPT_EVENT' || !message.payload) return;
        const eventProvider = message.payload.chat_provider;
        if (eventProvider && eventProvider !== 'unknown' && eventProvider !== expectedProvider) {
            console.warn(DEBUG_PREFIX, 'stream provider mismatch for port', {
                portName: port.name,
                expectedProvider,
                eventProvider,
                tabId: port.sender?.tab?.id,
            });
        }
        handleStreamEvent(message.payload, port.sender?.tab?.id);
    });
});
