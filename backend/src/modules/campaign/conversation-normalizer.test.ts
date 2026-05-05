import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize_conversation_payload } from './conversation-normalizer';

const normalize_chatgpt = (payload: unknown) =>
    normalize_conversation_payload({
        provider: 'chatgpt',
        conversationId: 'conv-1',
        payload,
    });

const normalize_claude = (payload: unknown) =>
    normalize_conversation_payload({
        provider: 'claude',
        conversationId: 'claude-conv-1',
        payload,
    });

const normalize_perplexity = (payload: unknown) =>
    normalize_conversation_payload({
        provider: 'perplexity',
        conversationId: 'pplx-conv-1',
        payload,
    });

const normalize_grok = (payload: unknown) =>
    normalize_conversation_payload({
        provider: 'grok',
        conversationId: 'grok-conv-1',
        payload,
    });

test('normalizes ChatGPT keywords/websites/places with canonicalized URL dedupe', () => {
    const payload = {
        current_node: 'assistant_latest',
        safe_urls: ['https://fallback.example/path/?utm_source=ignored'],
        mapping: {
            user: {
                message: {
                    author: { role: 'user' },
                    create_time: 10,
                    content: {
                        parts: ['search web for top restaunts'],
                    },
                },
            },
            tool: {
                message: {
                    author: { role: 'tool', name: 'web.run' },
                    create_time: 11,
                    metadata: {
                        search_model_queries: {
                            queries: ['Top Restaurants Sonipat ', ' top restaurants sonipat', { q: 'best cafes sonipat' }],
                        },
                    },
                },
            },
            assistant_latest: {
                message: {
                    author: { role: 'assistant' },
                    create_time: 12,
                    metadata: {
                        content_references: [
                            {
                                type: 'grouped_webpages',
                                items: [
                                    {
                                        url: 'https://Example.com/path/?utm_source=abc',
                                        supporting_websites: [{ url: 'https://example.com/support/?fbclid=123' }],
                                    },
                                ],
                            },
                            {
                                type: 'entity',
                                name: 'Mannat Haveli Murthal',
                                entity_data: {
                                    address: 'Murthal, Sonipat',
                                    rating: 4.2,
                                    review_count: 42063,
                                    website_url: 'https://mannat.example/?utm_campaign=test',
                                    categories: ['Restaurant'],
                                },
                            },
                        ],
                        search_result_groups: [
                            {
                                entries: [
                                    { url: 'https://example.com/path/' },
                                    { url: 'https://news.site/article/?igshid=xyz' },
                                ],
                            },
                        ],
                        safe_urls: ['https://EXAMPLE.com/path/', 'mailto:test@example.com'],
                    },
                },
            },
        },
    };

    const normalized = normalize_chatgpt(payload);

    assert.deepEqual(
        normalized.searchedKeywords.map((item) => item.query),
        ['Top Restaurants Sonipat', 'best cafes sonipat'],
    );

    assert.deepEqual(
        normalized.crawledWebsites.map((item) => item.url),
        ['https://example.com/path', 'https://example.com/support', 'https://news.site/article'],
    );
    assert.deepEqual(
        normalized.crawledWebsites.map((item) => item.host),
        ['example.com', 'example.com', 'news.site'],
    );

    assert.equal(normalized.placesFound.length, 1);
    assert.equal(normalized.placesFound[0].name, 'Mannat Haveli Murthal');
    assert.equal(normalized.placesFound[0].address, 'Murthal, Sonipat');
    assert.equal(normalized.placesFound[0].rating, 4.2);
    assert.equal(normalized.placesFound[0].reviewCount, 42063);
    assert.equal(normalized.placesFound[0].websiteUrl, 'https://mannat.example');
    assert.equal(normalized.placesFound[0].category, 'Restaurant');

    assert.equal(
        normalized.crawledWebsites.some((item) => item.url.includes('mannat.example')),
        false,
    );
});

test('falls back to tool search groups and top-level safe_urls when assistant URLs are unavailable', () => {
    const payload = {
        current_node: 'assistant_no_urls',
        safe_urls: ['https://fallback.com/path/?fbclid=1', 'ftp://invalid.example/file'],
        mapping: {
            user: {
                message: {
                    author: { role: 'user' },
                    create_time: 1,
                    content: { parts: ['find websites'] },
                },
            },
            tool: {
                message: {
                    author: { role: 'tool', name: 'web.run' },
                    create_time: 2,
                    metadata: {
                        search_model_queries: { queries: ['best sites sonipat'] },
                        search_result_groups: [
                            { entries: [{ url: 'https://toolsite.com/page/?utm_medium=social' }] },
                        ],
                    },
                },
            },
            assistant_no_urls: {
                message: {
                    author: { role: 'assistant' },
                    create_time: 3,
                    metadata: {
                        content_references: [
                            {
                                type: 'entity',
                                name: 'Place only',
                                entity_data: {
                                    address: 'Sector 14',
                                    categories: ['Cafe'],
                                },
                            },
                        ],
                    },
                },
            },
        },
    };

    const normalized = normalize_chatgpt(payload);

    assert.deepEqual(
        normalized.crawledWebsites.map((item) => item.url),
        ['https://toolsite.com/page', 'https://fallback.com/path'],
    );
    assert.equal(normalized.placesFound.length, 1);
    assert.equal(normalized.placesFound[0].name, 'Place only');
});

test('uses current graph node order fallback when assistant create_time is missing', () => {
    const payload = {
        current_node: 'assistant_current',
        mapping: {
            user: {
                message: {
                    author: { role: 'user' },
                    content: { parts: ['prompt'] },
                },
            },
            assistant_current: {
                parent: 'user',
                message: {
                    author: { role: 'assistant' },
                    metadata: {
                        safe_urls: ['https://current.example/'],
                    },
                },
            },
            assistant_other: {
                parent: 'user',
                message: {
                    author: { role: 'assistant' },
                    metadata: {
                        safe_urls: ['https://other.example/'],
                    },
                },
            },
        },
    };

    const normalized = normalize_chatgpt(payload);
    assert.deepEqual(
        normalized.crawledWebsites.map((item) => item.url),
        ['https://current.example'],
    );
});

test('normalizes Claude chat_messages payload with tool_use queries and tool_result websites', () => {
    const payload = {
        uuid: '4a38f45c-a135-4eb2-ae32-76f7114a8855',
        name: 'Top watched content worldwide',
        summary: '',
        chat_messages: [
            {
                sender: 'human',
                content: [
                    {
                        type: 'text',
                        text: 'search web for top watched in the worl',
                    },
                ],
                created_at: '2026-02-25T08:49:39.913348Z',
            },
            {
                sender: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        name: 'web_search',
                        input: {
                            query: 'most watched TV shows movies in the world 2025',
                        },
                    },
                    {
                        type: 'tool_result',
                        name: 'web_search',
                        content: [
                            {
                                type: 'knowledge',
                                title: 'Most Watched Movies and TV Shows in 2025 (July - December) • FlixPatrol',
                                url: 'https://flixpatrol.com/most-watched/?utm_source=test',
                            },
                            {
                                type: 'knowledge',
                                title: 'Most Popular TV Shows of 2025 - IMDb',
                                url: 'https://www.imdb.com/best-of/most-popular-series-2025/',
                            },
                        ],
                    },
                    {
                        type: 'text',
                        text: 'summary',
                        citations: [
                            {
                                url: 'https://www.thewrap.com/media-platforms/tv/2025-ratings-winners-broadcast-streaming/?fbclid=ignored',
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const normalized = normalize_claude(payload);

    assert.equal(normalized.prompt, 'search web for top watched in the worl');
    assert.deepEqual(
        normalized.searchedKeywords.map((item) => item.query),
        ['most watched TV shows movies in the world 2025'],
    );
    assert.deepEqual(
        normalized.crawledWebsites.map((item) => item.url),
        [
            'https://flixpatrol.com/most-watched',
            'https://www.imdb.com/best-of/most-popular-series-2025',
            'https://www.thewrap.com/media-platforms/tv/2025-ratings-winners-broadcast-streaming',
        ],
    );
    assert.deepEqual(
        normalized.crawledWebsites.map((item) => item.host),
        ['flixpatrol.com', 'imdb.com', 'thewrap.com'],
    );
    assert.equal(normalized.placesFound.length, 0);
});

test('normalizes Perplexity structured entries payload with related queries and web results', () => {
    const payload = {
        status: 'success',
        entries: [
            {
                context_uuid: 'ctx-1',
                backend_uuid: 'req-1',
                uuid: 'turn-1',
                query_str: 'search web for top watches',
                related_queries: [
                    'Compare prices of Tudor Ranger vs Rolex Explorer I',
                    'Best affordable watches under $100',
                ],
                related_query_items: [
                    { text: 'TAG Heuer Formula 1 Solargraph review' },
                ],
                blocks: [
                    {
                        intended_usage: 'pro_search_steps',
                        plan_block: {
                            steps: [
                                {
                                    step_type: 'SEARCH_WEB',
                                    search_web_content: {
                                        queries: [
                                            { engine: 'web', query: 'top watches 2026', limit: 8 },
                                        ],
                                    },
                                },
                                {
                                    step_type: 'SEARCH_RESULTS',
                                    web_results_content: {
                                        web_results: [
                                            {
                                                name: 'The Top 10 Watches to Buy in 2026.',
                                                url: 'https://www.youtube.com/watch?v=f0vSjhMibho',
                                                snippet: 'sample',
                                                meta_data: { domain_name: 'youtube' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        intended_usage: 'sources_answer_mode',
                        sources_mode_block: {
                            rows: [
                                {
                                    web_result: {
                                        name: 'The Best Affordable Watch Brands',
                                        url: 'https://teddybaldassarre.com/blogs/watches/best-affordable-watch-brands',
                                        snippet: 'sample',
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        ],
        thread_metadata: {
            title: 'search web for top watches',
        },
    };

    const normalized = normalize_perplexity(payload);

    assert.equal(normalized.prompt, 'search web for top watches');
    assert.ok(normalized.searchedKeywords.some((item) => item.query === 'top watches 2026'));
    assert.ok(normalized.searchedKeywords.some((item) => item.query === 'Best affordable watches under $100'));
    assert.ok(normalized.searchedKeywords.some((item) => item.query === 'TAG Heuer Formula 1 Solargraph review'));

    assert.ok(normalized.crawledWebsites.some((item) => item.url === 'https://www.youtube.com/watch?v=f0vSjhMibho'));
    assert.ok(
        normalized.crawledWebsites.some((item) => item.url === 'https://teddybaldassarre.com/blogs/watches/best-affordable-watch-brands'),
    );
});

test('normalizes Grok load-responses payload with tool usage query cards and web results', () => {
    const payload = {
        responses: [
            {
                responseId: 'human-1',
                sender: 'human',
                message: 'search web top perfumes',
                createTime: '2026-02-25T10:00:11.213Z',
            },
            {
                responseId: 'assistant-1',
                sender: 'assistant',
                parentResponseId: 'human-1',
                message: 'result',
                createTime: '2026-02-25T10:00:20.214Z',
                webSearchResults: [
                    {
                        url: 'https://www.fragrantica.com/awards2025',
                        title: 'Best Fragrance of 2025',
                    },
                ],
                steps: [
                    {
                        text: [
                            '<xai:tool_usage_card><xai:tool_args><![CDATA[{"query":"top perfumes 2025","num_results":15}]]></xai:tool_args></xai:tool_usage_card>'
                            + '<xai:tool_usage_card><xai:tool_args><![CDATA[{"query":"best perfumes 2026","num_results":10}]]></xai:tool_args></xai:tool_usage_card>',
                        ],
                        webSearchResults: [
                            {
                                url: 'https://www.vogue.com/article/best-perfumes-for-women-2025',
                                title: 'Best perfumes',
                            },
                        ],
                        toolUsageResults: [
                            {
                                webSearchResults: {
                                    results: [
                                        {
                                            url: 'https://fragrance.org/awards',
                                            title: 'Fragrance awards',
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const normalized = normalize_grok(payload);

    assert.equal(normalized.prompt, 'search web top perfumes');
    assert.ok(normalized.searchedKeywords.some((item) => item.query === 'top perfumes 2025'));
    assert.ok(normalized.searchedKeywords.some((item) => item.query === 'best perfumes 2026'));
    assert.ok(normalized.crawledWebsites.some((item) => item.url === 'https://www.fragrantica.com/awards2025'));
    assert.ok(normalized.crawledWebsites.some((item) => item.url === 'https://fragrance.org/awards'));
    assert.ok(normalized.crawledWebsites.some((item) => item.url === 'https://www.vogue.com/article/best-perfumes-for-women-2025'));
});

test('normalizes Grok envelope payload with modelResponse/userResponse wrappers', () => {
    const payload = {
        result: {
            conversation: {
                conversationId: 'grok-conv-envelope-1',
            },
            response: {
                userResponse: {
                    responseId: 'human-envelope-1',
                    sender: 'human',
                    message: 'search web for best news channel',
                    createTime: '2026-02-25T16:08:20.032Z',
                },
                modelResponse: {
                    responseId: 'assistant-envelope-1',
                    sender: 'assistant',
                    parentResponseId: 'human-envelope-1',
                    createTime: '2026-02-25T16:08:29.167Z',
                    webSearchResults: [
                        {
                            url: 'https://www.reuters.com/world',
                            title: 'Reuters world news',
                        },
                    ],
                    steps: [
                        {
                            text: [
                                '<xai:tool_usage_card><xai:tool_args><![CDATA[{"query":"best news channels in the world 2026","num_results":10}]]></xai:tool_args></xai:tool_usage_card>',
                            ],
                        },
                    ],
                },
            },
        },
    };

    const normalized = normalize_grok(payload);

    assert.equal(normalized.prompt, 'search web for best news channel');
    assert.ok(normalized.searchedKeywords.some((item) => item.query === 'best news channels in the world 2026'));
    assert.ok(normalized.crawledWebsites.some((item) => item.url === 'https://www.reuters.com/world'));
});
