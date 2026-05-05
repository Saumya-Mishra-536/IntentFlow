import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { useLocation, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowDownToLine,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  Filter,
  Globe2,
  Layers3,
  Link2,
  ListOrdered,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { AppLayoutContext } from './app-layout';
import {
  AnalyticsRange,
  ai_chat_provider,
  add_campaign_manual_prompt,
  auth_storage,
  execute_campaign_prompts,
  generate_campaign_suggestions,
  get_campaign_prompt_workflow_state,
  get_campaign_site_top_queries,
  get_campaign_versions,
  PromptCandidate,
  PromptWorkflowState,
  replace_campaign_prompt_selection,
  select_campaign_prompt_candidates,
} from '@/shared/lib/auth';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/components/ui/sheet';
import { Tabs, TabsContent } from '@/shared/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { D3CardFrame } from '@/shared/components/d3/D3CardFrame';
import { ScatterOpportunityChart } from '@/features/analytics/charts/ScatterOpportunityChart';
import { StackedBarChart } from '@/features/analytics/charts/StackedBarChart';
import { TimelineStripChart } from '@/features/analytics/charts/TimelineStripChart';
import { RankBarChart } from '@/features/analytics/charts/RankBarChart';
import { usePromptAnalytics } from '@/features/analytics/hooks/usePromptAnalytics';
import { useWebsiteAnalytics } from '@/features/analytics/hooks/useWebsiteAnalytics';
import { analytics_api } from '@/shared/lib/analytics';
import chatgptLogo from '/chatgpt.svg';
import claudeLogo from '/claude.svg';
import perplexityLogo from '/perplexity.svg';
import grokLogo from '/grok-(xai).svg';

const WEB_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://ai-seo-monorepo.onrender.com';

const EXECUTED_FILTER_PROVIDERS = ['chatgpt', 'claude', 'perplexity', 'grok'] as const;
type ExecutedProviderFilter = 'all' | typeof EXECUTED_FILTER_PROVIDERS[number];
type FireProvider = typeof EXECUTED_FILTER_PROVIDERS[number];

const PROVIDER_LOGO_MAP: Record<Extract<ai_chat_provider, 'chatgpt' | 'claude' | 'perplexity' | 'grok'>, string> = {
  chatgpt: chatgptLogo,
  claude: claudeLogo,
  perplexity: perplexityLogo,
  grok: grokLogo,
};

type SiteQueryRow = {
  query: string;
  volume?: number;
  traffic?: number;
  sourceTimestamp: string;
};

type SiteQueryState = {
  loading: boolean;
  rows: SiteQueryRow[];
  cached?: boolean;
  provider?: 'semrush' | 'ahrefs';
  fetchedAt?: string;
  error?: string;
};

type QueueStatus = 'queued' | 'running' | 'completed' | 'failed';
type ExecutionQueueItem = {
  promptId: string;
  text: string;
  provider?: FireProvider;
  index: number;
  status: QueueStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

type BridgeRuntime = {
  sendMessage: (message: Record<string, unknown>, callback?: (response: unknown) => void) => void;
  lastError?: { message?: string };
  onMessage?: {
    addListener: (listener: (message: unknown) => void) => void;
    removeListener: (listener: (message: unknown) => void) => void;
  };
};

const get_extension_runtime = (): BridgeRuntime | null => {
  const runtime = (window as Window & { chrome?: { runtime?: BridgeRuntime } }).chrome?.runtime;
  if (!runtime || typeof runtime.sendMessage !== 'function') {
    return null;
  }
  return runtime;
};

const format_date = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const now = new Date();
  const is_same_day = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const is_yesterday = date.toDateString() === yesterday.toDateString();

  const time_text = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

  if (is_same_day) return `Today at ${time_text}`;
  if (is_yesterday) return `Yesterday at ${time_text}`;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

const iso_day = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const provider_label = (value: ai_chat_provider): string => {
  if (value === 'chatgpt') return 'ChatGPT';
  if (value === 'claude') return 'Claude';
  if (value === 'perplexity') return 'Perplexity';
  if (value === 'gemini') return 'Gemini';
  if (value === 'grok') return 'Grok';
  return 'Unknown';
};

const provider_logo = (value: ai_chat_provider): string | null => {
  if (value === 'chatgpt' || value === 'claude' || value === 'perplexity' || value === 'grok') {
    return PROVIDER_LOGO_MAP[value];
  }
  return null;
};

const get_favicon_url = (target_url: string, host?: string): string | null => {
  try {
    const parsed = new URL(target_url);
    return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(parsed.origin)}`;
  } catch {
    if (!host) return null;
    return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(`https://${host}`)}`;
  }
};

function useVirtualRows(row_count: number, row_height: number, enabled: boolean) {
  const container_ref = useRef<HTMLDivElement | null>(null);
  const raf_ref = useRef<number | null>(null);
  const [scroll_top, set_scroll_top] = useState(0);
  const [viewport_height, set_viewport_height] = useState(0);

  useEffect(() => {
    if (!enabled) {
      set_scroll_top(0);
      set_viewport_height(0);
      return;
    }
    const element = container_ref.current;
    if (!element) return;
    const update_height = () => {
      set_viewport_height(element.clientHeight);
    };
    update_height();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update_height);
      return () => {
        window.removeEventListener('resize', update_height);
      };
    }
    const observer = new ResizeObserver(update_height);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [enabled, row_count]);

  useEffect(() => () => {
    if (raf_ref.current !== null) {
      window.cancelAnimationFrame(raf_ref.current);
      raf_ref.current = null;
    }
  }, []);

  const on_scroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const next = event.currentTarget.scrollTop;
    if (raf_ref.current !== null) {
      window.cancelAnimationFrame(raf_ref.current);
    }
    raf_ref.current = window.requestAnimationFrame(() => {
      set_scroll_top(next);
      raf_ref.current = null;
    });
  }, [enabled]);

  const overscan = 8;
  const visible_count = Math.max(1, Math.ceil((viewport_height || row_height) / row_height));
  const raw_start = Math.max(0, Math.floor(scroll_top / row_height) - overscan);
  const max_start = Math.max(0, row_count - 1);
  const start = Math.min(raw_start, max_start);
  const end = Math.min(row_count, start + visible_count + overscan * 2);
  const top_spacer = start * row_height;
  const bottom_spacer = Math.max(0, (row_count - end) * row_height);

  return {
    container_ref,
    on_scroll,
    start,
    end,
    top_spacer,
    bottom_spacer,
  };
}

const try_extension_bridge = async (message: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: unknown }> => {
  const runtime = get_extension_runtime();
  if (!runtime) {
    const request_id = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', on_window_message);
        resolve({ ok: false, error: 'Extension bridge unavailable in this browser context.' });
      }, 1800);

      const on_window_message = (event: MessageEvent) => {
        if (event.source !== window) return;
        const payload = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : null;
        if (!payload || payload.type !== 'AI_SEO_WEB_BRIDGE_RESPONSE') return;
        if (payload.requestId !== request_id) return;
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.removeEventListener('message', on_window_message);
        const ok = Boolean(payload.ok);
        if (!ok) {
          resolve({
            ok: false,
            error: typeof payload.error === 'string' ? payload.error : 'Extension bridge unavailable in this browser context.',
          });
          return;
        }
        resolve({ ok: true, data: payload.data });
      };

      window.addEventListener('message', on_window_message);
      window.postMessage(
        {
          type: 'AI_SEO_WEB_BRIDGE_REQUEST',
          requestId: request_id,
          message,
        },
        '*',
      );
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: 'Extension bridge timeout.' });
    }, 1500);

    try {
      runtime.sendMessage(message, (response: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        const runtime_error = runtime.lastError?.message;
        if (runtime_error) {
          resolve({ ok: false, error: runtime_error });
          return;
        }
        resolve({ ok: true, data: response });
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve({ ok: false, error: error instanceof Error ? error.message : 'Failed to call extension bridge.' });
    }
  });
};

export default function CampaignListPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested_version_id = searchParams.get('version_id') ?? undefined;
  const analytics_range = (searchParams.get('range') as AnalyticsRange | null) ?? '30d';
  const chart_status_filter = searchParams.get('status') as ('completed' | 'failed' | null);
  const chart_host_filter = searchParams.get('host');
  const chart_prompt_filter = searchParams.get('prompt_id');
  const chart_date_bucket_filter = searchParams.get('date_bucket');
  const requested_provider = searchParams.get('provider');
  const requested_provider_filter: ExecutedProviderFilter =
    requested_provider && EXECUTED_FILTER_PROVIDERS.includes(requested_provider as typeof EXECUTED_FILTER_PROVIDERS[number])
      ? (requested_provider as ExecutedProviderFilter)
      : 'all';
  const { projectsData } = useOutletContext<AppLayoutContext>();

  const campaign = useMemo(() => projectsData.find((item) => item.project.id === id), [projectsData, id]);

  const [versions, set_versions] = useState<Array<{ id: string; version_number: number; is_active: boolean; label?: string | null }>>([]);
  const [versions_loading, set_versions_loading] = useState(false);
  const [selected_version_id, set_selected_version_id] = useState<string | undefined>(requested_version_id);
  const [workflow, set_workflow] = useState<PromptWorkflowState | null>(null);
  const [workflow_loading, set_workflow_loading] = useState(false);
  const [error_message, set_error_message] = useState('');

  const [manual_prompt_text, set_manual_prompt_text] = useState('');
  const [manual_saving, set_manual_saving] = useState(false);
  const [refreshing, set_refreshing] = useState(false);
  const [executed_provider_filter, set_executed_provider_filter] = useState<ExecutedProviderFilter>(requested_provider_filter);
  const [fire_dialog_open, set_fire_dialog_open] = useState(false);
  const [queue_dialog_open, set_queue_dialog_open] = useState(false);
  const [pending_execution_mode, set_pending_execution_mode] = useState<'fire' | 'refire'>('fire');
  const [selected_fire_providers, set_selected_fire_providers] = useState<Record<FireProvider, boolean>>({
    chatgpt: requested_provider_filter === 'all' || requested_provider_filter === 'chatgpt',
    claude: requested_provider_filter === 'claude',
    perplexity: requested_provider_filter === 'perplexity',
    grok: requested_provider_filter === 'grok',
  });
  const [is_executing, set_is_executing] = useState(false);
  const [bridge_status, set_bridge_status] = useState<{ connected: boolean; message: string }>({
    connected: false,
    message: 'Checking extension bridge...',
  });

  const [active_execution_id, set_active_execution_id] = useState<string | null>(null);
  const [execution_queue, set_execution_queue] = useState<ExecutionQueueItem[]>([]);
  const [execution_finished_at, set_execution_finished_at] = useState<string | null>(null);

  const [selected_executed_prompt_id, set_selected_executed_prompt_id] = useState<string | null>(null);
  const [selected_candidate_prompt_id, set_selected_candidate_prompt_id] = useState<string | null>(null);
  const [prompts_drawer_open, set_prompts_drawer_open] = useState(false);
  const [websites_drawer_open, set_websites_drawer_open] = useState(false);
  const [selected_website_row_id, set_selected_website_row_id] = useState<string | null>(null);
  const [selected_website_row_ids, set_selected_website_row_ids] = useState<string[]>([]);
  const [selected_executed_row_ids, set_selected_executed_row_ids] = useState<string[]>([]);
  const [executed_visible_count, set_executed_visible_count] = useState(10);
  const [suggested_visible_count, set_suggested_visible_count] = useState(12);
  const [suggestion_mode, set_suggestion_mode] = useState<'regenerate' | 'append' | null>(null);

  const [selected_website_url, set_selected_website_url] = useState<string | null>(null);
  const [pipeline_details_open, set_pipeline_details_open] = useState(false);
  const [pipeline_queries_open, set_pipeline_queries_open] = useState(false);
  const [site_queries_by_host, set_site_queries_by_host] = useState<Record<string, SiteQueryState>>({});

  const selected_prompt_ids = useMemo(
    () => (workflow?.promptCandidates ?? []).filter((item) => item.selected).map((item) => item.id),
    [workflow],
  );
  const prompt_candidate_ids = useMemo(
    () => (workflow?.promptCandidates ?? []).map((item) => item.id),
    [workflow],
  );

  const suggested_prompts = workflow?.promptCandidates ?? [];
  const executed_prompts = workflow?.executedPrompts ?? [];
  const filtered_executed_prompts = useMemo(
    () => (executed_provider_filter === 'all' ? executed_prompts : executed_prompts.filter((item) => item.provider === executed_provider_filter)),
    [executed_prompts, executed_provider_filter],
  );
  const analytics_filtered_executed_prompts = useMemo(
    () => filtered_executed_prompts.filter((item) => {
      if (chart_status_filter && item.status !== chart_status_filter) return false;
      if (chart_prompt_filter && item.id !== chart_prompt_filter) return false;
      if (chart_date_bucket_filter && iso_day(item.lastExecutionAt) !== chart_date_bucket_filter) return false;
      return true;
    }),
    [chart_date_bucket_filter, chart_prompt_filter, chart_status_filter, filtered_executed_prompts],
  );

  const visible_executed_prompts = useMemo(
    () => analytics_filtered_executed_prompts.slice(0, executed_visible_count),
    [analytics_filtered_executed_prompts, executed_visible_count],
  );
  const visible_suggested_prompts = useMemo(
    () => suggested_prompts.slice(0, suggested_visible_count),
    [suggested_prompts, suggested_visible_count],
  );

  const executed_prompt_by_source_id = useMemo(() => {
    const map = new Map<string, PromptWorkflowState['executedPrompts'][number]>();
    for (const executed of workflow?.executedPrompts ?? []) {
      if (executed.sourcePromptId) {
        map.set(executed.sourcePromptId, executed);
      }
    }
    return map;
  }, [workflow]);

  const selected_executed_prompt = useMemo(() => {
    if (!selected_executed_prompt_id) return null;
    return (workflow?.executedPrompts ?? []).find((item) => item.id === selected_executed_prompt_id) ?? null;
  }, [workflow, selected_executed_prompt_id]);

  const selected_candidate_prompt = useMemo(() => {
    if (!selected_candidate_prompt_id) return null;
    return (workflow?.promptCandidates ?? []).find((item) => item.id === selected_candidate_prompt_id) ?? null;
  }, [workflow, selected_candidate_prompt_id]);

  const discovery_keywords = selected_executed_prompt?.searchedKeywords ?? workflow?.searchedKeywords ?? [];
  const discovery_websites = selected_executed_prompt?.crawledWebsites ?? workflow?.crawledWebsites ?? [];

  const selected_website = useMemo(() => {
    if (!discovery_websites.length) return null;
    const explicit = discovery_websites.find((item) => item.url === selected_website_url);
    return explicit ?? discovery_websites[0];
  }, [discovery_websites, selected_website_url]);

  const selected_site_query_key = selected_website?.url;
  const selected_site_query_state = selected_site_query_key ? site_queries_by_host[selected_site_query_key] : undefined;

  const selected_fire_provider_list = useMemo(
    () => EXECUTED_FILTER_PROVIDERS.filter((provider) => selected_fire_providers[provider]),
    [selected_fire_providers],
  );
  const execution_prompt_count = selected_prompt_ids.length ? selected_prompt_ids.length : prompt_candidate_ids.length;

  const selected_prompt_heading = selected_executed_prompt?.text ?? selected_candidate_prompt?.text ?? 'Latest campaign discovery';
  const queue_completed_count = execution_queue.filter((item) => item.status === 'completed').length;
  const queue_running_count = execution_queue.filter((item) => item.status === 'running').length;
  const queue_failed_count = execution_queue.filter((item) => item.status === 'failed').length;
  const queue_queued_count = execution_queue.filter((item) => item.status === 'queued').length;
  const queue_done_count = queue_completed_count + queue_failed_count;
  const queue_left_count = execution_queue.length - queue_done_count;
  const suggestions_loading = suggestion_mode !== null;
  const can_generate_suggestions = (workflow?.executedPrompts.length ?? 0) > 0;
  const initial_workflow_loading = workflow_loading && !workflow;
  const campaign_tab: 'pipeline' | 'prompts' | 'websites' =
    location.pathname.endsWith('/prompts')
      ? 'prompts'
      : location.pathname.endsWith('/websites')
        ? 'websites'
        : 'pipeline';

  const set_chart_filter = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const apply_provider_filter = useCallback((provider: ExecutedProviderFilter) => {
    set_executed_provider_filter(provider);
    set_chart_filter('provider', provider === 'all' ? null : provider);
  }, [set_chart_filter]);

  const update_fire_provider_selection = useCallback((provider: FireProvider, selected: boolean) => {
    set_selected_fire_providers((prev) => ({ ...prev, [provider]: selected }));
  }, []);

  const open_execute_dialog = useCallback((mode: 'fire' | 'refire') => {
    if (!prompt_candidate_ids.length) {
      set_error_message('No prompt candidates available to execute.');
      return;
    }
    set_pending_execution_mode(mode);
    set_fire_dialog_open(true);
  }, [prompt_candidate_ids.length]);

  const prompt_tab_active = campaign_tab === 'prompts';
  const website_tab_active = campaign_tab === 'websites';

  const { data: prompt_analytics, loading: prompt_analytics_loading } = usePromptAnalytics(
    id,
    selected_version_id,
    analytics_range,
    prompt_tab_active,
  );
  const { data: website_analytics, loading: website_analytics_loading } = useWebsiteAnalytics(
    id,
    selected_version_id,
    analytics_range,
    website_tab_active,
  );

  const website_table_rows = useMemo(() => {
    const rows: Array<{
      id: string;
      executed_id: string;
      prompt: string;
      provider: ai_chat_provider;
      status: string;
      last_execution_at?: string;
      website_url: string;
      website_host: string;
      website_source: string;
    }> = [];
    for (const executed of analytics_filtered_executed_prompts) {
      for (const site of executed.crawledWebsites) {
        rows.push({
          id: `${executed.id}::${site.url}`,
          executed_id: executed.id,
          prompt: executed.text,
          provider: executed.provider,
          status: executed.status,
          last_execution_at: executed.lastExecutionAt,
          website_url: site.url,
          website_host: site.host,
          website_source: site.source,
        });
      }
    }
    return rows;
  }, [analytics_filtered_executed_prompts]);
  const filtered_website_table_rows = useMemo(
    () => website_table_rows.filter((item) => {
      if (chart_host_filter && item.website_host !== chart_host_filter) return false;
      if (chart_prompt_filter && item.executed_id !== chart_prompt_filter) return false;
      return true;
    }),
    [chart_host_filter, chart_prompt_filter, website_table_rows],
  );
  const prompts_table_loading = workflow_loading || refreshing;
  const websites_table_loading = workflow_loading || refreshing;
  const prompt_virtual_rows = useVirtualRows(
    analytics_filtered_executed_prompts.length,
    54,
    prompt_tab_active && !prompts_table_loading,
  );
  const website_virtual_rows = useVirtualRows(
    filtered_website_table_rows.length,
    58,
    website_tab_active && !websites_table_loading,
  );
  const visible_prompt_rows = useMemo(
    () => analytics_filtered_executed_prompts.slice(prompt_virtual_rows.start, prompt_virtual_rows.end),
    [analytics_filtered_executed_prompts, prompt_virtual_rows.end, prompt_virtual_rows.start],
  );
  const visible_website_rows = useMemo(
    () => filtered_website_table_rows.slice(website_virtual_rows.start, website_virtual_rows.end),
    [filtered_website_table_rows, website_virtual_rows.end, website_virtual_rows.start],
  );

  const selected_website_table_row = useMemo(
    () => filtered_website_table_rows.find((item) => item.id === selected_website_row_id) ?? null,
    [filtered_website_table_rows, selected_website_row_id],
  );

  useEffect(() => {
    set_selected_executed_prompt_id((prev) => {
      if (prev && analytics_filtered_executed_prompts.some((item) => item.id === prev)) return prev;
      return analytics_filtered_executed_prompts[0]?.id ?? null;
    });
    set_selected_executed_row_ids((prev) => prev.filter((id) => analytics_filtered_executed_prompts.some((item) => item.id === id)));
  }, [analytics_filtered_executed_prompts]);

  useEffect(() => {
    set_selected_website_row_ids((prev) => prev.filter((id) => filtered_website_table_rows.some((item) => item.id === id)));
    set_selected_website_row_id((prev) => (prev && filtered_website_table_rows.some((item) => item.id === prev) ? prev : null));
  }, [filtered_website_table_rows]);

  useEffect(() => {
    set_executed_visible_count(10);
  }, [executed_provider_filter]);

  useEffect(() => {
    if (requested_provider_filter !== executed_provider_filter) {
      set_executed_provider_filter(requested_provider_filter);
    }
  }, [executed_provider_filter, requested_provider_filter]);

  useEffect(() => {
    if (!discovery_websites.length) {
      set_selected_website_url(null);
      return;
    }
    set_selected_website_url((prev) => {
      if (prev && discovery_websites.some((site) => site.url === prev)) return prev;
      return discovery_websites[0].url;
    });
  }, [discovery_websites]);

  const load_versions = useCallback(async () => {
    if (!id) return;
    const token = auth_storage.get_access_token();
    if (!token) return;
    set_versions_loading(true);
    try {
      const payload = await get_campaign_versions(token, id);
      const next_versions = payload.versions ?? [];
      set_versions(next_versions);
      set_selected_version_id((prev) => {
        if (prev && next_versions.some((entry) => entry.id === prev)) return prev;
        return next_versions.find((entry) => entry.is_active)?.id ?? next_versions[0]?.id;
      });
    } catch (error) {
      set_versions([]);
      set_error_message(error instanceof Error ? error.message : 'Failed to load versions');
    } finally {
      set_versions_loading(false);
    }
  }, [id]);

  const load_workflow_state = useCallback(async () => {
    if (!id) return;
    const token = auth_storage.get_access_token();
    if (!token) return;

    set_workflow_loading(true);
    set_error_message('');
    try {
      const payload = await get_campaign_prompt_workflow_state(token, id, { version_id: selected_version_id });
      set_workflow(payload);
      set_executed_visible_count(10);
      set_suggested_visible_count(12);
      set_selected_candidate_prompt_id(null);
      set_selected_executed_prompt_id((prev) => {
        if (prev && payload.executedPrompts.some((item) => item.id === prev)) return prev;
        return payload.executedPrompts[0]?.id ?? null;
      });
      const first_executed_website = payload.executedPrompts[0]?.crawledWebsites?.[0];
      const first_website = first_executed_website ?? payload.crawledWebsites[0];
      set_selected_website_url((prev) => prev ?? first_website?.url ?? null);
    } catch (error) {
      set_workflow(null);
      set_error_message(error instanceof Error ? error.message : 'Failed to load prompt workflow');
    } finally {
      set_workflow_loading(false);
    }
  }, [id, selected_version_id]);

  const fetch_site_top_queries = useCallback(async (target: string, force_refresh = false) => {
    if (!id || !selected_version_id) return;
    const token = auth_storage.get_access_token();
    if (!token) return;

    set_site_queries_by_host((prev) => ({
      ...prev,
      [target]: {
        ...(prev[target] ?? { rows: [] }),
        loading: true,
        error: undefined,
      },
    }));

    try {
      const payload = await get_campaign_site_top_queries(
        token,
        id,
        {
          targets: [target.includes('://') ? { page_url: target } : { domain: target }],
          country: 'IN',
          limit: 10,
          forceRefresh: force_refresh,
        },
        { version_id: selected_version_id },
      );
      const row = payload.results[0];
      set_site_queries_by_host((prev) => ({
        ...prev,
        [target]: {
          loading: false,
          rows: row?.top_queries ?? [],
          cached: row?.cached,
          provider: row?.provider,
          fetchedAt: row?.fetched_at,
          error: row?.error,
        },
      }));
    } catch (error) {
      set_site_queries_by_host((prev) => ({
        ...prev,
        [target]: {
          ...(prev[target] ?? { rows: [] }),
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch top queries',
        },
      }));
    }
  }, [id, selected_version_id]);

  useEffect(() => {
    void load_versions();
  }, [load_versions]);

  useEffect(() => {
    if (!selected_version_id) return;
    void load_workflow_state();
  }, [selected_version_id, load_workflow_state]);

  useEffect(() => {
    set_execution_queue([]);
    set_execution_finished_at(null);
    set_active_execution_id(null);
    set_is_executing(false);
    set_suggestion_mode(null);
    set_selected_executed_prompt_id(null);
    set_selected_candidate_prompt_id(null);
    set_selected_executed_row_ids([]);
    set_selected_website_row_ids([]);
    set_selected_website_row_id(null);
    set_prompts_drawer_open(false);
    set_websites_drawer_open(false);
    set_selected_website_url(null);
    set_pipeline_details_open(false);
    set_pipeline_queries_open(false);
    set_site_queries_by_host({});
  }, [selected_version_id]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selected_version_id) next.set('version_id', selected_version_id);
    else next.delete('version_id');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [selected_version_id, searchParams, setSearchParams]);

  const refresh_bridge_status = useCallback(async () => {
    const result = await try_extension_bridge({ type: 'AI_SEO_BRIDGE_GET_STATUS' });
    if (!result.ok) {
      set_bridge_status({ connected: false, message: result.error ?? 'Extension bridge unavailable' });
      return;
    }

    const data = result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>) : {};
    if (data.ok === false) {
      const error = typeof data.error === 'string' ? data.error : 'Extension bridge unavailable';
      set_bridge_status({ connected: false, message: error });
      return;
    }
    const bridge_is_executing = Boolean(data.isExecuting);
    const execution_id = typeof data.executionId === 'string' ? data.executionId : null;
    const current_index = typeof data.currentIndex === 'number' ? data.currentIndex : null;
    const total_count = typeof data.totalCount === 'number' ? data.totalCount : execution_queue.length;
    const running_count = typeof data.runningCount === 'number' ? data.runningCount : null;
    const completed_count = typeof data.completedCount === 'number' ? data.completedCount : null;
    const failed_count = typeof data.failedCount === 'number' ? data.failedCount : null;
    const progress_count =
      running_count !== null && completed_count !== null && failed_count !== null
        ? completed_count + failed_count + running_count
        : current_index !== null
          ? current_index + 1
          : null;

    if (bridge_is_executing) {
      if (execution_queue.length && completed_count !== null && failed_count !== null) {
        set_execution_queue((prev) => {
          if (!prev.length) return prev;
          const done_count = Math.max(0, Math.min(completed_count + failed_count, prev.length));
          const running_total = Math.max(0, Math.min(running_count ?? 0, prev.length - done_count));
          return prev.map((item, index) => {
            if (index < done_count) {
              return item.status === 'completed' || item.status === 'failed'
                ? item
                : { ...item, status: 'completed', completedAt: item.completedAt ?? new Date().toISOString() };
            }
            if (index < done_count + running_total) {
              return item.status === 'running'
                ? item
                : { ...item, status: 'running', startedAt: item.startedAt ?? new Date().toISOString() };
            }
            return item.status === 'queued' ? item : { ...item, status: 'queued' };
          });
        });
      }
      if (execution_id) {
        set_active_execution_id((prev) => prev ?? execution_id);
      }
      const message =
        progress_count !== null && total_count > 0
          ? `Extension bridge connected · running ${Math.min(progress_count, total_count)}/${total_count}${(running_count ?? 0) > 0 ? ` (${running_count} active)` : ''}`
          : current_index !== null && total_count > 0
            ? `Extension bridge connected · running prompt ${Math.min(current_index + 1, total_count)}/${total_count}`
            : 'Extension bridge connected · execution in progress';
      set_bridge_status({ connected: true, message });
      return;
    }

    set_bridge_status({ connected: true, message: 'Extension bridge connected' });
    if (is_executing) {
      set_is_executing(false);
      set_execution_finished_at(new Date().toISOString());
      set_active_execution_id(null);
      void load_workflow_state();
    }
  }, [execution_queue.length, is_executing, load_workflow_state]);

  useEffect(() => {
    void refresh_bridge_status();
    const interval = window.setInterval(() => {
      void refresh_bridge_status();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refresh_bridge_status]);

  const handle_bridge_event = useCallback((event_name: string, payload: Record<string, unknown>) => {
    const execution_id = typeof payload.executionId === 'string' ? payload.executionId : null;
    if (active_execution_id && execution_id && execution_id !== active_execution_id) {
      return;
    }

    const prompt_index = typeof payload.promptIndex === 'number' ? payload.promptIndex : null;
    const now_iso = typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString();

    if (event_name === 'executionStarted') {
      set_is_executing(true);
      set_execution_finished_at(null);
      if (execution_id) set_active_execution_id(execution_id);
      set_bridge_status({ connected: true, message: 'Execution started in extension bridge.' });
      return;
    }

    if (event_name === 'promptStarted' && prompt_index !== null) {
      set_execution_queue((prev) =>
        prev.map((item) =>
          item.index === prompt_index
            ? { ...item, status: 'running', startedAt: now_iso, error: undefined }
            : item,
        ),
      );
      set_bridge_status({ connected: true, message: `Running prompt ${prompt_index + 1}${execution_queue.length ? `/${execution_queue.length}` : ''}` });
      return;
    }

    if (event_name === 'promptCompleted' && prompt_index !== null) {
      set_execution_queue((prev) =>
        prev.map((item) =>
          item.index === prompt_index
            ? { ...item, status: 'completed', completedAt: now_iso }
            : item,
        ),
      );
      return;
    }

    if (event_name === 'promptFailed' && prompt_index !== null) {
      const error = typeof payload.error === 'string' ? payload.error : 'Prompt execution failed';
      set_execution_queue((prev) =>
        prev.map((item) =>
          item.index === prompt_index
            ? { ...item, status: 'failed', completedAt: now_iso, error }
            : item,
        ),
      );
      set_bridge_status({ connected: true, message: error });
      return;
    }

    if (event_name === 'executionFinished') {
      set_is_executing(false);
      set_execution_finished_at(now_iso);
      set_active_execution_id(null);
      set_bridge_status({ connected: true, message: 'Execution finished' });
      void load_workflow_state();
    }
  }, [active_execution_id, execution_queue.length, load_workflow_state]);

  useEffect(() => {
    const runtime = get_extension_runtime();
    if (!runtime?.onMessage) return;

    const listener = (message: unknown) => {
      const envelope = message && typeof message === 'object' ? (message as Record<string, unknown>) : null;
      if (!envelope || envelope.type !== 'AI_SEO_BRIDGE_EVENT') return;
      const event_name = typeof envelope.event === 'string' ? envelope.event : '';
      const payload = envelope.payload && typeof envelope.payload === 'object' ? (envelope.payload as Record<string, unknown>) : {};
      handle_bridge_event(event_name, payload);
    };

    runtime.onMessage.addListener(listener);
    return () => {
      runtime.onMessage?.removeListener(listener);
    };
  }, [handle_bridge_event]);

  useEffect(() => {
    const on_window_message = (event: MessageEvent) => {
      if (event.source !== window) return;
      const wrapper = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : null;
      if (!wrapper || wrapper.type !== 'AI_SEO_WEB_BRIDGE_EVENT') return;
      const message = wrapper.message && typeof wrapper.message === 'object' ? (wrapper.message as Record<string, unknown>) : null;
      if (!message || message.type !== 'AI_SEO_BRIDGE_EVENT') return;
      const event_name = typeof message.event === 'string' ? message.event : '';
      const payload = message.payload && typeof message.payload === 'object' ? (message.payload as Record<string, unknown>) : {};
      handle_bridge_event(event_name, payload);
    };

    window.addEventListener('message', on_window_message);
    return () => {
      window.removeEventListener('message', on_window_message);
    };
  }, [handle_bridge_event]);

  useEffect(() => {
    if (!selected_site_query_key) return;
    const current = site_queries_by_host[selected_site_query_key];
    if (current?.loading) return;
    if (current?.rows?.length) return;
    if (current && (current.fetchedAt || current.error || current.cached !== undefined)) return;
    void fetch_site_top_queries(selected_site_query_key);
  }, [selected_site_query_key, site_queries_by_host, fetch_site_top_queries]);

  useEffect(() => {
    if (typeof performance === 'undefined') return;
    performance.mark('campaign_tab_load_start');
  }, [campaign_tab, selected_version_id]);

  useEffect(() => {
    if (typeof performance === 'undefined') return;
    if (workflow_loading || !workflow) return;
    performance.mark('campaign_tab_load_end');
    performance.measure('campaign_tab_load_duration', 'campaign_tab_load_start', 'campaign_tab_load_end');
    const entries = performance.getEntriesByName('campaign_tab_load_duration');
    const latest = entries[entries.length - 1];
    if (!latest || Math.random() >= 0.15) return;
    void analytics_api.track_event({
      event_name: 'web_perf_campaign_tab_data_ready',
      properties: {
        tab: campaign_tab,
        duration_ms: Math.round(latest.duration),
        version_id: selected_version_id ?? 'active',
      },
    });
  }, [campaign_tab, selected_version_id, workflow, workflow_loading]);

  const update_prompt_selection = useCallback(async (prompt_id: string, selected: boolean) => {
    if (!id || !selected_version_id) return;
    const token = auth_storage.get_access_token();
    if (!token) return;

    set_workflow((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        promptCandidates: prev.promptCandidates.map((item) =>
          item.id === prompt_id ? { ...item, selected } : item,
        ),
      };
    });

    try {
      const payload = await select_campaign_prompt_candidates(token, id, selected_version_id, {
        promptIds: [prompt_id],
        selected,
      });
      set_workflow(payload);
    } catch (error) {
      set_error_message(error instanceof Error ? error.message : 'Failed to update prompt selection');
      void load_workflow_state();
    }
  }, [id, selected_version_id, load_workflow_state]);

  const set_all_prompt_selection = useCallback(async (selected: boolean) => {
    if (!id || !selected_version_id) return;
    const token = auth_storage.get_access_token();
    if (!token) return;

    const next_selected_ids = selected ? prompt_candidate_ids : [];
    set_workflow((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        promptCandidates: prev.promptCandidates.map((item) => ({ ...item, selected })),
      };
    });

    try {
      const payload = await replace_campaign_prompt_selection(token, id, selected_version_id, {
        selectedPromptIds: next_selected_ids,
      });
      set_workflow(payload);
    } catch (error) {
      set_error_message(error instanceof Error ? error.message : 'Failed to update prompt selections');
      void load_workflow_state();
    }
  }, [id, selected_version_id, prompt_candidate_ids, load_workflow_state]);

  const focus_prompt_candidate = useCallback((prompt_id: string) => {
    const linked_executed = executed_prompt_by_source_id.get(prompt_id);
    set_selected_candidate_prompt_id(prompt_id);
    set_pipeline_details_open(true);
    set_pipeline_queries_open(false);

    if (linked_executed) {
      set_selected_executed_prompt_id(linked_executed.id);
      set_selected_website_url(linked_executed.crawledWebsites[0]?.url ?? null);
      return;
    }

    set_selected_executed_prompt_id(null);
    set_selected_website_url((workflow?.crawledWebsites ?? [])[0]?.url ?? null);
  }, [executed_prompt_by_source_id, workflow]);

  const regenerate_suggestions = useCallback(async (append: boolean) => {
    if (!id || !selected_version_id) return;
    const token = auth_storage.get_access_token();
    if (!token) return;

    set_error_message('');
    set_suggestion_mode(append ? 'append' : 'regenerate');
    try {
      await generate_campaign_suggestions(
        token,
        id,
        { version_id: selected_version_id },
        { max_suggestions: 5, append },
      );
      await load_workflow_state();
    } catch (error) {
      set_error_message(error instanceof Error ? error.message : 'Failed to generate suggestions');
    } finally {
      set_suggestion_mode(null);
    }
  }, [id, selected_version_id, load_workflow_state]);

  const handle_add_manual_prompt = useCallback(async () => {
    if (!id || !selected_version_id) return;
    const token = auth_storage.get_access_token();
    if (!token) return;
    const text = manual_prompt_text.trim();
    if (!text) return;

    try {
      set_manual_saving(true);
      const payload = await add_campaign_manual_prompt(token, id, selected_version_id, { text });
      set_workflow(payload);
      set_manual_prompt_text('');
      set_suggested_visible_count((count) => Math.max(count, payload.promptCandidates.length));
    } catch (error) {
      set_error_message(error instanceof Error ? error.message : 'Failed to add manual prompt');
    } finally {
      set_manual_saving(false);
    }
  }, [id, manual_prompt_text, selected_version_id]);

  const queue_execution = useCallback(async (
    mode: 'fire' | 'refire',
    prompt_ids: string[],
    providers: FireProvider[],
  ) => {
    if (!id || !selected_version_id) return false;
    const token = auth_storage.get_access_token();
    if (!token) return false;
    if (!bridge_status.connected) {
      set_error_message('Extension bridge is disconnected. Reconnect the extension before running prompts.');
      return false;
    }
    if (!prompt_ids.length) {
      set_error_message('Select at least one prompt before execution.');
      return false;
    }
    if (!providers.length) {
      set_error_message('Select at least one LLM before execution.');
      return false;
    }

    set_is_executing(true);
    set_error_message('');
    try {
      const execution = await execute_campaign_prompts(token, id, selected_version_id, {
        mode,
        promptIds: prompt_ids,
        provider: providers[0],
      });

      const expanded_queue = execution.orderedQueue.flatMap((entry) =>
        providers.map((provider) => ({
          promptId: entry.promptId,
          text: entry.text,
          provider,
        })),
      );

      set_execution_queue(
        expanded_queue.map((entry, index) => ({
          promptId: entry.promptId,
          text: entry.text,
          provider: entry.provider,
          index,
          status: 'queued',
        })),
      );
      set_execution_finished_at(null);
      set_active_execution_id(execution.executionId);

      const bridge_message =
        mode === 'refire'
          ? {
            type: 'AI_SEO_BRIDGE_REFIRE_PROMPTS',
            executionId: execution.executionId,
            campaignId: id,
            versionId: selected_version_id,
            provider: providers[0],
            prompts: expanded_queue.map((entry, index) => ({
              promptId: entry.promptId,
              text: entry.text,
              provider: entry.provider,
              index,
            })),
            accessToken: token,
            apiBaseUrl: WEB_API_BASE_URL,
            ingestInBackground: true,
          }
          : {
            type: 'AI_SEO_BRIDGE_EXECUTE_PROMPTS',
            executionId: execution.executionId,
            campaignId: id,
            versionId: selected_version_id,
            provider: providers[0],
            prompts: expanded_queue.map((entry, index) => ({
              promptId: entry.promptId,
              text: entry.text,
              provider: entry.provider,
              index,
            })),
            accessToken: token,
            apiBaseUrl: WEB_API_BASE_URL,
            ingestInBackground: true,
          };
      const bridge_result = await try_extension_bridge(bridge_message);
      if (!bridge_result.ok) {
        set_bridge_status({ connected: false, message: bridge_result.error ?? 'Extension execution bridge unavailable.' });
        set_is_executing(false);
        set_active_execution_id(null);
        set_error_message(bridge_result.error ?? 'Failed to send execution to extension bridge.');
        return;
      }
      const bridge_data =
        bridge_result.data && typeof bridge_result.data === 'object' ? (bridge_result.data as Record<string, unknown>) : null;
      if (bridge_data?.ok === false) {
        const error = typeof bridge_data.error === 'string' ? bridge_data.error : 'Extension bridge rejected execution.';
        set_bridge_status({ connected: false, message: error });
        set_is_executing(false);
        set_active_execution_id(null);
        set_error_message(error);
        return;
      }
      set_bridge_status({ connected: true, message: 'Execution queued in extension bridge.' });

      await load_workflow_state();
      return true;
    } catch (error) {
      set_active_execution_id(null);
      set_execution_queue([]);
      set_execution_finished_at(null);
      set_error_message(error instanceof Error ? error.message : 'Failed to queue prompt execution');
      set_is_executing(false);
      return false;
    }
  }, [bridge_status.connected, id, load_workflow_state, selected_version_id]);

  const handle_confirm_execute = useCallback(async () => {
    const prompt_ids = selected_prompt_ids.length ? selected_prompt_ids : prompt_candidate_ids;
    if (!prompt_ids.length) {
      set_error_message('No prompt candidates available to execute.');
      return;
    }
    if (!selected_fire_provider_list.length) {
      set_error_message('Choose at least one LLM before execution.');
      return;
    }

    set_error_message('');
    set_fire_dialog_open(false);
    await queue_execution(pending_execution_mode, prompt_ids, selected_fire_provider_list);
  }, [pending_execution_mode, prompt_candidate_ids, queue_execution, selected_fire_provider_list, selected_prompt_ids]);

  const toggle_executed_row_selection = useCallback((executed_id: string, selected: boolean) => {
    set_selected_executed_row_ids((prev) => {
      if (selected) return prev.includes(executed_id) ? prev : [...prev, executed_id];
      return prev.filter((item) => item !== executed_id);
    });
  }, []);

  const refire_selected_executed_rows = useCallback(async () => {
    if (!selected_executed_row_ids.length) return;
    const selected_rows = analytics_filtered_executed_prompts.filter((item) => selected_executed_row_ids.includes(item.id));
    const source_ids = Array.from(new Set(selected_rows.map((item) => item.sourcePromptId).filter((item): item is string => Boolean(item))));
    if (!source_ids.length) {
      set_error_message('Selected executed prompts are missing source prompt links for refire.');
      return;
    }

    const rows_by_provider = selected_rows.reduce<Record<string, string[]>>((acc, row) => {
      const provider_key = row.provider;
      if (!acc[provider_key]) acc[provider_key] = [];
      if (row.sourcePromptId) acc[provider_key].push(row.sourcePromptId);
      return acc;
    }, {});

    const providers = Object.keys(rows_by_provider).filter(
      (provider): provider is Extract<ai_chat_provider, 'chatgpt' | 'claude' | 'perplexity' | 'grok'> =>
        provider === 'chatgpt' || provider === 'claude' || provider === 'perplexity' || provider === 'grok',
    );
    if (!providers.length) {
      set_error_message('Selected prompts have unsupported provider for refire.');
      return;
    }

    for (const provider of providers) {
      const prompt_ids = Array.from(new Set(rows_by_provider[provider] ?? []));
      if (!prompt_ids.length) continue;
      const ok = await queue_execution('refire', prompt_ids, [provider]);
      if (!ok) break;
    }
  }, [analytics_filtered_executed_prompts, queue_execution, selected_executed_row_ids]);

  const toggle_website_row_selection = useCallback((row_id: string, selected: boolean) => {
    set_selected_website_row_ids((prev) => {
      if (selected) return prev.includes(row_id) ? prev : [...prev, row_id];
      return prev.filter((item) => item !== row_id);
    });
  }, []);

  const fetch_selected_websites = useCallback(async () => {
    const targets = filtered_website_table_rows
      .filter((item) => selected_website_row_ids.includes(item.id))
      .map((item) => item.website_url);
    const unique_targets = Array.from(new Set(targets));
    if (!unique_targets.length) return;
    await Promise.all(unique_targets.map((target) => fetch_site_top_queries(target, true)));
  }, [fetch_site_top_queries, filtered_website_table_rows, selected_website_row_ids]);

  const handle_refresh = useCallback(async () => {
    set_refreshing(true);
    try {
      await load_workflow_state();
    } finally {
      set_refreshing(false);
    }
  }, [load_workflow_state]);

  if (!campaign) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Campaign not available in this workspace.</p>
      </div>
    );
  }

  return (
    <section className="dashboard-surface flex h-full w-full flex-col overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 via-white to-sky-50 dark:from-primary/5 dark:via-background dark:to-info/10">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200/80 px-3 py-2 dark:border-border/70">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{campaign.project.name}</h1>
          <p className="text-[11px] text-muted-foreground">Extension-style prompt workflow</p>
        </div>
        {versions_loading && !versions.length ? (
          <span className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-muted-foreground dark:border-border/80 dark:bg-background">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading versions
          </span>
        ) : null}
        {versions.length ? (
          <label className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 dark:border-border/80 dark:bg-background">
            <Layers3 className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              className="h-7 bg-transparent text-[11px] outline-none"
              value={selected_version_id ?? ''}
              onChange={(event) => set_selected_version_id(event.target.value || undefined)}
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {`v${version.version_number}${version.is_active ? ' (active)' : ''}${version.label ? ` - ${version.label}` : ''}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {versions_loading && versions.length ? (
          <span className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-muted-foreground dark:border-border/80 dark:bg-background">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        ) : null}
        <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1 dark:border-border/80 dark:bg-background">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">View</span>
          <button
            type="button"
            className={`inline-flex h-6 w-6 items-center justify-center rounded ${executed_provider_filter === 'all' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'}`}
            onClick={() => apply_provider_filter('all')}
            title="Show all providers"
          >
            <Filter className="h-3.5 w-3.5" />
          </button>
          {EXECUTED_FILTER_PROVIDERS.map((provider) => (
            <button
              key={provider}
              type="button"
              className={`inline-flex h-6 w-6 items-center justify-center rounded ${executed_provider_filter === provider ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'}`}
              onClick={() => apply_provider_filter(provider)}
              title={`Filter executed prompts: ${provider_label(provider)}`}
            >
              <img src={PROVIDER_LOGO_MAP[provider]} alt={provider_label(provider)} className="h-3.5 w-3.5 object-contain" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200/80 px-3 py-1.5 dark:border-border/60">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${bridge_status.connected ? 'bg-emerald-100 text-emerald-700 dark:bg-success/15 dark:text-success' : 'bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground'}`}>
          <Activity className="h-3 w-3" />
          {bridge_status.message}
        </span>
        <Badge variant="outline" className="text-[10px]">{selected_prompt_ids.length} selected</Badge>
        <Badge variant="outline" className="text-[10px]">
          {filtered_executed_prompts.length}/{executed_prompts.length} executed
        </Badge>
        <Button
          size="sm"
          variant="default"
          className={`h-6 px-2 text-[10px] shadow-sm ${
            execution_queue.length
              ? 'bg-sky-600 text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400'
              : 'bg-slate-600 text-white hover:bg-slate-500 dark:bg-slate-500 dark:hover:bg-slate-400'
          }`}
          onClick={() => set_queue_dialog_open(true)}
        >
          <ListOrdered className="h-3 w-3" />
          {execution_queue.length
            ? `Queue: done ${queue_done_count} · left ${queue_left_count}`
            : 'Queue: idle'}
        </Button>
        {executed_provider_filter !== 'all' ? (
          <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px]">
            <img
              src={provider_logo(executed_provider_filter) ?? undefined}
              alt={provider_label(executed_provider_filter)}
              className="h-3 w-3 object-contain"
            />
            {provider_label(executed_provider_filter)}
          </Badge>
        ) : null}
        {chart_status_filter ? <Badge variant="outline" className="text-[10px]">status {chart_status_filter}</Badge> : null}
        {chart_host_filter ? <Badge variant="outline" className="text-[10px]">host {chart_host_filter}</Badge> : null}
        {chart_prompt_filter ? <Badge variant="outline" className="text-[10px]">prompt filter</Badge> : null}
        {chart_date_bucket_filter ? <Badge variant="outline" className="text-[10px]">day {chart_date_bucket_filter}</Badge> : null}
        {error_message ? <p className="text-[11px] text-destructive">{error_message}</p> : null}
      </div>

      <Tabs value={campaign_tab} className="flex min-h-0 flex-1 flex-col">
        <TabsContent value="pipeline" className="mt-0 min-h-0 flex-1">
          <div className="flex h-full min-h-0 flex-col gap-2 p-2 md:flex-row">
        <div className={`min-h-0 w-full transition-all duration-200 ease-out ${pipeline_details_open ? (pipeline_queries_open ? 'md:w-4/12' : 'md:w-6/12') : 'md:w-full'}`}>
          <div className="flex h-full min-h-0 flex-col rounded-lg border border-slate-200/90 bg-white/90 p-2.5 shadow-sm dark:border-border/70 dark:bg-background/85">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Prompt Control
              </p>
              <div className="flex items-center gap-1">
                {workflow_loading ? (
                    <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px]">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading
                    </Badge>
                ) : null}
                <Badge variant="secondary" className="bg-primary/10 text-[10px] text-primary">{workflow?.promptCandidates.length ?? 0}</Badge>
              </div>
            </div>

            <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50/90 p-2 text-[10px] dark:border-border/70 dark:bg-muted/40">
              <p>Version date: {format_date(workflow?.versionMeta.versionDate ?? workflow?.version?.created_at)}</p>
              <p>Last execution: {format_date(workflow?.versionMeta.lastExecutionDate)}</p>
            </div>

            <div className="mb-2 flex gap-1.5">
              <Input
                placeholder="Add manual prompt"
                value={manual_prompt_text}
                onChange={(event) => set_manual_prompt_text(event.target.value)}
                className="h-7 text-[11px]"
              />
              <Button className="h-7 px-2 text-[11px]" onClick={() => void handle_add_manual_prompt()} disabled={manual_saving || !manual_prompt_text.trim()}>
                {manual_saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {manual_saving ? 'Adding...' : 'Add'}
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              <details open className="group rounded-lg border border-border/70 bg-background/80 p-1.5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 rounded-md bg-emerald-500/10 px-2 py-1">
                    <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" />
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Executed prompts</p>
                    <Badge variant="outline" className="text-[10px]">{analytics_filtered_executed_prompts.length}</Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handle_refresh();
                    }}
                    disabled={workflow_loading || refreshing}
                  >
                    {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Refresh
                  </Button>
                </summary>
                <div className="mt-1.5 space-y-2">
                  {initial_workflow_loading ? (
                    <>
                      <div className="h-12 animate-pulse rounded-lg border border-slate-200 bg-slate-100/80 dark:border-border/70 dark:bg-muted/50" />
                      <div className="h-12 animate-pulse rounded-lg border border-slate-200 bg-slate-100/80 dark:border-border/70 dark:bg-muted/50" />
                    </>
                  ) : null}
                  {analytics_filtered_executed_prompts.length === 0 && !initial_workflow_loading ? <p className="text-[11px] text-muted-foreground">No executed prompts for active filters.</p> : null}
                  {visible_executed_prompts.map((item) => (
                    <ExecutedPromptRow
                      key={item.id}
                      item={item}
                      selected={selected_executed_prompt_id === item.id}
                      onSelect={() => {
                        set_selected_candidate_prompt_id(item.sourcePromptId ?? null);
                        set_selected_executed_prompt_id(item.id);
                        set_selected_website_url(item.crawledWebsites[0]?.url ?? null);
                        set_pipeline_details_open(true);
                        set_pipeline_queries_open(false);
                      }}
                    />
                  ))}
                  {analytics_filtered_executed_prompts.length > executed_visible_count ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 w-full text-[10px]"
                      onClick={() => set_executed_visible_count((count) => count + 10)}
                    >
                      <ArrowDownToLine className="h-3 w-3" />
                      Load more executed prompts
                    </Button>
                  ) : null}
                </div>
              </details>

              <details open className="group rounded-lg border border-border/70 bg-background/80 p-1.5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 rounded-md bg-sky-500/10 px-2 py-1">
                    <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" />
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Suggested prompts</p>
                    <Badge variant="outline" className="text-[10px]">{suggested_prompts.length}</Badge>
                  </div>
                </summary>
                <div className="mt-1.5 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void set_all_prompt_selection(true)}
                      disabled={!prompt_candidate_ids.length || suggestions_loading || is_executing}
                    >
                      <CheckSquare className="h-3 w-3" />
                      Select all
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void set_all_prompt_selection(false)}
                      disabled={!prompt_candidate_ids.length || suggestions_loading || is_executing}
                    >
                      <Square className="h-3 w-3" />
                      Deselect all
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => open_execute_dialog('fire')}
                      disabled={!bridge_status.connected || is_executing || !prompt_candidate_ids.length || suggestions_loading}
                    >
                      {is_executing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      Fire
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => open_execute_dialog('refire')}
                      disabled={!bridge_status.connected || is_executing || !prompt_candidate_ids.length || suggestions_loading}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Refire
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void regenerate_suggestions(false)}
                      disabled={suggestions_loading || is_executing || !can_generate_suggestions}
                    >
                      {suggestion_mode === 'regenerate' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                      Regenerate
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void regenerate_suggestions(true)}
                      disabled={suggestions_loading || is_executing || !can_generate_suggestions}
                    >
                      {suggestion_mode === 'append' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" />}
                      Load more
                    </Button>
                  </div>

                  {initial_workflow_loading ? (
                    <>
                      <div className="h-12 animate-pulse rounded-lg border border-slate-200 bg-slate-100/80 dark:border-border/70 dark:bg-muted/50" />
                      <div className="h-12 animate-pulse rounded-lg border border-slate-200 bg-slate-100/80 dark:border-border/70 dark:bg-muted/50" />
                      <div className="h-12 animate-pulse rounded-lg border border-slate-200 bg-slate-100/80 dark:border-border/70 dark:bg-muted/50" />
                    </>
                  ) : null}
                  {suggested_prompts.length === 0 && !initial_workflow_loading ? (
                    <p className="text-[11px] text-muted-foreground">No suggested prompts yet. Click Regenerate.</p>
                  ) : null}

                  {suggestion_mode === 'regenerate' ? (
                    <>
                      <div className="h-12 animate-pulse rounded-lg border border-slate-200 bg-slate-100/80 dark:border-border/70 dark:bg-muted/50" />
                      <div className="h-12 animate-pulse rounded-lg border border-slate-200 bg-slate-100/80 dark:border-border/70 dark:bg-muted/50" />
                    </>
                  ) : null}

                  {visible_suggested_prompts.map((prompt) => (
                    <PromptCandidateRow
                      key={prompt.id}
                      prompt={prompt}
                      selected={selected_candidate_prompt_id === prompt.id || selected_executed_prompt?.sourcePromptId === prompt.id}
                      linkedExecution={Boolean(executed_prompt_by_source_id.get(prompt.id))}
                      disabled={is_executing}
                      onOpen={() => focus_prompt_candidate(prompt.id)}
                      onToggle={(selected) => void update_prompt_selection(prompt.id, selected)}
                    />
                  ))}

                  {suggested_prompts.length > suggested_visible_count ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 w-full text-[10px]"
                      onClick={() => set_suggested_visible_count((count) => count + 10)}
                    >
                      <ArrowDownToLine className="h-3 w-3" />
                      Show more from current list
                    </Button>
                  ) : null}
                </div>
              </details>
            </div>
          </div>
        </div>

        {pipeline_details_open ? (
        <div className={`min-h-0 w-full transition-all duration-200 ease-out ${pipeline_queries_open ? 'md:w-4/12' : 'md:w-6/12'}`}>
          <div className="flex h-full min-h-0 flex-col rounded-lg border border-slate-200/90 bg-white/90 p-2.5 shadow-sm dark:border-border/70 dark:bg-background/85">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                <Search className="h-3.5 w-3.5 text-info" />
                Keywords + Websites
              </p>
              <div className="flex items-center gap-1">
                <Badge variant="secondary" className="bg-info/15 text-[10px] text-info">{discovery_websites.length} sites</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 w-6 p-0 text-[10px]"
                  onClick={() => set_pipeline_queries_open(true)}
                  title="Open top queries panel"
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 w-6 p-0 text-[10px]"
                  onClick={() => {
                    set_pipeline_details_open(false);
                    set_pipeline_queries_open(false);
                  }}
                  title="Close panel"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50/90 p-2 dark:border-border/70 dark:bg-muted/40">
              <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Selected prompt</p>
              <p className="line-clamp-2 text-[11px] font-medium">{selected_prompt_heading}</p>
            </div>

            <div className="mb-2">
              <p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                <Search className="h-3 w-3" />
                Keywords
              </p>
              <div className="flex flex-wrap gap-1.5">
                {initial_workflow_loading ? <p className="text-[11px] text-muted-foreground">Loading keywords...</p> : null}
                {discovery_keywords.length === 0 && !initial_workflow_loading ? <p className="text-[11px] text-muted-foreground">No keywords captured.</p> : null}
                {discovery_keywords.map((item) => (
                  <Badge key={item.query} variant="outline" className="bg-background/80">{item.query}</Badge>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-border/70 dark:bg-background/60">
              <p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                <Globe2 className="h-3.5 w-3.5" />
                Websites
              </p>
              {initial_workflow_loading ? <p className="text-[11px] text-muted-foreground">Loading websites...</p> : null}
              {discovery_websites.length === 0 && !initial_workflow_loading ? <p className="text-[11px] text-muted-foreground">No websites captured yet.</p> : null}
              <div className="space-y-1.5">
                {discovery_websites.map((site) => (
                  <button
                    key={site.url}
                    type="button"
                    onClick={() => {
                      set_selected_website_url(site.url);
                      set_pipeline_queries_open(true);
                    }}
                    className={`w-full rounded-lg border px-2 py-1.5 text-left transition ${
                      selected_website?.url === site.url
                        ? 'border-primary/40 bg-primary/10 dark:border-primary/40 dark:bg-primary/10'
                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-border/70 dark:bg-background/80 dark:hover:bg-accent/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <WebsiteFavicon url={site.url} host={site.host} />
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium">{site.host}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{site.url}</p>
                          <p className="pt-1 text-[10px] text-muted-foreground">Source: {site.source}</p>
                        </div>
                      </div>
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        ) : null}

        {pipeline_queries_open ? (
        <div className="min-h-0 w-full transition-all duration-200 ease-out md:w-4/12">
          <div className="flex h-full min-h-0 flex-col rounded-lg border border-slate-200/90 bg-white/90 p-2.5 shadow-sm dark:border-border/70 dark:bg-background/85">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                <ListOrdered className="h-3.5 w-3.5 text-success" />
                Top Queries
              </p>
              <div className="flex items-center gap-1">
                {selected_website?.host ? <Badge variant="secondary" className="bg-success/15 text-[10px] text-success">{selected_website.host}</Badge> : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 w-6 p-0 text-[10px]"
                  onClick={() => set_pipeline_queries_open(false)}
                  title="Close panel"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {!selected_website ? (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-slate-300 text-[11px] text-muted-foreground dark:border-border/80">
                {initial_workflow_loading ? 'Loading website data...' : 'Select a website to view top queries.'}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-border/70 dark:bg-background/60">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium" title={selected_website.url}>
                      <span className="inline-flex items-center gap-1.5">
                        <WebsiteFavicon url={selected_website.url} host={selected_website.host} />
                        {selected_website.url}
                      </span>
                    </p>
                    {selected_site_query_state?.provider ? (
                      <p className="text-[10px] text-muted-foreground">
                        provider: {selected_site_query_state.provider} {selected_site_query_state.cached ? '(cached)' : ''} · fetched {format_date(selected_site_query_state.fetchedAt)}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => selected_site_query_key && void fetch_site_top_queries(selected_site_query_key, true)}
                    disabled={!selected_site_query_key || selected_site_query_state?.loading}
                  >
                    {selected_site_query_state?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Refresh
                  </Button>
                </div>

                {selected_site_query_state?.error ? <p className="mb-2 text-[11px] text-destructive">{selected_site_query_state.error}</p> : null}

                <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 bg-white p-2 dark:border-border/60 dark:bg-background/80">
                  {selected_site_query_state?.loading ? (
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Fetching top queries...
                    </p>
                  ) : (
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="pb-1.5">Query</th>
                          <th className="pb-1.5">Volume</th>
                          <th className="pb-1.5">Traffic</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selected_site_query_state?.rows ?? []).length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-1.5 text-muted-foreground">No top queries available.</td>
                          </tr>
                        ) : (
                          (selected_site_query_state?.rows ?? []).map((row, index) => (
                            <tr key={`${row.query}-${index}`} className="border-t border-slate-200 transition-colors hover:bg-sky-50 dark:border-border/50 dark:hover:bg-info/5">
                              <td className="py-1.5 align-top">
                                <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 font-medium text-primary dark:bg-primary/10">
                                  <Search className="h-3 w-3" />
                                  {row.query}
                                </span>
                              </td>
                              <td className="py-1.5 align-top">
                                <span className="inline-flex rounded-md bg-sky-100 px-1.5 py-0.5 font-medium text-sky-700 dark:bg-info/12 dark:text-info">
                                  {row.volume ?? '-'}
                                </span>
                              </td>
                              <td className="py-1.5 align-top">
                                <span className="inline-flex rounded-md bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-success/12 dark:text-success">
                                  {row.traffic ?? '-'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        ) : null}
          </div>
        </TabsContent>

        <TabsContent value="prompts" className="mt-0 min-h-0 flex-1 p-2">
          <div className="mb-2 grid grid-cols-1 gap-2 xl:grid-cols-3">
            <D3CardFrame
              title="Prompt Performance Distribution"
              subtitle="x: keywords • y: websites"
              heightClassName="h-[160px]"
              rightSlot={prompt_analytics_loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            >
              <ScatterOpportunityChart
                points={(prompt_analytics?.points ?? []).map((item) => ({
                  id: item.prompt_id,
                  label: item.prompt,
                  x: item.keyword_count,
                  y: item.website_count,
                  size: Math.max(item.website_count, 1),
                  color: item.status === 'failed' ? '#f43f5e' : '#3b82f6',
                }))}
                activeId={chart_prompt_filter}
                onSelect={(prompt_id) => set_chart_filter('prompt_id', chart_prompt_filter === prompt_id ? null : prompt_id)}
              />
            </D3CardFrame>
            <D3CardFrame title="Prompt Outcome By Provider" subtitle="completed vs failed + avg websites" heightClassName="h-[160px]">
              <StackedBarChart
                rows={(prompt_analytics?.provider_outcomes ?? []).map((item) => ({
                  id: item.provider,
                  label: provider_label(item.provider),
                  segments: [
                    { key: 'completed', label: 'Completed', value: item.completed, color: '#10b981' },
                    { key: 'failed', label: 'Failed', value: item.failed, color: '#f43f5e' },
                  ],
                }))}
                normalized
                activeKey={chart_status_filter}
                onSelectSegment={(status) => set_chart_filter('status', chart_status_filter === status ? null : status)}
              />
            </D3CardFrame>
            <D3CardFrame title="Execution Timeline" subtitle="latest execution events" heightClassName="h-[160px]">
              <TimelineStripChart
                events={(prompt_analytics?.timeline ?? []).map((item) => ({
                  id: item.prompt_id,
                  timestamp: item.timestamp,
                  status: item.status,
                  provider: item.provider,
                  label: item.prompt,
                }))}
                activeId={chart_prompt_filter}
                onSelect={(id) => set_chart_filter('prompt_id', chart_prompt_filter === id ? null : id)}
              />
            </D3CardFrame>
          </div>
          <div className="flex h-full min-h-0 flex-col rounded-lg border border-slate-200/90 bg-white/90 p-2.5 shadow-sm dark:border-border/70 dark:bg-background/85">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">{analytics_filtered_executed_prompts.length} executed prompts</Badge>
              <Badge variant="outline" className="text-[10px]">{selected_executed_row_ids.length} selected</Badge>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                onClick={() => set_selected_executed_row_ids(analytics_filtered_executed_prompts.map((item) => item.id))}
                disabled={!analytics_filtered_executed_prompts.length || prompts_table_loading}
              >
                <CheckSquare className="h-3 w-3" />
                Select all
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                onClick={() => set_selected_executed_row_ids([])}
                disabled={!selected_executed_row_ids.length || prompts_table_loading}
              >
                <Square className="h-3 w-3" />
                Deselect all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-6 px-2 text-[10px]"
                onClick={() => void refire_selected_executed_rows()}
                disabled={!selected_executed_row_ids.length || is_executing || prompts_table_loading}
              >
                {is_executing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Refire selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                onClick={() => void handle_refresh()}
                disabled={workflow_loading || refreshing}
              >
                {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Refresh executed
              </Button>
            </div>

            <div
              ref={prompt_virtual_rows.container_ref}
              onScroll={prompt_virtual_rows.on_scroll}
              className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white dark:border-border/70 dark:bg-background/80"
            >
              <Table className="table-fixed text-[11px]">
                <TableHeader>
                  <TableRow className="border-b border-slate-200/80 bg-transparent hover:bg-transparent dark:border-border/60">
                    <TableHead className="w-[40px]">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-400 accent-primary [color-scheme:light] dark:border-slate-500 dark:accent-primary dark:[color-scheme:dark]"
                        checked={analytics_filtered_executed_prompts.length > 0 && selected_executed_row_ids.length === analytics_filtered_executed_prompts.length}
                        disabled={prompts_table_loading}
                        onChange={(event) => {
                          if (event.target.checked) set_selected_executed_row_ids(analytics_filtered_executed_prompts.map((item) => item.id));
                          else set_selected_executed_row_ids([]);
                        }}
                      />
                    </TableHead>
                    <TableHead>Prompt</TableHead>
                    <TableHead>LLM</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Keywords</TableHead>
                    <TableHead>Websites</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prompts_table_loading ? (
                    <>
                      <TableRow>
                        <TableCell colSpan={6} className="py-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading executed prompts...
                          </span>
                        </TableCell>
                      </TableRow>
                      {Array.from({ length: 5 }).map((_, index) => (
                        <TableRow key={`prompt-loading-${index}`}>
                          <TableCell><div className="h-3.5 w-3.5 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /></TableCell>
                          <TableCell><div className="h-3.5 w-full max-w-[360px] animate-pulse rounded bg-slate-200 dark:bg-slate-700" /></TableCell>
                          <TableCell><div className="h-5 w-20 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" /></TableCell>
                          <TableCell><div className="h-3.5 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /></TableCell>
                          <TableCell><div className="h-5 w-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" /></TableCell>
                          <TableCell><div className="h-5 w-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" /></TableCell>
                        </TableRow>
                      ))}
                    </>
                  ) : analytics_filtered_executed_prompts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No executed prompts available.</TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {prompt_virtual_rows.top_spacer > 0 ? (
                        <TableRow aria-hidden="true" className="border-0 hover:bg-transparent">
                          <TableCell colSpan={6} className="p-0" style={{ height: `${prompt_virtual_rows.top_spacer}px` }} />
                        </TableRow>
                      ) : null}
                      {visible_prompt_rows.map((item) => {
                      const checked = selected_executed_row_ids.includes(item.id);
                      return (
                        <TableRow
                          key={item.id}
                          className="cursor-pointer hover:bg-sky-50/60 dark:hover:bg-accent/40"
                          onClick={() => {
                            set_selected_executed_prompt_id(item.id);
                            set_selected_candidate_prompt_id(item.sourcePromptId ?? null);
                            set_selected_website_url(item.crawledWebsites[0]?.url ?? null);
                            set_prompts_drawer_open(true);
                          }}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded border-slate-400 accent-primary [color-scheme:light] dark:border-slate-500 dark:accent-primary dark:[color-scheme:dark]"
                              checked={checked}
                              disabled={prompts_table_loading}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => toggle_executed_row_selection(item.id, event.target.checked)}
                            />
                          </TableCell>
                          <TableCell className="max-w-[520px]">
                            <p className="line-clamp-2 font-medium">{item.text}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="inline-flex items-center gap-1 bg-primary/10 text-[10px] text-primary dark:bg-primary/15 dark:text-primary">
                              {provider_logo(item.provider) ? <img src={provider_logo(item.provider) ?? ''} alt={provider_label(item.provider)} className="h-3 w-3 object-contain" /> : null}
                              {provider_label(item.provider)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{format_date(item.lastExecutionAt)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-sky-100 text-[10px] text-sky-700 dark:bg-info/15 dark:text-info">{item.searchedKeywords.length}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-emerald-100 text-[10px] text-emerald-700 dark:bg-success/15 dark:text-success">{item.crawledWebsites.length}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                      {prompt_virtual_rows.bottom_spacer > 0 ? (
                        <TableRow aria-hidden="true" className="border-0 hover:bg-transparent">
                          <TableCell colSpan={6} className="p-0" style={{ height: `${prompt_virtual_rows.bottom_spacer}px` }} />
                        </TableRow>
                      ) : null}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="websites" className="mt-0 min-h-0 flex-1 p-2">
          <div className="mb-2 grid grid-cols-1 gap-2 xl:grid-cols-3">
            <D3CardFrame
              title="Website Opportunity Quadrant"
              subtitle="x: volume • y: traffic • bubble: linked prompts"
              heightClassName="h-[160px]"
              rightSlot={website_analytics_loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            >
              <ScatterOpportunityChart
                points={(website_analytics?.points ?? []).map((item) => ({
                  id: item.host,
                  label: item.host,
                  x: item.aggregated_volume,
                  y: item.aggregated_traffic,
                  size: item.prompt_count,
                  color: '#f59e0b',
                }))}
                activeId={chart_host_filter}
                onSelect={(host) => set_chart_filter('host', chart_host_filter === host ? null : host)}
              />
            </D3CardFrame>
            <D3CardFrame title="Fetch Freshness Buckets" subtitle="pending and fetched recency" heightClassName="h-[160px]">
              <RankBarChart
                color="#eab308"
                rows={(website_analytics?.freshness_buckets ?? []).map((item) => ({
                  id: item.bucket,
                  label: item.bucket,
                  value: item.count,
                }))}
              />
            </D3CardFrame>
            <D3CardFrame title="Top Host Coverage" subtitle="distinct prompts per host" heightClassName="h-[160px]">
              <RankBarChart
                color="#10b981"
                rows={(website_analytics?.host_coverage ?? []).map((item) => ({
                  id: item.host,
                  label: item.host,
                  value: item.prompt_count,
                  secondaryValue: item.website_count,
                }))}
                activeId={chart_host_filter}
                onSelect={(host) => set_chart_filter('host', chart_host_filter === host ? null : host)}
              />
            </D3CardFrame>
          </div>
          <div className="flex h-full min-h-0 flex-col rounded-lg border border-slate-200/90 bg-white/90 p-2.5 shadow-sm dark:border-border/70 dark:bg-background/85">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">{filtered_website_table_rows.length} websites</Badge>
              <Badge variant="outline" className="text-[10px]">{selected_website_row_ids.length} selected</Badge>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                onClick={() => set_selected_website_row_ids(filtered_website_table_rows.map((item) => item.id))}
                disabled={!filtered_website_table_rows.length || websites_table_loading}
              >
                <CheckSquare className="h-3 w-3" />
                Select all
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                onClick={() => set_selected_website_row_ids([])}
                disabled={!selected_website_row_ids.length || websites_table_loading}
              >
                <Square className="h-3 w-3" />
                Deselect all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-6 px-2 text-[10px]"
                onClick={() => void fetch_selected_websites()}
                disabled={!selected_website_row_ids.length || websites_table_loading}
              >
                {websites_table_loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Fetch selected
              </Button>
            </div>

            <div
              ref={website_virtual_rows.container_ref}
              onScroll={website_virtual_rows.on_scroll}
              className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white dark:border-border/70 dark:bg-background/80"
            >
              <Table className="text-[11px]">
                <TableHeader>
                  <TableRow className="border-b border-slate-200/80 bg-transparent hover:bg-transparent dark:border-border/60">
                    <TableHead className="w-[42px]">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-400 accent-primary [color-scheme:light] dark:border-slate-500 dark:accent-primary dark:[color-scheme:dark]"
                        checked={filtered_website_table_rows.length > 0 && selected_website_row_ids.length === filtered_website_table_rows.length}
                        disabled={websites_table_loading}
                        onChange={(event) => {
                          if (event.target.checked) set_selected_website_row_ids(filtered_website_table_rows.map((item) => item.id));
                          else set_selected_website_row_ids([]);
                        }}
                      />
                    </TableHead>
                    <TableHead className="w-[230px]">Website</TableHead>
                    <TableHead>Prompt</TableHead>
                    <TableHead className="w-[140px]">LLM</TableHead>
                    <TableHead className="w-[170px]">Last fetched</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {websites_table_loading ? (
                    <>
                      <TableRow>
                        <TableCell colSpan={5} className="py-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading websites...
                          </span>
                        </TableCell>
                      </TableRow>
                      {Array.from({ length: 6 }).map((_, index) => (
                        <TableRow key={`website-loading-${index}`}>
                          <TableCell><div className="h-3.5 w-3.5 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /></TableCell>
                          <TableCell><div className="h-3.5 w-full max-w-[220px] animate-pulse rounded bg-slate-200 dark:bg-slate-700" /></TableCell>
                          <TableCell><div className="h-3.5 w-full max-w-[340px] animate-pulse rounded bg-slate-200 dark:bg-slate-700" /></TableCell>
                          <TableCell><div className="h-5 w-20 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" /></TableCell>
                          <TableCell><div className="h-3.5 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /></TableCell>
                        </TableRow>
                      ))}
                    </>
                  ) : filtered_website_table_rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No websites available.</TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {website_virtual_rows.top_spacer > 0 ? (
                        <TableRow aria-hidden="true" className="border-0 hover:bg-transparent">
                          <TableCell colSpan={5} className="p-0" style={{ height: `${website_virtual_rows.top_spacer}px` }} />
                        </TableRow>
                      ) : null}
                      {visible_website_rows.map((row) => {
                      const checked = selected_website_row_ids.includes(row.id);
                      const site_state = site_queries_by_host[row.website_url];
                      const fetched_at = site_state?.fetchedAt ?? null;
                      return (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer hover:bg-sky-50/60 dark:hover:bg-accent/40"
                          onClick={() => {
                            set_selected_executed_prompt_id(row.executed_id);
                            set_selected_candidate_prompt_id(null);
                            set_selected_website_url(row.website_url);
                            set_selected_website_row_id(row.id);
                            set_websites_drawer_open(true);
                          }}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded border-slate-400 accent-primary [color-scheme:light] dark:border-slate-500 dark:accent-primary dark:[color-scheme:dark]"
                              checked={checked}
                              disabled={websites_table_loading}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => toggle_website_row_selection(row.id, event.target.checked)}
                            />
                          </TableCell>
                          <TableCell className="w-[240px] max-w-[240px]">
                            <div className="flex w-full min-w-0 items-center gap-1.5">
                              <WebsiteFavicon url={row.website_url} host={row.website_host} />
                              <div className="min-w-0">
                                <p className="block w-full truncate font-medium" title={row.website_host}>{row.website_host}</p>
                                <p className="block w-full truncate text-[10px] text-muted-foreground" title={row.website_url}>{row.website_url}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-0">
                            <div className="flex items-center gap-2">
                              <p className="line-clamp-2 flex-1 break-words" title={row.prompt}>{row.prompt}</p>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[10px]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  set_selected_executed_prompt_id(row.executed_id);
                                  set_selected_candidate_prompt_id(null);
                                  set_selected_website_url(row.website_url);
                                  set_prompts_drawer_open(true);
                                }}
                              >
                                View prompt
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="inline-flex items-center gap-1 bg-primary/10 text-[10px] text-primary dark:bg-primary/15 dark:text-primary">
                              {provider_logo(row.provider) ? <img src={provider_logo(row.provider) ?? ''} alt={provider_label(row.provider)} className="h-3 w-3 object-contain" /> : null}
                              {provider_label(row.provider)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {fetched_at ? (
                              format_date(fetched_at)
                            ) : (
                              <Badge variant="outline" className="bg-amber-100 text-[10px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                Pending
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                      {website_virtual_rows.bottom_spacer > 0 ? (
                        <TableRow aria-hidden="true" className="border-0 hover:bg-transparent">
                          <TableCell colSpan={5} className="p-0" style={{ height: `${website_virtual_rows.bottom_spacer}px` }} />
                        </TableRow>
                      ) : null}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={fire_dialog_open} onOpenChange={set_fire_dialog_open}>
        <DialogContent className="w-[92vw] max-w-md p-4">
          <DialogHeader>
            <DialogTitle className="text-sm">Choose LLMs</DialogTitle>
            <DialogDescription className="text-xs">
              Select one or more LLMs for {pending_execution_mode === 'refire' ? 'refire' : 'fire'}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-2 dark:border-border/70 dark:bg-background/70">
              {EXECUTED_FILTER_PROVIDERS.map((provider) => (
                <label key={provider} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/40">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-400 accent-primary [color-scheme:light] dark:border-slate-500 dark:accent-primary dark:[color-scheme:dark]"
                    checked={selected_fire_providers[provider]}
                    onChange={(event) => update_fire_provider_selection(provider, event.target.checked)}
                  />
                  <Badge variant="outline" className="inline-flex items-center gap-1 bg-primary/10 text-[10px] text-primary dark:bg-primary/15 dark:text-primary">
                    <img src={PROVIDER_LOGO_MAP[provider]} alt={provider_label(provider)} className="h-3 w-3 object-contain" />
                    {provider_label(provider)}
                  </Badge>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                onClick={() => set_selected_fire_providers({ chatgpt: true, claude: true, perplexity: true, grok: true })}
              >
                Select all LLMs
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                onClick={() => set_selected_fire_providers({ chatgpt: false, claude: false, perplexity: false, grok: false })}
              >
                Clear
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Queue size: {execution_prompt_count} prompts × {selected_fire_provider_list.length} LLMs = {execution_prompt_count * selected_fire_provider_list.length} runs
            </p>
          </div>

          <DialogFooter className="flex-row gap-2 sm:justify-end sm:space-x-0">
            <Button type="button" variant="secondary" className="h-7 px-2 text-[11px]" onClick={() => set_fire_dialog_open(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="h-7 px-2 text-[11px]"
              disabled={!bridge_status.connected || is_executing || !execution_prompt_count || !selected_fire_provider_list.length}
              onClick={() => void handle_confirm_execute()}
            >
              {pending_execution_mode === 'refire' ? 'Refire now' : 'Fire now'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={queue_dialog_open} onOpenChange={set_queue_dialog_open}>
        <DialogContent className="w-[95vw] max-w-3xl p-4">
          <DialogHeader>
            <DialogTitle className="text-sm">Execution Queue</DialogTitle>
            <DialogDescription className="text-xs">
              Done {queue_done_count} · Left {queue_left_count} · Running {queue_running_count} · Queued {queue_queued_count} · Failed {queue_failed_count}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-border/70 dark:bg-background/70">
            {execution_queue.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No active execution queue.</p>
            ) : (
              <div className="space-y-1.5">
                {execution_queue.map((item, idx) => (
                  <div key={`${item.promptId}-${item.index}-${idx}`} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-border/70 dark:bg-background/80">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-[11px] font-medium">{item.text}</p>
                      <Badge variant="outline" className="text-[10px]">#{item.index + 1}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.provider ? (
                        <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px]">
                          <img src={PROVIDER_LOGO_MAP[item.provider]} alt={provider_label(item.provider)} className="h-3 w-3 object-contain" />
                          {provider_label(item.provider)}
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="text-[10px]">{item.status}</Badge>
                      {item.startedAt ? <Badge variant="outline" className="text-[10px]">started {format_date(item.startedAt)}</Badge> : null}
                      {item.completedAt ? <Badge variant="outline" className="text-[10px]">completed {format_date(item.completedAt)}</Badge> : null}
                    </div>
                    {item.error ? <p className="mt-1 text-[10px] text-destructive">{item.error}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="flex-row gap-2 sm:justify-end sm:space-x-0">
            {execution_finished_at ? (
              <p className="mr-auto text-[11px] text-muted-foreground">Finished at {format_date(execution_finished_at)}</p>
            ) : null}
            <Button type="button" className="h-7 px-2 text-[11px]" onClick={() => set_queue_dialog_open(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={prompts_drawer_open} onOpenChange={set_prompts_drawer_open}>
        <SheetContent side="right" className="w-[92vw] max-w-[92vw] sm:max-w-[1050px] p-0">
          <SheetHeader className="border-b border-slate-200 px-4 py-3 dark:border-border/60">
            <SheetTitle className="text-sm">{selected_executed_prompt?.text ?? 'Prompt details'}</SheetTitle>
          </SheetHeader>
          <div className="grid h-[calc(100vh-72px)] min-h-0 grid-cols-1 gap-2 p-2 lg:grid-cols-2">
            <div className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-border/70 dark:bg-background/60">
              <p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                <Search className="h-3 w-3" />
                Keywords + Websites
              </p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {discovery_keywords.length === 0 ? <p className="text-[11px] text-muted-foreground">No keywords captured.</p> : null}
                {discovery_keywords.map((item) => (
                  <Badge key={item.query} variant="outline" className="bg-background/90 text-[10px]">{item.query}</Badge>
                ))}
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 dark:border-border/60 dark:bg-background/80">
                {discovery_websites.length === 0 ? <p className="text-[11px] text-muted-foreground">No websites captured yet.</p> : null}
                {discovery_websites.map((site) => (
                  <button
                    key={site.url}
                    type="button"
                    onClick={() => set_selected_website_url(site.url)}
                    className={`w-full rounded-md border px-2 py-1.5 text-left transition ${
                      selected_website?.url === site.url
                        ? 'border-primary/40 bg-primary/10'
                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-border/70 dark:bg-background/80 dark:hover:bg-accent/50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <WebsiteFavicon url={site.url} host={site.host} />
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium">{site.host}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{site.url}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-border/70 dark:bg-background/60">
              <div className="mb-2 rounded-md border border-slate-200 bg-white/90 p-1.5 dark:border-border/60 dark:bg-background/80">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Keyword vs Website Yield</p>
                <div className="h-[120px]">
                  <RankBarChart
                    rows={[
                      { id: 'keywords', label: 'Keywords', value: selected_executed_prompt?.searchedKeywords.length ?? discovery_keywords.length },
                      { id: 'websites', label: 'Websites', value: selected_executed_prompt?.crawledWebsites.length ?? discovery_websites.length },
                    ]}
                    color="#3b82f6"
                  />
                </div>
              </div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <ListOrdered className="h-3 w-3" />
                  Top Queries
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => selected_site_query_key && void fetch_site_top_queries(selected_site_query_key, true)}
                  disabled={!selected_site_query_key || selected_site_query_state?.loading}
                >
                  {selected_site_query_state?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Refresh
                </Button>
              </div>
              {!selected_website ? (
                <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-slate-300 text-[11px] text-muted-foreground dark:border-border/80">
                  Select a website to view top queries.
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 bg-white p-2 dark:border-border/60 dark:bg-background/80">
                  {(selected_site_query_state?.rows ?? []).length === 0 && !selected_site_query_state?.loading ? (
                    <p className="text-[11px] text-muted-foreground">No top queries available.</p>
                  ) : null}
                  {selected_site_query_state?.loading ? (
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Fetching top queries...
                    </p>
                  ) : (
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="pb-1.5">Query</th>
                          <th className="pb-1.5">Volume</th>
                          <th className="pb-1.5">Traffic</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selected_site_query_state?.rows ?? []).map((row, index) => (
                          <tr key={`${row.query}-${index}`} className="border-t border-slate-200 transition-colors hover:bg-sky-50 dark:border-border/50 dark:hover:bg-info/5">
                            <td className="py-1.5 align-top">
                              <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 font-medium text-primary dark:bg-primary/10">
                                <Search className="h-3 w-3" />
                                {row.query}
                              </span>
                            </td>
                            <td className="py-1.5 align-top">
                              <span className="inline-flex rounded-md bg-sky-100 px-1.5 py-0.5 font-medium text-sky-700 dark:bg-info/12 dark:text-info">
                                {row.volume ?? '-'}
                              </span>
                            </td>
                            <td className="py-1.5 align-top">
                              <span className="inline-flex rounded-md bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-success/12 dark:text-success">
                                {row.traffic ?? '-'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={websites_drawer_open} onOpenChange={set_websites_drawer_open}>
        <SheetContent side="right" className="w-[92vw] max-w-[92vw] sm:max-w-[1050px] p-0">
          <SheetHeader className="border-b border-slate-200 px-4 py-3 dark:border-border/60">
            <SheetTitle className="text-sm">
              {selected_website_table_row?.website_host ?? selected_website?.host ?? 'Website details'}
            </SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100vh-72px)] min-h-0 p-2">
            <div className="flex h-full min-h-0 flex-col rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-border/70 dark:bg-background/60">
              <div className="mb-2 rounded-md border border-slate-200 bg-white/90 p-1.5 dark:border-border/60 dark:bg-background/80">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Top Queries Ranked</p>
                <div className="h-[120px]">
                  <RankBarChart
                    color="#10b981"
                    rows={(selected_site_query_state?.rows ?? []).map((row, index) => ({
                      id: `${row.query}-${index}`,
                      label: row.query,
                      value: row.traffic ?? row.volume ?? 0,
                      secondaryValue: row.volume,
                    }))}
                  />
                </div>
              </div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <ListOrdered className="h-3 w-3" />
                  Top Queries
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => selected_site_query_key && void fetch_site_top_queries(selected_site_query_key, true)}
                  disabled={!selected_site_query_key || selected_site_query_state?.loading}
                >
                  {selected_site_query_state?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Refresh
                </Button>
              </div>
              {!selected_website ? (
                <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-slate-300 text-[11px] text-muted-foreground dark:border-border/80">
                  Select a website to view top queries.
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 bg-white p-2 dark:border-border/60 dark:bg-background/80">
                  {(selected_site_query_state?.rows ?? []).length === 0 && !selected_site_query_state?.loading ? (
                    <p className="text-[11px] text-muted-foreground">No top queries available.</p>
                  ) : null}
                  {selected_site_query_state?.loading ? (
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Fetching top queries...
                    </p>
                  ) : (
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="pb-1.5">Query</th>
                          <th className="pb-1.5">Volume</th>
                          <th className="pb-1.5">Traffic</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selected_site_query_state?.rows ?? []).map((row, index) => (
                          <tr key={`${row.query}-${index}`} className="border-t border-slate-200 transition-colors hover:bg-sky-50 dark:border-border/50 dark:hover:bg-info/5">
                            <td className="py-1.5 align-top">
                              <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 font-medium text-primary dark:bg-primary/10">
                                <Search className="h-3 w-3" />
                                {row.query}
                              </span>
                            </td>
                            <td className="py-1.5 align-top">
                              <span className="inline-flex rounded-md bg-sky-100 px-1.5 py-0.5 font-medium text-sky-700 dark:bg-info/12 dark:text-info">
                                {row.volume ?? '-'}
                              </span>
                            </td>
                            <td className="py-1.5 align-top">
                              <span className="inline-flex rounded-md bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-success/12 dark:text-success">
                                {row.traffic ?? '-'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {workflow?.warnings?.length ? (
        <div className="border-t border-slate-200 px-3 py-1.5 dark:border-border/70">
          {workflow.warnings.map((warning, index) => (
            <p key={`${warning}-${index}`} className="text-[11px] text-muted-foreground">{warning}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PromptCandidateRow(props: {
  prompt: PromptCandidate;
  selected: boolean;
  linkedExecution: boolean;
  disabled: boolean;
  onOpen: () => void;
  onToggle: (selected: boolean) => void;
}) {
  const { prompt, selected, linkedExecution, disabled, onOpen, onToggle } = props;

  return (
    <div className={`rounded-lg border transition ${selected ? 'border-primary/40 bg-primary/10 dark:border-primary/40 dark:bg-primary/10' : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-border/70 dark:bg-background/80 dark:hover:bg-accent/50'}`}>
      <div className="flex items-start gap-2 px-2 py-1.5">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 rounded border-slate-400 accent-primary [color-scheme:light] focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-500 dark:accent-primary dark:[color-scheme:dark] dark:focus-visible:ring-primary/40"
          checked={prompt.selected}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
          onClick={(event) => event.stopPropagation()}
          title="Select prompt for fire/refire"
        />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="line-clamp-2 text-[11px] text-foreground">{prompt.text}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant={prompt.source === 'manual' ? 'secondary' : 'outline'} className="text-[10px]">{prompt.source}</Badge>
            <Badge variant="outline" className="text-[10px]">{prompt.status}</Badge>
            {linkedExecution ? <Badge variant="outline" className="bg-success/10 text-[10px] text-success">has execution</Badge> : null}
            {prompt.lastExecutionAt ? <Badge variant="outline" className="text-[10px]">{format_date(prompt.lastExecutionAt)}</Badge> : null}
          </div>
        </button>
      </div>
    </div>
  );
}

function ExecutedPromptRow(props: {
  item: NonNullable<PromptWorkflowState['executedPrompts']>[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const { item, selected, onSelect } = props;
  const logo = provider_logo(item.provider);

  return (
    <div className={`rounded-lg border transition ${selected ? 'border-primary/40 bg-primary/10 dark:border-primary/40 dark:bg-primary/10' : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-border/70 dark:bg-background/80 dark:hover:bg-accent/50'}`}>
      <div className="flex items-start gap-2 px-2 py-1.5">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <p className="line-clamp-2 text-[11px] text-foreground">{item.text}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px]">
              <CheckCircle2 className="h-3 w-3 text-success" />
              {logo ? <img src={logo} alt={provider_label(item.provider)} className="h-3 w-3 object-contain" /> : null}
              {provider_label(item.provider)}
            </Badge>
            <Badge variant="outline" className="text-[10px]">{item.status}</Badge>
            <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px]">
              <Search className="h-3 w-3" />
              {item.searchedKeywords.length}
            </Badge>
            <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px]">
              <Link2 className="h-3 w-3" />
              {item.crawledWebsites.length}
            </Badge>
          </div>
          <p className="pt-1 text-[10px] text-muted-foreground">{format_date(item.lastExecutionAt)}</p>
        </button>
      </div>
    </div>
  );
}

function WebsiteFavicon(props: { url: string; host?: string }) {
  const { url, host } = props;
  const [failed, set_failed] = useState(false);
  const favicon_url = failed ? null : get_favicon_url(url, host);

  if (!favicon_url) {
    return <Globe2 className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }

  return (
    <img
      src={favicon_url}
      alt={host ?? 'Website'}
      className="h-4 w-4 shrink-0 rounded-sm object-contain"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => set_failed(true)}
    />
  );
}
