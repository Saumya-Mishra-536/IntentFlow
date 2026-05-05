const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://ai-seo-monorepo.onrender.com';

const ACCESS_TOKEN_KEY = 'ai_seo_access_token';
const REFRESH_TOKEN_KEY = 'ai_seo_refresh_token';
const USER_KEY = 'ai_seo_user';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export type MeResponse = {
  id: string;
  email: string;
  name?: string | null;
  app_role?: string;
  needs_password?: boolean;
  active_tenant_id?: string | null;
  active_tenant_role?: string | null;
};

export type AccountMembership = {
  tenant_id: string;
  slug: string;
  name: string;
  member_role: string;
};

export type DomainSummary = {
  domain_id: string;
  normalized_domain: string;
  display_domain?: string;
  source_url?: string;
  scrape_status: 'queued' | 'running' | 'completed' | 'failed';
  last_scraped_at?: string | null;
};

export type OnboardingContext = {
  active_account?: {
    tenant_id: string;
    slug: string;
    name: string;
    member_role: string;
  };
  domains: DomainSummary[];
  needs_onboarding: boolean;
  join_request?: {
    request_id: string;
    account_slug: string;
    status: 'pending';
  };
};

export type ExchangeResponse = {
  access_token: string;
  refresh_token: string;
  user: MeResponse;
  active_account?: OnboardingContext['active_account'];
  memberships?: AccountMembership[];
  onboarding_context?: OnboardingContext;
};

export type CampaignTreeNode = {
  id: string;
  type: 'prompt' | 'subquery' | 'site' | 'generated';
  content: string;
  metadata?: {
    source?: string;
    prompt_ref?: string;
    subquery_ref?: string;
    result_ref?: string;
    query_key?: string;
    url?: string;
    domain?: string;
    citation_title?: string;
    lineage?: {
      capture_turn_id?: string;
      origin_provider?: string;
      origin_request_id?: string;
      source_version_id?: string;
    };
    refresh?: {
      refreshable?: boolean;
      refresh_count?: number;
      refresh_status?: 'idle' | 'queued' | 'running' | 'failed' | 'done';
      last_refreshed_at?: string;
      last_refresh_run_id?: string;
      refresh_provider?: string;
      refresh_source_version_id?: string;
    };
    ui?: {
      display_label?: string;
      is_unmapped?: boolean;
      is_system?: boolean;
    };
  };
  parent_id?: string | null;
  created_at: string;
  children: CampaignTreeNode[];
};

export type CampaignSummary = {
  id: string;
  domain_id?: string | null;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
  active_version_number: number;
  total_nodes: number;
  root_prompt_count: number;
};

export type CampaignVersionSummary = {
  id: string;
  version_number: number;
  is_active: boolean;
  status: 'draft' | 'active' | 'archived';
  label?: string | null;
  created_at: string;
  archived_at?: string | null;
};

export type RefreshNodeResponse = {
  refresh_run_id: string;
  node_id: string;
  version_id: string;
  status: 'queued' | 'done';
  provider: ai_chat_provider;
  scope: 'node' | 'branch';
  prompt?: string;
  target_node_id?: string;
  target_node_type?: 'prompt' | 'subquery' | 'generated';
  message: string;
};

export type CampaignWithTree = {
  project: CampaignSummary;
  roots: CampaignTreeNode[];
};

export type ai_chat_provider = 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'unknown';

export type ChatThreadSummary = {
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
};

export type ChatThreadsResponse = {
  threads: ChatThreadSummary[];
  total_count: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

export type PromptCandidate = {
  id: string;
  node_id: string;
  text: string;
  source: 'auto' | 'manual';
  selected: boolean;
  status: 'new' | 'fired' | 'running' | 'failed';
  lastExecutionAt?: string;
};

export type KeywordQuery = {
  query: string;
  sourceProvider: ai_chat_provider;
  sourcePromptId?: string;
  firstSeenAt: string;
};

export type CrawledWebsite = {
  url: string;
  host: string;
  source: string;
  firstSeenAt: string;
};

export type PlaceFound = {
  name: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  websiteUrl?: string;
  category?: string;
};

export type PromptWorkflowState = {
  version: CampaignVersionSummary | null;
  promptCandidates: PromptCandidate[];
  executedPrompts: Array<{
    id: string;
    text: string;
    provider: ai_chat_provider;
    status: 'completed' | 'failed';
    lastExecutionAt: string;
    sourcePromptId?: string;
    searchedKeywords: KeywordQuery[];
    crawledWebsites: CrawledWebsite[];
    placesFound: PlaceFound[];
  }>;
  searchedKeywords: KeywordQuery[];
  crawledWebsites: CrawledWebsite[];
  placesFound: PlaceFound[];
  warnings: string[];
  versionMeta: {
    versionDate?: string;
    lastExecutionDate?: string;
    provider: ai_chat_provider;
    conversationId: string;
  };
};

export type SuggestPromptsResponse = {
  generation_run_id: string;
  site_insights?: Array<{
    domain: string;
    competitors: string[];
    site_url?: string;
    ranking_keywords: string[];
    confidence_score?: number;
    summary?: string;
  }>;
  suggested_prompts: Array<{
    prompt: string;
    reason: string;
    target_subquery?: string;
  }>;
};

export type ExecutePromptsResponse = {
  executionId: string;
  mode: 'fire' | 'refire';
  provider: ai_chat_provider;
  status: 'queued';
  orderedQueue: Array<{
    promptId: string;
    text: string;
    index: number;
    status: 'queued';
  }>;
  version: CampaignVersionSummary;
  lastExecutionDate: string;
};

export type SiteTopQueriesResponse = {
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
    provider?: 'semrush' | 'ahrefs';
    fetched_at?: string;
    error?: string;
  }>;
  warnings: string[];
};

export type AnalyticsRange = '7d' | '30d' | 'all';

export type DashboardAnalyticsResponse = {
  range: AnalyticsRange;
  generated_at: string;
  momentum: Array<{
    date: string;
    chatgpt: number;
    claude: number;
    gemini: number;
    perplexity: number;
    grok: number;
    unknown: number;
  }>;
  health_matrix: Array<{
    campaign_id: string;
    campaign_name: string;
    executed_prompts: number;
    fetched_ratio: number;
    total_nodes: number;
    completed: number;
    failed: number;
    last_execution_at: string | null;
    provider_totals: {
      chatgpt: number;
      claude: number;
      gemini: number;
      perplexity: number;
      grok: number;
      unknown: number;
    };
  }>;
  freshness_buckets: Array<{
    bucket: 'pending' | '0_24h' | '1_3d' | '3_7d' | '7d_plus';
    count: number;
  }>;
};

export type PipelineAnalyticsResponse = {
  range: AnalyticsRange;
  version_id: string;
  generated_at: string;
  funnel: {
    suggested: number;
    selected: number;
    fired: number;
    executed_completed: number;
    websites_fetched: number;
  };
  execution_rhythm: Array<{
    day: string;
    hour: number;
    count: number;
  }>;
  provider_outcomes: Array<{
    provider: ai_chat_provider;
    completed: number;
    failed: number;
    total: number;
  }>;
  discovered_websites: number;
  fetched_websites: number;
};

export type PromptAnalyticsResponse = {
  range: AnalyticsRange;
  version_id: string;
  generated_at: string;
  points: Array<{
    prompt_id: string;
    prompt: string;
    provider: ai_chat_provider;
    status: 'completed' | 'failed';
    timestamp: string;
    keyword_count: number;
    website_count: number;
  }>;
  provider_outcomes: Array<{
    provider: ai_chat_provider;
    completed: number;
    failed: number;
    avg_websites_per_prompt: number;
    total: number;
  }>;
  timeline: Array<{
    prompt_id: string;
    prompt: string;
    provider: ai_chat_provider;
    status: 'completed' | 'failed';
    timestamp: string;
  }>;
};

export type WebsiteAnalyticsResponse = {
  range: AnalyticsRange;
  version_id: string;
  generated_at: string;
  points: Array<{
    url: string;
    host: string;
    prompt_count: number;
    providers: ai_chat_provider[];
    aggregated_volume: number;
    aggregated_traffic: number;
    fetched_at: string | null;
    freshness_bucket: 'pending' | '0_24h' | '1_3d' | '3_7d' | '7d_plus';
    last_seen_at: string;
  }>;
  freshness_buckets: Array<{
    bucket: 'pending' | '0_24h' | '1_3d' | '3_7d' | '7d_plus';
    count: number;
  }>;
  host_coverage: Array<{
    host: string;
    prompt_count: number;
    website_count: number;
  }>;
};

const tenant_access_message = 'This workspace is not available in your current account. Refresh or switch account.';

const is_project_endpoint = (url: string): boolean => url.includes('/api/campaigns');

const parse_json = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json()) as ApiResponse<T> | { message?: string };
  if (!response.ok || !('success' in payload) || !payload.success) {
    const fallback = 'message' in payload && payload.message ? payload.message : 'Request failed';
    const message =
      (response.status === 403 || response.status === 404) && is_project_endpoint(response.url)
        ? tenant_access_message
        : fallback;
    throw new Error(message);
  }
  return payload.data;
};

export const auth_storage = {
  get_access_token: () => localStorage.getItem(ACCESS_TOKEN_KEY),
  get_refresh_token: () => localStorage.getItem(REFRESH_TOKEN_KEY),
  get_user: () => {
    const raw = localStorage.getItem(USER_KEY);
    try {
      return raw ? JSON.parse(raw) as MeResponse : null;
    } catch {
      return null;
    }
  },
  set_tokens: (payload: ExchangeResponse) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, payload.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
  },
  update_user: (updates: Record<string, unknown>) => {
    const u = auth_storage.get_user();
    if (u) {
      localStorage.setItem(USER_KEY, JSON.stringify({ ...u, ...updates }));
    }
  },
  clear: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export const build_google_start_url = (params: { callback_uri: string; state_payload: Record<string, string>; action?: 'signin' | 'signup' }) => {
  const state = btoa(JSON.stringify(params.state_payload));
  const url = new URL('/api/auth/google/start', API_BASE_URL);
  url.searchParams.set('redirect_uri', params.callback_uri);
  url.searchParams.set('state', state);
  if (params.action) {
    url.searchParams.set('action', params.action);
  }
  return url.toString();
};

export const decode_state_payload = (state?: string): Record<string, string> | null => {
  if (!state) {
    return null;
  }
  try {
    return JSON.parse(atob(state)) as Record<string, string>;
  } catch {
    return null;
  }
};

export const exchange_code = async (code: string): Promise<ExchangeResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/auth/code/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return parse_json<ExchangeResponse>(response);
};

export const login_with_email = async (email: string, password_attempt: string): Promise<ExchangeResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: password_attempt }),
  });
  const data = await parse_json<ExchangeResponse>(response);
  auth_storage.set_tokens(data);
  return data;
};

export const switch_account = async (access_token: string, tenant_id: string): Promise<ExchangeResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/auth/switch-account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ tenant_id }),
  });
  const data = await parse_json<ExchangeResponse>(response);
  auth_storage.set_tokens(data);
  return data;
};

export const set_password = async (access_token: string, new_password: string): Promise<{ success: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/api/auth/set-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ password: new_password }),
  });
  return parse_json<{ success: boolean }>(response);
};

export const get_me = async (access_token: string): Promise<MeResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<MeResponse>(response);
};

export const get_account_memberships = async (access_token: string): Promise<Array<{
  tenant_id: string;
  role: string;
  account: {
    tenant_id: string;
    slug: string;
    name: string;
  };
  joined_at: string;
}>> => {
  const response = await fetch(`${API_BASE_URL}/api/accounts/memberships`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<Array<{
    tenant_id: string;
    role: string;
    account: {
      tenant_id: string;
      slug: string;
      name: string;
    };
    joined_at: string;
  }>>(response);
};

export const create_join_request = async (
  access_token: string,
  account_slug: string,
): Promise<{ request_id: string; account_slug: string; tenant_id: string; status: string }> => {
  const response = await fetch(`${API_BASE_URL}/api/accounts/join-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ account_slug }),
  });
  return parse_json<{ request_id: string; account_slug: string; tenant_id: string; status: string }>(response);
};

export const list_join_requests = async (
  access_token: string,
  status?: 'pending' | 'approved' | 'rejected',
): Promise<Array<{ request_id: string; status: string; requested_at: string; resolved_at?: string | null }>> => {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await fetch(`${API_BASE_URL}/api/accounts/join-requests${query}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<Array<{ request_id: string; status: string; requested_at: string; resolved_at?: string | null }>>(response);
};

export const approve_join_request = async (
  access_token: string,
  request_id: string,
): Promise<{ request_id: string; status: string }> => {
  const response = await fetch(`${API_BASE_URL}/api/accounts/join-requests/${request_id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<{ request_id: string; status: string }>(response);
};

export const reject_join_request = async (
  access_token: string,
  request_id: string,
): Promise<{ request_id: string; status: string }> => {
  const response = await fetch(`${API_BASE_URL}/api/accounts/join-requests/${request_id}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<{ request_id: string; status: string }>(response);
};

export const get_domains = async (access_token: string): Promise<DomainSummary[]> => {
  const response = await fetch(`${API_BASE_URL}/api/domains`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<DomainSummary[]>(response);
};

export const create_domain = async (
  access_token: string,
  domain_url: string,
): Promise<{ domain: DomainSummary; context: unknown }> => {
  const response = await fetch(`${API_BASE_URL}/api/domains`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ domain_url }),
  });
  return parse_json<{ domain: DomainSummary; context: unknown }>(response);
};

export const get_domain_context = async (
  access_token: string,
  domain_id: string,
): Promise<{ domain: DomainSummary; context: unknown }> => {
  const response = await fetch(`${API_BASE_URL}/api/domains/${domain_id}/context`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<{ domain: DomainSummary; context: unknown }>(response);
};

export const rescrape_domain = async (
  access_token: string,
  domain_id: string,
): Promise<{ domain: DomainSummary; context: unknown }> => {
  const response = await fetch(`${API_BASE_URL}/api/domains/${domain_id}/rescrape`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<{ domain: DomainSummary; context: unknown }>(response);
};

export const create_campaign = async (
  access_token: string,
  payload: {
    domain_id: string;
    name: string;
    description?: string;
    target_location?: string;
    industry_tag?: string;
    business_type?: string;
    primary_goal?: string;
  },
): Promise<CampaignSummary> => {
  const response = await fetch(`${API_BASE_URL}/api/campaigns`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify(payload),
  });
  return parse_json<CampaignSummary>(response);
};

export const get_campaigns = async (access_token: string, params?: { domain_id?: string }): Promise<CampaignSummary[]> => {
  const search = new URLSearchParams();
  if (params?.domain_id) {
    search.set('domain_id', params.domain_id);
  }
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<CampaignSummary[]>(response);
};

export const get_campaign_versions = async (
  access_token: string,
  campaign_id: string,
): Promise<{ campaign: Omit<CampaignSummary, 'active_version_number' | 'total_nodes' | 'root_prompt_count'>; versions: CampaignVersionSummary[] }> => {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/versions`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<{ campaign: Omit<CampaignSummary, 'active_version_number' | 'total_nodes' | 'root_prompt_count'>; versions: CampaignVersionSummary[] }>(response);
};

export const get_campaign_tree = async (
  access_token: string,
  campaign_id: string,
  params?: { version_id?: string },
): Promise<{ campaign: CampaignSummary; version?: CampaignVersionSummary | null; roots: CampaignTreeNode[] }> => {
  const search = new URLSearchParams();
  if (params?.version_id) {
    search.set('version_id', params.version_id);
  }
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/tree${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<{ campaign: CampaignSummary; version?: CampaignVersionSummary | null; roots: CampaignTreeNode[] }>(response);
};

export const get_onboarding_context = async (access_token: string): Promise<OnboardingContext> => {
  const response = await fetch(`${API_BASE_URL}/api/onboarding/context`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<OnboardingContext>(response);
};

export const bootstrap_onboarding = async (
  access_token: string,
  payload:
    | {
      mode: 'create_account';
      domain_url: string;
    }
    | {
      mode: 'join_account';
      account_slug: string;
    },
): Promise<OnboardingContext> => {
  const response = await fetch(`${API_BASE_URL}/api/onboarding/bootstrap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify(payload),
  });
  return parse_json<OnboardingContext>(response);
};

export const get_campaign_chat_threads = async (
  access_token: string,
  campaign_id: string,
  params?: { version_id?: string; provider?: ai_chat_provider; limit?: number; offset?: number },
): Promise<ChatThreadsResponse> => {
  const search = new URLSearchParams();
  if (params?.version_id !== undefined) {
    search.set('version_id', params.version_id);
  }
  if (params?.provider !== undefined) {
    search.set('provider', params.provider);
  }
  if (params?.limit !== undefined) {
    search.set('limit', String(params.limit));
  }
  if (params?.offset !== undefined) {
    search.set('offset', String(params.offset));
  }
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/chat-threads${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<ChatThreadsResponse>(response);
};

export const link_campaign_chat_thread = async (
  access_token: string,
  campaign_id: string,
  params: { version_id?: string } | undefined,
  payload: {
    chat_provider: ai_chat_provider;
    conversation_id?: string;
    provider_chat_id?: string;
    chat_url?: string;
    chat_title?: string;
  },
): Promise<ChatThreadSummary> => {
  const response = await fetch(
    `${API_BASE_URL}/api/campaigns/${campaign_id}/chat-threads/link${params?.version_id ? `?version_id=${encodeURIComponent(params.version_id)}` : ''}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify(payload),
    },
  );
  return parse_json<ChatThreadSummary>(response);
};

export const mark_campaign_chat_thread_opened = async (
  access_token: string,
  campaign_id: string,
  chat_thread_id: string,
): Promise<ChatThreadSummary> => {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/chat-threads/${chat_thread_id}/opened`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<ChatThreadSummary>(response);
};

export const refresh_campaign_node = async (
  access_token: string,
  campaign_id: string,
  node_id: string,
  params?: { version_id?: string },
  payload?: { provider?: ai_chat_provider; scope?: 'node' | 'branch' },
): Promise<RefreshNodeResponse> => {
  const search = new URLSearchParams();
  if (params?.version_id) {
    search.set('version_id', params.version_id);
  }
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/nodes/${encodeURIComponent(node_id)}/refresh${query ? `?${query}` : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify(payload ?? {}),
  });
  return parse_json<RefreshNodeResponse>(response);
};

export const get_campaign_prompt_workflow_state = async (
  access_token: string,
  campaign_id: string,
  params?: { version_id?: string },
): Promise<PromptWorkflowState> => {
  const search = new URLSearchParams();
  if (params?.version_id) {
    search.set('version_id', params.version_id);
  }
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/workflow/state${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return parse_json<PromptWorkflowState>(response);
};

export const ingest_campaign_conversation = async (
  access_token: string,
  campaign_id: string,
  provider: ai_chat_provider,
  payload: {
    conversationId: string;
    payload: unknown;
    promptVersionId?: string;
  },
  params?: { version_id?: string },
): Promise<PromptWorkflowState> => {
  const search = new URLSearchParams();
  if (params?.version_id) {
    search.set('version_id', params.version_id);
  }
  const query = search.toString();
  const response = await fetch(
    `${API_BASE_URL}/api/campaigns/${campaign_id}/providers/${provider}/conversations/ingest${query ? `?${query}` : ''}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify(payload),
    },
  );
  return parse_json<PromptWorkflowState>(response);
};

export const add_campaign_manual_prompt = async (
  access_token: string,
  campaign_id: string,
  version_id: string,
  payload: { text: string },
): Promise<PromptWorkflowState> => {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/versions/${version_id}/prompts/manual`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify(payload),
  });
  return parse_json<PromptWorkflowState>(response);
};

export const select_campaign_prompt_candidates = async (
  access_token: string,
  campaign_id: string,
  version_id: string,
  payload: { promptIds: string[]; selected: boolean },
): Promise<PromptWorkflowState> => {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/versions/${version_id}/prompts/select`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify(payload),
  });
  return parse_json<PromptWorkflowState>(response);
};

export const replace_campaign_prompt_selection = async (
  access_token: string,
  campaign_id: string,
  version_id: string,
  payload: { selectedPromptIds: string[] },
): Promise<PromptWorkflowState> => {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/versions/${version_id}/prompts/selection-set`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify(payload),
  });
  return parse_json<PromptWorkflowState>(response);
};

export const generate_campaign_suggestions = async (
  access_token: string,
  campaign_id: string,
  params?: { version_id?: string },
  payload?: { max_suggestions?: number; append?: boolean },
): Promise<SuggestPromptsResponse> => {
  const search = new URLSearchParams();
  if (params?.version_id) {
    search.set('version_id', params.version_id);
  }
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/suggestions/generate${query ? `?${query}` : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify(payload ?? {}),
  });
  return parse_json<SuggestPromptsResponse>(response);
};

export const execute_campaign_prompts = async (
  access_token: string,
  campaign_id: string,
  version_id: string,
  payload: { mode: 'fire' | 'refire'; promptIds: string[]; provider: ai_chat_provider },
): Promise<ExecutePromptsResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/versions/${version_id}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify(payload),
  });
  return parse_json<ExecutePromptsResponse>(response);
};

export const get_campaign_site_top_queries = async (
  access_token: string,
  campaign_id: string,
  payload: {
    targets?: Array<{ domain?: string; page_url?: string }>;
    hosts?: string[];
    country?: string;
    limit?: number;
    forceRefresh?: boolean;
  },
  params?: { version_id?: string },
): Promise<SiteTopQueriesResponse> => {
  const search = new URLSearchParams();
  if (params?.version_id) {
    search.set('version_id', params.version_id);
  }
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/site-keywords/top-queries${query ? `?${query}` : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify(payload),
  });
  return parse_json<SiteTopQueriesResponse>(response);
};

export const get_dashboard_analytics = async (
  access_token: string,
  params?: { range?: AnalyticsRange },
  options?: { signal?: AbortSignal },
): Promise<DashboardAnalyticsResponse> => {
  const search = new URLSearchParams();
  if (params?.range) {
    search.set('range', params.range);
  }
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns/analytics/dashboard${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: options?.signal,
  });
  return parse_json<DashboardAnalyticsResponse>(response);
};

export const get_campaign_pipeline_analytics = async (
  access_token: string,
  campaign_id: string,
  params?: { version_id?: string; range?: AnalyticsRange },
  options?: { signal?: AbortSignal },
): Promise<PipelineAnalyticsResponse> => {
  const search = new URLSearchParams();
  if (params?.version_id) search.set('version_id', params.version_id);
  if (params?.range) search.set('range', params.range);
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/analytics/pipeline${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: options?.signal,
  });
  return parse_json<PipelineAnalyticsResponse>(response);
};

export const get_campaign_prompt_analytics = async (
  access_token: string,
  campaign_id: string,
  params?: { version_id?: string; range?: AnalyticsRange },
  options?: { signal?: AbortSignal },
): Promise<PromptAnalyticsResponse> => {
  const search = new URLSearchParams();
  if (params?.version_id) search.set('version_id', params.version_id);
  if (params?.range) search.set('range', params.range);
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/analytics/prompts${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: options?.signal,
  });
  return parse_json<PromptAnalyticsResponse>(response);
};

export const get_campaign_website_analytics = async (
  access_token: string,
  campaign_id: string,
  params?: { version_id?: string; range?: AnalyticsRange },
  options?: { signal?: AbortSignal },
): Promise<WebsiteAnalyticsResponse> => {
  const search = new URLSearchParams();
  if (params?.version_id) search.set('version_id', params.version_id);
  if (params?.range) search.set('range', params.range);
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaign_id}/analytics/websites${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: options?.signal,
  });
  return parse_json<WebsiteAnalyticsResponse>(response);
};

export const issue_extension_code = async (params: {
  access_token: string;
  redirect_uri: string;
  state?: string;
}) => {
  const response = await fetch(`${API_BASE_URL}/api/auth/issue-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.access_token}`,
    },
    body: JSON.stringify({
      redirect_uri: params.redirect_uri,
      state: params.state,
    }),
  });
  return parse_json<{ redirect_uri: string; code: string; state?: string }>(response);
};

export const logout = async (refresh_token: string) => {
  await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token }),
  });
};

export const start_google_login = (state_payload: Record<string, string>, action?: 'signin' | 'signup') => {
  const callback_uri = `${window.location.origin}/auth/callback`;
  const url = build_google_start_url({ callback_uri, state_payload, action });
  window.location.href = url;
};
