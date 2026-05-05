import { SemrushKeywordMetric, SemrushSiteInsightResult, SemrushSiteInput } from '../semrush.types';

const normalize_key = (value: string): string => value.trim().toLowerCase();
const is_probable_domain = (value: string): boolean => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value.trim());

const get_string = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const to_record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parse_json_payload = (raw: unknown): Record<string, unknown> | null => {
  if (!raw) {
    return null;
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
};

const to_number = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const to_percent_number = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace('%', '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const extract_semrush_rows = (raw: unknown): Record<string, unknown>[] => {
  if (Array.isArray(raw)) {
    return raw.map((entry) => to_record(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
  const root = to_record(raw);
  if (!root) {
    return [];
  }
  if (get_string(root.keyword) || get_string(root.phrase) || get_string(root.query)) {
    return [root];
  }
  const collections = [
    root.data,
    root.output,
    root.result,
    root.payload,
    root.items,
    root.results,
    root.keywords,
    root.organic_keywords,
    root.organic,
    root.rows,
    root.records,
  ];
  for (const collection of collections) {
    if (typeof collection === 'string') {
      const parsed = parse_json_payload(collection);
      if (parsed) {
        const nested = extract_semrush_rows(parsed);
        if (nested.length) {
          return nested;
        }
      }
    }
    if (Array.isArray(collection)) {
      return collection
        .map((entry) => to_record(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
    const as_record = to_record(collection);
    if (as_record) {
      const nested = extract_semrush_rows(as_record);
      if (nested.length) {
        return nested;
      }
    }
  }
  return [];
};

const to_semrush_metric = (entry: Record<string, unknown>): SemrushKeywordMetric | null => {
  const keyword = get_string(entry.keyword) ?? get_string(entry.phrase) ?? get_string(entry.query);
  if (!keyword) {
    return null;
  }
  return {
    keyword,
    position: to_number(entry.position),
    traffic: to_number(entry.traffic),
    traffic_percent: to_percent_number(entry.traffic_percent ?? entry.trafficPercent),
    volume: to_number(entry.volume),
    keyword_difficulty: to_number(entry.keyword_difficulty ?? entry.keywordDifficulty),
    url: get_string(entry.url),
  };
};

const build_semrush_summary = (site_name: string, metrics: SemrushKeywordMetric[]): string => {
  if (!metrics.length) {
    return `No SEMrush keyword metrics returned for ${site_name}.`;
  }
  const lines = metrics.slice(0, 3).map((item) => {
    const parts = [
      item.traffic_percent !== undefined ? `${item.traffic_percent.toFixed(2)}% share` : undefined,
      item.volume !== undefined ? `vol ${Math.round(item.volume)}` : undefined,
      item.keyword_difficulty !== undefined ? `kd ${Math.round(item.keyword_difficulty)}` : undefined,
    ].filter((part): part is string => Boolean(part));
    return `${item.keyword}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  });
  return `Top keywords sorted by traffic share: ${lines.join('; ')}`;
};

const fetch_semrush_metrics_for_site = async (params: {
  semrush_url: string;
  site_name: string;
  site_url?: string;
  seed_keyword?: string;
}): Promise<SemrushKeywordMetric[]> => {
  let domain: string | undefined = undefined;
  if (params.site_url) {
    try {
      domain = new URL(params.site_url).hostname.replace(/^www\./, '');
    } catch {
      domain = undefined;
    }
  } else if (is_probable_domain(params.site_name)) {
    domain = params.site_name.trim().replace(/^www\./, '');
  }

  const semrush_url = new URL(params.semrush_url);
  if (domain) {
    semrush_url.searchParams.set('domain', domain);
  }
  if (params.seed_keyword) {
    semrush_url.searchParams.set('query', params.seed_keyword);
    semrush_url.searchParams.set('keyword', params.seed_keyword);
  }
  semrush_url.searchParams.set('site_name', params.site_name);
  if (params.site_url) {
    semrush_url.searchParams.set('site_url', params.site_url);
    semrush_url.searchParams.set('url', params.site_url);
  }

  const response = await fetch(semrush_url.toString(), {
    method: 'GET',
  });

  if (!response.ok) {
    return [];
  }

  const raw_text = await response.text();
  let raw: unknown = null;
  try {
    raw = JSON.parse(raw_text) as unknown;
  } catch {
    return [];
  }

  return extract_semrush_rows(raw)
    .map((entry) => to_semrush_metric(entry))
    .filter((entry): entry is SemrushKeywordMetric => Boolean(entry))
    .sort((a, b) => {
      const traffic_share = (b.traffic_percent ?? 0) - (a.traffic_percent ?? 0);
      if (traffic_share !== 0) {
        return traffic_share;
      }
      const traffic = (b.traffic ?? 0) - (a.traffic ?? 0);
      if (traffic !== 0) {
        return traffic;
      }
      return (b.volume ?? 0) - (a.volume ?? 0);
    });
};

export const fetch_semrush_site_insights = async (params: {
  semrush_url: string;
  sites: SemrushSiteInput[];
  latest_prompt?: string;
}): Promise<SemrushSiteInsightResult[]> => {
  const unique_sites = params.sites
    .map((item) => {
      if (item.site_url) {
        try {
          return {
            ...item,
            normalized_site: new URL(item.site_url).hostname.replace(/^www\./, ''),
          };
        } catch {
          return {
            ...item,
            normalized_site: item.site_name,
          };
        }
      }
      return {
        ...item,
        normalized_site: item.site_name,
      };
    })
    .reduce<Array<{ site_name: string; site_url?: string; normalized_site: string }>>((acc, item) => {
      if (acc.some((existing) => normalize_key(existing.normalized_site) === normalize_key(item.normalized_site))) {
        return acc;
      }
      acc.push(item);
      return acc;
    }, [])
    .slice(0, 10);

  const site_results = await Promise.all(
    unique_sites.map(async (site) => {
      const metrics = await fetch_semrush_metrics_for_site({
        semrush_url: params.semrush_url,
        site_name: site.site_name,
        site_url: site.site_url,
        seed_keyword: params.latest_prompt,
      });
      const ranking_keywords = metrics.slice(0, 12).map((metric) => metric.keyword);
      const average_traffic_share =
        metrics.length > 0
          ? metrics.reduce((sum, metric) => sum + (metric.traffic_percent ?? 0), 0) / metrics.length
          : 0;
      const confidence_score = Math.min(0.95, Math.max(0.25, average_traffic_share / 100));

      return {
        source: 'semrush',
        site_name: site.site_name,
        site_url: site.site_url ?? metrics.find((metric) => metric.url)?.url,
        ranking_keywords,
        confidence_score,
        summary: build_semrush_summary(site.site_name, metrics),
        keyword_metrics: metrics.slice(0, 15),
      } satisfies SemrushSiteInsightResult;
    }),
  );

  return site_results.filter((item) => item.ranking_keywords.length > 0 || item.keyword_metrics.length > 0);
};
