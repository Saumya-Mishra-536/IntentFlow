import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, ListChecks, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import ProviderBadge from '@/components/ProviderBadge';
import { PromptWorkflowState, ai_chat_provider, campaign_api } from '@/lib/api';
import { ExecutionPhase, phase_to_copy } from '@/lib/workflow-view-model';

type QueueStatus = 'queued' | 'running' | 'completed' | 'failed';

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
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (is_same_day) return `Today at ${time}`;
  if (is_yesterday) return `Yesterday at ${time}`;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const queue_status_copy = (status: QueueStatus): { label: string; className: string } => {
  if (status === 'running') return { label: 'Running', className: 'border-primary/35 bg-primary/15 text-primary' };
  if (status === 'completed') return { label: 'Completed', className: 'border-success/40 bg-success/15 text-success' };
  if (status === 'failed') return { label: 'Failed', className: 'border-destructive/40 bg-destructive/15 text-destructive' };
  return { label: 'Queued', className: 'border-border/70 bg-background/70 text-muted-foreground' };
};

const as_exec_provider = (value: ai_chat_provider): 'chatgpt' | 'claude' | 'perplexity' | 'grok' => {
  if (value === 'claude' || value === 'perplexity' || value === 'grok') return value;
  return 'chatgpt';
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
  if (!runtime || typeof runtime.sendMessage !== 'function') return null;
  return runtime;
};

const try_extension_bridge = async (message: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: unknown }> => {
  const runtime = get_extension_runtime();
  if (!runtime) return { ok: false, error: 'Extension bridge unavailable in this browser context.' };

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

export default function WorkflowQueuePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const route_state = location.state as SessionState | null;
  const campaign_id = sessionId === 'new' ? route_state?.campaign_id : sessionId;
  const [campaign_name, set_campaign_name] = useState(route_state?.campaign_name ?? 'Campaign Workflow');
  const [selected_version_id, set_selected_version_id] = useState<string | undefined>(
    searchParams.get('version_id') ?? route_state?.version_id,
  );

  const [workflow, set_workflow] = useState<PromptWorkflowState | null>(null);
  const [workflow_loading, set_workflow_loading] = useState(false);
  const [error_message, set_error_message] = useState('');
  const [bridge_status, set_bridge_status] = useState<{ connected: boolean; message: string }>({
    connected: false,
    message: 'Checking extension bridge...',
  });

  const [active_execution_id, set_active_execution_id] = useState<string | null>(null);
  const [execution_queue, set_execution_queue] = useState<ExecutionQueueItem[]>([]);
  const [execution_finished_at, set_execution_finished_at] = useState<string | null>(null);
  const [executed_open, set_executed_open] = useState(true);
  const [suggested_open, set_suggested_open] = useState(false);

  const execution_queue_ref = useRef<ExecutionQueueItem[]>([]);
  const queue_storage_key = useMemo(
    () => (campaign_id ? `ai_seo_workflow_queue:${campaign_id}` : null),
    [campaign_id],
  );

  useEffect(() => {
    execution_queue_ref.current = execution_queue;
  }, [execution_queue]);

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const current = next.get('version_id');
      if (!selected_version_id) {
        if (!current) return prev;
        next.delete('version_id');
        return next;
      }
      if (current === selected_version_id) return prev;
      next.set('version_id', selected_version_id);
      return next;
    }, { replace: true });
  }, [selected_version_id, setSearchParams]);

  const load_workflow_state = useCallback(async () => {
    if (!campaign_id) return;
    set_workflow_loading(true);
    set_error_message('');
    try {
      const payload = await campaign_api.get_workflow_state(campaign_id, { version_id: selected_version_id });
      set_workflow(payload);
      set_campaign_name(payload.version ? campaign_name : (route_state?.campaign_name ?? campaign_name));
      if (!selected_version_id && payload.version?.id) {
        set_selected_version_id(payload.version.id);
      }
    } catch (error) {
      set_workflow(null);
      set_error_message(error instanceof Error ? error.message : 'Failed to load workflow');
    } finally {
      set_workflow_loading(false);
    }
  }, [campaign_id, campaign_name, route_state?.campaign_name, selected_version_id]);

  useEffect(() => {
    void load_workflow_state();
  }, [load_workflow_state]);

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
      if (Array.isArray(parsed.queue) && parsed.queue.length) set_execution_queue(parsed.queue);
      if (typeof parsed.executionId === 'string') set_active_execution_id(parsed.executionId);
      if (typeof parsed.finishedAt === 'string') set_execution_finished_at(parsed.finishedAt);
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
    const running_count = typeof data.runningCount === 'number' ? data.runningCount : 0;
    const total_count = typeof data.totalCount === 'number' ? data.totalCount : 0;
    if (is_running && execution_id) set_active_execution_id((prev) => prev ?? execution_id);

    set_bridge_status({
      connected: true,
      message: is_running ? `Execution in progress${total_count ? ` ${Math.max(running_count, 1)}/${total_count}` : ''}` : 'Bridge connected · listener active',
    });
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

  useEffect(() => {
    const runtime = get_extension_runtime();
    if (!runtime?.onMessage) return;

    const listener = (message: unknown) => {
      const envelope = message && typeof message === 'object' ? (message as Record<string, unknown>) : null;
      if (!envelope) return;
      if (envelope.type !== 'AI_SEO_BRIDGE_EVENT') return;

      const event_name = typeof envelope.event === 'string' ? envelope.event : '';
      const payload = envelope.payload && typeof envelope.payload === 'object' ? (envelope.payload as Record<string, unknown>) : {};
      const execution_id = typeof payload.executionId === 'string' ? payload.executionId : null;
      if (active_execution_id && execution_id && execution_id !== active_execution_id) return;

      const prompt_index = typeof payload.promptIndex === 'number' ? payload.promptIndex : null;
      const now_iso = typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString();
      const phase = is_execution_phase(payload.phase) ? payload.phase : undefined;
      const step_message = typeof payload.stepMessage === 'string' && payload.stepMessage.trim()
        ? payload.stepMessage.trim()
        : (phase ? phase_to_copy(phase) : undefined);

      if (event_name === 'executionStarted') {
        if (execution_id) set_active_execution_id(execution_id);
        set_execution_finished_at(null);
        set_bridge_status({ connected: true, message: 'Execution started' });
        return;
      }

      if (event_name === 'promptStarted' && prompt_index !== null) {
        const prompt_text = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
        const provider = as_exec_provider((typeof payload.provider === 'string' ? payload.provider : 'chatgpt') as ai_chat_provider);
        const resolved_phase = phase ?? 'open_tab';
        const resolved_step = step_message ?? phase_to_copy(resolved_phase);

        set_execution_queue((prev) => {
          const existing_index = prev.findIndex((item) => item.index === prompt_index);
          if (existing_index === -1) {
            const row: ExecutionQueueItem = {
              text: prompt_text || `Prompt ${prompt_index + 1}`,
              provider,
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
        set_execution_queue((prev) => {
          const has_row = prev.some((item) => item.index === prompt_index);
          if (!has_row) {
            const row: ExecutionQueueItem = {
              text: typeof payload.prompt === 'string' ? payload.prompt : `Prompt ${prompt_index + 1}`,
              provider: as_exec_provider((typeof payload.provider === 'string' ? payload.provider : 'chatgpt') as ai_chat_provider),
              index: prompt_index,
              status: 'completed',
              phase: 'complete',
              stepMessage: 'Completed',
              updatedAt: now_iso,
              completedAt: now_iso,
            };
            return [
              ...prev,
              row,
            ].sort((a, b) => a.index - b.index);
          }
          return prev.map((item) =>
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
          );
        });
        return;
      }

      if (event_name === 'promptFailed' && prompt_index !== null) {
        const error = typeof payload.error === 'string' ? payload.error : 'Prompt execution failed';
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
        return;
      }

      if (event_name === 'executionFinished') {
        set_active_execution_id(null);
        set_execution_finished_at(now_iso);
        set_bridge_status({ connected: true, message: 'Execution finished' });
        void load_workflow_state();
      }
    };

    runtime.onMessage.addListener(listener);
    return () => {
      runtime.onMessage?.removeListener(listener);
    };
  }, [active_execution_id, load_workflow_state]);

  const sorted_executed_prompts = useMemo(() => {
    const rows = [...(workflow?.executedPrompts ?? [])];
    rows.sort((a, b) => new Date(b.lastExecutionAt).getTime() - new Date(a.lastExecutionAt).getTime());
    return rows;
  }, [workflow?.executedPrompts]);

  const completed_count = execution_queue.filter((item) => item.status === 'completed').length;
  const failed_count = execution_queue.filter((item) => item.status === 'failed').length;
  const running_count = execution_queue.filter((item) => item.status === 'running').length;
  const queued_count = execution_queue.filter((item) => item.status === 'queued').length;
  const total_count = execution_queue.length;
  const done_count = completed_count + failed_count;

  const handle_back = useCallback(() => {
    if (!sessionId) return navigate('/dashboard');
    const version_query = selected_version_id ? `?version_id=${encodeURIComponent(selected_version_id)}` : '';
    navigate(`/visualization/${sessionId}${version_query}`, {
      state: {
        campaign_id,
        campaign_name,
        version_id: selected_version_id,
      } satisfies SessionState,
    });
  }, [campaign_id, campaign_name, navigate, selected_version_id, sessionId]);

  const handle_open_prompt_detail = useCallback((prompt_id: string) => {
    if (!sessionId || !campaign_id) return;
    const version_query = selected_version_id ? `?version_id=${encodeURIComponent(selected_version_id)}` : '';
    navigate(`/visualization/${sessionId}/prompts/${prompt_id}${version_query}`, {
      state: {
        campaign_id,
        campaign_name,
        version_id: selected_version_id,
      } satisfies SessionState,
    });
  }, [campaign_id, campaign_name, navigate, selected_version_id, sessionId]);

  if (!campaign_id) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Campaign not available.</p>
      </div>
    );
  }

  return (
    <section className="relative flex h-dvh w-full flex-col overflow-hidden border border-border/60 bg-gradient-to-br from-background via-background to-primary/10 sm:rounded-2xl">
      <header className="sticky top-0 z-20 shrink-0 border-b border-border/80 bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex items-start gap-2">
          <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={handle_back}>
            Back
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-foreground">Execution Queue</h1>
            <p className="truncate text-[11px] text-muted-foreground">{campaign_name}</p>
          </div>
          <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => void load_workflow_state()} disabled={workflow_loading}>
            Refresh
          </Button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <Badge variant={bridge_status.connected ? 'secondary' : 'destructive'} className={bridge_status.connected ? 'bg-primary/15 text-primary' : ''}>
            {bridge_status.connected ? 'Bridge connected' : 'Bridge disconnected'}
          </Badge>
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
            <ListChecks className="mr-1 h-3.5 w-3.5" />
            {total_count ? `${done_count}/${total_count} done` : 'No queue'}
          </Badge>
          {running_count > 0 ? (
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{running_count} running</Badge>
          ) : null}
          {queued_count > 0 ? (
            <Badge variant="outline" className="border-border/80 text-muted-foreground">{queued_count} queued</Badge>
          ) : null}
          {execution_finished_at ? (
            <span className="text-muted-foreground">Finished: {format_date(execution_finished_at)}</span>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 sm:p-3">
        <div className="space-y-3">
          {error_message ? (
            <p className="flex items-center gap-1 text-xs text-destructive">
              <TriangleAlert className="h-3 w-3" />
              {error_message}
            </p>
          ) : null}

          <section className="rounded-xl border border-border/70 bg-background/80 p-2.5">
            <div className="mb-2 flex items-center justify-between rounded-lg bg-primary/10 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Queue execution</p>
              <Badge variant="outline" className="border-border/80 text-foreground">{total_count}</Badge>
            </div>

            {!execution_queue.length ? (
              <p className="px-1 text-xs text-muted-foreground">No queue found yet. Fire prompts from workflow to start tracking execution.</p>
            ) : (
              <div className="space-y-1.5">
                {execution_queue.map((item) => {
                  const status_copy = queue_status_copy(item.status);
                  return (
                    <div key={`${item.provider}-${item.index}-${item.text}`} className="rounded-lg border border-border/70 bg-background/70 px-2 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-xs text-foreground">
                          <span className="mr-1 text-muted-foreground">#{item.index + 1}</span>
                          {item.text}
                        </p>
                        <Badge variant="outline" className={status_copy.className}>{status_copy.label}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <ProviderBadge provider={item.provider} />
                        {item.stepMessage ? <span className="text-[11px] text-muted-foreground">{item.stepMessage}</span> : null}
                        {item.updatedAt ? <span className="text-[11px] text-muted-foreground">{format_date(item.updatedAt)}</span> : null}
                      </div>
                      {item.error ? <p className="mt-1 text-[11px] text-destructive">{item.error}</p> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

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
              <div className="mt-2 space-y-1">
                {workflow_loading ? (
                  <>
                    <Skeleton className="h-14 w-full bg-muted" />
                    <Skeleton className="h-14 w-full bg-muted" />
                  </>
                ) : null}
                {sorted_executed_prompts.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handle_open_prompt_detail(item.id)}
                    className="w-full rounded-md border border-border bg-background/80 px-2 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/10"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-xs text-foreground">{item.text}</p>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <ProviderBadge provider={item.provider} />
                      <Badge variant="outline" className="border-border/80 text-muted-foreground">{item.status}</Badge>
                      <Badge variant="outline" className="border-border/80 text-muted-foreground">{format_date(item.lastExecutionAt)}</Badge>
                    </div>
                  </button>
                ))}
                {!workflow_loading && sorted_executed_prompts.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground">No executed prompts yet.</p>
                ) : null}
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
              <div className="mt-2 space-y-1">
                {workflow_loading ? (
                  <>
                    <Skeleton className="h-14 w-full bg-muted" />
                    <Skeleton className="h-14 w-full bg-muted" />
                  </>
                ) : null}
                {(workflow?.promptCandidates ?? []).map((prompt) => (
                  <div key={prompt.id} className="rounded-md border border-border bg-background/80 px-2 py-2">
                    <p className="line-clamp-2 text-xs text-foreground">{prompt.text}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant={prompt.source === 'manual' ? 'secondary' : 'outline'} className={prompt.source === 'manual' ? 'bg-primary/15 text-primary' : 'border-border/80 text-muted-foreground'}>
                        {prompt.source === 'manual' ? 'manual' : 'auto'}
                      </Badge>
                      <Badge variant="outline" className="border-border/80 text-muted-foreground">{prompt.status}</Badge>
                      {prompt.lastExecutionAt ? <Badge variant="outline" className="border-border/80 text-muted-foreground">{format_date(prompt.lastExecutionAt)}</Badge> : null}
                    </div>
                  </div>
                ))}
                {!workflow_loading && (workflow?.promptCandidates.length ?? 0) === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground">No suggested prompts yet.</p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}
