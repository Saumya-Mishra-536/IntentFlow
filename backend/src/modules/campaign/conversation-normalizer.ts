type WorkflowProvider = 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'unknown';

export interface PromptCandidateItem {
    id: string;
    text: string;
    source: 'auto' | 'manual';
    selected: boolean;
    status: 'new' | 'fired' | 'running' | 'failed';
    lastExecutionAt?: string;
}

export interface KeywordQueryItem {
    query: string;
    sourceProvider: WorkflowProvider;
    sourcePromptId?: string;
    firstSeenAt: string;
}

export interface CrawledWebsiteItem {
    url: string;
    host: string;
    source: string;
    firstSeenAt: string;
}

export interface PlaceFoundItem {
    name: string;
    address?: string;
    rating?: number;
    reviewCount?: number;
    websiteUrl?: string;
    category?: string;
}

export interface PromptVersionMetaItem {
    versionDate?: string;
    lastExecutionDate?: string;
    provider: WorkflowProvider;
    conversationId: string;
}

export interface NormalizedConversationData {
    prompt: string;
    searchedKeywords: KeywordQueryItem[];
    crawledWebsites: CrawledWebsiteItem[];
    placesFound: PlaceFoundItem[];
    promptCandidates: PromptCandidateItem[];
    resultGroups: unknown[];
    versionMeta: PromptVersionMetaItem;
    warnings: string[];
}

interface NormalizeParams {
    provider: WorkflowProvider;
    conversationId: string;
    payload: unknown;
    promptCandidates?: PromptCandidateItem[];
    versionDate?: string;
    lastExecutionDate?: string;
}

interface MessageNode {
    id: string;
    order: number;
    role: string;
    authorName?: string;
    createTime?: number;
    message: Record<string, unknown>;
}

const to_record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const to_array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const get_string = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
};

const to_number = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};

const collapse_spaces = (value: string): string => value.replace(/\s+/g, ' ').trim();
const normalize_text_key = (value: string): string => collapse_spaces(value).toLowerCase();

const canonicalize_url = (raw?: string): string | undefined => {
    if (!raw) return undefined;
    try {
        const parsed = new URL(raw.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
        parsed.hash = '';

        const delete_keys: string[] = [];
        parsed.searchParams.forEach((_value, key) => {
            if (
                key.toLowerCase().startsWith('utm_') ||
                key.toLowerCase() === 'gclid' ||
                key.toLowerCase() === 'fbclid' ||
                key.toLowerCase() === 'igshid'
            ) {
                delete_keys.push(key);
            }
        });
        delete_keys.forEach((key) => parsed.searchParams.delete(key));

        parsed.hostname = parsed.hostname.toLowerCase();
        if (parsed.pathname === '/') {
            parsed.pathname = '';
        }
        const normalized = parsed.toString();
        return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
    } catch {
        return undefined;
    }
};

const host_from_url = (raw?: string): string | undefined => {
    if (!raw) return undefined;
    try {
        return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return undefined;
    }
};

const pick_latest_node = (nodes: MessageNode[]): MessageNode | undefined => {
    if (!nodes.length) return undefined;
    return [...nodes].sort((a, b) => {
        const a_time = a.createTime ?? -1;
        const b_time = b.createTime ?? -1;
        if (a_time !== b_time) return b_time - a_time;
        return b.order - a.order;
    })[0];
};

const extract_current_node_chain_rank = (payload: unknown): Map<string, number> => {
    const root = to_record(payload) ?? {};
    const mapping = to_record(root.mapping);
    const current_node = get_string(root.current_node);
    if (!mapping || !current_node) {
        return new Map();
    }

    const rank = new Map<string, number>();
    const seen = new Set<string>();
    let cursor: string | undefined = current_node;
    let index = 0;
    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        rank.set(cursor, index);
        index += 1;
        const entry = to_record(mapping[cursor]);
        cursor = get_string(entry?.parent);
    }
    return rank;
};

const extract_messages = (payload: unknown): MessageNode[] => {
    const root = to_record(payload) ?? {};
    const mapping = to_record(root.mapping);
    if (!mapping) return [];

    const nodes: MessageNode[] = [];
    Object.entries(mapping).forEach(([id, entry], index) => {
        const node = to_record(entry);
        if (!node) return;
        const message = to_record(node.message);
        if (!message) return;
        const author = to_record(message.author) ?? {};
        const role = get_string(author.role) ?? 'unknown';
        const author_name = get_string(author.name);
        const create_time = to_number(message.create_time) ?? to_number(node.create_time);
        nodes.push({
            id,
            order: index,
            role,
            authorName: author_name,
            createTime: create_time,
            message,
        });
    });
    return nodes;
};

const extract_message_text = (message: Record<string, unknown>): string | undefined => {
    const content = to_record(message.content);
    if (!content) return undefined;
    const parts = to_array(content.parts);
    for (const part of parts) {
        const text = get_string(part);
        if (text) return collapse_spaces(text);
    }
    return undefined;
};

const dedupe_queries = (queries: string[]): string[] => {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const query of queries) {
        const normalized = collapse_spaces(query);
        if (!normalized) continue;
        const key = normalize_text_key(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(normalized);
    }
    return output;
};

const get_latest_assistant_metadata = (messages: MessageNode[], payload: unknown): Record<string, unknown> | null => {
    const assistants = messages.filter((node) => node.role === 'assistant');
    if (!assistants.length) return null;

    const with_create_time = assistants.filter((node) => node.createTime !== undefined);
    const assistant = with_create_time.length
        ? pick_latest_node(with_create_time)
        : (() => {
            const chain_rank = extract_current_node_chain_rank(payload);
            const in_chain = assistants
                .map((node) => ({
                    node,
                    rank: chain_rank.get(node.id),
                }))
                .filter((item): item is { node: MessageNode; rank: number } => item.rank !== undefined)
                .sort((a, b) => a.rank - b.rank);
            if (in_chain.length) {
                return in_chain[0].node;
            }
            return pick_latest_node(assistants);
        })();

    if (!assistant) return null;
    const metadata = to_record(assistant.message.metadata);
    return metadata ?? null;
};

const extract_urls_from_search_groups = (search_groups: unknown): string[] => {
    const urls: string[] = [];
    const groups = to_array(search_groups);
    for (const group of groups) {
        const group_record = to_record(group);
        if (!group_record) continue;
        const entries = to_array(group_record.entries);
        for (const entry of entries) {
            const entry_record = to_record(entry);
            if (!entry_record) continue;
            const url = canonicalize_url(get_string(entry_record.url));
            if (url) urls.push(url);
        }
    }
    return urls;
};

const extract_assistant_websites = (metadata: Record<string, unknown> | null): Array<{ url: string; source: string }> => {
    if (!metadata) return [];
    const websites: Array<{ url: string; source: string }> = [];

    const push = (url: string | undefined, source: string) => {
        const normalized = canonicalize_url(url);
        if (!normalized) return;
        websites.push({ url: normalized, source });
    };

    const content_references = to_array(metadata.content_references);
    for (const reference of content_references) {
        const reference_record = to_record(reference);
        if (!reference_record) continue;
        const type = get_string(reference_record.type);
        if (type === 'grouped_webpages') {
            const items = to_array(reference_record.items);
            for (const item of items) {
                const item_record = to_record(item);
                if (!item_record) continue;
                push(get_string(item_record.url), 'grouped_webpages');
                const supporting = to_array(item_record.supporting_websites);
                for (const support of supporting) {
                    const support_record = to_record(support);
                    if (!support_record) continue;
                    push(get_string(support_record.url), 'supporting_website');
                }
            }
        }
        if (type === 'sources_footnote') {
            const sources = to_array(reference_record.sources);
            for (const source of sources) {
                const source_record = to_record(source);
                if (!source_record) continue;
                push(get_string(source_record.url), 'sources_footnote');
            }
        }
    }

    extract_urls_from_search_groups(metadata.search_result_groups).forEach((url) =>
        websites.push({ url, source: 'assistant_search_result_groups' }),
    );

    to_array(metadata.safe_urls).forEach((value) =>
        push(get_string(value), 'assistant_safe_urls'),
    );

    return websites;
};

const extract_top_level_safe_urls = (payload: unknown): string[] => {
    const root = to_record(payload) ?? {};
    return to_array(root.safe_urls)
        .map((value) => canonicalize_url(get_string(value)))
        .filter((value): value is string => Boolean(value));
};

const extract_tool_data = (messages: MessageNode[]): {
    queries: string[];
    urls: string[];
} => {
    const queries: string[] = [];
    const urls: string[] = [];

    for (const node of messages) {
        if (node.role !== 'tool' || node.authorName !== 'web.run') continue;
        const metadata = to_record(node.message.metadata) ?? {};
        const search_model_queries = to_record(metadata.search_model_queries);
        if (search_model_queries) {
            for (const query of to_array(search_model_queries.queries)) {
                const query_record = to_record(query);
                const text = get_string(query) ?? get_string(query_record?.q) ?? get_string(query_record?.query);
                if (text) queries.push(text);
            }
        }
        extract_urls_from_search_groups(metadata.search_result_groups).forEach((url) => urls.push(url));
    }

    return { queries: dedupe_queries(queries), urls };
};

const extract_places = (metadata: Record<string, unknown> | null): PlaceFoundItem[] => {
    if (!metadata) return [];
    const places: PlaceFoundItem[] = [];
    const seen = new Set<string>();
    const content_references = to_array(metadata.content_references);

    for (const reference of content_references) {
        const item = to_record(reference);
        if (!item || get_string(item.type) !== 'entity') continue;
        const entity_data = to_record(item.entity_data) ?? {};
        const name = get_string(item.name) ?? get_string(entity_data.name);
        if (!name) continue;
        const address =
            get_string(entity_data.address) ??
            get_string(to_record(item.extra_params)?.address);
        const website_url = canonicalize_url(get_string(entity_data.website_url));
        const rating = to_number(entity_data.rating);
        const review_count = to_number(entity_data.review_count);
        const category = get_string(to_array(entity_data.categories)[0]);
        const key = `${normalize_text_key(name)}|${normalize_text_key(address ?? '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        places.push({
            name,
            ...(address ? { address } : {}),
            ...(rating !== undefined ? { rating } : {}),
            ...(review_count !== undefined ? { reviewCount: Math.floor(review_count) } : {}),
            ...(website_url ? { websiteUrl: website_url } : {}),
            ...(category ? { category } : {}),
        });
    }

    return places;
};

const to_keyword_items = (queries: string[], provider: WorkflowProvider, now_iso: string): KeywordQueryItem[] =>
    queries.map((query) => ({
        query,
        sourceProvider: provider,
        firstSeenAt: now_iso,
    }));

const to_website_items = (websites: Array<{ url: string; source: string }>, now_iso: string): CrawledWebsiteItem[] => {
    const seen = new Set<string>();
    const output: CrawledWebsiteItem[] = [];
    for (const entry of websites) {
        const normalized = canonicalize_url(entry.url);
        if (!normalized || seen.has(normalized)) continue;
        const host = host_from_url(normalized);
        if (!host) continue;
        seen.add(normalized);
        output.push({
            url: normalized,
            host,
            source: entry.source,
            firstSeenAt: now_iso,
        });
    }
    return output;
};

const build_result_groups = (
    websites: CrawledWebsiteItem[],
    keywords: KeywordQueryItem[],
): unknown[] => {
    const site_rows = websites.slice(0, 8).map((site) => ({
        site_name: site.host,
        url: site.url,
        title: site.host,
    }));

    if (!site_rows.length) {
        return [];
    }

    if (!keywords.length) {
        return [{
            query: '__unscoped__',
            results: site_rows.slice(0, 4),
        }];
    }

    return keywords.slice(0, 20).map((item) => ({
        query: item.query,
        results: site_rows,
    }));
};

const extract_text_like = (value: unknown): string | undefined => {
    const direct = get_string(value);
    if (direct) return collapse_spaces(direct);
    if (Array.isArray(value)) {
        for (const entry of value) {
            const nested = extract_text_like(entry);
            if (nested) return nested;
        }
        return undefined;
    }
    const obj = to_record(value);
    if (!obj) return undefined;
    return (
        extract_text_like(obj.text) ??
        extract_text_like(obj.value) ??
        extract_text_like(obj.message) ??
        extract_text_like(obj.content)
    );
};

const extract_urls_from_unknown = (value: unknown): string[] => {
    const urls: string[] = [];
    const seen = new Set<unknown>();
    const walk = (current: unknown, depth = 0) => {
        if (depth > 10 || current === null || current === undefined) return;
        if (typeof current !== 'object') return;
        if (seen.has(current)) return;
        seen.add(current);

        if (Array.isArray(current)) {
            current.forEach((entry) => walk(entry, depth + 1));
            return;
        }

        const row = to_record(current);
        if (!row) return;

        const maybe_url =
            canonicalize_url(get_string(row.url)) ??
            canonicalize_url(get_string(row.source_url)) ??
            canonicalize_url(get_string(row.link)) ??
            canonicalize_url(get_string(row.display_url));
        if (maybe_url) {
            urls.push(maybe_url);
        }

        Object.values(row).forEach((nested) => {
            if (nested !== undefined && nested !== null && (typeof nested === 'object' || Array.isArray(nested))) {
                walk(nested, depth + 1);
            }
        });
    };
    walk(value);
    return urls;
};

const parse_chatgpt_payload = (params: NormalizeParams): Omit<NormalizedConversationData, 'promptCandidates' | 'versionMeta'> => {
    const now_iso = new Date().toISOString();
    const warnings: string[] = [];
    const messages = extract_messages(params.payload);
    const assistant_metadata = get_latest_assistant_metadata(messages, params.payload);
    const tool = extract_tool_data(messages);

    const user_prompt_node = pick_latest_node(messages.filter((node) => node.role === 'user'));
    const prompt = extract_message_text(user_prompt_node?.message ?? {}) ?? '';

    const searched_queries = dedupe_queries(tool.queries);
    if (!searched_queries.length) {
        warnings.push('No search_model_queries were found in tool metadata.');
    }

    const assistant_websites = extract_assistant_websites(assistant_metadata);
    const top_level_safe_urls = extract_top_level_safe_urls(params.payload);
    const website_rows =
        assistant_websites.length > 0
            ? assistant_websites
            : [
                ...tool.urls.map((url) => ({ url, source: 'tool_search_result_groups' })),
                ...top_level_safe_urls.map((url) => ({ url, source: 'payload_safe_urls' })),
            ];

    if (!website_rows.length) {
        warnings.push('No crawled websites were found in assistant/tool metadata.');
    }

    const places = extract_places(assistant_metadata);
    const keywords = to_keyword_items(searched_queries, params.provider, now_iso);
    const websites = to_website_items(website_rows, now_iso);
    const result_groups = build_result_groups(websites, keywords);

    return {
        prompt,
        searchedKeywords: keywords,
        crawledWebsites: websites,
        placesFound: places,
        resultGroups: result_groups,
        warnings,
    };
};

const parse_claude_payload = (params: NormalizeParams): Omit<NormalizedConversationData, 'promptCandidates' | 'versionMeta'> => {
    const now_iso = new Date().toISOString();
    const warnings: string[] = [];
    const root = to_record(params.payload) ?? {};
    const chat_messages = to_array(root.chat_messages);

    let prompt = '';
    const searched_queries: string[] = [];
    const website_rows: Array<{ url: string; source: string }> = [];

    for (let index = chat_messages.length - 1; index >= 0; index -= 1) {
        const message = to_record(chat_messages[index]);
        if (!message) continue;
        const sender = (get_string(message.sender) ?? '').toLowerCase();
        if (sender !== 'human' && sender !== 'user') continue;
        const content = to_array(message.content);
        const from_content = content
            .map((item) => extract_text_like(item))
            .find((item): item is string => Boolean(item));
        prompt = from_content ?? extract_text_like(message.text) ?? '';
        if (prompt) break;
    }

    chat_messages.forEach((message) => {
        const row = to_record(message);
        if (!row) return;
        const sender = (get_string(row.sender) ?? '').toLowerCase();
        if (sender !== 'assistant') return;

        const content = to_array(row.content);
        content.forEach((block) => {
            const block_record = to_record(block);
            if (!block_record) return;
            const block_type = get_string(block_record.type);

            if (block_type === 'tool_use') {
                const tool_name = get_string(block_record.name);
                if (tool_name === 'web_search') {
                    const input = to_record(block_record.input) ?? {};
                    const query_values = [
                        get_string(input.query),
                        get_string(input.q),
                        ...to_array(input.queries).map((item) => get_string(item)),
                    ].filter((item): item is string => Boolean(item));
                    query_values.forEach((query) => searched_queries.push(query));
                }
            }

            if (block_type === 'tool_result') {
                extract_urls_from_unknown(block_record.content).forEach((url) =>
                    website_rows.push({ url, source: 'claude_tool_result' }),
                );
            }

            if (block_type === 'text') {
                to_array(block_record.citations).forEach((citation) => {
                    const citation_record = to_record(citation);
                    const citation_url = canonicalize_url(get_string(citation_record?.url));
                    if (citation_url) {
                        website_rows.push({ url: citation_url, source: 'claude_citation' });
                    }
                });
            }
        });
    });

    if (!prompt) {
        prompt = extract_text_like(root.summary) ?? extract_text_like(root.name) ?? '';
    }

    const deduped_queries = dedupe_queries(searched_queries);
    if (!deduped_queries.length) {
        warnings.push('No Claude web_search queries were found in chat_messages.');
    }
    if (!website_rows.length) {
        warnings.push('No Claude crawled websites were found in chat_messages.');
    }

    const keywords = to_keyword_items(deduped_queries, params.provider, now_iso);
    const websites = to_website_items(website_rows, now_iso);

    return {
        prompt,
        searchedKeywords: keywords,
        crawledWebsites: websites,
        placesFound: [],
        resultGroups: build_result_groups(websites, keywords),
        warnings,
    };
};

const extract_perplexity_prompt = (payload: unknown): string => {
    const root = to_record(payload) ?? {};
    const top_prompt = get_string(root.query_str);
    if (top_prompt) return top_prompt;

    const entries = to_array(root.entries);
    for (const entry of entries) {
        const item = to_record(entry);
        const prompt = get_string(item?.query_str);
        if (prompt) return prompt;
    }

    return '';
};

const extract_perplexity_payload_data = (payload: unknown): {
    prompt: string;
    queries: string[];
    websites: Array<{ url: string; source: string }>;
} => {
    const prompt = extract_perplexity_prompt(payload);
    const queries: string[] = [];
    const websites: Array<{ url: string; source: string }> = [];
    const visited = new Set<unknown>();

    const push_query = (value?: string) => {
        if (!value) return;
        queries.push(value);
    };
    const push_url = (raw_url: unknown, source: string) => {
        const normalized = canonicalize_url(get_string(raw_url));
        if (!normalized) return;
        websites.push({ url: normalized, source });
    };

    const walk = (value: unknown, depth = 0) => {
        if (depth > 12 || value === null || value === undefined) return;
        if (typeof value !== 'object') return;
        if (visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
            value.forEach((entry) => walk(entry, depth + 1));
            return;
        }

        const row = to_record(value);
        if (!row) return;

        push_query(
            get_string(row.query)
            ?? get_string(row.q)
            ?? get_string(row.search_query)
            ?? get_string(row.keyword),
        );

        to_array(row.related_queries).forEach((entry) => {
            const text = get_string(entry);
            if (text) push_query(text);
        });
        to_array(row.related_query_items).forEach((entry) => {
            const item = to_record(entry);
            const text = get_string(item?.text);
            if (text) push_query(text);
        });

        to_array(row.queries).forEach((entry) => {
            const item = to_record(entry);
            const text = get_string(entry) ?? get_string(item?.query) ?? get_string(item?.q);
            if (text) push_query(text);
        });

        to_array(row.web_results).forEach((entry) => {
            const item = to_record(entry);
            push_url(item?.url ?? item?.link ?? item?.source_url ?? item?.display_url, 'perplexity_web_result');
        });

        const single_web_result = to_record(row.web_result);
        if (single_web_result) {
            push_url(
                single_web_result.url
                ?? single_web_result.link
                ?? single_web_result.source_url
                ?? single_web_result.display_url,
                'perplexity_web_result',
            );
        }

        Object.values(row).forEach((nested) => {
            if (nested !== undefined && (Array.isArray(nested) || typeof nested === 'object')) {
                walk(nested, depth + 1);
            }
        });
    };

    walk(payload);

    return {
        prompt,
        queries: dedupe_queries(queries),
        websites,
    };
};

const parse_perplexity_payload = (params: NormalizeParams): Omit<NormalizedConversationData, 'promptCandidates' | 'versionMeta'> => {
    const now_iso = new Date().toISOString();
    const warnings: string[] = [];
    const extracted = extract_perplexity_payload_data(params.payload);
    const prompt = extracted.prompt;
    const keywords = to_keyword_items(extracted.queries, params.provider, now_iso);
    const websites = to_website_items(extracted.websites, now_iso);

    if (!keywords.length) {
        warnings.push('No Perplexity search queries were found in payload.');
    }
    if (!websites.length) {
        warnings.push('No Perplexity crawled websites were found in payload.');
    }

    if (!prompt && !keywords.length && !websites.length) {
        return parse_generic_payload(params);
    }

    return {
        prompt,
        searchedKeywords: keywords,
        crawledWebsites: websites,
        placesFound: [],
        resultGroups: build_result_groups(websites, keywords),
        warnings,
    };
};

const parse_grok_tool_queries_from_text = (value: string): string[] => {
    const queries: string[] = [];
    const seen = new Set<string>();

    const push_query = (raw?: string) => {
        if (!raw) return;
        const normalized = collapse_spaces(raw);
        if (!normalized) return;
        const key = normalize_text_key(normalized);
        if (seen.has(key)) return;
        seen.add(key);
        queries.push(normalized);
    };

    const tool_args_regex = /<xai:tool_args><!\[CDATA\[(.*?)\]\]><\/xai:tool_args>/gs;
    let match: RegExpExecArray | null;
    while ((match = tool_args_regex.exec(value)) !== null) {
        const candidate = match[1]?.trim();
        if (!candidate) continue;
        try {
            const parsed = JSON.parse(candidate) as Record<string, unknown>;
            push_query(get_string(parsed.query) ?? get_string(parsed.q));
            to_array(parsed.queries).forEach((entry) => {
                const row = to_record(entry);
                push_query(get_string(entry) ?? get_string(row?.query) ?? get_string(row?.q));
            });
        } catch {
            // Fallback regex below covers malformed card payloads.
        }
    }

    const fallback_regex = /"query"\s*:\s*"([^"]+)"/g;
    let fallback_match: RegExpExecArray | null;
    while ((fallback_match = fallback_regex.exec(value)) !== null) {
        push_query(fallback_match[1]);
    }

    return queries;
};

const extract_grok_response_rows = (payload: unknown): Record<string, unknown>[] => {
    const root = to_record(payload) ?? {};
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    const push_row = (value: unknown) => {
        const row = to_record(value);
        if (!row) return;

        const sender = (get_string(row.sender) ?? '').toLowerCase();
        if (!(sender === 'assistant' || sender === 'human' || sender === 'user')) {
            return;
        }

        const response_id = get_string(row.responseId);
        const create_time = get_string(row.createTime);
        const message_preview = collapse_spaces(get_string(row.message) ?? '').slice(0, 80);
        const dedupe_key = response_id ?? `${sender}|${create_time ?? ''}|${message_preview}`;
        if (seen.has(dedupe_key)) return;
        seen.add(dedupe_key);
        rows.push(row);
    };

    to_array(root.responses).forEach((entry) => push_row(entry));

    const result = to_record(root.result);
    const envelope = result ?? root;
    const response = to_record(envelope.response);
    if (!response) {
        return rows;
    }

    push_row(response);
    push_row(response.userResponse);
    push_row(response.modelResponse);
    push_row(to_record(response.response));
    return rows;
};

const parse_grok_payload = (params: NormalizeParams): Omit<NormalizedConversationData, 'promptCandidates' | 'versionMeta'> => {
    const now_iso = new Date().toISOString();
    const warnings: string[] = [];
    const responses = extract_grok_response_rows(params.payload);

    const assistants = responses.filter((entry) => (get_string(entry.sender) ?? '').toLowerCase() === 'assistant');
    const humans = responses.filter((entry) => {
        const sender = (get_string(entry.sender) ?? '').toLowerCase();
        return sender === 'human' || sender === 'user';
    });

    const latest_assistant = [...assistants].sort((a, b) => {
        const a_time = new Date(get_string(a.createTime) ?? '').getTime();
        const b_time = new Date(get_string(b.createTime) ?? '').getTime();
        return (Number.isNaN(b_time) ? 0 : b_time) - (Number.isNaN(a_time) ? 0 : a_time);
    })[0] ?? null;

    const parent_response_id = get_string(latest_assistant?.parentResponseId);
    const parent_human = parent_response_id
        ? humans.find((entry) => get_string(entry.responseId) === parent_response_id) ?? null
        : null;
    const latest_human = [...humans].sort((a, b) => {
        const a_time = new Date(get_string(a.createTime) ?? '').getTime();
        const b_time = new Date(get_string(b.createTime) ?? '').getTime();
        return (Number.isNaN(b_time) ? 0 : b_time) - (Number.isNaN(a_time) ? 0 : a_time);
    })[0] ?? null;
    const prompt = get_string((parent_human ?? latest_human)?.message) ?? '';

    const queries: string[] = [];
    const website_rows: Array<{ url: string; source: string }> = [];
    const push_query = (value?: string) => {
        if (!value) return;
        queries.push(value);
    };
    const push_url = (raw_url: unknown, source: string) => {
        const normalized = canonicalize_url(get_string(raw_url));
        if (!normalized) return;
        website_rows.push({ url: normalized, source });
    };

    if (latest_assistant) {
        to_array(latest_assistant.webSearchResults).forEach((entry) => {
            const row = to_record(entry);
            push_url(row?.url ?? row?.link, 'grok_web_search_results');
        });
        to_array(latest_assistant.citedWebSearchResults).forEach((entry) => {
            const row = to_record(entry);
            push_url(row?.url ?? row?.link, 'grok_cited_web_search_results');
        });

        to_array(latest_assistant.steps).forEach((step) => {
            const step_row = to_record(step);
            if (!step_row) return;

            to_array(step_row.text).forEach((entry) => {
                const text = get_string(entry);
                if (!text) return;
                parse_grok_tool_queries_from_text(text).forEach((query) => push_query(query));
            });

            to_array(step_row.webSearchResults).forEach((entry) => {
                const row = to_record(entry);
                push_url(row?.url ?? row?.link, 'grok_step_web_search_results');
            });

            to_array(step_row.toolUsageResults).forEach((usage) => {
                const usage_row = to_record(usage);
                const web_search_results = to_record(usage_row?.webSearchResults);
                to_array(web_search_results?.results).forEach((entry) => {
                    const row = to_record(entry);
                    push_url(row?.url ?? row?.link, 'grok_tool_usage_results');
                });
            });
        });
    }

    const deduped_queries = dedupe_queries(queries);
    const keywords = to_keyword_items(deduped_queries, params.provider, now_iso);
    const websites = to_website_items(website_rows, now_iso);

    if (!deduped_queries.length) {
        warnings.push('No Grok tool queries were found in response payload.');
    }
    if (!websites.length) {
        warnings.push('No Grok crawled websites were found in response payload.');
    }

    if (!prompt && !keywords.length && !websites.length) {
        return parse_generic_payload(params);
    }

    return {
        prompt,
        searchedKeywords: keywords,
        crawledWebsites: websites,
        placesFound: [],
        resultGroups: build_result_groups(websites, keywords),
        warnings,
    };
};

const parse_generic_payload = (params: NormalizeParams): Omit<NormalizedConversationData, 'promptCandidates' | 'versionMeta'> => {
    const now_iso = new Date().toISOString();
    const warnings: string[] = [];
    const root = to_record(params.payload) ?? {};
    const walk_queries: string[] = [];
    const walk_websites: Array<{ url: string; source: string }> = [];

    const walk = (value: unknown, depth = 0) => {
        if (depth > 10) return;
        if (Array.isArray(value)) {
            value.forEach((entry) => walk(entry, depth + 1));
            return;
        }
        const obj = to_record(value);
        if (!obj) return;

        const query_candidates = [obj.query, obj.search_query, obj.keyword, obj.q];
        for (const candidate of query_candidates) {
            const text = get_string(candidate);
            if (text) walk_queries.push(text);
        }
        if (Array.isArray(obj.queries)) {
            obj.queries.forEach((query) => {
                const text = get_string(query);
                if (text) walk_queries.push(text);
            });
        }

        const url_candidates = [obj.url, obj.link, obj.source_url, obj.display_url];
        for (const candidate of url_candidates) {
            const url = canonicalize_url(get_string(candidate));
            if (url) walk_websites.push({ url, source: 'generic_payload' });
        }

        to_array(obj.safe_urls).forEach((entry) => {
            const url = canonicalize_url(get_string(entry));
            if (url) walk_websites.push({ url, source: 'generic_safe_urls' });
        });

        Object.values(obj).forEach((nested) => {
            if (nested !== undefined && (Array.isArray(nested) || typeof nested === 'object')) {
                walk(nested, depth + 1);
            }
        });
    };
    walk(params.payload);

    const prompt =
        get_string(root.prompt) ??
        get_string(root.title) ??
        '';
    const keywords = to_keyword_items(dedupe_queries(walk_queries), params.provider, now_iso);
    const websites = to_website_items(walk_websites, now_iso);
    if (!keywords.length) warnings.push('No keyword queries discovered in generic payload.');
    if (!websites.length) warnings.push('No websites discovered in generic payload.');

    return {
        prompt,
        searchedKeywords: keywords,
        crawledWebsites: websites,
        placesFound: [],
        resultGroups: build_result_groups(websites, keywords),
        warnings,
    };
};

export const normalize_conversation_payload = (params: NormalizeParams): NormalizedConversationData => {
    const base =
        params.provider === 'chatgpt'
            ? parse_chatgpt_payload(params)
            : params.provider === 'claude'
                ? parse_claude_payload(params)
            : params.provider === 'perplexity'
                ? parse_perplexity_payload(params)
            : params.provider === 'grok'
                ? parse_grok_payload(params)
                : parse_generic_payload(params);

    return {
        ...base,
        promptCandidates: params.promptCandidates ?? [],
        versionMeta: {
            versionDate: params.versionDate,
            lastExecutionDate: params.lastExecutionDate,
            provider: params.provider,
            conversationId: params.conversationId,
        },
    };
};
