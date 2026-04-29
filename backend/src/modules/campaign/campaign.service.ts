import { CampaignRepository, campaignRepository } from './campaign.repository';
import {
    CreateCampaignDto,
    UpdateCampaignDto,
    IngestTurnDto,
    LinkChatThreadDto,
    RefreshNodeDto,
    ConversationIngestDto,
    ManualPromptDto,
    SelectPromptCandidatesDto,
    ExecutePromptDto,
    SiteTopQueriesDto,
} from './dto/campaign.dto';
import { prisma } from '../../utils/prisma';
import { NodeType, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AHREFS_URL, GEMINI_API_KEY, SEMRUSH_URL } from '../../config/env';
import { SemrushSiteInput } from '../../queue/semrush.types';
import { leadIntelligenceService } from '../lead-intelligence/lead-intelligence.service';
import { fetch_semrush_site_insights } from '../../queue/workers/semrush.client';
import { fetch_ahrefs_site_insights } from '../../queue/workers/ahrefs.client';
import {
    normalize_conversation_payload,
    NormalizedConversationData,
    PromptCandidateItem,
    KeywordQueryItem,
    CrawledWebsiteItem,
    PlaceFoundItem,
} from './conversation-normalizer';

type StreamEventType = 'prompt_sent' | 'search_queries' | 'search_results' | 'response_finished';
type StreamProvider = 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'unknown';
type AnalyticsRange = '7d' | '30d' | 'all';

interface MaterializedSite {
    site_name: string;
    url?: string;
    title?: string;
    result_ref: string;
    first_seen_seq: number;
}

interface MaterializedSubquery {
    query_key: string;
    label: string;
    subquery_ref: string;
    first_seen_seq: number;
    sites: MaterializedSite[];
}

type NodeRefreshStatus = 'idle' | 'queued' | 'running' | 'failed' | 'done';

interface CanonicalNodeMetadata {
    source?: string;
    prompt_ref?: string;
    subquery_ref?: string;
    result_ref?: string;
    query_key?: string;
    url?: string;
    domain?: string;
    citation_title?: string;
    lineage: {
        capture_turn_id?: string;
        origin_provider?: string;
        origin_request_id?: string;
        source_version_id?: string;
    };
    refresh: {
        refreshable: boolean;
        refresh_count: number;
        refresh_status: NodeRefreshStatus;
        last_refreshed_at?: string;
        last_refresh_run_id?: string;
        refresh_provider?: string;
        refresh_source_version_id?: string;
    };
    ui: {
        display_label?: string;
        is_unmapped?: boolean;
        is_system?: boolean;
    };
}

interface NormalizedTurnEvent {
    capture_turn_id: string;
    provider: StreamProvider;
    provider_conversation_id: string;
    provider_request_id?: string;
    provider_turn_id: string;
    seq: number;
    event_type: StreamEventType;
    source_ref: string;
    payload: Record<string, unknown>;
    occurred_at: string;
}

const MAX_QUERY_COUNT = 20;
const MAX_SITES_PER_QUERY = 8;
const MAX_UNSCOPED_SITES = 4;
const MAX_PROMPT_LENGTH = 8000;
const MAX_QUERY_LENGTH = 240;
const MAX_SITE_NAME_LENGTH = 200;
const MAX_URL_LENGTH = 1200;
const MAX_TITLE_LENGTH = 300;
const SITE_KEYWORD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const IMPORTED_PROMPT_FALLBACK = 'Imported conversation prompt';
const DAY_MS = 24 * 60 * 60 * 1000;

type PromptCandidateStatus = 'new' | 'fired' | 'running' | 'failed';

interface PromptCandidateResponse extends PromptCandidateItem {
    node_id: string;
}

interface ExecutedPromptResponse {
    id: string;
    text: string;
    provider: StreamProvider;
    status: 'completed' | 'failed';
    lastExecutionAt: string;
    sourcePromptId?: string;
    searchedKeywords: KeywordQueryItem[];
    crawledWebsites: CrawledWebsiteItem[];
    placesFound: PlaceFoundItem[];
}

interface WorkflowStatePayload {
    version: {
        id: string;
        version_number: number;
        is_active: boolean;
        status: string;
        label: string | null;
        created_at: Date;
        archived_at: Date | null;
    } | null;
    promptCandidates: PromptCandidateResponse[];
    executedPrompts: ExecutedPromptResponse[];
    searchedKeywords: KeywordQueryItem[];
    crawledWebsites: CrawledWebsiteItem[];
    placesFound: PlaceFoundItem[];
    warnings: string[];
    versionMeta: {
        versionDate?: string;
        lastExecutionDate?: string;
        provider: StreamProvider;
        conversationId: string;
    };
}

const to_record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const to_array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const get_string = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
};

const to_day_key = (date: Date): string => date.toISOString().slice(0, 10);

const range_start_for = (range: AnalyticsRange): Date | null => {
    if (range === 'all') return null;
    const days = range === '7d' ? 7 : 30;
    return new Date(Date.now() - days * DAY_MS);
};

const is_in_range = (value: string | undefined, start: Date | null): boolean => {
    if (!value) return false;
    if (!start) return true;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return date.getTime() >= start.getTime();
};

const freshness_bucket_for = (value?: string | null): 'pending' | '0_24h' | '1_3d' | '3_7d' | '7d_plus' => {
    if (!value) return 'pending';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'pending';
    const age = Date.now() - date.getTime();
    if (age <= DAY_MS) return '0_24h';
    if (age <= 3 * DAY_MS) return '1_3d';
    if (age <= 7 * DAY_MS) return '3_7d';
    return '7d_plus';
};

const to_number = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};

const normalize_query_key = (query: string): string => query.trim().toLowerCase();

const clamp = (value: string, max: number): string => value.slice(0, max);

const normalize_prompt = (value: string): string => clamp(value.trim(), MAX_PROMPT_LENGTH);

const normalize_query = (value: string): string => clamp(value.trim(), MAX_QUERY_LENGTH);

const normalize_site_name = (value: string): string => clamp(value.trim(), MAX_SITE_NAME_LENGTH);

const normalize_url = (value: string): string => clamp(value.trim(), MAX_URL_LENGTH);

const normalize_title = (value: string): string => clamp(value.trim(), MAX_TITLE_LENGTH);

const is_http_url = (value: string): boolean => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const canonicalize_url = (value?: string): string | undefined => {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (!is_http_url(trimmed)) return undefined;
    try {
        const parsed = new URL(trimmed);
        parsed.hash = '';
        const keys_to_delete: string[] = [];
        parsed.searchParams.forEach((_value, key) => {
            const lowered = key.toLowerCase();
            if (
                lowered.startsWith('utm_') ||
                lowered === 'gclid' ||
                lowered === 'fbclid' ||
                lowered === 'igshid'
            ) {
                keys_to_delete.push(key);
            }
        });
        keys_to_delete.forEach((key) => parsed.searchParams.delete(key));
        const normalized = parsed.toString();
        const without_trailing = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
        return normalize_url(without_trailing);
    } catch {
        return normalize_url(trimmed);
    }
};

const is_internal_site_name = (value: string): boolean => {
    const key = normalize_text_key(value);
    if (!key) return true;
    if (['default', 'unknown', 'null', 'undefined', 'sonic_tool', 'tool', 'styles'].includes(key)) return true;
    if (key.startsWith('mapbox.') || key.includes('mapbox')) return true;
    return false;
};

const infer_site_name_from_url = (url?: string): string | undefined => {
    if (!url) return undefined;
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return undefined;
    }
};

const normalize_text_key = (value: string): string => value.trim().toLowerCase();

const deterministic_hash = (...parts: Array<string | number | undefined>): string => {
    const normalized = parts
        .map((part) => (part === undefined ? '' : String(part).trim().toLowerCase()))
        .join('||');
    return createHash('sha1').update(normalized).digest('hex');
};

const parse_refresh_status = (value: unknown): NodeRefreshStatus => {
    if (value === 'queued' || value === 'running' || value === 'failed' || value === 'done') {
        return value;
    }
    return 'idle';
};

const to_positive_int = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
    return 0;
};

const node_display_label = (
    node_type: NodeType,
    content: string,
    metadata: Record<string, unknown>,
): { label: string; is_unmapped: boolean; is_system: boolean } => {
    const normalized_content = normalize_text_key(content);
    const query_key = normalize_text_key(get_string(metadata.query_key) ?? '');
    const source = normalize_text_key(get_string(metadata.source) ?? '');
    const is_unmapped =
        node_type === NodeType.subquery &&
        (query_key === '__unscoped__' || normalized_content === '__unscoped__' || normalized_content === 'unmapped_sources');
    const is_system = source === 'system' || normalized_content === 'unmapped_sources';
    if (is_unmapped) {
        return { label: 'Unmapped results', is_unmapped: true, is_system };
    }
    return { label: content, is_unmapped: false, is_system };
};

const truncate_for_log = (value: string, max = 120): string => (value.length <= max ? value : `${value.slice(0, max)}...`);

const safe_json_record = (value: unknown): Record<string, unknown> => {
    const obj = to_record(value);
    return obj ?? {};
};

const provider_turn_id_for = (data: IngestTurnDto): string =>
    deterministic_hash(data.chat_provider, data.conversation_id, data.request_id ?? '', data.turn_exchange_id ?? '');

const infer_query_from_obj = (obj: Record<string, unknown>): string | undefined =>
    get_string(obj.query) ??
    get_string(obj.search_query) ??
    get_string(obj.keyword) ??
    get_string(obj.q);

const infer_group_ref_from_obj = (obj: Record<string, unknown>, path: string): string =>
    deterministic_hash(
        get_string(obj.group_ref) ??
        get_string(obj.group_id) ??
        get_string(obj.groupId) ??
        get_string(obj.block_id) ??
        get_string(obj.id) ??
        path,
    );

const extract_result_candidates = (result_groups: unknown[] | undefined): Array<{
    query?: string;
    site_name: string;
    url?: string;
    title?: string;
    group_ref: string;
}> => {
    if (!result_groups?.length) {
        return [];
    }

    const results: Array<{ query?: string; site_name: string; url?: string; title?: string; group_ref: string }> = [];
    const push_site = (params: { query?: string; site_name: string; url?: string; title?: string; group_ref: string }) => {
        if (!params.site_name.trim()) return;
        results.push({
            query: params.query ? normalize_query(params.query) : undefined,
            site_name: normalize_site_name(params.site_name),
            url: params.url ? normalize_url(params.url) : undefined,
            title: params.title ? normalize_title(params.title) : undefined,
            group_ref: params.group_ref,
        });
    };

    const walk = (value: unknown, query_context?: string, path = 'root', depth = 0) => {
        if (depth > 10) return;
        if (Array.isArray(value)) {
            value.forEach((item, index) => walk(item, query_context, `${path}[${index}]`, depth + 1));
            return;
        }
        const obj = to_record(value);
        if (!obj) return;

        const local_query = infer_query_from_obj(obj);
        const active_query = local_query ?? query_context;
        const group_ref = infer_group_ref_from_obj(obj, path);

        const raw_url = get_string(obj.url) ?? get_string(obj.link) ?? get_string(obj.source_url) ?? get_string(obj.display_url);
        const url = canonicalize_url(raw_url);
        const site_name =
            get_string(obj.site_name) ??
            get_string(obj.domain) ??
            get_string(obj.source) ??
            get_string(obj.name) ??
            infer_site_name_from_url(url);
        const title = get_string(obj.title) ?? get_string(obj.headline) ?? get_string(obj.heading);
        if (site_name && !is_internal_site_name(site_name)) {
            push_site({ query: active_query, site_name, url, title, group_ref });
        }

        Object.entries(obj).forEach(([key, nested]) => {
            if (nested !== undefined && (Array.isArray(nested) || typeof nested === 'object')) {
                walk(nested, active_query, `${path}.${key}`, depth + 1);
            }
        });
    };

    walk(result_groups);
    return results;
};

const normalize_turn_events = (params: {
    capture_turn_id: string;
    data: IngestTurnDto;
    normalized_prompt: string;
    normalized_queries: string[];
    occurred_at: Date;
}): NormalizedTurnEvent[] => {
    const provider_turn_id = provider_turn_id_for(params.data);
    const provider = params.data.chat_provider;
    const occurred_at = params.occurred_at.toISOString();
    const events: NormalizedTurnEvent[] = [];
    let seq = 1;
    const prompt_ref = deterministic_hash(provider, provider_turn_id, params.normalized_prompt, seq);
    const subquery_ref_by_key = new Map<string, { subquery_ref: string; first_seen_seq: number; label: string }>();

    const emit = (event_type: StreamEventType, payload: Record<string, unknown>) => {
        const current_seq = seq++;
        events.push({
            capture_turn_id: params.capture_turn_id,
            provider,
            provider_conversation_id: params.data.conversation_id,
            provider_request_id: params.data.request_id,
            provider_turn_id,
            seq: current_seq,
            event_type,
            source_ref: deterministic_hash(provider_turn_id, event_type, current_seq),
            payload,
            occurred_at,
        });
    };

    emit('prompt_sent', {
        prompt: params.normalized_prompt,
        prompt_ref,
    });

    for (const query of params.normalized_queries) {
        const query_key = normalize_query_key(query);
        if (subquery_ref_by_key.has(query_key)) continue;
        const next_ref = deterministic_hash(provider, provider_turn_id, query_key, seq);
        subquery_ref_by_key.set(query_key, {
            subquery_ref: next_ref,
            first_seen_seq: seq,
            label: query,
        });
        emit('search_queries', {
            prompt_ref,
            query,
            query_key,
            subquery_ref: next_ref,
        });
    }

    const extracted_results = extract_result_candidates(params.data.result_groups);
    const should_infer_prompt_query = params.normalized_queries.length === 0 && extracted_results.length > 0;
    let inferred_prompt_query_key: string | undefined;
    let inferred_prompt_query_label: string | undefined;
    if (should_infer_prompt_query) {
        inferred_prompt_query_label = normalize_query(params.normalized_prompt);
        inferred_prompt_query_key = normalize_query_key(inferred_prompt_query_label);
        const inferred_ref = deterministic_hash(provider, provider_turn_id, inferred_prompt_query_key, 'inferred_prompt');
        subquery_ref_by_key.set(inferred_prompt_query_key, {
            subquery_ref: inferred_ref,
            first_seen_seq: seq,
            label: inferred_prompt_query_label,
        });
        emit('search_queries', {
            prompt_ref,
            query: inferred_prompt_query_label,
            query_key: inferred_prompt_query_key,
            subquery_ref: inferred_ref,
            inferred: true,
            inferred_from_prompt: true,
        });
    }

    for (const result of extracted_results) {
        const resolved_query = result.query ?? inferred_prompt_query_label ?? '__unscoped__';
        const query_key = normalize_query_key(resolved_query);
        if (query_key !== '__unscoped__' && !subquery_ref_by_key.has(query_key)) {
            const inferred_label = normalize_query(result.query ?? query_key);
            const inferred_ref = deterministic_hash(provider, provider_turn_id, query_key, seq);
            subquery_ref_by_key.set(query_key, {
                subquery_ref: inferred_ref,
                first_seen_seq: seq,
                label: inferred_label,
            });
            emit('search_queries', {
                prompt_ref,
                query: inferred_label,
                query_key,
                subquery_ref: inferred_ref,
                inferred: true,
            });
        }

        const linked_subquery = subquery_ref_by_key.get(query_key);
        const result_ref = deterministic_hash(
            provider,
            provider_turn_id,
            query_key,
            normalize_text_key(result.site_name),
            normalize_text_key(canonicalize_url(result.url) ?? ''),
        );

        emit('search_results', {
            prompt_ref,
            query: query_key === '__unscoped__' ? undefined : resolved_query,
            query_key,
            subquery_ref: linked_subquery?.subquery_ref,
            result_ref,
            group_ref: result.group_ref,
            site_name: result.site_name,
            url: canonicalize_url(result.url),
            title: result.title,
        });
    }

    emit('response_finished', {
        prompt_ref,
        reason: params.data.finished_reason ?? 'status_finished_successfully',
    });

    return events;
};

const materialize_turn_from_events = (events: NormalizedTurnEvent[]): {
    prompt: { prompt_ref: string; text: string; first_seen_seq: number };
    subqueries: MaterializedSubquery[];
    expected_counts: { subquery_count: number; result_count: number; unscoped_count: number };
} => {
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    const prompt_event = sorted.find((event) => event.event_type === 'prompt_sent');
    const prompt_payload = safe_json_record(prompt_event?.payload);
    const prompt_text = get_string(prompt_payload.prompt) ?? '';
    const prompt_ref = get_string(prompt_payload.prompt_ref) ?? deterministic_hash(prompt_text);

    const subquery_map = new Map<string, MaterializedSubquery>();
    const subquery_ref_by_key = new Map<string, string>();
    const upsert_subquery = (params: {
        query_key: string;
        label: string;
        subquery_ref: string;
        first_seen_seq: number;
    }): MaterializedSubquery => {
        const existing = subquery_map.get(params.subquery_ref);
        if (existing) {
            if (params.first_seen_seq < existing.first_seen_seq) {
                existing.first_seen_seq = params.first_seen_seq;
            }
            return existing;
        }
        const next: MaterializedSubquery = {
            query_key: params.query_key,
            label: params.label,
            subquery_ref: params.subquery_ref,
            first_seen_seq: params.first_seen_seq,
            sites: [],
        };
        subquery_map.set(params.subquery_ref, next);
        if (params.query_key !== '__unscoped__' && !subquery_ref_by_key.has(params.query_key)) {
            subquery_ref_by_key.set(params.query_key, params.subquery_ref);
        }
        return next;
    };

    const seen_result_by_subquery = new Map<string, Set<string>>();
    const ensure_site_set = (subquery_ref: string): Set<string> => {
        const existing = seen_result_by_subquery.get(subquery_ref);
        if (existing) return existing;
        const next = new Set<string>();
        seen_result_by_subquery.set(subquery_ref, next);
        return next;
    };

    let unscoped_ref: string | null = null;
    const ensure_unscoped = (first_seen_seq: number): MaterializedSubquery => {
        if (!unscoped_ref) {
            unscoped_ref = deterministic_hash(prompt_ref, '__unscoped__');
        }
        return upsert_subquery({
            query_key: '__unscoped__',
            label: '__unscoped__',
            subquery_ref: unscoped_ref,
            first_seen_seq,
        });
    };

    for (const event of sorted) {
        const payload = safe_json_record(event.payload);
        if (event.event_type === 'search_queries') {
            const query_key = normalize_query_key(get_string(payload.query_key) ?? get_string(payload.query) ?? '__unscoped__');
            const label = normalize_query(get_string(payload.query) ?? query_key);
            const subquery_ref =
                get_string(payload.subquery_ref) ??
                deterministic_hash(prompt_ref, query_key);
            upsert_subquery({
                query_key,
                label: query_key === '__unscoped__' ? '__unscoped__' : label,
                subquery_ref,
                first_seen_seq: event.seq,
            });
            continue;
        }

        if (event.event_type !== 'search_results') continue;
        const query_key = normalize_query_key(get_string(payload.query_key) ?? get_string(payload.query) ?? '__unscoped__');
        const requested_subquery_ref = get_string(payload.subquery_ref);
        const site_name = normalize_site_name(get_string(payload.site_name) ?? '');
        if (!site_name || is_internal_site_name(site_name)) continue;
        const url = canonicalize_url(get_string(payload.url));
        const title = get_string(payload.title);
        const fallback_result_ref = deterministic_hash(
            event.provider,
            event.provider_turn_id,
            query_key,
            normalize_text_key(site_name),
            normalize_text_key(url ?? ''),
        );
        const result_ref = get_string(payload.result_ref) ?? fallback_result_ref;

        let target_subquery: MaterializedSubquery | undefined;
        if (requested_subquery_ref) {
            target_subquery = subquery_map.get(requested_subquery_ref);
        }
        if (!target_subquery && query_key !== '__unscoped__') {
            const known_ref = subquery_ref_by_key.get(query_key);
            if (known_ref) {
                target_subquery = subquery_map.get(known_ref);
            }
        }
        if (!target_subquery && query_key !== '__unscoped__') {
            const inferred_ref = deterministic_hash(prompt_ref, query_key);
            target_subquery = upsert_subquery({
                query_key,
                label: normalize_query(get_string(payload.query) ?? query_key),
                subquery_ref: inferred_ref,
                first_seen_seq: event.seq,
            });
        }
        if (!target_subquery) {
            const non_unscoped_subqueries = Array.from(subquery_map.values()).filter((subquery) => subquery.query_key !== '__unscoped__');
            if (query_key === '__unscoped__' && non_unscoped_subqueries.length === 1) {
                target_subquery = non_unscoped_subqueries[0];
            } else {
                target_subquery = ensure_unscoped(event.seq);
            }
        }

        const seen_results = ensure_site_set(target_subquery.subquery_ref);
        if (seen_results.has(result_ref)) continue;
        seen_results.add(result_ref);
        target_subquery.sites.push({
            site_name,
            url: url ?? undefined,
            title: title ? normalize_title(title) : undefined,
            result_ref,
            first_seen_seq: event.seq,
        });
    }

    const subqueries = Array.from(subquery_map.values())
        .sort((a, b) => a.first_seen_seq - b.first_seen_seq)
        .map((subquery) => ({
            ...subquery,
            sites: [...subquery.sites].sort((a, b) => a.first_seen_seq - b.first_seen_seq),
        }));

    const unscoped = subqueries.find((subquery) => subquery.query_key === '__unscoped__');
    const expected_counts = {
        subquery_count: subqueries.length,
        result_count: subqueries.reduce((acc, subquery) => acc + subquery.sites.length, 0),
        unscoped_count: unscoped?.sites.length ?? 0,
    };

    return {
        prompt: {
            prompt_ref,
            text: prompt_text,
            first_seen_seq: prompt_event?.seq ?? 1,
        },
        subqueries,
        expected_counts,
    };
};

interface SuggestedPromptCandidate {
    prompt: string;
    reason: string;
}

const parse_json_object_from_text = (raw: string): Record<string, unknown> | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const candidates: string[] = [trimmed];
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        candidates.push(fenced[1].trim());
    }

    const first_brace = trimmed.indexOf('{');
    const last_brace = trimmed.lastIndexOf('}');
    if (first_brace >= 0 && last_brace > first_brace) {
        candidates.push(trimmed.slice(first_brace, last_brace + 1));
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as unknown;
            const record = to_record(parsed);
            if (record) return record;
        } catch {
            // Continue trying other candidates.
        }
    }

    return null;
};

const normalize_suggested_prompts = (
    raw: unknown,
    limit: number,
): SuggestedPromptCandidate[] => {
    const rows = Array.isArray(raw)
        ? raw
        : Array.isArray(to_record(raw)?.suggestions)
            ? (to_record(raw)?.suggestions as unknown[])
            : [];

    const seen = new Set<string>();
    const output: SuggestedPromptCandidate[] = [];
    for (const row of rows) {
        const record = to_record(row);
        if (!record) continue;
        const prompt = normalize_prompt(get_string(record.prompt) ?? '');
        if (!prompt || is_imported_prompt_fallback(prompt)) continue;
        const key = normalize_text_key(prompt);
        if (seen.has(key)) continue;
        seen.add(key);
        const reason = get_string(record.reason) ?? 'Suggested from executed prompt history';
        output.push({ prompt, reason });
        if (output.length >= limit) break;
    }

    return output;
};

const build_suggestions_from_openai = async (
    recent_prompts: string[],
    max_suggestions: number,
): Promise<SuggestedPromptCandidate[]> => {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not configured');
    }

    const limit = Math.min(Math.max(max_suggestions, 1), 25);
    const prompt_lines = recent_prompts
        .slice(0, 20)
        .map((prompt, index) => `${index + 1}. ${prompt}`)
        .join('\n');

    const system_message = [
        'Generate realistic follow-up prompts a human would type into an LLM.',
        'Use only the executed prompt history context.',
        `Return strictly JSON object: {"suggestions":[{"prompt":"...","reason":"..."}]} with ${limit} unique suggestions.`,
        'Each prompt should be concise and practical.',
    ].join(' ');

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: system_message }] },
                contents: [
                    {
                        parts: [{ text: `Executed prompts:\n${prompt_lines}` }]
                    }
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                }
            })
        }
    );

    const raw_text = await response.text();
    if (!response.ok) {
        throw new Error(`Suggestion generation failed (${response.status}): ${raw_text.slice(0, 260)}`);
    }

    let payload: unknown = null;
    try {
        payload = JSON.parse(raw_text) as unknown;
    } catch {
        throw new Error('Suggestion generation returned invalid JSON');
    }

    const candidates = to_array(to_record(payload)?.candidates) ?? [];
    const firstCandidate = to_record(candidates[0]) ?? {};
    const content = to_record(firstCandidate.content) ?? {};
    const parts = to_array(content.parts) ?? [];
    const firstPart = to_record(parts[0]) ?? {};
    const content_raw = get_string(firstPart.text) ?? '';
    const parsed_content = parse_json_object_from_text(content_raw);
    if (!parsed_content) {
        throw new Error('Suggestion generation returned unparsable content');
    }

    const suggestions = normalize_suggested_prompts(parsed_content, limit);
    if (!suggestions.length) {
        throw new Error('No prompt suggestions could be generated');
    }
    return suggestions;
};

const parse_prompt_candidate_status = (value: unknown): PromptCandidateStatus => {
    if (value === 'fired' || value === 'running' || value === 'failed') return value;
    return 'new';
};

const parse_bool = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    return fallback;
};

const is_imported_prompt_fallback = (prompt: string): boolean => {
    const key = normalize_text_key(prompt);
    const fallback = normalize_text_key(IMPORTED_PROMPT_FALLBACK);
    return key === fallback || key.startsWith(`${fallback} `);
};

const prompt_quality_score = (prompt: string): number => {
    const key = normalize_text_key(prompt);
    if (!key) return 0;
    if (is_imported_prompt_fallback(prompt)) return 1;
    return 3;
};

const prompt_source_score = (source?: string): number => {
    const key = normalize_text_key(source ?? '');
    if (key === 'extension_background_seq' || key === 'extension' || key === 'extension_capture') return 3;
    if (key === 'conversation_ingest') return 2;
    return 1;
};

interface SiteKeywordTarget {
    host: string;
    url?: string;
    cacheKey: string;
}

type SiteKeywordRequestTarget = {
    domain?: string;
    page_url?: string;
};

interface SiteTopQueryRow {
    query: string;
    volume?: number;
    traffic?: number;
    position?: number;
    trafficPercent?: number;
    keywordDifficulty?: number;
    sourceTimestamp: string;
}

const normalize_site_keyword_target = (value: string): SiteKeywordTarget | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
        parsed.hash = '';
        parsed.hostname = parsed.hostname.toLowerCase();
        const normalized = canonicalize_url(parsed.toString());
        const host = parsed.hostname.replace(/^www\./, '');
        if (!host) return undefined;
        return {
            host,
            ...(normalized ? { url: normalized } : {}),
            cacheKey: normalized ?? host,
        };
    } catch {
        const lowered = trimmed.toLowerCase();
        const raw = lowered.replace(/^https?:\/\//, '').replace(/^www\./, '');
        const host = raw.split('/')[0];
        if (!host || host.includes(' ')) return undefined;
        return {
            host,
            cacheKey: host,
        };
    }
};

const normalize_site_keyword_request_target = (value: SiteKeywordRequestTarget): SiteKeywordTarget | undefined => {
    const page_target = value.page_url ? normalize_site_keyword_target(value.page_url) : undefined;
    const domain_target = value.domain ? normalize_site_keyword_target(value.domain) : undefined;
    const host = page_target?.host ?? domain_target?.host;
    if (!host) return undefined;
    return {
        host,
        ...(page_target?.url ? { url: page_target.url } : {}),
        cacheKey: page_target?.url ?? host,
    };
};

const parse_keyword_items = (value: unknown): KeywordQueryItem[] => {
    const rows = Array.isArray(value) ? value : [];
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const output: KeywordQueryItem[] = [];
    for (const row of rows) {
        const record = to_record(row);
        if (!record) continue;
        const query = get_string(record.query);
        if (!query) continue;
        const key = normalize_text_key(query);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
            query,
            sourceProvider: (get_string(record.sourceProvider) as StreamProvider | undefined) ?? 'unknown',
            sourcePromptId: get_string(record.sourcePromptId),
            firstSeenAt: get_string(record.firstSeenAt) ?? now,
        });
    }
    return output;
};

const parse_website_items = (value: unknown): CrawledWebsiteItem[] => {
    const rows = Array.isArray(value) ? value : [];
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const output: CrawledWebsiteItem[] = [];
    for (const row of rows) {
        const record = to_record(row);
        if (!record) continue;
        const url = canonicalize_url(get_string(record.url));
        if (!url) continue;
        const host = infer_site_name_from_url(url);
        if (!host) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        output.push({
            url,
            host,
            source: get_string(record.source) ?? 'discovery',
            firstSeenAt: get_string(record.firstSeenAt) ?? now,
        });
    }
    return output;
};

const parse_place_items = (value: unknown): PlaceFoundItem[] => {
    const rows = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    const output: PlaceFoundItem[] = [];
    for (const row of rows) {
        const record = to_record(row);
        if (!record) continue;
        const name = get_string(record.name);
        if (!name) continue;
        const address = get_string(record.address);
        const key = `${normalize_text_key(name)}|${normalize_text_key(address ?? '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rating = to_number(record.rating);
        const review_count = to_number(record.reviewCount);
        const website_url = canonicalize_url(get_string(record.websiteUrl));
        const category = get_string(record.category);
        output.push({
            name,
            ...(address ? { address } : {}),
            ...(rating !== undefined ? { rating } : {}),
            ...(review_count !== undefined ? { reviewCount: Math.floor(review_count) } : {}),
            ...(website_url ? { websiteUrl: website_url } : {}),
            ...(category ? { category } : {}),
        });
    }
    return output;
};

const is_probable_host = (value: string): boolean => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value.trim());

const keyword_items_from_materialized_turn = (
    turn: { created_at: Date; capture_session: { chat_provider: StreamProvider } },
    materialized: ReturnType<typeof materialize_turn_from_events>,
): KeywordQueryItem[] => {
    const now_iso = turn.created_at.toISOString();
    const seen = new Set<string>();
    const output: KeywordQueryItem[] = [];
    for (const subquery of materialized.subqueries) {
        if (subquery.query_key === '__unscoped__') continue;
        const query = normalize_query(subquery.label || subquery.query_key);
        if (!query) continue;
        const key = normalize_text_key(query);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
            query,
            sourceProvider: turn.capture_session.chat_provider ?? 'unknown',
            firstSeenAt: now_iso,
        });
    }
    return output;
};

const website_items_from_materialized_turn = (
    turn: { created_at: Date },
    materialized: ReturnType<typeof materialize_turn_from_events>,
): CrawledWebsiteItem[] => {
    const seen = new Set<string>();
    const now_iso = turn.created_at.toISOString();
    const output: CrawledWebsiteItem[] = [];
    for (const subquery of materialized.subqueries) {
        for (const site of subquery.sites) {
            const from_url = canonicalize_url(site.url);
            const inferred_url =
                from_url ??
                (is_probable_host(site.site_name)
                    ? canonicalize_url(`https://${site.site_name.replace(/^www\./i, '')}`)
                    : undefined);
            if (!inferred_url) continue;
            if (seen.has(inferred_url)) continue;
            seen.add(inferred_url);
            const host = infer_site_name_from_url(inferred_url);
            if (!host) continue;
            output.push({
                url: inferred_url,
                host,
                source: 'capture_result',
                firstSeenAt: now_iso,
            });
        }
    }
    return output;
};

const to_iso_from_epoch_seconds = (value: unknown): string | undefined => {
    const numeric = to_number(value);
    if (numeric === undefined) return undefined;
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString();
};

const to_percent_number = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().replace(/%$/, '');
    if (!normalized) return undefined;
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return undefined;
    return numeric;
};

const extract_keyword_rows = (raw: unknown): Record<string, unknown>[] => {
    if (Array.isArray(raw)) {
        return raw.map((entry) => to_record(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
    const root = to_record(raw);
    if (!root) return [];

    if (get_string(root.keyword) || get_string(root.phrase) || get_string(root.query)) {
        return [root];
    }

    const collections = [
        root.data,
        root.output,
        root.result,
        root.payload,
        root.items,
        root.results,
        root.keywords,
        root.organic_keywords,
        root.organic,
        root.rows,
        root.records,
        root.top_queries,
    ];
    for (const collection of collections) {
        if (Array.isArray(collection)) {
            const rows = collection
                .map((entry) => to_record(entry))
                .filter((entry): entry is Record<string, unknown> => Boolean(entry));
            if (rows.length) return rows;
        }
        const as_record = to_record(collection);
        if (as_record) {
            const nested = extract_keyword_rows(as_record);
            if (nested.length) return nested;
        }
    }
    return [];
};

const parse_top_queries_from_payload = (
    payload: unknown,
    fallback_timestamp: string,
): SiteTopQueryRow[] => {
    const rows = extract_keyword_rows(payload);
    const seen = new Set<string>();
    const output: SiteTopQueryRow[] = [];
    for (const row of rows) {
        const query = get_string(row.query) ?? get_string(row.keyword) ?? get_string(row.phrase);
        if (!query) continue;
        const key = normalize_text_key(query);
        if (seen.has(key)) continue;
        seen.add(key);
        const volume = to_number(row.volume ?? row.search_volume ?? row.searchVolume);
        const traffic = to_number(row.traffic ?? row.estimated_traffic ?? row.estimatedTraffic);
        const position = to_number(row.position ?? row.rank ?? row.serp_position);
        const traffic_percent = to_percent_number(row.trafficPercent ?? row.traffic_percent);
        const keyword_difficulty = to_number(row.keywordDifficulty ?? row.keyword_difficulty ?? row.kd);
        const source_timestamp =
            get_string(row.sourceTimestamp) ??
            to_iso_from_epoch_seconds(row.crawledTime ?? row.crawled_time ?? row.updated_at ?? row.timestamp) ??
            fallback_timestamp;
        output.push({
            query,
            ...(volume !== undefined ? { volume } : {}),
            ...(traffic !== undefined ? { traffic } : {}),
            ...(position !== undefined ? { position } : {}),
            ...(traffic_percent !== undefined ? { trafficPercent: traffic_percent } : {}),
            ...(keyword_difficulty !== undefined ? { keywordDifficulty: keyword_difficulty } : {}),
            sourceTimestamp: source_timestamp,
        });
    }

    return output.sort((a, b) => {
        const traffic_delta = (b.traffic ?? 0) - (a.traffic ?? 0);
        if (traffic_delta !== 0) return traffic_delta;
        return (b.volume ?? 0) - (a.volume ?? 0);
    });
};

const extract_site_target_from_snapshot = (
    summary_metrics: Prisma.JsonValue | null,
): { url?: string; host?: string; key?: string } => {
    const summary = to_record(summary_metrics) ?? {};
    const url = canonicalize_url(get_string(summary.target_url) ?? get_string(summary.site_url));
    const host =
        get_string(summary.host) ??
        get_string(summary.domain) ??
        (url ? infer_site_name_from_url(url) : undefined);
    const normalized_host = host ? host.replace(/^www\./i, '').toLowerCase() : undefined;
    return {
        ...(url ? { url } : {}),
        ...(normalized_host ? { host: normalized_host } : {}),
        key: url ?? normalized_host,
    };
};

const fetch_webhook_top_queries = async (params: {
    target: SiteKeywordTarget;
    country: string;
    limit: number;
}): Promise<SiteTopQueryRow[]> => {
    if (!SEMRUSH_URL) return [];

    const webhook_url = new URL(SEMRUSH_URL);
    if (params.target.url) {
        webhook_url.searchParams.set('url', params.target.url);
        webhook_url.searchParams.set('site_url', params.target.url);
    }
    webhook_url.searchParams.set('domain', params.target.host);
    webhook_url.searchParams.set('country', params.country);
    webhook_url.searchParams.set('limit', String(params.limit));

    const response = await fetch(webhook_url.toString(), { method: 'GET' });
    if (!response.ok) return [];
    const raw_text = await response.text();
    let raw_payload: unknown = null;
    try {
        raw_payload = JSON.parse(raw_text) as unknown;
    } catch {
        return [];
    }
    return parse_top_queries_from_payload(raw_payload, new Date().toISOString());
};

export class CampaignService {
    constructor(private repo: CampaignRepository) { }

    private toChatThreadSummary(session: {
        id?: string;
        chat_thread_id?: string;
        chat_provider: StreamProvider;
        conversation_id: string;
        provider_chat_id?: string | null;
        chat_url?: string | null;
        chat_title?: string | null;
        started_at?: Date | string | null;
        last_event_at?: Date | string | null;
        last_opened_at?: Date | string | null;
        turn_count?: number;
    }) {
        const to_iso = (value: Date | string | null | undefined): string | null => {
            if (!value) return null;
            if (typeof value === 'string') return value;
            return value.toISOString();
        };

        return {
            chat_thread_id: session.chat_thread_id ?? session.id ?? '',
            chat_provider: session.chat_provider,
            conversation_id: session.conversation_id,
            provider_chat_id: session.provider_chat_id ?? null,
            chat_url: session.chat_url ?? null,
            chat_title: session.chat_title ?? null,
            started_at: to_iso(session.started_at) ?? new Date(0).toISOString(),
            last_event_at: to_iso(session.last_event_at),
            last_opened_at: to_iso(session.last_opened_at),
            turn_count: session.turn_count ?? 0,
        };
    }

    private async resolveVersion(
        tenant_id: string,
        campaign_id: string,
        user_id?: string,
        version_id?: string,
        create_if_missing = false,
    ) {
        if (version_id) {
            const explicit_version = await this.repo.getVersionById(tenant_id, campaign_id, version_id);
            if (!explicit_version) {
                throw new Error('Campaign version not found');
            }
            return explicit_version;
        }

        let version = await this.repo.getActiveVersion(tenant_id, campaign_id);
        if (!version && create_if_missing && user_id) {
            version = await this.repo.establishActiveVersion(campaign_id, user_id);
        }
        return version;
    }

    private toVersionSummary(version: { id: string; version_number: number; is_active: boolean; status: string; label: string | null; created_at: Date; archived_at: Date | null; }) {
        return {
            id: version.id,
            version_number: version.version_number,
            is_active: version.is_active,
            status: version.status,
            label: version.label,
            created_at: version.created_at,
            archived_at: version.archived_at,
        };
    }

    private getVersionLastExecutionDate(version: { config_json: Prisma.JsonValue | null }): string | undefined {
        const config = to_record(version.config_json) ?? {};
        return get_string(config.workflow_last_execution_at);
    }

    private toPromptCandidate(node: { id: string; content: string; metadata: Prisma.JsonValue | null }): PromptCandidateResponse | null {
        const metadata = to_record(node.metadata) ?? {};
        const source = get_string(metadata.source);
        if (source !== 'suggestion' && source !== 'manual') {
            return null;
        }
        const selected_default = source === 'suggestion';
        const status = parse_prompt_candidate_status(get_string(metadata.status));
        return {
            id: node.id,
            node_id: node.id,
            text: node.content,
            source: source === 'manual' ? 'manual' : 'auto',
            selected: parse_bool(metadata.selected, selected_default),
            status,
            lastExecutionAt: get_string(metadata.last_execution_at),
        };
    }

    private async listPromptCandidatesForVersion(tenant_id: string, campaign_version_id: string): Promise<PromptCandidateResponse[]> {
        const version = await prisma.campaignVersion.findFirst({
            where: {
                id: campaign_version_id,
                tenant_id,
            },
            select: { config_json: true },
        });
        const version_config = to_record(version?.config_json) ?? {};
        const active_suggestion_batch_id = get_string(version_config.workflow_active_suggestion_batch_id);

        const generated_nodes = await prisma.promptNode.findMany({
            where: {
                tenant_id,
                campaign_version_id,
                type: NodeType.generated,
            },
            orderBy: { created_at: 'desc' },
        });

        const latest_suggestion_generation_run_id = active_suggestion_batch_id
            ? undefined
            : generated_nodes
                .map((node) => {
                    const metadata = to_record(node.metadata) ?? {};
                    const source = normalize_text_key(get_string(metadata.source) ?? '');
                    if (source !== 'suggestion') return undefined;
                    return get_string(metadata.generation_run_id);
                })
                .find((value): value is string => Boolean(value));

        const seen = new Set<string>();
        const candidates: PromptCandidateResponse[] = [];
        for (const node of generated_nodes) {
            const metadata = to_record(node.metadata) ?? {};
            const source = normalize_text_key(get_string(metadata.source) ?? '');
            if (source === 'suggestion') {
                const suggestion_batch_id = get_string(metadata.suggestion_batch_id) ?? get_string(metadata.generation_run_id);
                if (active_suggestion_batch_id && suggestion_batch_id !== active_suggestion_batch_id) {
                    continue;
                }
                const generation_run_id = get_string(metadata.generation_run_id);
                if (
                    !active_suggestion_batch_id &&
                    latest_suggestion_generation_run_id &&
                    generation_run_id &&
                    generation_run_id !== latest_suggestion_generation_run_id
                ) {
                    continue;
                }
            }
            const candidate = this.toPromptCandidate(node);
            if (!candidate) continue;
            const dedupe_key = `${candidate.source}:${normalize_text_key(candidate.text)}`;
            if (seen.has(dedupe_key)) continue;
            seen.add(dedupe_key);
            candidates.push(candidate);
        }

        return candidates;
    }

    private async listExecutedPromptsForVersion(
        tenant_id: string,
        campaign_version_id: string,
        prompt_candidates: PromptCandidateResponse[],
    ): Promise<ExecutedPromptResponse[]> {
        const turns = await prisma.captureTurn.findMany({
            where: {
                tenant_id,
                capture_session: {
                    campaign_version_id,
                },
            },
            include: {
                capture_session: {
                    select: {
                        chat_provider: true,
                        conversation_id: true,
                    },
                },
            },
            orderBy: { created_at: 'desc' },
            take: 200,
        });

        const candidate_by_prompt_key = new Map<string, string>();
        for (const candidate of prompt_candidates) {
            const key = normalize_text_key(candidate.text);
            if (!key || candidate_by_prompt_key.has(key)) continue;
            candidate_by_prompt_key.set(key, candidate.id);
        }

        const groups = new Map<string, {
            item: ExecutedPromptResponse;
            prompt_quality: number;
            source_quality: number;
            keyword_map: Map<string, KeywordQueryItem>;
            website_map: Map<string, CrawledWebsiteItem>;
            place_map: Map<string, PlaceFoundItem>;
        }>();
        for (const turn of turns) {
            const metadata = to_record(turn.metadata) ?? {};
            const workflow_discovery = to_record(metadata.workflow_discovery) ?? {};
            let searched_keywords = parse_keyword_items(workflow_discovery.searchedKeywords);
            let crawled_websites = parse_website_items(workflow_discovery.crawledWebsites);
            const places_found = parse_place_items(workflow_discovery.placesFound);

            if (!searched_keywords.length || !crawled_websites.length) {
                const raw_payload = to_record(turn.raw_event_json) ?? {};
                const event_rows = to_array(raw_payload.normalized_events)
                    .map((row) => to_record(row))
                    .filter((row): row is Record<string, unknown> => Boolean(row));
                if (event_rows.length) {
                    const normalized_events = event_rows as unknown as NormalizedTurnEvent[];
                    const materialized = materialize_turn_from_events(normalized_events);
                    if (!searched_keywords.length) {
                        searched_keywords = keyword_items_from_materialized_turn(
                            {
                                created_at: turn.created_at,
                                capture_session: {
                                    chat_provider: turn.capture_session.chat_provider as StreamProvider,
                                },
                            },
                            materialized,
                        );
                    }
                    if (!crawled_websites.length) {
                        crawled_websites = website_items_from_materialized_turn(
                            { created_at: turn.created_at },
                            materialized,
                        );
                    }
                }
            }

            const finished_reason_key = normalize_text_key(get_string(turn.finished_reason) ?? '');
            const status: 'completed' | 'failed' = finished_reason_key.includes('fail') ? 'failed' : 'completed';
            const source_prompt_id =
                get_string(metadata.source_prompt_id) ??
                candidate_by_prompt_key.get(normalize_text_key(turn.prompt));
            const source = get_string(metadata.source);
            const conversation_id = get_string(turn.capture_session.conversation_id);
            const request_id = get_string(turn.request_id);
            const turn_exchange_id = get_string(turn.turn_exchange_id);
            const fallback_prompt = is_imported_prompt_fallback(turn.prompt);
            if (fallback_prompt) {
                continue;
            }
            const group_key =
                conversation_id && request_id && turn_exchange_id
                    ? `${conversation_id}::${request_id}::${turn_exchange_id}`
                    : `turn:${turn.id}`;

            const item: ExecutedPromptResponse = {
                id: turn.id,
                text: turn.prompt,
                provider: (turn.capture_session.chat_provider as StreamProvider) ?? 'unknown',
                status,
                lastExecutionAt: turn.created_at.toISOString(),
                ...(source_prompt_id ? { sourcePromptId: source_prompt_id } : {}),
                searchedKeywords: searched_keywords,
                crawledWebsites: crawled_websites,
                placesFound: places_found,
            };

            const existing = groups.get(group_key);
            if (!existing) {
                groups.set(group_key, {
                    item,
                    prompt_quality: prompt_quality_score(item.text),
                    source_quality: prompt_source_score(source),
                    keyword_map: new Map(item.searchedKeywords.map((keyword) => [normalize_text_key(keyword.query), keyword])),
                    website_map: new Map(item.crawledWebsites.map((site) => [site.url, site])),
                    place_map: new Map(item.placesFound.map((place) => [`${normalize_text_key(place.name)}|${normalize_text_key(place.address ?? '')}`, place])),
                });
                continue;
            }

            for (const keyword of item.searchedKeywords) {
                const key = normalize_text_key(keyword.query);
                if (!existing.keyword_map.has(key)) {
                    existing.keyword_map.set(key, keyword);
                }
            }
            for (const site of item.crawledWebsites) {
                if (!existing.website_map.has(site.url)) {
                    existing.website_map.set(site.url, site);
                }
            }
            for (const place of item.placesFound) {
                const key = `${normalize_text_key(place.name)}|${normalize_text_key(place.address ?? '')}`;
                if (!existing.place_map.has(key)) {
                    existing.place_map.set(key, place);
                }
            }

            const incoming_prompt_quality = prompt_quality_score(item.text);
            const incoming_source_quality = prompt_source_score(source);
            const should_replace_prompt =
                incoming_prompt_quality > existing.prompt_quality ||
                (incoming_prompt_quality === existing.prompt_quality && incoming_source_quality > existing.source_quality) ||
                (incoming_prompt_quality === existing.prompt_quality &&
                    incoming_source_quality === existing.source_quality &&
                    item.text.length > existing.item.text.length);
            if (should_replace_prompt) {
                existing.item.text = item.text;
                existing.item.provider = item.provider;
                if (item.sourcePromptId) {
                    existing.item.sourcePromptId = item.sourcePromptId;
                }
                existing.prompt_quality = incoming_prompt_quality;
                existing.source_quality = incoming_source_quality;
            }

            if (item.status === 'failed') {
                existing.item.status = 'failed';
            }
            if (new Date(item.lastExecutionAt).getTime() > new Date(existing.item.lastExecutionAt).getTime()) {
                existing.item.lastExecutionAt = item.lastExecutionAt;
            }
        }

        return Array.from(groups.values())
            .map((group) => ({
                ...group.item,
                searchedKeywords: Array.from(group.keyword_map.values()),
                crawledWebsites: Array.from(group.website_map.values()),
                placesFound: Array.from(group.place_map.values()),
            }))
            .sort((a, b) => new Date(b.lastExecutionAt).getTime() - new Date(a.lastExecutionAt).getTime());
    }

    private async getLatestWorkflowDiscovery(tenant_id: string, campaign_version_id: string): Promise<{
        searchedKeywords: KeywordQueryItem[];
        crawledWebsites: CrawledWebsiteItem[];
        placesFound: PlaceFoundItem[];
        warnings: string[];
        provider: StreamProvider;
        conversationId: string;
    }> {
        const latest_turn = await prisma.captureTurn.findFirst({
            where: {
                tenant_id,
                capture_session: {
                    campaign_version_id,
                },
            },
            include: {
                capture_session: {
                    select: {
                        chat_provider: true,
                        conversation_id: true,
                    },
                },
            },
            orderBy: { created_at: 'desc' },
        });

        if (!latest_turn) {
            return {
                searchedKeywords: [],
                crawledWebsites: [],
                placesFound: [],
                warnings: ['No capture turns found for this version yet.'],
                provider: 'unknown',
                conversationId: '',
            };
        }

        const metadata = to_record(latest_turn.metadata) ?? {};
        const workflow_discovery = to_record(metadata.workflow_discovery) ?? {};
        const searched_keywords = parse_keyword_items(workflow_discovery.searchedKeywords);
        const crawled_websites = parse_website_items(workflow_discovery.crawledWebsites);
        const places = parse_place_items(workflow_discovery.placesFound);
        const warnings = Array.isArray(workflow_discovery.warnings)
            ? workflow_discovery.warnings.map((item) => get_string(item)).filter((item): item is string => Boolean(item))
            : [];

        if (!searched_keywords.length || !crawled_websites.length) {
            const nodes = await this.repo.getVersionNodes(tenant_id, campaign_version_id);
            const inferred_keywords = searched_keywords.length
                ? searched_keywords
                : nodes
                    .filter((node) => node.type === NodeType.subquery)
                    .map((node) => node.content.trim())
                    .filter((content) => content && content !== '__unscoped__' && content.toLowerCase() !== 'unmapped_sources')
                    .map((query) => ({
                        query,
                        sourceProvider: (latest_turn.capture_session.chat_provider as StreamProvider) ?? 'unknown',
                        firstSeenAt: latest_turn.created_at.toISOString(),
                    }));

            const inferred_sites = crawled_websites.length
                ? crawled_websites
                : nodes
                    .filter((node) => node.type === NodeType.site)
                    .map((node) => {
                        const node_meta = to_record(node.metadata) ?? {};
                        const url = canonicalize_url(get_string(node_meta.url));
                        const host = url ? infer_site_name_from_url(url) : undefined;
                        if (!url || !host) return null;
                        return {
                            url,
                            host,
                            source: get_string(node_meta.source) ?? 'tree_site',
                            firstSeenAt: node.created_at.toISOString(),
                        } satisfies CrawledWebsiteItem;
                    })
                    .filter((item): item is CrawledWebsiteItem => Boolean(item));

            return {
                searchedKeywords: inferred_keywords,
                crawledWebsites: inferred_sites,
                placesFound: places,
                warnings,
                provider: (latest_turn.capture_session.chat_provider as StreamProvider) ?? 'unknown',
                conversationId: latest_turn.capture_session.conversation_id,
            };
        }

        return {
            searchedKeywords: searched_keywords,
            crawledWebsites: crawled_websites,
            placesFound: places,
            warnings,
            provider: (latest_turn.capture_session.chat_provider as StreamProvider) ?? 'unknown',
            conversationId: latest_turn.capture_session.conversation_id,
        };
    }

    async getWorkflowState(tenant_id: string, campaign_id: string, version_id?: string): Promise<WorkflowStatePayload> {
        const version = await this.resolveVersion(tenant_id, campaign_id, undefined, version_id, false);
        if (!version) {
            return {
                version: null,
                promptCandidates: [],
                executedPrompts: [],
                searchedKeywords: [],
                crawledWebsites: [],
                placesFound: [],
                warnings: ['No active version found for campaign.'],
                versionMeta: {
                    provider: 'unknown',
                    conversationId: '',
                },
            };
        }

        const prompt_candidates = await this.listPromptCandidatesForVersion(tenant_id, version.id);
        const executed_prompts = await this.listExecutedPromptsForVersion(tenant_id, version.id, prompt_candidates);
        const discovery = await this.getLatestWorkflowDiscovery(tenant_id, version.id);
        const last_execution_date = this.getVersionLastExecutionDate(version) ?? executed_prompts[0]?.lastExecutionAt;
        return {
            version,
            promptCandidates: prompt_candidates,
            executedPrompts: executed_prompts,
            searchedKeywords: discovery.searchedKeywords,
            crawledWebsites: discovery.crawledWebsites,
            placesFound: discovery.placesFound,
            warnings: discovery.warnings,
            versionMeta: {
                versionDate: version.created_at.toISOString(),
                lastExecutionDate: last_execution_date,
                provider: discovery.provider,
                conversationId: discovery.conversationId,
            },
        };
    }

    async ingestConversation(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        provider: StreamProvider,
        data: ConversationIngestDto,
        version_id?: string,
    ) {
        const resolved_version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id ?? data.promptVersionId, true);
        if (!resolved_version) {
            throw new Error('Campaign has no active version');
        }

        const prompt_candidates = await this.listPromptCandidatesForVersion(tenant_id, resolved_version.id);
        const normalized: NormalizedConversationData = normalize_conversation_payload({
            provider,
            conversationId: data.conversationId,
            payload: data.payload,
            promptCandidates: prompt_candidates,
            versionDate: resolved_version.created_at.toISOString(),
            lastExecutionDate: this.getVersionLastExecutionDate(resolved_version),
        });
        const ingest_source = normalize_text_key(data.source ?? '') || 'conversation_ingest';
        const explicit_prompt = normalize_prompt(data.prompt ?? '');
        const normalized_prompt = normalize_prompt(normalized.prompt ?? '');
        const resolved_prompt = explicit_prompt
            || (!is_imported_prompt_fallback(normalized_prompt) ? normalized_prompt : '');
        if (!resolved_prompt) {
            throw new Error('Unable to resolve prompt text from conversation payload');
        }

        await this.ingestTurn(
            tenant_id,
            user_id,
            campaign_id,
            {
                chat_provider: provider,
                conversation_id: data.conversationId,
                prompt: resolved_prompt,
                queries: normalized.searchedKeywords.map((item) => item.query),
                result_groups: normalized.resultGroups,
                metadata: {
                    source: ingest_source,
                    ...(data.sourcePromptId ? { source_prompt_id: data.sourcePromptId } : {}),
                    workflow_discovery: {
                        searchedKeywords: normalized.searchedKeywords,
                        crawledWebsites: normalized.crawledWebsites,
                        placesFound: normalized.placesFound,
                        warnings: normalized.warnings,
                    },
                },
            },
            resolved_version.id,
        );

        const workflow_state = await this.getWorkflowState(tenant_id, campaign_id, resolved_version.id);
        const normalized_prompt_key = normalize_text_key(resolved_prompt);
        const executed_prompt = workflow_state.executedPrompts.find((item) => {
            if (data.sourcePromptId && item.sourcePromptId === data.sourcePromptId) return true;
            return normalize_text_key(item.text) === normalized_prompt_key;
        }) ?? null;
        return {
            ...workflow_state,
            executedPrompt: executed_prompt,
            warnings: Array.from(new Set([...(workflow_state.warnings ?? []), ...(normalized.warnings ?? [])])),
            versionMeta: {
                ...workflow_state.versionMeta,
                provider,
                conversationId: data.conversationId,
            },
        };
    }

    async addManualPromptCandidate(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        payload: ManualPromptDto,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        await this.repo.createNode({
            tenant_id,
            campaign_version_id: version.id,
            type: NodeType.generated,
            content: normalize_prompt(payload.text),
            depth: 0,
            metadata: {
                source: 'manual',
                selected: true,
                status: 'new',
                created_by_user_id: user_id,
                source_version_id: version.id,
                refreshable: true,
                refresh_count: 0,
                refresh_status: 'idle',
            },
        });

        return this.getWorkflowState(tenant_id, campaign_id, version.id);
    }

    async selectPromptCandidates(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        payload: SelectPromptCandidatesDto,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const rows = await prisma.promptNode.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                id: { in: payload.promptIds },
                type: NodeType.generated,
            },
        });

        await Promise.all(rows.map(async (row) => {
            const metadata = to_record(row.metadata) ?? {};
            const source = get_string(metadata.source);
            if (source !== 'suggestion' && source !== 'manual') return;
            await prisma.promptNode.update({
                where: { id: row.id },
                data: {
                    metadata: {
                        ...metadata,
                        selected: payload.selected,
                    } as Prisma.InputJsonValue,
                },
            });
        }));

        return this.getWorkflowState(tenant_id, campaign_id, version.id);
    }

    async replacePromptSelection(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        selected_prompt_ids: string[],
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }
        const selected_set = new Set(selected_prompt_ids.map((id) => id.trim()).filter(Boolean));
        const rows = await prisma.promptNode.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                type: NodeType.generated,
            },
        });

        await Promise.all(rows.map(async (row) => {
            const metadata = to_record(row.metadata) ?? {};
            const source = get_string(metadata.source);
            if (source !== 'suggestion' && source !== 'manual') return;
            await prisma.promptNode.update({
                where: { id: row.id },
                data: {
                    metadata: {
                        ...metadata,
                        selected: selected_set.has(row.id),
                    } as Prisma.InputJsonValue,
                },
            });
        }));

        return this.getWorkflowState(tenant_id, campaign_id, version.id);
    }

    async executePromptCandidates(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        payload: ExecutePromptDto,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const rows = await prisma.promptNode.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                id: { in: payload.promptIds },
                type: NodeType.generated,
            },
        });
        const by_id = new Map(rows.map((row) => [row.id, row]));
        const ordered_rows = payload.promptIds
            .map((id) => by_id.get(id))
            .filter((row): row is typeof rows[number] => Boolean(row));

        if (!ordered_rows.length) {
            throw new Error('No valid prompt candidates found for execution');
        }

        const now_iso = new Date().toISOString();
        await Promise.all(ordered_rows.map(async (row) => {
            const metadata = to_record(row.metadata) ?? {};
            await prisma.promptNode.update({
                where: { id: row.id },
                data: {
                    metadata: {
                        ...metadata,
                        status: 'fired',
                        selected: true,
                        last_execution_at: now_iso,
                        last_execution_provider: payload.provider,
                        last_execution_mode: payload.mode,
                    } as Prisma.InputJsonValue,
                },
            });
        }));

        const version_config = to_record(version.config_json) ?? {};
        await prisma.campaignVersion.update({
            where: { id: version.id },
            data: {
                config_json: {
                    ...version_config,
                    workflow_last_execution_at: now_iso,
                    workflow_last_execution_provider: payload.provider,
                    workflow_last_execution_mode: payload.mode,
                } as Prisma.InputJsonValue,
            },
        });

        const execution_id = randomUUID();
        return {
            executionId: execution_id,
            mode: payload.mode,
            provider: payload.provider,
            status: 'queued' as const,
            orderedQueue: ordered_rows.map((row, index) => ({
                promptId: row.id,
                text: row.content,
                index,
                status: 'queued' as const,
            })),
            version: this.toVersionSummary(version),
            lastExecutionDate: now_iso,
        };
    }

    async getSiteTopQueries(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        payload: SiteTopQueriesDto,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const target_by_cache_key = new Map<string, SiteKeywordTarget>();
        for (const raw_target of payload.targets ?? []) {
            const target = normalize_site_keyword_request_target(raw_target as SiteKeywordRequestTarget);
            if (!target) continue;
            if (!target_by_cache_key.has(target.cacheKey)) {
                target_by_cache_key.set(target.cacheKey, target);
            }
        }
        for (const raw_host of payload.hosts ?? []) {
            const target = normalize_site_keyword_target(raw_host);
            if (!target) continue;
            if (!target_by_cache_key.has(target.cacheKey)) {
                target_by_cache_key.set(target.cacheKey, target);
            }
        }
        const normalized_targets = Array.from(target_by_cache_key.values());
        if (!normalized_targets.length) {
            throw new Error('No valid targets, hosts, or URLs were supplied');
        }

        const now = Date.now();
        const results: Array<{
            host: string;
            target_url?: string;
            top_queries: SiteTopQueryRow[];
            cached: boolean;
            provider?: 'semrush' | 'ahrefs';
            fetched_at?: string;
            error?: string;
        }> = [];

        for (const target of normalized_targets) {
            const cache_key = `site-keywords:${target.cacheKey}:${payload.country}`;
            const cached = await prisma.semrushSnapshot.findFirst({
                where: {
                    tenant_id,
                    campaign_version_id: version.id,
                    query_text: cache_key,
                },
                orderBy: { fetched_at: 'desc' },
            });

            const use_cache =
                !payload.forceRefresh &&
                cached &&
                now - cached.fetched_at.getTime() <= SITE_KEYWORD_CACHE_TTL_MS;

            if (use_cache && cached) {
                const raw = to_record(cached.raw_response) ?? {};
                const top_queries = to_array(raw.top_queries)
                    .map((row: unknown) => to_record(row))
                    .filter((row): row is Record<string, unknown> => Boolean(row))
                    .map((row: Record<string, unknown>) => {
                        const query = get_string(row.query) ?? get_string(row.keyword) ?? get_string(row.phrase) ?? '';
                        if (!query) return null;
                        const volume = to_number(row.volume);
                        const traffic = to_number(row.traffic);
                        const position = to_number(row.position);
                        const traffic_percent = to_percent_number(row.trafficPercent ?? row.traffic_percent);
                        const keyword_difficulty = to_number(row.keywordDifficulty ?? row.keyword_difficulty);
                        return {
                            query,
                            ...(volume !== undefined ? { volume } : {}),
                            ...(traffic !== undefined ? { traffic } : {}),
                            ...(position !== undefined ? { position } : {}),
                            ...(traffic_percent !== undefined ? { trafficPercent: traffic_percent } : {}),
                            ...(keyword_difficulty !== undefined ? { keywordDifficulty: keyword_difficulty } : {}),
                            sourceTimestamp: get_string(row.sourceTimestamp) ?? cached.fetched_at.toISOString(),
                        };
                    })
                    .filter((row): row is SiteTopQueryRow => Boolean(row))
                    .slice(0, payload.limit);

                results.push({
                    host: target.host,
                    ...(target.url ? { target_url: target.url } : {}),
                    top_queries,
                    cached: true,
                    provider: (get_string(raw.provider) as 'semrush' | 'ahrefs' | undefined) ?? undefined,
                    fetched_at: cached.fetched_at.toISOString(),
                });
                continue;
            }

            try {
                if (!SEMRUSH_URL && !AHREFS_URL) {
                    results.push({
                        host: target.host,
                        ...(target.url ? { target_url: target.url } : {}),
                        top_queries: [],
                        cached: false,
                        error: 'No keyword provider configured',
                    });
                    continue;
                }

                let provider: 'semrush' | 'ahrefs' = 'semrush';
                const fetched_at = new Date().toISOString();
                const cache_limit = Math.max(payload.limit, 50);
                let top_queries = await fetch_webhook_top_queries({
                    target,
                    country: payload.country,
                    limit: cache_limit,
                });

                let insight: Awaited<ReturnType<typeof fetch_semrush_site_insights>>[number] | null = null;
                if (!top_queries.length && SEMRUSH_URL) {
                    const insights = await fetch_semrush_site_insights({
                        semrush_url: SEMRUSH_URL,
                        sites: [{
                            site_name: target.host,
                            site_url: target.url,
                        } satisfies SemrushSiteInput],
                        latest_prompt: target.host,
                    });
                    insight = insights[0] ?? null;
                    top_queries = insight
                        ? (
                            insight.keyword_metrics.length
                                ? insight.keyword_metrics.slice(0, cache_limit).map((metric) => ({
                                    query: metric.keyword,
                                    volume: metric.volume,
                                    traffic: metric.traffic,
                                    sourceTimestamp: fetched_at,
                                }))
                                : insight.ranking_keywords.slice(0, cache_limit).map((keyword) => ({
                                    query: keyword,
                                    sourceTimestamp: fetched_at,
                                }))
                        )
                        : [];
                }
                if (!top_queries.length && AHREFS_URL) {
                    provider = 'ahrefs';
                    const insights = await fetch_ahrefs_site_insights({
                        ahrefs_url: AHREFS_URL,
                        sites: [{
                            site_name: target.host,
                            site_url: target.url,
                        } satisfies SemrushSiteInput],
                        latest_prompt: target.host,
                    });
                    insight = insights[0] ?? null;
                    top_queries = insight
                        ? (
                            insight.keyword_metrics.length
                                ? insight.keyword_metrics.slice(0, cache_limit).map((metric) => ({
                                    query: metric.keyword,
                                    volume: metric.volume,
                                    traffic: metric.traffic,
                                    sourceTimestamp: fetched_at,
                                }))
                                : insight.ranking_keywords.slice(0, cache_limit).map((keyword) => ({
                                    query: keyword,
                                    sourceTimestamp: fetched_at,
                                }))
                        )
                        : [];
                }

                await prisma.semrushSnapshot.create({
                    data: {
                        tenant_id,
                        campaign_version_id: version.id,
                        query_text: cache_key,
                        summary_metrics: {
                            host: target.host,
                            target_url: target.url,
                            country: payload.country,
                            limit: payload.limit,
                            provider,
                        } as Prisma.InputJsonValue,
                        raw_response: {
                            provider,
                            top_queries: top_queries,
                            insight: insight ?? null,
                        } as unknown as Prisma.InputJsonValue,
                    },
                });

                results.push({
                    host: target.host,
                    ...(target.url ? { target_url: target.url } : {}),
                    top_queries: top_queries.slice(0, payload.limit),
                    cached: false,
                    provider,
                    fetched_at,
                });
            } catch (error) {
                results.push({
                    host: target.host,
                    ...(target.url ? { target_url: target.url } : {}),
                    top_queries: [],
                    cached: false,
                    error: error instanceof Error ? error.message : 'Failed to fetch top queries',
                });
            }
        }

        const warnings = results
            .filter((row) => row.error)
            .map((row) => `${row.host}: ${row.error}`);

        return {
            country: payload.country,
            limit: payload.limit,
            ttlHours: 24,
            results,
            warnings,
        };
    }

    async getDashboardAnalytics(tenant_id: string, range: AnalyticsRange) {
        const range_start = range_start_for(range);
        const campaigns = await this.repo.listCampaigns(tenant_id);
        const campaign_ids = campaigns.map((campaign) => campaign.id);
        const by_campaign = new Map<string, {
            executed: number;
            completed: number;
            failed: number;
            last_execution_at: string | null;
            discovered_sites: Set<string>;
            fetched_sites: Set<string>;
            provider_totals: {
                chatgpt: number;
                claude: number;
                gemini: number;
                perplexity: number;
                grok: number;
                unknown: number;
            };
        }>();
        for (const campaign of campaigns) {
            by_campaign.set(campaign.id, {
                executed: 0,
                completed: 0,
                failed: 0,
                last_execution_at: null,
                discovered_sites: new Set<string>(),
                fetched_sites: new Set<string>(),
                provider_totals: {
                    chatgpt: 0,
                    claude: 0,
                    gemini: 0,
                    perplexity: 0,
                    grok: 0,
                    unknown: 0,
                },
            });
        }

        const momentum_by_day = new Map<string, {
            date: string;
            chatgpt: number;
            claude: number;
            gemini: number;
            perplexity: number;
            grok: number;
            unknown: number;
        }>();
        const freshness_buckets = {
            pending: 0,
            '0_24h': 0,
            '1_3d': 0,
            '3_7d': 0,
            '7d_plus': 0,
        };

        if (campaign_ids.length) {
            const turns = await prisma.captureTurn.findMany({
                where: {
                    tenant_id,
                    ...(range_start ? { created_at: { gte: range_start } } : {}),
                    capture_session: {
                        campaign_version: {
                            campaign_id: { in: campaign_ids },
                        },
                    },
                },
                select: {
                    created_at: true,
                    finished_reason: true,
                    metadata: true,
                    capture_session: {
                        select: {
                            chat_provider: true,
                            campaign_version: {
                                select: { campaign_id: true },
                            },
                        },
                    },
                },
            });

            for (const turn of turns) {
                const campaign_id = turn.capture_session.campaign_version.campaign_id;
                const metric = by_campaign.get(campaign_id);
                if (!metric) continue;

                metric.executed += 1;
                const failed = normalize_text_key(get_string(turn.finished_reason) ?? '').includes('fail');
                if (failed) metric.failed += 1;
                else metric.completed += 1;

                const turn_iso = turn.created_at.toISOString();
                if (!metric.last_execution_at || new Date(turn_iso).getTime() > new Date(metric.last_execution_at).getTime()) {
                    metric.last_execution_at = turn_iso;
                }

                const day = to_day_key(turn.created_at);
                const row = momentum_by_day.get(day) ?? {
                    date: day,
                    chatgpt: 0,
                    claude: 0,
                    gemini: 0,
                    perplexity: 0,
                    grok: 0,
                    unknown: 0,
                };
                const provider = turn.capture_session.chat_provider as StreamProvider;
                if (provider === 'chatgpt') {
                    row.chatgpt += 1;
                    metric.provider_totals.chatgpt += 1;
                } else if (provider === 'claude') {
                    row.claude += 1;
                    metric.provider_totals.claude += 1;
                } else if (provider === 'gemini') {
                    row.gemini += 1;
                    metric.provider_totals.gemini += 1;
                } else if (provider === 'perplexity') {
                    row.perplexity += 1;
                    metric.provider_totals.perplexity += 1;
                } else if (provider === 'grok') {
                    row.grok += 1;
                    metric.provider_totals.grok += 1;
                } else {
                    row.unknown += 1;
                    metric.provider_totals.unknown += 1;
                }
                momentum_by_day.set(day, row);

                const metadata = to_record(turn.metadata) ?? {};
                const workflow_discovery = to_record(metadata.workflow_discovery) ?? {};
                const discovered = parse_website_items(workflow_discovery.crawledWebsites);
                for (const site of discovered) {
                    metric.discovered_sites.add(site.url);
                }
            }

            const snapshots = await prisma.semrushSnapshot.findMany({
                where: {
                    tenant_id,
                    query_text: { startsWith: 'site-keywords:' },
                    ...(range_start ? { fetched_at: { gte: range_start } } : {}),
                    campaign_version: {
                        campaign_id: { in: campaign_ids },
                    },
                },
                select: {
                    summary_metrics: true,
                    campaign_version: {
                        select: { campaign_id: true },
                    },
                },
            });

            for (const snapshot of snapshots) {
                const campaign_id = snapshot.campaign_version.campaign_id;
                const metric = by_campaign.get(campaign_id);
                if (!metric) continue;
                const target = extract_site_target_from_snapshot(snapshot.summary_metrics);
                if (target.key) {
                    metric.fetched_sites.add(target.key);
                }
            }
        }

        const health_matrix = campaigns.map((campaign) => {
            const metric = by_campaign.get(campaign.id)!;
            const discovered_count = metric.discovered_sites.size;
            const fetched_count = metric.fetched_sites.size;
            const fetched_ratio = discovered_count ? fetched_count / discovered_count : 0;
            const bucket = freshness_bucket_for(metric.last_execution_at);
            freshness_buckets[bucket] += 1;
            return {
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                executed_prompts: metric.executed,
                fetched_ratio,
                total_nodes: campaign.total_nodes,
                completed: metric.completed,
                failed: metric.failed,
                last_execution_at: metric.last_execution_at,
                provider_totals: metric.provider_totals,
            };
        });

        return {
            range,
            generated_at: new Date().toISOString(),
            momentum: Array.from(momentum_by_day.values()).sort((a, b) => a.date.localeCompare(b.date)),
            health_matrix,
            freshness_buckets: [
                { bucket: 'pending', count: freshness_buckets.pending },
                { bucket: '0_24h', count: freshness_buckets['0_24h'] },
                { bucket: '1_3d', count: freshness_buckets['1_3d'] },
                { bucket: '3_7d', count: freshness_buckets['3_7d'] },
                { bucket: '7d_plus', count: freshness_buckets['7d_plus'] },
            ],
        };
    }

    async getPipelineAnalytics(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        range: AnalyticsRange,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }
        const workflow_state = await this.getWorkflowState(tenant_id, campaign_id, version.id);
        const range_start = range_start_for(range);
        const executed_in_range = workflow_state.executedPrompts.filter((item) => is_in_range(item.lastExecutionAt, range_start));

        const discovered_sites = new Set<string>();
        for (const executed of executed_in_range) {
            for (const site of executed.crawledWebsites) {
                discovered_sites.add(site.url);
            }
        }

        const snapshots = await prisma.semrushSnapshot.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                query_text: { startsWith: 'site-keywords:' },
                ...(range_start ? { fetched_at: { gte: range_start } } : {}),
            },
            select: {
                summary_metrics: true,
            },
        });
        const fetched_sites = new Set<string>();
        for (const snapshot of snapshots) {
            const target = extract_site_target_from_snapshot(snapshot.summary_metrics);
            if (target.key) fetched_sites.add(target.key);
        }

        const heatmap = new Map<string, { day: string; hour: number; count: number }>();
        const provider_map = new Map<StreamProvider, { provider: StreamProvider; completed: number; failed: number; total: number }>();
        for (const executed of executed_in_range) {
            const date = new Date(executed.lastExecutionAt);
            if (!Number.isNaN(date.getTime())) {
                const day = to_day_key(date);
                const hour = date.getHours();
                const key = `${day}::${hour}`;
                const cell = heatmap.get(key) ?? { day, hour, count: 0 };
                cell.count += 1;
                heatmap.set(key, cell);
            }

            const provider = executed.provider;
            const summary = provider_map.get(provider) ?? { provider, completed: 0, failed: 0, total: 0 };
            summary.total += 1;
            if (executed.status === 'failed') summary.failed += 1;
            else summary.completed += 1;
            provider_map.set(provider, summary);
        }

        const fired_count = workflow_state.promptCandidates.filter((item) => item.status !== 'new').length;
        const completed_count = executed_in_range.filter((item) => item.status === 'completed').length;
        return {
            range,
            version_id: version.id,
            generated_at: new Date().toISOString(),
            funnel: {
                suggested: workflow_state.promptCandidates.length,
                selected: workflow_state.promptCandidates.filter((item) => item.selected).length,
                fired: fired_count,
                executed_completed: completed_count,
                websites_fetched: fetched_sites.size,
            },
            execution_rhythm: Array.from(heatmap.values()).sort((a, b) =>
                a.day === b.day ? a.hour - b.hour : a.day.localeCompare(b.day),
            ),
            provider_outcomes: Array.from(provider_map.values()).sort((a, b) => b.total - a.total),
            discovered_websites: discovered_sites.size,
            fetched_websites: fetched_sites.size,
        };
    }

    async getPromptAnalytics(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        range: AnalyticsRange,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }
        const workflow_state = await this.getWorkflowState(tenant_id, campaign_id, version.id);
        const range_start = range_start_for(range);
        const executed_in_range = workflow_state.executedPrompts.filter((item) => is_in_range(item.lastExecutionAt, range_start));

        const provider_map = new Map<StreamProvider, {
            provider: StreamProvider;
            completed: number;
            failed: number;
            websites_sum: number;
            total: number;
        }>();
        const points = executed_in_range.map((item) => {
            const row = provider_map.get(item.provider) ?? {
                provider: item.provider,
                completed: 0,
                failed: 0,
                websites_sum: 0,
                total: 0,
            };
            row.total += 1;
            row.websites_sum += item.crawledWebsites.length;
            if (item.status === 'failed') row.failed += 1;
            else row.completed += 1;
            provider_map.set(item.provider, row);

            return {
                prompt_id: item.id,
                prompt: item.text,
                provider: item.provider,
                status: item.status,
                timestamp: item.lastExecutionAt,
                keyword_count: item.searchedKeywords.length,
                website_count: item.crawledWebsites.length,
            };
        });

        const timeline = executed_in_range
            .map((item) => ({
                prompt_id: item.id,
                prompt: item.text,
                provider: item.provider,
                status: item.status,
                timestamp: item.lastExecutionAt,
            }))
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        return {
            range,
            version_id: version.id,
            generated_at: new Date().toISOString(),
            points,
            provider_outcomes: Array.from(provider_map.values()).map((item) => ({
                provider: item.provider,
                completed: item.completed,
                failed: item.failed,
                avg_websites_per_prompt: item.total ? item.websites_sum / item.total : 0,
                total: item.total,
            })),
            timeline,
        };
    }

    async getWebsiteAnalytics(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        range: AnalyticsRange,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }
        const workflow_state = await this.getWorkflowState(tenant_id, campaign_id, version.id);
        const range_start = range_start_for(range);
        const executed_in_range = workflow_state.executedPrompts.filter((item) => is_in_range(item.lastExecutionAt, range_start));

        const site_map = new Map<string, {
            url: string;
            host: string;
            prompt_ids: Set<string>;
            providers: Set<StreamProvider>;
            last_seen_at: string;
        }>();

        for (const executed of executed_in_range) {
            for (const site of executed.crawledWebsites) {
                const entry = site_map.get(site.url) ?? {
                    url: site.url,
                    host: site.host.replace(/^www\./i, '').toLowerCase(),
                    prompt_ids: new Set<string>(),
                    providers: new Set<StreamProvider>(),
                    last_seen_at: executed.lastExecutionAt,
                };
                entry.prompt_ids.add(executed.id);
                entry.providers.add(executed.provider);
                if (new Date(executed.lastExecutionAt).getTime() > new Date(entry.last_seen_at).getTime()) {
                    entry.last_seen_at = executed.lastExecutionAt;
                }
                site_map.set(site.url, entry);
            }
        }

        const snapshots = await prisma.semrushSnapshot.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                query_text: { startsWith: 'site-keywords:' },
                ...(range_start ? { fetched_at: { gte: range_start } } : {}),
            },
            select: {
                summary_metrics: true,
                raw_response: true,
                fetched_at: true,
            },
        });
        const metrics_by_key = new Map<string, { volume: number; traffic: number; last_fetched_at: string }>();
        for (const snapshot of snapshots) {
            const target = extract_site_target_from_snapshot(snapshot.summary_metrics);
            if (!target.key) continue;
            const raw = to_record(snapshot.raw_response) ?? {};
            const rows = parse_top_queries_from_payload(raw.top_queries ?? raw, snapshot.fetched_at.toISOString());
            const volume_sum = rows.reduce((sum, row) => sum + (row.volume ?? 0), 0);
            const traffic_sum = rows.reduce((sum, row) => sum + (row.traffic ?? 0), 0);
            const existing = metrics_by_key.get(target.key) ?? {
                volume: 0,
                traffic: 0,
                last_fetched_at: snapshot.fetched_at.toISOString(),
            };
            existing.volume += volume_sum;
            existing.traffic += traffic_sum;
            if (snapshot.fetched_at.getTime() > new Date(existing.last_fetched_at).getTime()) {
                existing.last_fetched_at = snapshot.fetched_at.toISOString();
            }
            metrics_by_key.set(target.key, existing);
        }

        const freshness_buckets = {
            pending: 0,
            '0_24h': 0,
            '1_3d': 0,
            '3_7d': 0,
            '7d_plus': 0,
        };
        const host_coverage_map = new Map<string, { host: string; prompt_ids: Set<string>; website_count: number }>();

        const points = Array.from(site_map.values()).map((site) => {
            const metric = metrics_by_key.get(site.url) ?? metrics_by_key.get(site.host);
            const fetched_at = metric?.last_fetched_at ?? null;
            const bucket = freshness_bucket_for(fetched_at);
            freshness_buckets[bucket] += 1;

            const coverage = host_coverage_map.get(site.host) ?? {
                host: site.host,
                prompt_ids: new Set<string>(),
                website_count: 0,
            };
            for (const prompt_id of site.prompt_ids) {
                coverage.prompt_ids.add(prompt_id);
            }
            coverage.website_count += 1;
            host_coverage_map.set(site.host, coverage);

            return {
                url: site.url,
                host: site.host,
                prompt_count: site.prompt_ids.size,
                providers: Array.from(site.providers),
                aggregated_volume: metric?.volume ?? 0,
                aggregated_traffic: metric?.traffic ?? 0,
                fetched_at,
                freshness_bucket: bucket,
                last_seen_at: site.last_seen_at,
            };
        });

        return {
            range,
            version_id: version.id,
            generated_at: new Date().toISOString(),
            points: points.sort((a, b) => b.prompt_count - a.prompt_count),
            freshness_buckets: [
                { bucket: 'pending', count: freshness_buckets.pending },
                { bucket: '0_24h', count: freshness_buckets['0_24h'] },
                { bucket: '1_3d', count: freshness_buckets['1_3d'] },
                { bucket: '3_7d', count: freshness_buckets['3_7d'] },
                { bucket: '7d_plus', count: freshness_buckets['7d_plus'] },
            ],
            host_coverage: Array.from(host_coverage_map.values())
                .map((entry) => ({
                    host: entry.host,
                    prompt_count: entry.prompt_ids.size,
                    website_count: entry.website_count,
                }))
                .sort((a, b) => b.prompt_count - a.prompt_count)
                .slice(0, 25),
        };
    }

    async createCampaign(tenant_id: string, user_id: string, data: CreateCampaignDto) {
        return this.repo.createCampaign(tenant_id, user_id, data);
    }

    async listCampaigns(tenant_id: string, domain_id?: string) {
        return this.repo.listCampaigns(tenant_id, domain_id);
    }

    async getCampaign(tenant_id: string, campaign_id: string) {
        const campaign = await this.repo.getCampaign(tenant_id, campaign_id);
        if (!campaign) throw new Error('Campaign not found');
        return campaign;
    }

    async updateCampaign(tenant_id: string, campaign_id: string, data: UpdateCampaignDto) {
        return this.repo.updateCampaign(tenant_id, campaign_id, data);
    }

    async deleteCampaign(tenant_id: string, campaign_id: string) {
        return this.repo.deleteCampaign(tenant_id, campaign_id);
    }

    async listVersions(tenant_id: string, campaign_id: string) {
        const campaign = await this.repo.getCampaign(tenant_id, campaign_id);
        if (!campaign) throw new Error('Campaign not found');
        const versions = await this.repo.listVersions(tenant_id, campaign_id);
        return {
            campaign: {
                id: campaign.id,
                domain_id: campaign.domain_id,
                name: campaign.name,
                description: campaign.description,
                created_at: campaign.created_at,
                updated_at: campaign.updated_at,
            },
            versions: versions.map((version) => this.toVersionSummary(version)),
        };
    }

    async getActiveTree(tenant_id: string, campaign_id: string, version_id?: string) {
        const campaign = await this.repo.getCampaign(tenant_id, campaign_id);
        const version = await this.resolveVersion(tenant_id, campaign_id, undefined, version_id, false);
        if (!campaign || !version) return { campaign, version: null, roots: [] };

        const flatNodes = await this.repo.getVersionNodes(tenant_id, version.id);
        const nodeMap = new Map<string, any>();
        const roots: any[] = [];

        for (const node of flatNodes) {
            const metadata = to_record(node.metadata) ?? {};
            const display = node_display_label(node.type, node.content, metadata);
            const canonical_metadata: CanonicalNodeMetadata = {
                source: get_string(metadata.source),
                prompt_ref: get_string(metadata.prompt_ref),
                subquery_ref: get_string(metadata.subquery_ref),
                result_ref: get_string(metadata.result_ref),
                query_key: get_string(metadata.query_key),
                url: get_string(metadata.url),
                domain: get_string(metadata.domain),
                citation_title: get_string(metadata.citation_title) ?? get_string(metadata.title),
                lineage: {
                    capture_turn_id: get_string(metadata.capture_turn_id) ?? node.capture_turn_id ?? undefined,
                    origin_provider: get_string(metadata.origin_provider) ?? get_string(metadata.chat_provider),
                    origin_request_id: get_string(metadata.origin_request_id) ?? get_string(metadata.request_id),
                    source_version_id: get_string(metadata.source_version_id) ?? version.id,
                },
                refresh: {
                    refreshable:
                        node.type === NodeType.prompt ||
                        node.type === NodeType.subquery ||
                        (node.type === NodeType.generated && get_string(metadata.source) === 'suggestion'),
                    refresh_count: to_positive_int(metadata.refresh_count),
                    refresh_status: parse_refresh_status(metadata.refresh_status),
                    last_refreshed_at: get_string(metadata.last_refreshed_at),
                    last_refresh_run_id: get_string(metadata.last_refresh_run_id),
                    refresh_provider: get_string(metadata.refresh_provider),
                    refresh_source_version_id: get_string(metadata.refresh_source_version_id),
                },
                ui: {
                    display_label: display.label,
                    is_unmapped: display.is_unmapped,
                    is_system: display.is_system,
                },
            };
            nodeMap.set(node.id, {
                ...node,
                metadata: canonical_metadata,
                children: [],
            });
        }

        for (const node of nodeMap.values()) {
            if (node.parent_id && nodeMap.has(node.parent_id)) {
                nodeMap.get(node.parent_id).children.push(node);
            } else {
                roots.push(node);
            }
        }

        return { campaign, version: this.toVersionSummary(version), roots };
    }

    async getActiveChatThreads(tenant_id: string, campaign_id: string, limit: number, offset: number, version_id?: string) {
        const version = await this.resolveVersion(tenant_id, campaign_id, undefined, version_id, false);
        // New campaign has no threads yet — return empty list, not an error
        if (!version) return { threads: [], total_count: 0, limit, offset, has_more: false };
        const raw_threads = await this.repo.getChatThreads(tenant_id, version.id, limit, offset);
        const threads = raw_threads.map((thread) => this.toChatThreadSummary(thread));
        return {
            version: this.toVersionSummary(version),
            threads,
            total_count: threads.length,
            limit,
            offset,
            has_more: false,
        };
    }

    async linkChatThread(tenant_id: string, user_id: string, campaign_id: string, data: LinkChatThreadDto, version_id?: string) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }
        const linked = await this.repo.linkChatThread({
            tenant_id,
            campaign_version_id: version.id,
            chat_provider: data.chat_provider,
            conversation_id: data.conversation_id,
            provider_chat_id: data.provider_chat_id,
            chat_url: data.chat_url,
            chat_title: data.chat_title,
        });
        return this.toChatThreadSummary({
            ...linked,
            chat_provider: linked.chat_provider as StreamProvider,
            turn_count: 0,
        });
    }

    async markChatThreadOpened(tenant_id: string, campaign_id: string, thread_id: string) {
        // Verify campaign belongs to tenant first
        const campaign = await this.repo.getCampaign(tenant_id, campaign_id);
        if (!campaign) return null;
        const opened = await this.repo.markChatThreadOpened(tenant_id, thread_id);
        if (!opened) return null;
        const turn_count = await prisma.captureTurn.count({ where: { capture_session_id: opened.id, tenant_id } });
        return this.toChatThreadSummary({
            ...opened,
            chat_provider: opened.chat_provider as StreamProvider,
            turn_count,
        });
    }

    async getGeneratedSuggestions(tenant_id: string, campaign_id: string, limit: number, offset: number, version_id?: string) {
        const normalized_limit = Math.min(Math.max(limit, 1), 50);
        const normalized_offset = Math.max(offset, 0);
        const version = await this.resolveVersion(tenant_id, campaign_id, undefined, version_id, false);
        if (!version) {
            return {
                version: null,
                prompts: [],
                total_count: 0,
                limit: normalized_limit,
                offset: normalized_offset,
                has_more: false,
            };
        }

        const all_generated = await prisma.promptNode.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                type: NodeType.generated,
            },
            orderBy: { created_at: 'desc' },
        });

        const suggestion_nodes = all_generated.filter((node) => {
            const metadata = to_record(node.metadata) ?? {};
            return get_string(metadata.source) === 'suggestion';
        });

        const page = suggestion_nodes.slice(normalized_offset, normalized_offset + normalized_limit);
        return {
            version: this.toVersionSummary(version),
            prompts: page.map((node) => {
                const metadata = to_record(node.metadata) ?? {};
                return {
                    node_id: node.id,
                    prompt: node.content,
                    reason: get_string(metadata.reason),
                    target_subquery: get_string(metadata.target_subquery),
                    created_at: node.created_at.toISOString(),
                };
            }),
            total_count: suggestion_nodes.length,
            limit: normalized_limit,
            offset: normalized_offset,
            has_more: normalized_offset + page.length < suggestion_nodes.length,
        };
    }

    async generateSuggestions(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        max_suggestions: number,
        version_id?: string,
        append = false,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const turns = await prisma.captureTurn.findMany({
            where: {
                tenant_id,
                capture_session: {
                    campaign_version_id: version.id,
                },
            },
            orderBy: { created_at: 'desc' },
            take: 200,
        });
        const seen_prompt_keys = new Set<string>();
        const recent_prompt_texts: string[] = [];
        for (const turn of turns) {
            const prompt = normalize_prompt(turn.prompt);
            if (!prompt || is_imported_prompt_fallback(prompt)) continue;
            const key = normalize_text_key(prompt);
            if (seen_prompt_keys.has(key)) continue;
            seen_prompt_keys.add(key);
            recent_prompt_texts.push(prompt);
            if (recent_prompt_texts.length >= 20) break;
        }
        if (!recent_prompt_texts.length) {
            throw new Error('No executed prompts found yet to generate suggestions');
        }

        const parent_prompt_node = await prisma.promptNode.findFirst({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                type: NodeType.prompt,
            },
            orderBy: { created_at: 'desc' },
            select: { id: true, depth: true, capture_turn_id: true },
        });

        const version_config = to_record(version.config_json) ?? {};
        const active_batch_id = get_string(version_config.workflow_active_suggestion_batch_id);
        const suggestion_batch_id = append
            ? (active_batch_id ?? randomUUID())
            : randomUUID();
        const generation_run_id = randomUUID();
        const generation_run = await prisma.generationRun.create({
            data: {
                tenant_id,
                campaign_version_id: version.id,
                capture_turn_id: parent_prompt_node?.capture_turn_id ?? undefined,
                status: 'processing',
                started_at: new Date(),
            },
        });

        try {
            const llm_suggestions = await build_suggestions_from_openai(recent_prompt_texts, max_suggestions);

            const existing_rows = append
                ? await prisma.promptNode.findMany({
                    where: {
                        tenant_id,
                        campaign_version_id: version.id,
                        type: NodeType.generated,
                    },
                    select: { content: true, metadata: true },
                })
                : [];
            const existing_keys = new Set<string>();
            for (const row of existing_rows) {
                const metadata = to_record(row.metadata) ?? {};
                if (get_string(metadata.source) !== 'suggestion') continue;
                const row_batch_id = get_string(metadata.suggestion_batch_id) ?? get_string(metadata.generation_run_id);
                if (row_batch_id !== suggestion_batch_id) continue;
                existing_keys.add(normalize_text_key(row.content));
            }

            const unique_suggestions = llm_suggestions.filter((item) => !existing_keys.has(normalize_text_key(item.prompt)));
            if (!unique_suggestions.length) {
                throw new Error('No new unique prompt suggestions were generated');
            }

            const parent_id = parent_prompt_node?.id ?? null;
            const base_depth = parent_prompt_node ? parent_prompt_node.depth + 1 : 0;
            await Promise.all(
                unique_suggestions.map((item) =>
                    this.repo.createNode({
                        tenant_id,
                        campaign_version_id: version.id,
                        parent_id,
                        type: NodeType.generated,
                        content: item.prompt,
                        depth: base_depth,
                        metadata: {
                            source: 'suggestion',
                            reason: item.reason,
                            generation_run_id,
                            suggestion_batch_id,
                            created_by_user_id: user_id,
                            origin_provider: 'system',
                            source_version_id: version.id,
                            refreshable: true,
                            refresh_count: 0,
                            refresh_status: 'idle',
                        },
                    }),
                ),
            );

            await prisma.campaignVersion.update({
                where: { id: version.id },
                data: {
                    config_json: {
                        ...version_config,
                        workflow_active_suggestion_batch_id: suggestion_batch_id,
                        workflow_last_suggestion_generation_at: new Date().toISOString(),
                    } as Prisma.InputJsonValue,
                },
            });

            await prisma.generationRun.update({
                where: { id: generation_run.id },
                data: {
                    status: 'completed',
                    finished_at: new Date(),
                    error_message: null,
                },
            });

            return {
                generation_run_id,
                version: this.toVersionSummary(version),
                site_insights: [],
                suggested_prompts: unique_suggestions,
            };
        } catch (error) {
            await prisma.generationRun.update({
                where: { id: generation_run.id },
                data: {
                    status: 'failed',
                    finished_at: new Date(),
                    error_message: error instanceof Error ? error.message : 'Failed to generate suggestions',
                },
            });
            throw error;
        }
    }

    async ingestTurn(tenant_id: string, user_id: string, campaign_id: string, data: IngestTurnDto, version_id?: string) {
        const normalized_prompt = normalize_prompt(data.prompt);
        const normalized_queries = Array.from(
            new Set(
                (data.queries ?? [])
                    .map((query) => normalize_query(query))
                    .filter((query) => Boolean(query)),
            ),
        ).slice(0, MAX_QUERY_COUNT);
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const session = await this.repo.findOrCreateSession(
            tenant_id,
            version.id,
            data.chat_provider,
            data.conversation_id
        );

        // Idempotency guard for duplicate provider events.
        if (data.request_id && data.turn_exchange_id) {
            const existing_turn = await prisma.captureTurn.findFirst({
                where: {
                    tenant_id,
                    capture_session_id: session.id,
                    request_id: data.request_id,
                    turn_exchange_id: data.turn_exchange_id,
                },
                select: { id: true },
            });
            if (existing_turn) {
                return this.getActiveTree(tenant_id, campaign_id, version.id);
            }
        }

        const ingest_metadata = to_record(data.metadata) ?? {};
        const refresh_target_node_id = get_string(ingest_metadata.refresh_target_node_id);
        let refresh_target_node:
            | { id: string; parent_id: string | null; depth: number; type: NodeType }
            | null = null;
        let refresh_delete_ids: string[] = [];
        let refresh_mode: 'none' | 'prompt' | 'subquery' = 'none';

        if (refresh_target_node_id) {
            const target = await prisma.promptNode.findFirst({
                where: {
                    id: refresh_target_node_id,
                    tenant_id,
                    campaign_version_id: version.id,
                },
                select: { id: true, parent_id: true, depth: true, type: true },
            });
            if (target) {
                refresh_target_node = target;
                refresh_mode = target.type === NodeType.subquery ? 'subquery' : 'prompt';

                const flat_nodes = await this.repo.getVersionNodes(tenant_id, version.id);
                const children_by_parent = new Map<string, string[]>();
                for (const row of flat_nodes) {
                    if (!row.parent_id) continue;
                    const bucket = children_by_parent.get(row.parent_id) ?? [];
                    bucket.push(row.id);
                    children_by_parent.set(row.parent_id, bucket);
                }
                const stack = [target.id];
                const seen = new Set<string>();
                while (stack.length) {
                    const current = stack.pop()!;
                    if (seen.has(current)) continue;
                    seen.add(current);
                    refresh_delete_ids.push(current);
                    const children = children_by_parent.get(current) ?? [];
                    for (const child of children) stack.push(child);
                }
            }
        }

        // Try to find the parent node if active_prompt_node_id is provided
        let parent_id = data.active_prompt_node_id || null;
        let depth = 0;

        if (refresh_target_node) {
            parent_id = refresh_target_node.parent_id;
            depth = refresh_target_node.depth;
        }

        if (parent_id) {
            const parent = await prisma.promptNode.findFirst({ where: { id: parent_id, tenant_id } });
            if (parent) {
                depth = parent.depth + 1;
            } else {
                parent_id = null; // invalid parent provided
            }
        }

        const capture_turn_id = randomUUID();
        const now = new Date();
        const normalized_events = normalize_turn_events({
            capture_turn_id,
            data,
            normalized_prompt,
            normalized_queries,
            occurred_at: now,
        });
        const normalized_fact_count = normalized_events.length;
        console.log('[AI-SEO][INGEST]', 'normalized facts before write', {
            capture_turn_id,
            provider: data.chat_provider,
            normalized_fact_count,
            prompt_preview: truncate_for_log(normalized_prompt),
        });

        let capture_turn;
        try {
            capture_turn = await prisma.captureTurn.create({
                data: {
                    id: capture_turn_id,
                    tenant_id,
                    capture_session_id: session.id,
                    request_id: data.request_id,
                    turn_exchange_id: data.turn_exchange_id,
                    prompt: normalized_prompt,
                    finished_reason: data.finished_reason,
                    metadata: data.metadata ?? Prisma.JsonNull,
                    raw_event_json: {
                        schema_version: 'v1-deterministic-stream-facts',
                        capture_turn_id,
                        provider: data.chat_provider,
                        provider_conversation_id: data.conversation_id,
                        provider_request_id: data.request_id,
                        provider_turn_exchange_id: data.turn_exchange_id,
                        normalized_events: normalized_events as unknown as Prisma.InputJsonValue,
                        normalized_fact_count,
                        query_input_count: normalized_queries.length,
                        result_group_input_count: data.result_groups?.length ?? 0,
                    } as Prisma.InputJsonValue,
                    prompt_detected_at: now,
                    response_finished_at: now,
                },
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002' &&
                data.request_id &&
                data.turn_exchange_id
            ) {
                // Duplicate ingest for same provider turn; treat as idempotent success.
                return this.getActiveTree(tenant_id, campaign_id, version.id);
            }
            throw error;
        }

        const persisted_payload = safe_json_record(capture_turn.raw_event_json);
        const persisted_events_raw = persisted_payload.normalized_events;
        const persisted_events = Array.isArray(persisted_events_raw) ? (persisted_events_raw as NormalizedTurnEvent[]) : [];
        console.log('[AI-SEO][INGEST]', 'persisted facts after write', {
            capture_turn_id,
            persisted_fact_count: persisted_events.length,
        });

        const materialized = materialize_turn_from_events(persisted_events);
        let persisted_subquery_count = 0;
        let persisted_result_count = 0;
        let persisted_unscoped_count = 0;
        let persisted_prompt_count = 0;
        if (refresh_mode === 'subquery') {
            const refresh_subqueries = materialized.subqueries.slice(0, MAX_QUERY_COUNT);
            const fallback_subqueries =
                refresh_subqueries.length > 0
                    ? refresh_subqueries
                    : [
                        {
                            query_key: normalize_query_key(normalized_prompt || '__unscoped__'),
                            label: normalized_prompt || '__unscoped__',
                            subquery_ref: deterministic_hash(capture_turn_id, 'subquery-fallback'),
                            first_seen_seq: 0,
                            sites: [],
                        },
                    ];

            for (const subquery of fallback_subqueries) {
                const subquery_node = await this.repo.createNode({
                    tenant_id,
                    campaign_version_id: version.id,
                    capture_session_id: session.id,
                    capture_turn_id: capture_turn.id,
                    parent_id,
                    type: NodeType.subquery,
                    content: subquery.query_key === '__unscoped__' ? '__unscoped__' : subquery.label,
                    depth,
                    metadata: {
                        source: 'capture_query',
                        query_key: subquery.query_key,
                        subquery_ref: subquery.subquery_ref,
                        first_seen_seq: subquery.first_seen_seq,
                        origin_provider: data.chat_provider,
                        origin_request_id: data.request_id,
                        capture_turn_id,
                        source_version_id: version.id,
                        refreshable: true,
                        refresh_count: 0,
                        refresh_status: 'idle',
                    },
                });
                persisted_subquery_count += 1;

                const max_sites = subquery.query_key === '__unscoped__' ? MAX_UNSCOPED_SITES : MAX_SITES_PER_QUERY;
                const sites = subquery.sites.slice(0, max_sites);
                if (subquery.query_key === '__unscoped__') {
                    persisted_unscoped_count += sites.length;
                }
                for (const site of sites) {
                    await this.repo.createNode({
                        tenant_id,
                        campaign_version_id: version.id,
                        capture_session_id: session.id,
                        capture_turn_id: capture_turn.id,
                        parent_id: subquery_node.id,
                        type: NodeType.site,
                        content: site.site_name,
                        depth: depth + 1,
                        metadata: {
                            source: 'citation',
                            url: site.url,
                            domain: infer_site_name_from_url(site.url),
                            citation_title: site.title,
                            result_ref: site.result_ref,
                            first_seen_seq: site.first_seen_seq,
                            subquery_ref: subquery.subquery_ref,
                            query_key: subquery.query_key,
                            origin_provider: data.chat_provider,
                            origin_request_id: data.request_id,
                            capture_turn_id,
                            source_version_id: version.id,
                            refreshable: false,
                            refresh_count: 0,
                            refresh_status: 'idle',
                        },
                    });
                    persisted_result_count += 1;
                }
            }
        } else {
            const prompt_node = await this.repo.createNode({
                tenant_id,
                campaign_version_id: version.id,
                capture_session_id: session.id,
                capture_turn_id: capture_turn.id,
                parent_id,
                type: NodeType.prompt,
                content: materialized.prompt.text || normalized_prompt,
                depth,
                metadata: {
                    source: 'extension',
                    imported_at: now.toISOString(),
                    request_id: data.request_id,
                    turn_exchange_id: data.turn_exchange_id,
                    chat_provider: data.chat_provider,
                    origin_provider: data.chat_provider,
                    origin_request_id: data.request_id,
                    prompt_ref: materialized.prompt.prompt_ref,
                    capture_turn_id,
                    provider_turn_id: provider_turn_id_for(data),
                    source_version_id: version.id,
                    refreshable: true,
                    refresh_count: 0,
                    refresh_status: 'idle',
                },
            });
            persisted_prompt_count = 1;

            for (const subquery of materialized.subqueries.slice(0, MAX_QUERY_COUNT)) {
                const subquery_node = await this.repo.createNode({
                    tenant_id,
                    campaign_version_id: version.id,
                    capture_session_id: session.id,
                    capture_turn_id: capture_turn.id,
                    parent_id: prompt_node.id,
                    type: NodeType.subquery,
                    content: subquery.query_key === '__unscoped__' ? '__unscoped__' : subquery.label,
                    depth: depth + 1,
                    metadata: {
                        source: 'capture_query',
                        query_key: subquery.query_key,
                        subquery_ref: subquery.subquery_ref,
                        first_seen_seq: subquery.first_seen_seq,
                        origin_provider: data.chat_provider,
                        origin_request_id: data.request_id,
                        capture_turn_id,
                        source_version_id: version.id,
                        refreshable: true,
                        refresh_count: 0,
                        refresh_status: 'idle',
                    },
                });
                persisted_subquery_count += 1;

                const max_sites = subquery.query_key === '__unscoped__' ? MAX_UNSCOPED_SITES : MAX_SITES_PER_QUERY;
                const sites = subquery.sites.slice(0, max_sites);
                if (subquery.query_key === '__unscoped__') {
                    persisted_unscoped_count += sites.length;
                }
                for (const site of sites) {
                    await this.repo.createNode({
                        tenant_id,
                        campaign_version_id: version.id,
                        capture_session_id: session.id,
                        capture_turn_id: capture_turn.id,
                        parent_id: subquery_node.id,
                        type: NodeType.site,
                        content: site.site_name,
                        depth: depth + 2,
                        metadata: {
                            source: 'citation',
                            url: site.url,
                            domain: infer_site_name_from_url(site.url),
                            citation_title: site.title,
                            result_ref: site.result_ref,
                            first_seen_seq: site.first_seen_seq,
                            subquery_ref: subquery.subquery_ref,
                            query_key: subquery.query_key,
                            origin_provider: data.chat_provider,
                            origin_request_id: data.request_id,
                            capture_turn_id,
                            source_version_id: version.id,
                            refreshable: false,
                            refresh_count: 0,
                            refresh_status: 'idle',
                        },
                    });
                    persisted_result_count += 1;
                }
            }
        }

        if (refresh_delete_ids.length) {
            await prisma.promptNode.deleteMany({
                where: {
                    tenant_id,
                    campaign_version_id: version.id,
                    id: { in: refresh_delete_ids },
                },
            });
        }

        const persisted_node_count = persisted_prompt_count + persisted_subquery_count + persisted_result_count;
        console.log('[AI-SEO][INGEST]', 'materialized node count before response', {
            capture_turn_id,
            persisted_node_count,
            persisted_subquery_count,
            persisted_result_count,
            persisted_unscoped_count,
        });
        const expected = materialized.expected_counts;
        if (
            expected.subquery_count !== persisted_subquery_count ||
            expected.result_count !== persisted_result_count ||
            expected.unscoped_count !== persisted_unscoped_count
        ) {
            console.warn('[AI-SEO][INGEST][MISMATCH]', {
                capture_turn_id,
                expected_subquery_count: expected.subquery_count,
                expected_result_count: expected.result_count,
                expected_unscoped_count: expected.unscoped_count,
                persisted_subquery_count,
                persisted_result_count,
                persisted_unscoped_count,
            });
        }

        await prisma.captureSession.update({
            where: { id: session.id },
            data: {
                last_event_at: now,
                provider_chat_id: data.provider_chat_id || session.provider_chat_id,
                chat_title: data.chat_title || session.chat_title,
                chat_url: data.chat_url || session.chat_url,
            }
        });

        // Fire and forget lead signal extraction
        leadIntelligenceService.extractSignalsFromTurn(
            tenant_id,
            user_id,
            capture_turn.id,
            normalized_prompt
        ).catch((err: any) => console.error('[LeadIntelligence] Extraction failed:', err));

        return this.getActiveTree(tenant_id, campaign_id, version.id);
    }

    async refreshNode(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        node_id: string,
        payload: RefreshNodeDto,
        version_id?: string,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const node = await prisma.promptNode.findFirst({
            where: {
                id: node_id,
                tenant_id,
                campaign_version_id: version.id,
            },
        });
        if (!node) {
            throw new Error('Node not found in selected version');
        }

        const existing = to_record(node.metadata) ?? {};
        const refreshable =
            node.type === NodeType.prompt ||
            node.type === NodeType.subquery ||
            (node.type === NodeType.generated && get_string(existing.source) === 'suggestion');
        if (!refreshable) {
            throw new Error('Node is not refreshable');
        }

        const run_id = randomUUID();
        const now = new Date().toISOString();
        const next_refresh_count = to_positive_int(existing.refresh_count) + 1;
        const refresh_provider =
            payload.provider && payload.provider !== 'unknown'
                ? payload.provider
                : get_string(existing.origin_provider) ?? get_string(existing.chat_provider) ?? 'unknown';

        let target_node = node;
        if (payload.scope === 'branch' && node.type !== NodeType.prompt) {
            const flat_nodes = await this.repo.getVersionNodes(tenant_id, version.id);
            const by_id = new Map(flat_nodes.map((row) => [row.id, row]));
            let cursor = node.parent_id ? by_id.get(node.parent_id) : null;
            while (cursor) {
                if (cursor.type === NodeType.prompt) {
                    target_node = cursor;
                    break;
                }
                cursor = cursor.parent_id ? by_id.get(cursor.parent_id) ?? null : null;
            }
        }

        const replay_prompt = normalize_prompt(target_node.content);
        const replay_target_type =
            target_node.type === NodeType.subquery
                ? 'subquery'
                : target_node.type === NodeType.generated
                    ? 'generated'
                    : 'prompt';

        const forked = await this.repo.forkVersionForRefresh({
            tenant_id,
            campaign_id,
            user_id,
            source_version_id: version.id,
            source_target_node_id: target_node.id,
            refresh_provider,
            refresh_scope: payload.scope ?? 'node',
        });

        const cloned_target = await prisma.promptNode.findFirst({
            where: {
                id: forked.mapped_target_node_id,
                tenant_id,
                campaign_version_id: forked.version.id,
            },
        });
        if (!cloned_target) {
            throw new Error('Mapped refresh target node not found in new version');
        }

        const cloned_metadata = to_record(cloned_target.metadata) ?? {};
        const updated_metadata: Record<string, unknown> = {
            ...cloned_metadata,
            refreshable: true,
            refresh_count: next_refresh_count,
            refresh_status: 'queued',
            last_refresh_run_id: run_id,
            refresh_provider,
            refresh_source_version_id: version.id,
            refresh_scope: payload.scope ?? 'node',
            refresh_created_version_id: forked.version.id,
            refresh_target_source_node_id: target_node.id,
        };

        await prisma.promptNode.update({
            where: { id: cloned_target.id },
            data: {
                metadata: updated_metadata as Prisma.InputJsonValue,
                updated_at: new Date(),
            },
        });

        return {
            refresh_run_id: run_id,
            node_id: cloned_target.id,
            version_id: forked.version.id,
            status: 'queued' as const,
            provider: refresh_provider,
            scope: payload.scope ?? 'node',
            prompt: replay_prompt,
            target_node_id: cloned_target.id,
            target_node_type: replay_target_type as 'prompt' | 'subquery' | 'generated',
            started_at: now,
            message: 'Refresh queued in a new version. Re-run this prompt in the selected provider and ingest to replace this branch.',
        };
    }

    async refire(tenant_id: string, campaign_id: string, user_id: string, source_version_number: number) {
        return this.repo.refireVersion(tenant_id, campaign_id, user_id, source_version_number);
    }
}

export const campaignService = new CampaignService(campaignRepository);
