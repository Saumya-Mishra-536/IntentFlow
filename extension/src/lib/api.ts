import { PromptNode } from "@/data/mockData";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "https://ai-seo-monorepo.onrender.com";
export type ai_chat_provider = "chatgpt" | "claude" | "gemini" | "perplexity" | "grok" | "unknown";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface CampaignSummary {
  id: string;
  domain_id?: string | null;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
  total_nodes: number;
}

export interface DomainSummary {
  domain_id: string;
  normalized_domain: string;
  scrape_status: "queued" | "running" | "completed" | "failed";
  last_scraped_at?: string | null;
}

export interface AccountMembership {
  tenant_id: string;
  slug: string;
  name: string;
  member_role: string;
}

export interface CampaignVersionSummary {
  id: string;
  version_number: number;
  is_active: boolean;
  status: "draft" | "active" | "archived";
  label?: string | null;
  created_at: string;
  archived_at?: string | null;
}

export interface CampaignVersionsResponse {
  campaign: {
    id: string;
    name: string;
    description?: string | null;
    created_at: string;
    updated_at: string;
  };
  versions: CampaignVersionSummary[];
}

export interface RefireVersionResponse {
  id: string;
  version_number: number;
  is_active: boolean;
  status: "draft" | "active" | "archived";
  label?: string | null;
  created_at: string;
  archived_at?: string | null;
}

export interface RefreshNodeResponse {
  refresh_run_id: string;
  node_id: string;
  version_id: string;
  status: "queued" | "done";
  provider: ai_chat_provider;
  scope: "node" | "branch";
  prompt?: string;
  target_node_id?: string;
  target_node_type?: "prompt" | "subquery" | "generated";
  message: string;
}

export interface CampaignTreeResponse {
  campaign: CampaignSummary;
  version?: CampaignVersionSummary | null;
  roots: PromptNode[];
  executedPrompt?: PromptWorkflowState["executedPrompts"][number] | null;
}

export interface SiteInsight {
  source?: "semrush" | "ahrefs";
  site_name: string;
  site_url?: string;
  ranking_keywords: string[];
  confidence_score?: number;
  summary?: string;
}

export interface PromptSuggestion {
  prompt: string;
  reason: string;
  target_subquery?: string;
}

export interface SuggestPromptsResponse {
  generation_run_id: string;
  site_insights: SiteInsight[];
  suggested_prompts: PromptSuggestion[];
}

export interface StoredPromptSuggestion {
  node_id: string;
  prompt: string;
  reason?: string;
  target_subquery?: string;
  created_at: string;
}

export interface StoredPromptSuggestionsResponse {
  version?: CampaignVersionSummary | null;
  prompts: StoredPromptSuggestion[];
  total_count: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ChatThreadSummary {
  chat_thread_id: string;
  chat_provider: ai_chat_provider;
  conversation_id: string;
  provider_chat_id?: string | null;
  chat_url?: string | null;
  chat_title?: string | null;
  started_at: string;
  last_event_at?: string | null;
  last_opened_at?: string | null;
  turn_count: number;
}

export interface ChatThreadsResponse {
  version?: CampaignVersionSummary | null;
  threads: ChatThreadSummary[];
  total_count: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface PromptCandidate {
  id: string;
  node_id: string;
  text: string;
  source: "auto" | "manual";
  selected: boolean;
  status: "new" | "fired" | "running" | "failed";
  lastExecutionAt?: string;
}

export interface PromptWorkflowState {
  version: CampaignVersionSummary | null;
  promptCandidates: PromptCandidate[];
  executedPrompts: Array<{
    id: string;
    text: string;
    provider: ai_chat_provider;
    status: "completed" | "failed";
    lastExecutionAt: string;
    sourcePromptId?: string;
    searchedKeywords: Array<{
      query: string;
      sourceProvider: ai_chat_provider;
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
  }>;
  searchedKeywords: Array<{
    query: string;
    sourceProvider: ai_chat_provider;
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
  warnings: string[];
  versionMeta: {
    versionDate?: string;
    lastExecutionDate?: string;
    provider: ai_chat_provider;
    conversationId: string;
  };
}

export interface ExecutePromptsResponse {
  executionId: string;
  mode: "fire" | "refire";
  provider: ai_chat_provider;
  status: "queued";
  orderedQueue: Array<{
    promptId: string;
    text: string;
    index: number;
    status: "queued";
  }>;
  version: CampaignVersionSummary;
  lastExecutionDate: string;
}

export interface SiteTopQueriesResponse {
  country: string;
  limit: number;
  ttlHours: number;
  results: Array<{
    host: string;
    target_url?: string;
    top_queries: Array<{
      query: string;
      volume?: number;
      traffic?: number;
      position?: number;
      trafficPercent?: number;
      keywordDifficulty?: number;
      sourceTimestamp: string;
    }>;
    cached: boolean;
    provider?: "semrush" | "ahrefs";
    fetched_at?: string;
    error?: string;
  }>;
  warnings: string[];
}

const get_access_token = (): string => {
  const token = localStorage.getItem("ai_seo_access_token");
  if (!token) {
    throw new Error("Missing access token");
  }
  return token;
};

const tenant_access_message = "This campaign is not available in your current workspace. Refresh campaigns or switch account.";

const to_error_message = (response: Response, path: string, fallback: string): string => {
  const is_base_campaign_route = path.match(/^\/api\/campaigns\/[0-9a-fA-F-]+$/);
  if ((response.status === 403 || response.status === 404) && is_base_campaign_route) {
    return tenant_access_message;
  }
  return fallback;
};

const parse_error_payload = async (response: Response): Promise<{ message?: string }> => {
  const content_type = response.headers.get("content-type") ?? "";
  if (content_type.includes("application/json")) {
    try {
      return (await response.json()) as { message?: string };
    } catch {
      return {};
    }
  }
  try {
    const text = (await response.text()).trim();
    if (!text) {
      return {};
    }
    if (text.startsWith("<!DOCTYPE html>")) {
      return { message: `Request failed (${response.status}).` };
    }
    return { message: text.slice(0, 280) };
  } catch {
    return {};
  }
};

const parse_api = async <T>(response: Response, path: string): Promise<T> => {
  const payload = await parse_error_payload(response);
  if (!response.ok) {
    const fallback = payload.message ?? "Request failed";
    const message = to_error_message(response, path, fallback);
    throw new Error(message);
  }
  const typed = payload as ApiResponse<T>;
  if (!typed || !typed.success) {
    const fallback = payload.message ?? "Request failed";
    const message = to_error_message(response, path, fallback);
    throw new Error(message);
  }
  return typed.data;
};

const api_fetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${get_access_token()}`,
      ...(init?.headers ?? {}),
    },
  });
  return parse_api<T>(response, path);
};

export const campaign_api = {
  get_campaigns: (params?: { domain_id?: string }) => {
    const search = new URLSearchParams();
    if (params?.domain_id) {
      search.set("domain_id", params.domain_id);
    }
    const query = search.toString();
    return api_fetch<CampaignSummary[]>(`/api/campaigns${query ? `?${query}` : ""}`);
  },
  create_campaign: (payload: { domain_id: string; name: string; description?: string }) =>
    api_fetch<CampaignSummary>("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  update_campaign: (campaign_id: string, payload: { name?: string; description?: string }) =>
    api_fetch<CampaignSummary>(`/api/campaigns/${campaign_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  delete_campaign: (campaign_id: string) =>
    api_fetch<{ campaign_id: string; deleted: boolean }>(`/api/campaigns/${campaign_id}`, {
      method: "DELETE",
    }),
  refire_version: (campaign_id: string, version_number: number) =>
    api_fetch<RefireVersionResponse>(`/api/campaigns/${campaign_id}/versions/${version_number}/refire`, {
      method: "POST",
    }),
  refresh_node: (
    campaign_id: string,
    node_id: string,
    params?: { version_id?: string },
    payload?: { provider?: ai_chat_provider; scope?: "node" | "branch" },
  ) =>
    api_fetch<RefreshNodeResponse>(
      `/api/campaigns/${campaign_id}/nodes/${encodeURIComponent(node_id)}/refresh${params?.version_id ? `?version_id=${encodeURIComponent(params.version_id)}` : ""}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      },
    ),
  get_campaign_versions: (campaign_id: string) => api_fetch<CampaignVersionsResponse>(`/api/campaigns/${campaign_id}/versions`),
  get_campaign_tree: (campaign_id: string, params?: { version_id?: string }) => {
    const search = new URLSearchParams();
    if (params?.version_id) {
      search.set("version_id", params.version_id);
    }
    const query = search.toString();
    return api_fetch<CampaignTreeResponse>(`/api/campaigns/${campaign_id}/tree${query ? `?${query}` : ""}`);
  },
  ingest_turn: (
    campaign_id: string,
    params: { version_id?: string } | undefined,
    payload: {
      conversation_id: string;
      chat_provider?: ai_chat_provider;
      provider_chat_id?: string;
      chat_url?: string;
      chat_title?: string;
      request_id?: string;
      turn_exchange_id?: string;
      prompt: string;
      finished_reason?: string;
      queries?: string[];
      result_groups?: unknown[];
      metadata?: Record<string, unknown>;
    },
  ) =>
    api_fetch<CampaignTreeResponse>(`/api/campaigns/${campaign_id}/capture/ingest-turn${params?.version_id ? `?version_id=${encodeURIComponent(params.version_id)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  ingest_conversation: (
    campaign_id: string,
    provider: ai_chat_provider,
    params: { version_id?: string } | undefined,
    payload: {
      conversationId: string;
      payload: unknown;
      promptVersionId?: string;
      source?: string;
      prompt?: string;
      sourcePromptId?: string;
    },
  ) =>
    api_fetch<PromptWorkflowState>(
      `/api/campaigns/${campaign_id}/providers/${provider}/conversations/ingest${params?.version_id ? `?version_id=${encodeURIComponent(params.version_id)}` : ""}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
  get_workflow_state: (campaign_id: string, params?: { version_id?: string }) => {
    const search = new URLSearchParams();
    if (params?.version_id) {
      search.set("version_id", params.version_id);
    }
    const query = search.toString();
    return api_fetch<PromptWorkflowState>(`/api/campaigns/${campaign_id}/workflow/state${query ? `?${query}` : ""}`);
  },
  add_manual_prompt: (
    campaign_id: string,
    version_id: string,
    payload: { text: string },
  ) =>
    api_fetch<PromptWorkflowState>(`/api/campaigns/${campaign_id}/versions/${version_id}/prompts/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  select_prompt_candidates: (
    campaign_id: string,
    version_id: string,
    payload: { promptIds: string[]; selected: boolean },
  ) =>
    api_fetch<PromptWorkflowState>(`/api/campaigns/${campaign_id}/versions/${version_id}/prompts/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  replace_prompt_selection: (
    campaign_id: string,
    version_id: string,
    payload: { selectedPromptIds: string[] },
  ) =>
    api_fetch<PromptWorkflowState>(`/api/campaigns/${campaign_id}/versions/${version_id}/prompts/selection-set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  execute_prompts: (
    campaign_id: string,
    version_id: string,
    payload: { mode: "fire" | "refire"; promptIds: string[]; provider: ai_chat_provider },
  ) =>
    api_fetch<ExecutePromptsResponse>(`/api/campaigns/${campaign_id}/versions/${version_id}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  get_site_top_queries: (
    campaign_id: string,
    payload: {
      targets?: Array<{ domain?: string; page_url?: string }>;
      hosts?: string[];
      country?: string;
      limit?: number;
      forceRefresh?: boolean;
    },
    params?: { version_id?: string },
  ) =>
    api_fetch<SiteTopQueriesResponse>(
      `/api/campaigns/${campaign_id}/site-keywords/top-queries${params?.version_id ? `?version_id=${encodeURIComponent(params.version_id)}` : ""}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
  get_chat_threads: (campaign_id: string, params?: { version_id?: string; provider?: ai_chat_provider; limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (params?.version_id) {
      search.set("version_id", String(params.version_id));
    }
    if (params?.provider !== undefined) {
      search.set("provider", String(params.provider));
    }
    if (params?.limit !== undefined) {
      search.set("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      search.set("offset", String(params.offset));
    }
    const query = search.toString();
    return api_fetch<ChatThreadsResponse>(`/api/campaigns/${campaign_id}/chat-threads${query ? `?${query}` : ""}`);
  },
  link_chat_thread: (
    campaign_id: string,
    params: { version_id?: string } | undefined,
    payload: {
      chat_provider: ai_chat_provider;
      conversation_id?: string;
      provider_chat_id?: string;
      chat_url?: string;
      chat_title?: string;
    },
  ) =>
    api_fetch<ChatThreadSummary>(`/api/campaigns/${campaign_id}/chat-threads/link${params?.version_id ? `?version_id=${encodeURIComponent(params.version_id)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  mark_chat_thread_opened: (campaign_id: string, chat_thread_id: string) =>
    api_fetch<ChatThreadSummary>(`/api/campaigns/${campaign_id}/chat-threads/${chat_thread_id}/opened`, {
      method: "POST",
    }),
  generate_suggestions: (
    campaign_id: string,
    params: { version_id?: string } | undefined,
    payload?: { max_suggestions?: number; append?: boolean },
  ) =>
    api_fetch<SuggestPromptsResponse>(`/api/campaigns/${campaign_id}/suggestions/generate${params?.version_id ? `?version_id=${encodeURIComponent(params.version_id)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    }),
  get_generated_suggestions: (campaign_id: string, params?: { version_id?: string; limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (params?.version_id) {
      search.set("version_id", String(params.version_id));
    }
    if (params?.limit !== undefined) {
      search.set("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      search.set("offset", String(params.offset));
    }
    const query = search.toString();
    return api_fetch<StoredPromptSuggestionsResponse>(
      `/api/campaigns/${campaign_id}/suggestions/generated${query ? `?${query}` : ""}`,
    );
  },
};

export const account_api = {
  get_memberships: () =>
    api_fetch<Array<{ account: { tenant_id: string; slug: string; name: string }; role: string }>>("/api/accounts/memberships"),
  switch_account: (tenant_id: string) =>
    api_fetch<{
      access_token: string;
      refresh_token: string;
      user?: unknown;
      memberships: AccountMembership[];
      active_account?: { tenant_id: string; slug: string; name: string; member_role: string };
      onboarding_context?: { domains?: DomainSummary[] };
    }>("/api/auth/switch-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id }),
    }),
};

export const domain_api = {
  get_domains: () => api_fetch<DomainSummary[]>("/api/domains"),
};

export const analytics_api = {
  track_event: (payload: { event_name: string; properties: Record<string, unknown> }) =>
    api_fetch<void>("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
