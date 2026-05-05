import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { NewCampaignDialog } from '@/shared/components/new-campaign-dialog';
import { AppLayoutContext } from './app-layout';
import { auth_storage, get_domain_context, rescrape_domain } from '@/shared/lib/auth';
import { Building2, Globe, Lightbulb, Loader2, RefreshCw, Target, Users } from 'lucide-react';
import { toast } from 'sonner';

const status_label: Record<string, string> = {
  queued: 'Queued',
  running: 'Scraping',
  completed: 'Ready',
  failed: 'Failed',
};

type DomainSection = {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  keys: string[];
};

const DOMAIN_SECTIONS: DomainSection[] = [
  { id: 'business', title: 'Business Context', icon: Building2, keys: ['business', 'company', 'brand', 'about'] },
  { id: 'market', title: 'Market Context', icon: Globe, keys: ['market', 'industry', 'trend'] },
  { id: 'audience', title: 'Audience', icon: Users, keys: ['audience', 'persona', 'customer', 'user'] },
  { id: 'goals', title: 'Goals & Positioning', icon: Target, keys: ['goal', 'position', 'value', 'offer'] },
  { id: 'offerings', title: 'Products & Services', icon: Building2, keys: ['product', 'service', 'offering'] },
  { id: 'opportunities', title: 'Opportunities', icon: Lightbulb, keys: ['opportun', 'gap', 'keyword', 'seo', 'insight'] },
  { id: 'risks', title: 'Risks & Messaging', icon: Lightbulb, keys: ['risk', 'messaging'] },
];

const to_readable = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const normalize_text = (value: string) => value.toLowerCase().replace(/[_-]+/g, ' ');

const object_entries = (value: unknown): Array<[string, unknown]> =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];

const to_record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const flatten_to_strings = (value: unknown, max = 6): string[] => {
  if (!value) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => flatten_to_strings(item, max))
      .filter(Boolean)
      .slice(0, max);
  }
  const entries = object_entries(value)
    .flatMap(([key, nested]) => {
      if (typeof nested === 'string' && nested.trim()) return [`${key}: ${nested.trim()}`];
      if (typeof nested === 'number' || typeof nested === 'boolean') return [`${key}: ${String(nested)}`];
      if (Array.isArray(nested)) return nested.flatMap((item) => flatten_to_strings(item, max).map((row) => `${key}: ${row}`));
      return [];
    })
    .slice(0, max);
  return entries;
};

const find_section_value = (context: unknown, keys: string[]): unknown => {
  const entries = object_entries(context);
  if (!entries.length) return null;
  const matched = entries.find(([key]) => keys.some((needle) => normalize_text(key).includes(needle)));
  if (matched) return matched[1];
  return null;
};

export default function WorkspacePage() {
  const {
    domains,
    selectedDomainId,
    setSelectedDomainId,
    reloadProjectData,
  } = useOutletContext<AppLayoutContext>();
  const [new_campaign_open, setNewCampaignOpen] = useState(false);
  const [loading_context, setLoadingContext] = useState(false);
  const [rescraping, setRescraping] = useState(false);
  const [domain_context, setDomainContext] = useState<unknown>(null);

  const selected_domain = useMemo(
    () => domains.find((domain) => domain.domain_id === selectedDomainId) ?? domains[0] ?? null,
    [domains, selectedDomainId],
  );

  const load_domain_context = useCallback(async () => {
    if (!selected_domain) {
      setDomainContext(null);
      return;
    }
    const token = auth_storage.get_access_token();
    if (!token) return;

    setLoadingContext(true);
    try {
      const payload = await get_domain_context(token, selected_domain.domain_id);
      setDomainContext(payload.context ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load domain context');
    } finally {
      setLoadingContext(false);
    }
  }, [selected_domain]);

  useEffect(() => {
    void load_domain_context();
  }, [load_domain_context]);

  const handle_rescrape = async () => {
    if (!selected_domain) return;
    const token = auth_storage.get_access_token();
    if (!token) return;

    setRescraping(true);
    try {
      await rescrape_domain(token, selected_domain.domain_id);
      toast.success('Domain reanalyze started');
      await Promise.all([reloadProjectData(), load_domain_context()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reanalyze domain');
      await Promise.all([reloadProjectData(), load_domain_context()]);
    } finally {
      setRescraping(false);
    }
  };

  const section_rows = useMemo(
    () =>
      DOMAIN_SECTIONS.map((section) => {
        const value = find_section_value(domain_context, section.keys);
        return {
          ...section,
          lines: flatten_to_strings(value),
        };
      }),
    [domain_context],
  );
  const overall_summary = useMemo(() => {
    const summary = to_record(domain_context)?.summary;
    return typeof summary === 'string' && summary.trim() ? summary.trim() : '';
  }, [domain_context]);

  return (
    <div className="space-y-4">
      <Card className="border-slate-200/90 bg-gradient-to-br from-white via-slate-50/80 to-sky-50/70 dark:border-border/70 dark:from-background dark:via-background dark:to-sky-950/10">
        <CardHeader>
          <CardTitle className="text-base">Domain Intelligence</CardTitle>
          <CardDescription>Switch domain scope, review AI context, and reanalyze when needed.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 min-w-[240px] rounded-md border border-input bg-background px-2 text-xs"
            value={selected_domain?.domain_id ?? ''}
            onChange={(event) => setSelectedDomainId(event.target.value || undefined)}
          >
            {domains.map((domain) => (
              <option key={domain.domain_id} value={domain.domain_id}>
                {domain.display_domain || domain.normalized_domain}
              </option>
            ))}
          </select>
          <Badge variant="outline">{status_label[selected_domain?.scrape_status ?? ''] ?? 'Unknown'}</Badge>
          {selected_domain?.last_scraped_at ? (
            <Badge variant="outline">Last analyzed: {to_readable(selected_domain.last_scraped_at)}</Badge>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void handle_rescrape()}
            disabled={!selected_domain || rescraping}
          >
            {rescraping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Reanalyze
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setNewCampaignOpen(true)} disabled={!domains.length}>
            New Campaign
          </Button>
        </CardContent>
      </Card>

      <Card className="border-slate-200/90 bg-white/90 shadow-sm dark:border-border/70 dark:bg-background/85">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">AI Executive Summary</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading_context ? (
            <p className="text-xs text-muted-foreground">Generating domain summary...</p>
          ) : overall_summary ? (
            <p className="rounded-md bg-slate-50 px-2.5 py-2 text-xs text-slate-700 dark:bg-muted/40 dark:text-muted-foreground">
              {overall_summary}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No summary available yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {section_rows.map((section) => (
          <Card key={section.id} className="border-slate-200/90 bg-white/90 shadow-sm dark:border-border/70 dark:bg-background/85">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <section.icon className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                {section.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {loading_context ? (
                <p className="text-xs text-muted-foreground">Loading context...</p>
              ) : section.lines.length ? (
                <div className="space-y-1.5">
                  {section.lines.map((line, index) => (
                    <p key={`${section.id}-${index}`} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:bg-muted/40 dark:text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No data available yet for this section.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <NewCampaignDialog open={new_campaign_open} onOpenChange={setNewCampaignOpen} domains={domains} />
    </div>
  );
}
