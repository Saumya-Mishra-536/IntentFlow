import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, ExternalLink, Globe, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import ProviderBadge from '@/components/ProviderBadge';
import WebsiteFavicon from '@/components/WebsiteFavicon';
import { PromptWorkflowState, analytics_api, campaign_api } from '@/lib/api';

type SessionState = {
  campaign_id?: string;
  campaign_name?: string;
  version_id?: string;
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

const format_date = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

export default function PromptDetailPage() {
  const { sessionId, promptId } = useParams<{ sessionId: string; promptId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const route_state = location.state as SessionState | null;
  const campaign_id = sessionId === 'new' ? route_state?.campaign_id : sessionId;
  const [selected_version_id, set_selected_version_id] = useState<string | undefined>(
    searchParams.get('version_id') ?? route_state?.version_id,
  );

  const [workflow, set_workflow] = useState<PromptWorkflowState | null>(null);
  const [loading, set_loading] = useState(false);
  const [error_message, set_error_message] = useState('');
  const [site_queries_by_key, set_site_queries_by_key] = useState<Record<string, SiteQueryState>>({});
  const [expanded_site_url, set_expanded_site_url] = useState<string | null>(null);
  const [live_polite, set_live_polite] = useState('');
  const [live_assertive, set_live_assertive] = useState('');

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

  const load_workflow_state = useCallback(async () => {
    if (!campaign_id) return;
    set_loading(true);
    set_error_message('');
    try {
      const payload = await campaign_api.get_workflow_state(campaign_id, { version_id: selected_version_id });
      set_workflow(payload);
      const resolved_version_id = payload.version?.id;
      if (!selected_version_id && resolved_version_id) {
        set_selected_version_id(resolved_version_id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load prompt details';
      set_workflow(null);
      set_error_message(message);
      announce_error(message);
    } finally {
      set_loading(false);
    }
  }, [announce_error, campaign_id, selected_version_id]);

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

  useEffect(() => {
    if (!campaign_id || !promptId) return;
    track_event('prompt_detail_opened', {
      campaign_id,
      prompt_id: promptId,
      version_id: selected_version_id,
    });
  }, [campaign_id, promptId, selected_version_id, track_event]);

  useEffect(() => {
    void load_workflow_state();
  }, [load_workflow_state]);

  const prompt = useMemo(() => {
    if (!promptId) return null;
    return workflow?.executedPrompts.find((item) => item.id === promptId) ?? null;
  }, [workflow, promptId]);

  const fetch_site_top_queries = useCallback(async (url: string, force_refresh = false) => {
    if (!campaign_id || !selected_version_id) return;
    set_site_queries_by_key((prev) => ({
      ...prev,
      [url]: {
        ...(prev[url] ?? { rows: [] }),
        loading: true,
        error: undefined,
      },
    }));

    try {
      const payload = await campaign_api.get_site_top_queries(
        campaign_id,
        {
          targets: [url.includes('://') ? { page_url: url } : { domain: url }],
          country: 'IN',
          limit: 10,
          forceRefresh: force_refresh,
        },
        { version_id: selected_version_id },
      );
      const row = payload.results[0];
      set_site_queries_by_key((prev) => ({
        ...prev,
        [url]: {
          loading: false,
          rows: row?.top_queries ?? [],
          cached: row?.cached,
          provider: row?.provider,
          fetchedAt: row?.fetched_at,
          error: row?.error,
        },
      }));

      track_event('site_queries_fetched', {
        campaign_id,
        version_id: selected_version_id,
        prompt_id: promptId,
        url,
        cached: row?.cached ?? false,
        provider: row?.provider ?? null,
        rows: row?.top_queries?.length ?? 0,
        force_refresh,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch top queries';
      set_site_queries_by_key((prev) => ({
        ...prev,
        [url]: {
          ...(prev[url] ?? { rows: [] }),
          loading: false,
          error: message,
        },
      }));
      announce_error(message);
      track_event('run_failed', {
        campaign_id,
        version_id: selected_version_id,
        prompt_id: promptId,
        scope: 'site_queries',
        url,
        error: message,
      });
    }
  }, [announce_error, campaign_id, promptId, selected_version_id, track_event]);

  const handle_toggle_site = useCallback((url: string) => {
    set_expanded_site_url((current) => {
      const next = current === url ? null : url;
      if (!next) return next;

      const query_state = site_queries_by_key[url];
      const needs_fetch =
        !query_state
        || (!query_state.loading
          && query_state.rows.length === 0
          && !query_state.fetchedAt
          && !query_state.error
          && query_state.cached === undefined);
      if (needs_fetch) {
        void fetch_site_top_queries(url);
        announce_polite('Fetching top queries for selected website.');
      }
      return next;
    });
  }, [announce_polite, fetch_site_top_queries, site_queries_by_key]);

  const handle_back = useCallback(() => {
    if (sessionId) {
      const version_query = selected_version_id ? `?version_id=${encodeURIComponent(selected_version_id)}` : '';
      navigate(`/visualization/${sessionId}${version_query}`, {
        state: {
          campaign_id,
          campaign_name: route_state?.campaign_name,
          version_id: selected_version_id,
        } satisfies SessionState,
      });
      return;
    }
    navigate('/dashboard');
  }, [campaign_id, navigate, route_state?.campaign_name, selected_version_id, sessionId]);

  if (!campaign_id || !promptId) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Prompt details are unavailable.</p>
      </div>
    );
  }

  return (
    <section className="relative flex h-dvh w-full flex-col overflow-hidden border border-border/60 bg-gradient-to-br from-background via-background to-primary/10 sm:rounded-xl">
      <div className="sr-only" aria-live="polite" aria-atomic="true">{live_polite}</div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">{live_assertive}</div>

      <header className="sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b border-border/70 bg-background/95 px-3 py-2 backdrop-blur">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handle_back}>
          Back
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">Prompt details</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {route_state?.campaign_name ?? 'Campaign'} · version {workflow?.version?.version_number ?? '-'}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void load_workflow_state()} disabled={loading}>
          Refresh workflow
        </Button>
      </header>

      {error_message ? <p className="px-3 pt-2 text-xs text-destructive">{error_message}</p> : null}

      <div className="min-h-0 flex-1 overflow-auto p-2.5 sm:p-3">
        {loading && !workflow ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full bg-muted" />
            <Skeleton className="h-20 w-full bg-muted" />
            <Skeleton className="h-40 w-full bg-muted" />
          </div>
        ) : null}

        {!loading && workflow && !prompt ? (
          <div className="rounded-lg border border-border bg-background/90 p-4">
            <p className="text-sm font-medium text-foreground">Prompt not found in this version.</p>
            <p className="mt-1 text-xs text-muted-foreground">Select another version or return to workflow.</p>
          </div>
        ) : null}

        {prompt ? (
          <div className="space-y-3">
            <section className="rounded-lg border border-border bg-background/85 p-3">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Executed prompt</p>
              <p className="mt-1 text-sm font-medium text-foreground">{prompt.text}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <ProviderBadge provider={prompt.provider} />
                <Badge variant="outline" className="border-border/80 text-muted-foreground">{prompt.status}</Badge>
                <Badge variant="outline" className="border-border/80 text-muted-foreground">{format_date(prompt.lastExecutionAt)}</Badge>
                <Badge variant="outline" className="border-border/80 text-muted-foreground">{prompt.searchedKeywords.length} keywords</Badge>
                <Badge variant="outline" className="border-border/80 text-muted-foreground">{prompt.crawledWebsites.length} websites</Badge>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-background/85 p-3">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">AI searched keywords</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {prompt.searchedKeywords.length === 0 ? <p className="text-xs text-muted-foreground">No keywords captured.</p> : null}
                {prompt.searchedKeywords.map((item) => (
                  <Badge key={item.query} variant="secondary" className="bg-primary/15 text-primary">
                    {item.query}
                  </Badge>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-background/85 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Websites crawled by AI</p>
                <Badge variant="outline" className="border-border/80 text-muted-foreground">{prompt.crawledWebsites.length}</Badge>
              </div>

              <div className="space-y-2">
                {prompt.crawledWebsites.length === 0 ? <p className="text-xs text-muted-foreground">No websites captured.</p> : null}
                {prompt.crawledWebsites.map((site) => {
                  const is_expanded = expanded_site_url === site.url;
                  const query_state = site_queries_by_key[site.url];
                  return (
                    <div key={site.url} className="overflow-hidden rounded-md border border-border bg-background/70">
                      <button
                        type="button"
                        onClick={() => handle_toggle_site(site.url)}
                        className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-primary/10"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <WebsiteFavicon url={site.url} host={site.host} />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-foreground">{site.host}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{site.url}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {is_expanded ? (
                            <ProviderBadge provider={prompt.provider} className="border-primary/30 bg-primary/10 text-primary" />
                          ) : null}
                          <Badge variant="outline" className="shrink-0 border-border/80 text-muted-foreground">{is_expanded ? 'Hide' : 'Show'} queries</Badge>
                          {is_expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                        </div>
                      </button>

                      {is_expanded ? (
                        <div className="border-t border-border px-3 py-2">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Top queries for this website</p>
                              <ProviderBadge provider={prompt.provider} className="border-primary/30 bg-primary/10 text-primary" />
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              disabled={query_state?.loading}
                              onClick={() => void fetch_site_top_queries(site.url, true)}
                            >
                              Refresh
                            </Button>
                          </div>

                          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />{query_state?.provider ?? 'semrush'}</span>
                            {query_state?.cached !== undefined ? <span>{query_state.cached ? 'cached' : 'fresh'}</span> : null}
                            {query_state?.fetchedAt ? <span>{format_date(query_state.fetchedAt)}</span> : null}
                            <a className="inline-flex items-center gap-1 text-primary hover:underline" href={site.url} target="_blank" rel="noreferrer">
                              open
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>

                          {query_state?.loading ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching top queries...</div>
                              <Skeleton className="h-10 w-full bg-muted" />
                              <Skeleton className="h-10 w-full bg-muted" />
                              <Skeleton className="h-10 w-full bg-muted" />
                            </div>
                          ) : null}

                          {query_state?.error ? <p className="text-xs text-destructive">{query_state.error}</p> : null}

                          {!query_state?.loading && !query_state?.error ? (
                            <div className="space-y-1">
                              {(query_state?.rows ?? []).length === 0 ? (
                                <p className="text-xs text-muted-foreground">No top queries available.</p>
                              ) : (
                                (query_state?.rows ?? []).map((row, index) => (
                                  <div key={`${site.url}-${row.query}-${index}`} className="grid grid-cols-1 gap-1.5 rounded border border-border bg-background/80 px-2 py-1.5 text-[11px] sm:grid-cols-12 sm:gap-2">
                                    <p className="text-foreground sm:col-span-6 sm:truncate">{row.query}</p>
                                    <p className="text-muted-foreground sm:col-span-2 sm:text-right">
                                      <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/80 sm:hidden">Vol</span>
                                      {row.volume ?? '-'}
                                    </p>
                                    <p className="text-muted-foreground sm:col-span-2 sm:text-right">
                                      <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/80 sm:hidden">Traffic</span>
                                      {row.traffic ?? '-'}
                                    </p>
                                    <p className="text-muted-foreground sm:col-span-2 sm:text-right">{format_date(row.sourceTimestamp)}</p>
                                  </div>
                                ))
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            {prompt.placesFound.length ? (
              <section className="rounded-lg border border-border bg-background/85 p-3">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Places found</p>
                <div className="mt-2 space-y-1">
                  {prompt.placesFound.map((place, index) => (
                    <div key={`${place.name}-${index}`} className="rounded border border-border bg-background/70 px-2 py-1.5">
                      <p className="text-xs font-medium text-foreground">{place.name}</p>
                      <p className="text-[11px] text-muted-foreground">{place.address ?? '-'}</p>
                      <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                        <span>rating {place.rating ?? '-'}</span>
                        <span>reviews {place.reviewCount ?? '-'}</span>
                        <span>{place.category ?? '-'}</span>
                        {place.websiteUrl ? (
                          <a className="inline-flex items-center gap-1 text-primary hover:underline" href={place.websiteUrl} target="_blank" rel="noreferrer">
                            site <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
