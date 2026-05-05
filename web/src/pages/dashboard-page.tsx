import { useMemo, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { AppLayoutContext } from './app-layout';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { NewCampaignDialog } from '@/shared/components/new-campaign-dialog';
import { ArrowUpDown, FolderOpen, ListTree, Loader2, Plus, SlidersHorizontal, X } from 'lucide-react';
import { AnalyticsRange } from '@/shared/lib/auth';
import { useDashboardAnalytics } from '@/features/analytics/hooks/useDashboardAnalytics';
import { D3CardFrame } from '@/shared/components/d3/D3CardFrame';
import { LineTrendChart } from '@/features/analytics/charts/LineTrendChart';
import { ScatterOpportunityChart } from '@/features/analytics/charts/ScatterOpportunityChart';
import { RankBarChart } from '@/features/analytics/charts/RankBarChart';

function formatDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

const freshness_bucket_for = (value?: string | null): 'pending' | '0_24h' | '1_3d' | '3_7d' | '7d_plus' => {
  if (!value) return 'pending';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'pending';
  const age = Date.now() - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (age <= day) return '0_24h';
  if (age <= 3 * day) return '1_3d';
  if (age <= 7 * day) return '3_7d';
  return '7d_plus';
};

const provider_colors: Record<string, string> = {
  chatgpt: '#3b82f6',
  claude: '#fb923c',
  gemini: '#60a5fa',
  perplexity: '#14b8a6',
  grok: '#a78bfa',
  unknown: '#64748b',
};

export default function DashboardPage() {
  const { projectsData: campaignsData, domains } = useOutletContext<AppLayoutContext>();
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const range = (searchParams.get('d_range') as AnalyticsRange | null) ?? '30d';
  const campaignFilter = searchParams.get('d_campaign');
  const freshnessFilter = searchParams.get('d_freshness') as ('pending' | '0_24h' | '1_3d' | '3_7d' | '7d_plus' | null);
  const providerFilter = searchParams.get('d_provider');

  const { data: analytics, loading: analytics_loading } = useDashboardAnalytics(range);

  const totalNodes = campaignsData.reduce((sum, item) => sum + item.project.total_nodes, 0);
  const totalRoots = campaignsData.reduce((sum, item) => sum + (item.project.root_prompt_count ?? 0), 0);

  const sortedCampaigns = [...campaignsData].sort(
    (a, b) => new Date(b.project.updated_at).getTime() - new Date(a.project.updated_at).getTime(),
  );

  const health_by_campaign = useMemo(() => {
    const map = new Map<string, NonNullable<typeof analytics>['health_matrix'][number]>();
    for (const row of analytics?.health_matrix ?? []) {
      map.set(row.campaign_id, row);
    }
    return map;
  }, [analytics]);

  const momentum_series = useMemo(() => {
    if (!analytics) return [];
    const providers: Array<'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'unknown'> = ['chatgpt', 'claude', 'gemini', 'perplexity', 'grok', 'unknown'];
    return providers.map((provider) => ({
      key: provider,
      color: provider_colors[provider],
      values: analytics.momentum.map((item) => ({ x: item.date, y: item[provider] })),
    }));
  }, [analytics]);

  const filtered_campaigns = sortedCampaigns.filter(({ project }) => {
    if (campaignFilter && project.id !== campaignFilter) return false;
    const health = health_by_campaign.get(project.id);
    if (freshnessFilter && freshness_bucket_for(health?.last_execution_at) !== freshnessFilter) return false;
    if (providerFilter && health && (health.provider_totals[providerFilter as keyof typeof health.provider_totals] ?? 0) <= 0) return false;
    return true;
  });

  const set_filter = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <section className="dashboard-surface overflow-hidden rounded-xl">
        <div className="flex flex-col gap-4 border-b border-border/70 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">All Campaigns</h1>
            <p className="mt-1 text-xs text-muted-foreground">Manage campaign trees from a single workspace table</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filter
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5" />
              Sort
            </Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setNewCampaignOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New Campaign
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 border-b border-border/70 bg-muted/10 p-3 md:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Campaigns</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{campaignsData.length}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Nodes</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{totalNodes}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Root Prompts</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{totalRoots}</p>
          </div>
        </div>

        <div className="border-b border-border/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-1 py-1">
              {(['7d', '30d', 'all'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`rounded px-2 py-1 text-[10px] ${range === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'}`}
                  onClick={() => set_filter('d_range', value)}
                >
                  {value}
                </button>
              ))}
            </div>
            {analytics_loading ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading analytics
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
            <D3CardFrame title="Campaign Momentum" subtitle="Executed prompts by provider" heightClassName="h-[180px]">
              <LineTrendChart
                series={momentum_series}
                activeKey={providerFilter}
                onSelectSeries={(key) => set_filter('d_provider', providerFilter === key ? null : key)}
              />
            </D3CardFrame>

            <D3CardFrame title="Campaign Health Matrix" subtitle="x: executed • y: fetched ratio" heightClassName="h-[180px]">
              <ScatterOpportunityChart
                points={(analytics?.health_matrix ?? []).map((row) => ({
                  id: row.campaign_id,
                  label: row.campaign_name,
                  x: row.executed_prompts,
                  y: Math.round(row.fetched_ratio * 100),
                  size: row.total_nodes,
                  color: '#f59e0b',
                }))}
                activeId={campaignFilter}
                onSelect={(id) => set_filter('d_campaign', campaignFilter === id ? null : id)}
              />
            </D3CardFrame>

            <D3CardFrame title="Version Freshness" subtitle="Campaign count by recency" heightClassName="h-[180px]">
              <RankBarChart
                color="#10b981"
                rows={(analytics?.freshness_buckets ?? []).map((bucket) => ({
                  id: bucket.bucket,
                  label: bucket.bucket,
                  value: bucket.count,
                }))}
                activeId={freshnessFilter}
                onSelect={(id) => set_filter('d_freshness', freshnessFilter === id ? null : id)}
              />
            </D3CardFrame>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-border/70 px-3 py-1.5">
          {campaignFilter ? (
            <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px]">
              campaign
              <button type="button" onClick={() => set_filter('d_campaign', null)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ) : null}
          {freshnessFilter ? (
            <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px]">
              freshness {freshnessFilter}
              <button type="button" onClick={() => set_filter('d_freshness', null)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ) : null}
          {providerFilter ? (
            <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px]">
              provider {providerFilter}
              <button type="button" onClick={() => set_filter('d_provider', null)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow className="border-border/70 bg-muted/10 hover:bg-muted/10">
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[120px]">Nodes</TableHead>
                <TableHead className="w-[140px]">Root Prompts</TableHead>
                <TableHead className="w-[150px]">Updated</TableHead>
                <TableHead className="w-[220px] text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered_campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                    No campaigns match current analytics filters.
                  </TableCell>
                </TableRow>
              )}
              {filtered_campaigns.map(({ project: campaign }) => (
                <TableRow key={campaign.id} className="border-border/60 hover:bg-muted/20">
                  <TableCell className="pl-4 font-medium">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate">{campaign.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[320px]">
                    <p className="truncate text-muted-foreground">{campaign.description || 'No description'}</p>
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">{campaign.total_nodes}</TableCell>
                  <TableCell className="tabular-nums">{campaign.root_prompt_count ?? 0}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(campaign.updated_at)}</TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-2">
                      <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                        <Link to={`/campaign/${campaign.id}/list`}>
                          <ListTree className="h-3.5 w-3.5" />
                          Open
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <NewCampaignDialog open={newCampaignOpen} onOpenChange={setNewCampaignOpen} domains={domains} />
    </>
  );
}
