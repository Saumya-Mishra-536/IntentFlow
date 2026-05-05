import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, ListChecks, Loader2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import ProviderBadge from '@/components/ProviderBadge';
import { DomainSummary, PromptCandidate, PromptWorkflowState, ai_chat_provider, analytics_api, campaign_api, domain_api } from '@/lib/api';
import { campaign_chat } from '@/lib/campaign-chat';
import { ExecutionPhase, WorkflowAsyncState, phase_to_copy } from '@/lib/workflow-view-model';

type QueueStatus = 'queued' | 'running' | 'completed' | 'failed';
type CapturePhase = 'idle' | 'capturing' | 'ingesting';
type SuggestionMode = 'regenerate' | 'append' | null;
type FireProvider = 'chatgpt' | 'claude' | 'perplexity' | 'grok';

type ExecutionQueueItem = {
  promptId?: string;
  text: string;
  provider: 'chatgpt' | 'claude' | 'perplexity' | 'grok';
  index: number;
  status: QueueStatus;
  phase?: ExecutionPhase;
  stepMessage?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
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

type SessionState = {
  campaign_id?: string;
  campaign_name?: string;
  version_id?: string;
  chat_provider?: ai_chat_provider;
};

const WEB_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://ai-seo-monorepo.onrender.com';
const ACCESS_TOKEN_KEY = 'ai_seo_access_token';
const DOMAIN_SELECTION_KEY = 'ai_seo_selected_domain_id';
const FIRE_PROVIDER_OPTIONS: FireProvider[] = ['chatgpt', 'claude', 'perplexity', 'grok'];

const as_exec_provider = (value: ai_chat_provider): 'chatgpt' | 'claude' | 'perplexity' | 'grok' => {
  if (value === 'claude' || value === 'perplexity' || value === 'grok') return value;
  return 'chatgpt';
};

const to_supported_provider = (value: unknown): ai_chat_provider | null => {
  if (value === 'chatgpt' || value === 'claude' || value === 'perplexity' || value === 'grok') return value;
  return null;
};

const normalize_text_key = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

const format_date = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const now = new Date();
  const is_same_day = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const is_yesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (is_same_day) return `Today at ${time}`;
  if (is_yesterday) return `Yesterday at ${time}`;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const is_execution_phase = (value: unknown): value is ExecutionPhase => {
  return (
    value === 'open_tab'
    || value === 'inject'
    || value === 'send_prompt'
    || value === 'await_stream'
    || value === 'hydrate_conversation'
    || value === 'ingest'
    || value === 'complete'
    || value === 'failed'
  );
};

const get_extension_runtime = (): BridgeRuntime | null => {
  const runtime = (window as Window & { chrome?: { runtime?: BridgeRuntime } }).chrome?.runtime;
  if (!runtime || typeof runtime.sendMessage !== 'function') {
    return null;
  }
  return runtime;
};

const try_extension_bridge = async (message: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: unknown }> => {
  const runtime = get_extension_runtime();
  if (!runtime) {
    return { ok: false, error: 'Extension bridge unavailable in this browser context.' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: 'Extension bridge timeout.' });
    }, 1800);

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

export default function WorkflowPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const route_state = location.state as SessionState | null;
  const campaign_id = sessionId === 'new' ? route_state?.campaign_id : sessionId;

  const [campaign_name, set_campaign_name] = useState(route_state?.campaign_name ?? 'Campaign Workflow');
  const [versions, set_versions] = useState<Array<{ id: string; version_number: number; is_active: boolean; label?: string | null }>>([]);
  const [selected_version_id, set_selected_version_id] = useState<string | undefined>(route_state?.version_id);
  const [workflow, set_workflow] = useState<PromptWorkflowState | null>(null);

  const [workflow_async, set_workflow_async] = useState<WorkflowAsyncState>({ status: 'idle' });
  const [suggestions_async, set_suggestions_async] = useState<WorkflowAsyncState>({ status: 'idle' });
  const [execution_async, set_execution_async] = useState<WorkflowAsyncState>({ status: 'idle' });
  const [suggestion_mode, set_suggestion_mode] = useState<SuggestionMode>(null);

  const [error_message, set_error_message] = useState('');
  const [manual_prompt_text, set_manual_prompt_text] = useState('');
  const [suggested_visible_count, set_suggested_visible_count] = useState(10);
  const [executed_open, set_executed_open] = useState(true);
  const [suggested_open, set_suggested_open] = useState(true);
  const [selected_by_id, set_selected_by_id] = useState<Record<string, boolean>>({});
  const [fire_dialog_open, set_fire_dialog_open] = useState(false);
  const [selected_fire_providers, set_selected_fire_providers] = useState<Record<FireProvider, boolean>>({
    chatgpt: route_state?.chat_provider === 'chatgpt' || !route_state?.chat_provider,
    claude: route_state?.chat_provider === 'claude',
    perplexity: route_state?.chat_provider === 'perplexity',
    grok: route_state?.chat_provider === 'grok',
  });

  const [bridge_status, set_bridge_status] = useState<{ connected: boolean; message: string }>({
    connected: false,
    message: 'Checking extension bridge...',
  });
  const [live_provider, set_live_provider] = useState<ai_chat_provider | null>(
    to_supported_provider(route_state?.chat_provider) ?? null,
  );
  const [domains, set_domains] = useState<DomainSummary[]>([]);
  const [selected_domain_id, set_selected_domain_id] = useState<string>(
    () => localStorage.getItem(DOMAIN_SELECTION_KEY) ?? '',
  );

  const [capture_phase, set_capture_phase] = useState<CapturePhase>('idle');
  const [capture_label, set_capture_label] = useState('');

  const [active_execution_id, set_active_execution_id] = useState<string | null>(null);
  const [execution_queue, set_execution_queue] = useState<ExecutionQueueItem[]>([]);
  const [execution_finished_at, set_execution_finished_at] = useState<string | null>(null);

  const [live_polite, set_live_polite] = useState('');
  const [live_assertive, set_live_assertive] = useState('');

  const execution_queue_ref = useRef<ExecutionQueueItem[]>([]);
  const execution_provider_ref = useRef<'chatgpt' | 'claude' | 'perplexity' | 'grok'>('chatgpt');
  const queue_storage_key = useMemo(
    () => (campaign_id ? `ai_seo_workflow_queue:${campaign_id}` : null),
    [campaign_id],
  );

  const execution_provider = useMemo(() => {
    if (live_provider) return as_exec_provider(live_provider);
    if (!campaign_id) return as_exec_provider(route_state?.chat_provider ?? 'chatgpt');
    const mapped = campaign_chat.get_provider(campaign_id);
    return as_exec_provider(mapped ?? route_state?.chat_provider ?? 'chatgpt');
  }, [campaign_id, live_provider, route_state?.chat_provider]);

  useEffect(() => {
    if (!campaign_id || !live_provider) return;
    campaign_chat.set_provider({ campaign_id, provider: live_provider });
  }, [campaign_id, live_provider]);

  useEffect(() => {
    execution_provider_ref.current = execution_provider;
  }, [execution_provider]);

  useEffect(() => {
    const has_selected = FIRE_PROVIDER_OPTIONS.some((provider) => selected_fire_providers[provider]);
    if (has_selected) return;
    set_selected_fire_providers({
      chatgpt: execution_provider === 'chatgpt',
      claude: execution_provider === 'claude',
      perplexity: execution_provider === 'perplexity',
      grok: execution_provider === 'grok',
    });
  }, [execution_provider, selected_fire_providers]);

  useEffect(() => {
    execution_queue_ref.current = execution_queue;
  }, [execution_queue]);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await domain_api.get_domains();
        set_domains(rows);
        if (!rows.length) {
          set_selected_domain_id('');
          localStorage.removeItem(DOMAIN_SELECTION_KEY);
          return;
        }
        const stored = localStorage.getItem(DOMAIN_SELECTION_KEY) ?? '';
        const resolved = rows.some((item) => item.domain_id === stored) ? stored : rows[0]?.domain_id ?? '';
        set_selected_domain_id(resolved);
        if (resolved) {
          localStorage.setItem(DOMAIN_SELECTION_KEY, resolved);
        }
      } catch {
        set_domains([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!queue_storage_key) return;
    try {
      const raw = localStorage.getItem(queue_storage_key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        executionId?: string | null;
        queue?: ExecutionQueueItem[];
        finishedAt?: string | null;
      };
      if (Array.isArray(parsed.queue) && parsed.queue.length) {
        set_execution_queue(parsed.queue);
      }
      if (typeof parsed.executionId === 'string') {
        set_active_execution_id(parsed.executionId);
      }
      if (typeof parsed.finishedAt === 'string') {
        set_execution_finished_at(parsed.finishedAt);
      }
    } catch {
      // Ignore malformed queue payload.
    }
  }, [queue_storage_key]);

  useEffect(() => {
    if (!queue_storage_key) return;
    const payload = {
      executionId: active_execution_id,
      queue: execution_queue,
      finishedAt: execution_finished_at,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(queue_storage_key, JSON.stringify(payload));
  }, [active_execution_id, execution_finished_at, execution_queue, queue_storage_key]);

  const track_event = useCallback((event_name: string, properties: Record<string, unknown> = {}) => {
    analytics_api.track_event({ event_name, properties }).catch(() => { });
  }, []);

  const announce_polite = useCallback((message: string) => {
    set_live_polite('');
    window.setTimeout(() => set_live_polite(message), 20);
  }, []);

  const announce_error = useCallback((message: string) => {
    set_live_assertive('');
    window.setTimeout(() => set_live_assertive(message), 20);
  }, []);

  const selected_prompt_ids = useMemo(() => {
    return (workflow?.promptCandidates ?? [])
      .filter((item) => selected_by_id[item.id] ?? item.selected)
      .map((item) => item.id);
  }, [selected_by_id, workflow?.promptCandidates]);

  const selected_fire_provider_list = useMemo(
    () => FIRE_PROVIDER_OPTIONS.filter((provider) => selected_fire_providers[provider]),
    [selected_fire_providers],
  );

  const visible_suggested_prompts = useMemo(
    () => (workflow?.promptCandidates ?? []).slice(0, suggested_visible_count),
    [workflow?.promptCandidates, suggested_visible_count],
  );

  const sorted_executed_prompts = useMemo(() => {
    const rows = [...(workflow?.executedPrompts ?? [])];
    rows.sort((a, b) => new Date(b.lastExecutionAt).getTime() - new Date(a.lastExecutionAt).getTime());
    return rows;
  }, [workflow?.executedPrompts]);

  const version_options = useMemo(
    () =>
      versions.map((version) => ({
        value: version.id,
        label: `v${version.version_number}${version.is_active ? ' (active)' : ''}${version.label ? ` - ${version.label}` : ''}`,
      })),
    [versions],
  );

  const completed_count = execution_queue.filter((item) => item.status === 'completed').length;
  const failed_count = execution_queue.filter((item) => item.status === 'failed').length;
  const total_count = execution_queue.length;

  useEffect(() => {
    if (!campaign_id) {
      navigate('/dashboard', { replace: true });
      return;
    }

    track_event('workflow_viewed', {
      campaign_id,
      version_id: selected_version_id,
    });
  }, [campaign_id, navigate, selected_version_id, track_event]);

  useEffect(() => {
    if (!campaign_id) return;

    try {
      const access_token = localStorage.getItem(ACCESS_TOKEN_KEY);
      if (access_token) {
        chrome.storage.local.set({
          ai_seo_access_token: access_token,
          ai_seo_api_base_url: WEB_API_BASE_URL,
        });
      }
    } catch {
      // Ignore storage sync failures.
    }

    void try_extension_bridge({ type: 'AI_SEO_SET_ACTIVE_CAMPAIGN', campaignId: campaign_id });
    void try_extension_bridge({ type: 'AI_SEO_START_LISTENING' });

    return () => {
      void try_extension_bridge({ type: 'AI_SEO_SET_ACTIVE_CAMPAIGN', campaignId: null });
    };
  }, [campaign_id]);

  const load_versions = useCallback(async () => {
    if (!campaign_id) return;
    try {
      const payload = await campaign_api.get_campaign_versions(campaign_id);
      const next_versions = payload.versions ?? [];
      set_campaign_name((prev) => payload.campaign?.name ?? prev);
      set_versions(next_versions);
      set_selected_version_id((prev) => {
        if (prev && next_versions.some((entry) => entry.id === prev)) return prev;
        return next_versions.find((entry) => entry.is_active)?.id ?? next_versions[0]?.id;
      });
    } catch (error) {
      set_versions([]);
      const message = error instanceof Error ? error.message : 'Failed to load versions';
      set_error_message(message);
      set_workflow_async({ status: 'error', message, updatedAt: new Date().toISOString() });
      announce_error(message);
    }
  }, [announce_error, campaign_id]);

  const load_workflow_state = useCallback(async (silent = false): Promise<PromptWorkflowState | null> => {
    if (!campaign_id) return null;
    if (!silent) {
      set_workflow_async({ status: 'loading', message: 'Refreshing workflow...', updatedAt: new Date().toISOString() });
    }
    try {
      const payload = await campaign_api.get_workflow_state(campaign_id, { version_id: selected_version_id });
      set_workflow(payload);
      set_suggested_visible_count(10);
      set_workflow_async({ status: 'success', message: 'Workflow updated', updatedAt: new Date().toISOString() });
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load workflow state';
      set_workflow(null);
      set_error_message(message);
      set_workflow_async({ status: 'error', message, updatedAt: new Date().toISOString() });
      announce_error(message);
      return null;
    }
  }, [announce_error, campaign_id, selected_version_id]);

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
    set_capture_phase('idle');
    set_capture_label('');
    set_selected_by_id({});
    set_execution_async({ status: 'idle' });
  }, [selected_version_id]);

  useEffect(() => {
    set_selected_by_id((prev) => {
      const next: Record<string, boolean> = {};
      for (const item of workflow?.promptCandidates ?? []) {
        next[item.id] = prev[item.id] ?? item.selected;
      }
      return next;
    });
  }, [workflow?.promptCandidates]);

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

    const is_running = Boolean(data.isExecuting);
    const execution_id = typeof data.executionId === 'string' ? data.executionId : null;
    const current_index = typeof data.currentIndex === 'number' ? data.currentIndex : null;
    const total_count_from_bridge = typeof data.totalCount === 'number' ? data.totalCount : 0;
    const running_count_from_bridge = typeof data.runningCount === 'number' ? data.runningCount : null;
    const completed_count_from_bridge = typeof data.completedCount === 'number' ? data.completedCount : null;
    const failed_count_from_bridge = typeof data.failedCount === 'number' ? data.failedCount : null;
    const active_tab_provider = to_supported_provider(data.activeTabProvider);
    if (active_tab_provider) {
      set_live_provider(active_tab_provider);
    }

    if (is_running) {
      if (execution_id) {
        set_active_execution_id((prev) => prev ?? execution_id);
      }
      const message = running_count_from_bridge !== null && total_count_from_bridge > 0
        ? `Execution in progress ${Math.min((completed_count_from_bridge ?? 0) + (failed_count_from_bridge ?? 0) + running_count_from_bridge, total_count_from_bridge)}/${total_count_from_bridge}${running_count_from_bridge > 0 ? ` · ${running_count_from_bridge} running` : ''}`
        : current_index !== null && total_count_from_bridge > 0
          ? `Execution in progress ${Math.min(current_index + 1, total_count_from_bridge)}/${total_count_from_bridge}`
          : 'Execution in progress';
      set_bridge_status({ connected: true, message });
      return;
    }

    set_bridge_status({ connected: true, message: 'Bridge connected · listener active' });
  }, []);

  useEffect(() => {
    void refresh_bridge_status();
  }, [refresh_bridge_status]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh_bridge_status();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refresh_bridge_status]);

  const regenerate_suggestions = useCallback(async (append: boolean) => {
    if (!campaign_id || !selected_version_id) return;
    set_suggestion_mode(append ? 'append' : 'regenerate');
    set_suggestions_async({ status: 'loading', message: append ? 'Loading more suggestions...' : 'Regenerating suggestions...', updatedAt: new Date().toISOString() });
    set_error_message('');

    track_event(append ? 'load_more_clicked' : 'regenerate_clicked', {
      campaign_id,
      version_id: selected_version_id,
      executed_prompt_count: workflow?.executedPrompts.length ?? 0,
    });

    try {
      await campaign_api.generate_suggestions(
        campaign_id,
        { version_id: selected_version_id },
        {
          max_suggestions: 5,
          append,
        },
      );
      await load_workflow_state(true);
      set_suggestions_async({ status: 'success', message: append ? 'Added suggestions' : 'Suggestions regenerated', updatedAt: new Date().toISOString() });
      announce_polite(append ? 'More suggested prompts loaded.' : 'Suggested prompts regenerated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate suggestions';
      set_error_message(message);
      set_suggestions_async({ status: 'error', message, updatedAt: new Date().toISOString() });
      announce_error(message);
    } finally {
      set_suggestion_mode(null);
    }
  }, [announce_error, announce_polite, campaign_id, load_workflow_state, selected_version_id, track_event, workflow?.executedPrompts.length]);

  useEffect(() => {
    const runtime = get_extension_runtime();
    if (!runtime?.onMessage) return;

    const listener = (message: unknown) => {
      const envelope = message && typeof message === 'object' ? (message as Record<string, unknown>) : null;
      if (!envelope) return;

      if (envelope.type === 'AI_SEO_WORKFLOW_INGEST_STARTED') {
        const campaign = typeof envelope.campaignId === 'string' ? envelope.campaignId : null;
        if (campaign_id && campaign === campaign_id) {
          const provider = to_supported_provider(envelope.provider);
          if (provider) set_live_provider(provider);
          set_capture_phase('ingesting');
          const prompt_text = typeof envelope.prompt === 'string' ? envelope.prompt.trim() : '';
          set_capture_label(prompt_text ? `Ingesting: ${prompt_text.slice(0, 90)}` : 'Saving captured prompt...');
          announce_polite('Saving captured prompt outputs...');
        }
        return;
      }

      if (envelope.type === 'AI_SEO_WORKFLOW_INGESTED') {
        const campaign = typeof envelope.campaignId === 'string' ? envelope.campaignId : null;
        if (campaign_id && campaign === campaign_id) {
          const provider = to_supported_provider(envelope.provider);
          if (provider) set_live_provider(provider);
          set_capture_phase('idle');
          set_capture_label('');
          if (envelope.ok === false) {
            const error = typeof envelope.error === 'string' ? envelope.error : 'Prompt ingest failed';
            set_bridge_status({ connected: true, message: error });
            set_error_message(error);
            announce_error(error);
          } else {
            set_bridge_status({ connected: true, message: 'Prompt captured successfully' });
            announce_polite('Prompt captured successfully.');
            void load_workflow_state(true);
          }
        }
        return;
      }

      if (envelope.type !== 'AI_SEO_BRIDGE_EVENT') return;

      const event_name = typeof envelope.event === 'string' ? envelope.event : '';
      const payload = envelope.payload && typeof envelope.payload === 'object' ? (envelope.payload as Record<string, unknown>) : {};
      const execution_id = typeof payload.executionId === 'string' ? payload.executionId : null;
      if (active_execution_id && execution_id && execution_id !== active_execution_id) {
        return;
      }

      const prompt_index = typeof payload.promptIndex === 'number' ? payload.promptIndex : null;
      const now_iso = typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString();
      const phase = is_execution_phase(payload.phase) ? payload.phase : undefined;
      const step_message = typeof payload.stepMessage === 'string' && payload.stepMessage.trim()
        ? payload.stepMessage.trim()
        : (phase ? phase_to_copy(phase) : undefined);

      if (event_name === 'executionStarted') {
        set_execution_async({ status: 'loading', message: 'Execution started', updatedAt: now_iso });
        set_execution_finished_at(null);
        if (execution_id) set_active_execution_id(execution_id);
        set_bridge_status({ connected: true, message: 'Execution started' });
        announce_polite('Execution started.');
        return;
      }

      if (event_name === 'promptStarted' && prompt_index !== null) {
        const prompt_text = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
        const provider = (typeof payload.provider === 'string' ? payload.provider : execution_provider_ref.current) as ai_chat_provider;
        const supported_provider = to_supported_provider(provider);
        if (supported_provider) set_live_provider(supported_provider);
        const resolved_phase = phase ?? 'open_tab';
        const resolved_step = step_message ?? phase_to_copy(resolved_phase);

        set_capture_phase(resolved_phase === 'ingest' ? 'ingesting' : 'capturing');
        set_capture_label(prompt_text ? `${resolved_step} ${prompt_text.slice(0, 80)}` : resolved_step);

        set_execution_queue((prev) => {
          const existing_index = prev.findIndex((item) => item.index === prompt_index);
          if (existing_index === -1) {
            const row: ExecutionQueueItem = {
              text: prompt_text || `Prompt ${prompt_index + 1}`,
              provider: as_exec_provider(provider),
              index: prompt_index,
              status: 'running',
              phase: resolved_phase,
              stepMessage: resolved_step,
              startedAt: now_iso,
              updatedAt: now_iso,
            };
            return [...prev, row].sort((a, b) => a.index - b.index);
          }
          return prev.map((item) =>
            item.index === prompt_index
              ? {
                ...item,
                status: item.status === 'completed' || item.status === 'failed' ? item.status : 'running',
                phase: resolved_phase,
                stepMessage: resolved_step,
                updatedAt: now_iso,
                startedAt: item.startedAt ?? now_iso,
              }
              : item,
          );
        });

        return;
      }

      if (event_name === 'promptCompleted' && prompt_index !== null) {
        const provider = (typeof payload.provider === 'string' ? payload.provider : execution_provider_ref.current) as ai_chat_provider;
        const queue_item = execution_queue_ref.current.find((item) => item.index === prompt_index);
        const ingested = payload.ingestedExecutedPrompt && typeof payload.ingestedExecutedPrompt === 'object'
          ? (payload.ingestedExecutedPrompt as {
            id: string;
            text: string;
            provider: ai_chat_provider;
            status: 'completed' | 'failed';
            lastExecutionAt: string;
            sourcePromptId?: string;
            searchedKeywords: Array<{ query: string; sourceProvider: ai_chat_provider; sourcePromptId?: string; firstSeenAt: string }>;
            crawledWebsites: Array<{ url: string; host: string; source: string; firstSeenAt: string }>;
            placesFound: Array<{ name: string; address?: string; rating?: number; reviewCount?: number; websiteUrl?: string; category?: string }>;
          })
          : null;

        if (queue_item || ingested) {
          set_workflow((prev) => {
            if (!prev) return prev;
            const next_row = ingested ?? {
              id: `local:${execution_id ?? 'exec'}:${prompt_index}`,
              text: queue_item?.text ?? `Prompt ${prompt_index + 1}`,
              provider,
              status: 'completed' as const,
              lastExecutionAt: now_iso,
              searchedKeywords: [],
              crawledWebsites: [],
              placesFound: [],
            };
            const existing_index = prev.executedPrompts.findIndex(
              (item) => item.id === next_row.id || normalize_text_key(item.text) === normalize_text_key(next_row.text),
            );
            const next_rows = [...prev.executedPrompts];
            if (existing_index >= 0) {
              next_rows[existing_index] = next_row;
            } else {
              next_rows.unshift(next_row);
            }
            return {
              ...prev,
              executedPrompts: next_rows,
            };
          });
        }

        set_execution_queue((prev) =>
          prev.map((item) =>
            item.index === prompt_index
              ? {
                ...item,
                status: 'completed',
                phase: 'complete',
                stepMessage: 'Completed',
                completedAt: now_iso,
                updatedAt: now_iso,
              }
              : item,
          ),
        );

        announce_polite('Prompt completed.');
        return;
      }

      if (event_name === 'promptFailed' && prompt_index !== null) {
        set_capture_phase('idle');
        set_capture_label('');
        const error = typeof payload.error === 'string' ? payload.error : 'Prompt execution failed';
        const provider = (typeof payload.provider === 'string' ? payload.provider : execution_provider_ref.current) as ai_chat_provider;

        set_execution_queue((prev) =>
          prev.map((item) =>
            item.index === prompt_index
              ? {
                ...item,
                status: 'failed',
                phase: 'failed',
                stepMessage: phase_to_copy('failed', error),
                completedAt: now_iso,
                updatedAt: now_iso,
                error,
              }
              : item,
          ),
        );

        set_bridge_status({ connected: true, message: error });
        set_error_message(error);
        set_execution_async({ status: 'error', message: error, updatedAt: now_iso });
        announce_error(error);
        track_event('run_failed', {
          campaign_id,
          version_id: selected_version_id,
          execution_id,
          prompt_index: prompt_index + 1,
          provider,
          error,
        });
        return;
      }

      if (event_name === 'executionFinished') {
        const any_failed = execution_queue_ref.current.some((item) => item.status === 'failed');
        set_execution_async({
          status: any_failed ? 'error' : 'success',
          message: any_failed ? 'Execution finished with failures' : 'Execution finished',
          updatedAt: now_iso,
        });
        set_execution_finished_at(now_iso);
        set_active_execution_id(null);
        set_capture_phase('idle');
        set_capture_label('');
        set_bridge_status({ connected: true, message: 'Execution finished' });

        announce_polite('Execution finished.');
        void load_workflow_state(true);
      }
    };

    runtime.onMessage.addListener(listener);
    return () => {
      runtime.onMessage?.removeListener(listener);
    };
  }, [active_execution_id, announce_error, announce_polite, campaign_id, load_workflow_state, selected_version_id, track_event]);

  const update_prompt_selection = useCallback((prompt_id: string, selected: boolean) => {
    set_selected_by_id((prev) => ({
      ...prev,
      [prompt_id]: selected,
    }));
  }, []);

  const update_fire_provider_selection = useCallback((provider: FireProvider, selected: boolean) => {
    set_selected_fire_providers((prev) => ({
      ...prev,
      [provider]: selected,
    }));
  }, []);

  const handle_add_manual_prompt = useCallback(async () => {
    if (!campaign_id || !selected_version_id) return;
    const text = manual_prompt_text.trim();
    if (!text) return;

    set_error_message('');
    try {
      const payload = await campaign_api.add_manual_prompt(campaign_id, selected_version_id, { text });
      set_workflow(payload);
      set_manual_prompt_text('');
      set_suggested_visible_count((count) => Math.max(count, payload.promptCandidates.length));
      announce_polite('Manual prompt added.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add manual prompt';
      set_error_message(message);
      announce_error(message);
    }
  }, [announce_error, announce_polite, campaign_id, manual_prompt_text, selected_version_id]);

  const send_bridge_execution = useCallback(async (params: {
    executionId: string;
    versionId: string;
    prompts: Array<{ text: string; promptId?: string; provider: 'chatgpt' | 'claude' | 'perplexity' | 'grok' }>;
    fallbackProvider?: 'chatgpt' | 'claude' | 'perplexity' | 'grok';
  }) => {
    if (!campaign_id) {
      throw new Error('Campaign not available');
    }
    if (!bridge_status.connected) {
      throw new Error('Extension bridge is disconnected. Reconnect and retry.');
    }

    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) {
      throw new Error('Missing extension access token. Reconnect auth and retry.');
    }

    const bridge_result = await try_extension_bridge({
      type: 'AI_SEO_BRIDGE_EXECUTE_PROMPTS',
      executionId: params.executionId,
      campaignId: campaign_id,
      versionId: params.versionId,
      provider: params.fallbackProvider ?? execution_provider,
      prompts: params.prompts,
      accessToken: token,
      apiBaseUrl: WEB_API_BASE_URL,
      ingestInBackground: true,
    });

    if (!bridge_result.ok) {
      throw new Error(bridge_result.error ?? 'Failed to send execution to extension bridge.');
    }
    const bridge_data = bridge_result.data && typeof bridge_result.data === 'object'
      ? (bridge_result.data as Record<string, unknown>)
      : null;
    if (bridge_data?.ok === false) {
      throw new Error(typeof bridge_data.error === 'string' ? bridge_data.error : 'Extension bridge rejected execution.');
    }
  }, [bridge_status.connected, campaign_id, execution_provider]);

  const handle_fire_selected = useCallback(async (providers: FireProvider[]) => {
    if (!campaign_id || !selected_version_id) return;
    if (!selected_prompt_ids.length) {
      const message = 'Select at least one suggested prompt before firing.';
      set_error_message(message);
      announce_error(message);
      return;
    }
    if (!providers.length) {
      const message = 'Select at least one LLM before firing.';
      set_error_message(message);
      announce_error(message);
      return;
    }

    set_error_message('');
    set_execution_async({ status: 'loading', message: 'Queueing selected prompts...', updatedAt: new Date().toISOString() });

    track_event('fire_clicked', {
      campaign_id,
      version_id: selected_version_id,
      selected_count: selected_prompt_ids.length,
      provider_count: providers.length,
      providers,
    });

    try {
      const execution = await campaign_api.execute_prompts(campaign_id, selected_version_id, {
        mode: 'fire',
        promptIds: selected_prompt_ids,
        provider: providers[0],
      });

      await campaign_api.replace_prompt_selection(campaign_id, selected_version_id, {
        selectedPromptIds: selected_prompt_ids,
      });

      const queue_items: ExecutionQueueItem[] = [];
      let queue_index = 0;
      for (const entry of execution.orderedQueue) {
        for (const provider of providers) {
          queue_items.push({
            promptId: entry.promptId,
            text: entry.text,
            provider,
            index: queue_index,
            status: 'queued',
          });
          queue_index += 1;
        }
      }
      set_execution_queue(queue_items);
      set_active_execution_id(execution.executionId);
      set_execution_finished_at(null);

      await send_bridge_execution({
        executionId: execution.executionId,
        versionId: selected_version_id,
        prompts: queue_items.map((item) => ({
          text: item.text,
          provider: item.provider,
          ...(item.promptId ? { promptId: item.promptId } : {}),
        })),
        fallbackProvider: providers[0],
      });

      set_bridge_status({ connected: true, message: 'Execution queued in extension bridge' });
      set_execution_async({ status: 'success', message: 'Execution queued', updatedAt: new Date().toISOString() });
      announce_polite('Execution queued.');
      await load_workflow_state(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to queue prompt execution';
      set_active_execution_id(null);
      set_execution_queue([]);
      set_execution_finished_at(null);
      set_error_message(message);
      set_execution_async({ status: 'error', message, updatedAt: new Date().toISOString() });
      announce_error(message);
    }
  }, [announce_error, announce_polite, campaign_id, load_workflow_state, selected_prompt_ids, selected_version_id, send_bridge_execution, track_event]);

  const handle_open_fire_dialog = useCallback(() => {
    if (Boolean(active_execution_id)) return;
    if (!selected_prompt_ids.length) {
      const message = 'Select at least one suggested prompt before firing.';
      set_error_message(message);
      announce_error(message);
      return;
    }
    set_error_message('');
    set_fire_dialog_open(true);
  }, [active_execution_id, announce_error, selected_prompt_ids.length]);

  const handle_confirm_fire_selected = useCallback(async () => {
    const providers = selected_fire_provider_list;
    if (!providers.length) {
      const message = 'Select at least one LLM before firing.';
      set_error_message(message);
      announce_error(message);
      return;
    }
    set_fire_dialog_open(false);
    await handle_fire_selected(providers);
  }, [announce_error, handle_fire_selected, selected_fire_provider_list]);

  const handle_update = useCallback(async () => {
    if (!campaign_id || !workflow?.version || !selected_version_id) return;

    const latest_unique_completed = [] as Array<{ text: string; provider: 'chatgpt' | 'claude' | 'perplexity' | 'grok' }>;
    const seen = new Set<string>();
    for (const row of workflow.executedPrompts) {
      if (row.status !== 'completed') continue;
      const key = normalize_text_key(row.text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      latest_unique_completed.push({
        text: row.text,
        provider: as_exec_provider(row.provider),
      });
    }

    if (!latest_unique_completed.length) {
      const message = 'No completed executed prompts available to update.';
      set_error_message(message);
      announce_error(message);
      return;
    }

    set_error_message('');
    set_execution_async({ status: 'loading', message: 'Preparing new version...', updatedAt: new Date().toISOString() });

    try {
      const next_version = await campaign_api.refire_version(campaign_id, workflow.version.version_number);
      await load_versions();
      set_selected_version_id(next_version.id);

      const execution_id = window.crypto?.randomUUID?.() ?? `${Date.now()}`;
      const queue_items: ExecutionQueueItem[] = latest_unique_completed.map((item, index) => ({
        text: item.text,
        provider: item.provider,
        index,
        status: 'queued',
      }));
      set_execution_queue(queue_items);
      set_active_execution_id(execution_id);
      set_execution_finished_at(null);

      await send_bridge_execution({
        executionId: execution_id,
        versionId: next_version.id,
        prompts: queue_items.map((item) => ({
          text: item.text,
          provider: item.provider,
        })),
      });

      set_bridge_status({ connected: true, message: 'Update execution queued in extension bridge' });
      set_execution_async({ status: 'success', message: 'Update queued', updatedAt: new Date().toISOString() });
      announce_polite('Update execution queued.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start update run';
      set_active_execution_id(null);
      set_execution_queue([]);
      set_execution_finished_at(null);
      set_error_message(message);
      set_execution_async({ status: 'error', message, updatedAt: new Date().toISOString() });
      announce_error(message);
    }
  }, [announce_error, announce_polite, campaign_id, load_versions, selected_version_id, send_bridge_execution, workflow?.executedPrompts, workflow?.version]);

  const handle_refresh = useCallback(async () => {
    await load_workflow_state(true);
    const bridge_result = await try_extension_bridge({ type: 'AI_SEO_BRIDGE_REFRESH_CONVERSATION' });
    if (!bridge_result.ok) {
      const message = bridge_result.error ?? 'Extension bridge unavailable';
      set_bridge_status({ connected: false, message });
      set_error_message(message);
      announce_error(message);
      return;
    }
    set_bridge_status({ connected: true, message: 'Capture listeners refreshed' });
    announce_polite('Listener refreshed.');
  }, [announce_error, announce_polite, load_workflow_state]);

  const handle_switch_domain = useCallback((domain_id: string) => {
    if (!domain_id || domain_id === selected_domain_id) return;
    set_selected_domain_id(domain_id);
    localStorage.setItem(DOMAIN_SELECTION_KEY, domain_id);
    announce_polite('Domain switched. Redirecting to dashboard.');
    navigate('/dashboard');
  }, [announce_polite, navigate, selected_domain_id]);

  const handle_open_queue_page = useCallback(() => {
    if (!sessionId || !campaign_id) return;
    const version_query = selected_version_id ? `?version_id=${encodeURIComponent(selected_version_id)}` : '';
    navigate(`/visualization/${sessionId}/queue${version_query}`, {
      state: {
        campaign_id,
        campaign_name,
        version_id: selected_version_id,
      } satisfies SessionState,
    });
  }, [campaign_id, campaign_name, navigate, selected_version_id, sessionId]);

  const handle_open_prompt_detail = useCallback((prompt_id: string) => {
    if (!campaign_id || !sessionId) return;
    track_event('prompt_detail_opened', {
      campaign_id,
      version_id: selected_version_id,
      prompt_id,
    });

    const version_query = selected_version_id ? `?version_id=${encodeURIComponent(selected_version_id)}` : '';
    navigate(`/visualization/${sessionId}/prompts/${prompt_id}${version_query}`, {
      state: {
        campaign_id,
        campaign_name,
        version_id: selected_version_id,
      } satisfies SessionState,
    });
  }, [campaign_id, campaign_name, navigate, selected_version_id, sessionId, track_event]);

  if (!campaign_id) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Campaign not available.</p>
      </div>
    );
  }

  const running_count = execution_queue.filter((item) => item.status === 'running').length;
  const done_count = completed_count + failed_count;
  const active_queue_item = execution_queue.find((item) => item.status === 'running') ?? null;
  const capture_active = capture_phase !== 'idle';
  const execution_focus_text = capture_label || active_queue_item?.stepMessage || '';

  return (
    <section
      className="relative flex h-dvh w-full flex-col overflow-hidden border border-border/60 bg-gradient-to-br from-background via-background to-primary/10 sm:rounded-2xl"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif' }}
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">{live_polite}</div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">{live_assertive}</div>

      <header className="sticky top-0 z-20 shrink-0 border-b border-border/80 bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex items-start gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            onClick={() => navigate('/dashboard')}
          >
            Back
          </Button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-foreground">{campaign_name}</h1>
            <p className="truncate text-[11px] text-muted-foreground">Prompt workflow</p>
          </div>
        </div>

        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-lg border border-border/70 bg-background/85 px-2 py-1.5">
            {domains.length ? (
              <select
                className="h-8 min-w-0 rounded-md border border-border bg-background px-2 text-[11px]"
                value={selected_domain_id || domains[0]?.domain_id || ''}
                onChange={(event) => handle_switch_domain(event.target.value)}
                title="Switch domain scope"
              >
                {domains.map((domain) => (
                  <option key={domain.domain_id} value={domain.domain_id}>
                    {domain.normalized_domain}
                  </option>
                ))}
              </select>
            ) : null}

            {version_options.length ? (
              <Select
                value={selected_version_id ?? ''}
                onValueChange={(value) => set_selected_version_id(value || undefined)}
                options={version_options}
                className="w-[110px]"
              />
            ) : null}

            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-[11px]"
              onClick={() => void handle_refresh()}
              disabled={workflow_async.status === 'loading'}
            >
              Refresh
            </Button>
          </div>

          <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-1.5 rounded-lg border border-border/70 bg-background/85 px-2 py-1.5 text-[11px]">
            <ProviderBadge provider={execution_provider} className="border-primary/30 bg-primary/10 text-primary" />
            <Badge
              variant={bridge_status.connected ? 'secondary' : 'destructive'}
              className={`${bridge_status.connected ? 'bg-primary/15 text-primary' : ''} whitespace-nowrap`}
            >
              {bridge_status.connected ? 'Bridge on' : 'Bridge off'}
            </Badge>
            <Button
              type="button"
              size="sm"
              onClick={handle_open_queue_page}
              className={`h-8 min-w-0 justify-between gap-1 px-2 text-[11px] ${capture_active || active_execution_id
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-primary/15 text-primary hover:bg-primary/25'}`}
            >
              <span className="inline-flex min-w-0 items-center gap-1">
                {execution_async.status === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
                <span className="truncate">Queue</span>
              </span>
              <Badge variant="secondary" className="h-5 shrink-0 rounded-md bg-background/80 px-1.5 text-[10px] text-foreground">
                {total_count ? `${done_count}/${total_count}` : '0'}
              </Badge>
            </Button>
          </div>
        </div>

        {execution_focus_text ? (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {execution_focus_text}
          </p>
        ) : null}
        {running_count > 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Live execution is active. Open queue for detailed step-by-step updates.
          </p>
        ) : null}

        {error_message ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
            <TriangleAlert className="h-3 w-3" />
            {error_message}
          </p>
        ) : null}

        {workflow && workflow_async.status === 'loading' ? (
          <div className="mt-2">
            <Progress value={60} className="h-1 bg-muted/70 [&>div]:animate-pulse" />
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 sm:p-3">
        <div className="space-y-3">
          <section className="rounded-xl border border-border/70 bg-background/80 p-2.5">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg bg-emerald-500/10 px-2.5 py-2 text-left"
              onClick={() => set_executed_open((prev) => !prev)}
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Executed prompts</p>
              <span className="flex items-center gap-1.5">
                <Badge variant="outline" className="border-border/80 text-foreground">{sorted_executed_prompts.length}</Badge>
                {executed_open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </span>
            </button>

            {executed_open ? (
              <div className="mt-2 space-y-2">
                {!workflow && workflow_async.status === 'loading' ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full bg-muted" />
                    <Skeleton className="h-16 w-full bg-muted" />
                    <Skeleton className="h-16 w-full bg-muted" />
                  </div>
                ) : null}

                {workflow && sorted_executed_prompts.length === 0 ? (
                  <div className="rounded-md border border-border bg-background/80 p-3">
                    <p className="text-xs text-foreground">Type your first prompt in ChatGPT, Claude, or Perplexity to start listening.</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">How it works: once a response finishes, we capture AI searched keywords and crawled websites automatically.</p>
                  </div>
                ) : null}

                <div className="space-y-1">
                  {sorted_executed_prompts.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handle_open_prompt_detail(item.id)}
                      className="w-full rounded-md border border-border bg-background/80 px-2 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/10"
                      title="View details"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-xs text-foreground">{item.text}</p>
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <ProviderBadge provider={item.provider} />
                        <Badge variant="outline" className="border-border/80 text-muted-foreground">{item.status}</Badge>
                        <Badge variant="outline" className="border-border/80 text-muted-foreground">{item.searchedKeywords.length} keywords</Badge>
                        <Badge variant="outline" className="border-border/80 text-muted-foreground">{item.crawledWebsites.length} websites</Badge>
                        <Badge variant="outline" className="border-border/80 text-muted-foreground">{format_date(item.lastExecutionAt)}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-border/70 bg-background/80 p-2.5">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg bg-sky-500/10 px-2.5 py-2 text-left"
              onClick={() => set_suggested_open((prev) => !prev)}
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Suggested prompts</p>
              <span className="flex items-center gap-1.5">
                <Badge variant="outline" className="border-border/80 text-foreground">{workflow?.promptCandidates.length ?? 0}</Badge>
                {suggested_open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </span>
            </button>

            {suggested_open ? (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Add manual prompt"
                    value={manual_prompt_text}
                    onChange={(event) => set_manual_prompt_text(event.target.value)}
                    className="h-8 text-xs"
                  />
                  <Button className="h-8 px-3 text-xs" onClick={() => void handle_add_manual_prompt()}>
                    Add manual
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => set_selected_by_id(Object.fromEntries((workflow?.promptCandidates ?? []).map((item) => [item.id, true])))}
                    disabled={Boolean(active_execution_id) || !(workflow?.promptCandidates.length ?? 0)}
                  >
                    Select all
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => set_selected_by_id(Object.fromEntries((workflow?.promptCandidates ?? []).map((item) => [item.id, false])))}
                    disabled={Boolean(active_execution_id) || !(workflow?.promptCandidates.length ?? 0)}
                  >
                    Deselect all
                  </Button>
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => void handle_open_fire_dialog()}
                    disabled={!bridge_status.connected || Boolean(active_execution_id) || !selected_prompt_ids.length}
                  >
                    Fire selected
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8"
                    onClick={() => void regenerate_suggestions(false)}
                    disabled={suggestions_async.status === 'loading' || Boolean(active_execution_id) || !(workflow?.executedPrompts.length ?? 0)}
                  >
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8"
                    onClick={() => void regenerate_suggestions(true)}
                    disabled={suggestions_async.status === 'loading' || Boolean(active_execution_id) || !(workflow?.executedPrompts.length ?? 0)}
                  >
                    Load more
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8"
                    onClick={() => void handle_update()}
                    disabled={!bridge_status.connected || Boolean(active_execution_id) || !(workflow?.executedPrompts.length ?? 0)}
                  >
                    Update (new version)
                  </Button>
                </div>

                {suggestions_async.status === 'loading' && suggestion_mode === 'regenerate' ? (
                  <div className="space-y-1">
                    <Skeleton className="h-14 w-full bg-muted" />
                    <Skeleton className="h-14 w-full bg-muted" />
                    <Skeleton className="h-14 w-full bg-muted" />
                    <Skeleton className="h-14 w-full bg-muted" />
                    <Skeleton className="h-14 w-full bg-muted" />
                  </div>
                ) : (
                  <div className="space-y-1">
                    {(workflow?.promptCandidates.length ?? 0) === 0 ? <p className="px-1 text-xs text-muted-foreground">No suggested prompts yet.</p> : null}

                    {visible_suggested_prompts.map((prompt) => (
                      <PromptCandidateRow
                        key={prompt.id}
                        prompt={prompt}
                        selected={selected_by_id[prompt.id] ?? prompt.selected}
                        onToggle={(selected) => void update_prompt_selection(prompt.id, selected)}
                      />
                    ))}

                    {suggestions_async.status === 'loading' && suggestion_mode === 'append' ? (
                      <>
                        <Skeleton className="h-14 w-full bg-muted" />
                        <Skeleton className="h-14 w-full bg-muted" />
                      </>
                    ) : null}

                    {(workflow?.promptCandidates.length ?? 0) > suggested_visible_count ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-full text-[11px]"
                        onClick={() => set_suggested_visible_count((count) => count + 10)}
                      >
                        Show more from current list
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </section>

          {workflow?.warnings?.length ? (
            <section className="rounded-xl border border-destructive/40 bg-destructive/10 p-2">
              {workflow.warnings.map((warning, index) => (
                <p key={`${warning}-${index}`} className="text-xs text-destructive">{warning}</p>
              ))}
            </section>
          ) : null}
        </div>
      </div>

      <Dialog open={fire_dialog_open} onOpenChange={set_fire_dialog_open}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Choose LLMs to Fire</DialogTitle>
            <DialogDescription>
              Select one or more LLMs. Each selected prompt will run on each selected LLM sequentially.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="rounded-md border border-border bg-background/70 p-2">
              {FIRE_PROVIDER_OPTIONS.map((provider) => (
                <label key={provider} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/40">
                  <Checkbox
                    checked={selected_fire_providers[provider]}
                    onCheckedChange={(selected) => update_fire_provider_selection(provider, selected)}
                  />
                  <ProviderBadge provider={provider} />
                </label>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => set_selected_fire_providers({ chatgpt: true, claude: true, perplexity: true, grok: true })}
              >
                Select all LLMs
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => set_selected_fire_providers({ chatgpt: false, claude: false, perplexity: false, grok: false })}
              >
                Clear LLMs
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Queue size: {selected_prompt_ids.length} prompts × {selected_fire_provider_list.length} LLMs = {selected_prompt_ids.length * selected_fire_provider_list.length} runs
            </p>

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => set_fire_dialog_open(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={!selected_fire_provider_list.length || Boolean(active_execution_id) || !bridge_status.connected}
                onClick={() => void handle_confirm_fire_selected()}
              >
                Fire now
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PromptCandidateRow(props: {
  prompt: PromptCandidate;
  selected: boolean;
  onToggle: (selected: boolean) => void;
}) {
  const { prompt, selected, onToggle } = props;

  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background/80 px-2 py-2 transition-colors hover:border-primary/50 hover:bg-primary/10">
      <Checkbox
        className="mt-1"
        checked={selected}
        onCheckedChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs text-foreground">{prompt.text}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge
            variant={prompt.source === 'manual' ? 'secondary' : 'outline'}
            className={prompt.source === 'manual' ? 'bg-primary/15 text-primary' : 'border-border/80 text-muted-foreground'}
          >
            {prompt.source === 'manual' ? 'manual' : 'auto'}
          </Badge>
          <Badge variant="outline" className="border-border/80 text-muted-foreground">{prompt.status}</Badge>
          {prompt.lastExecutionAt ? <Badge variant="outline" className="border-border/80 text-muted-foreground">{format_date(prompt.lastExecutionAt)}</Badge> : null}
        </div>
      </div>
    </label>
  );
}
