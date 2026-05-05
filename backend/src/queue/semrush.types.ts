export interface SemrushSiteInput {
  site_name: string;
  site_url?: string;
}

export interface SemrushKeywordMetric {
  keyword: string;
  position?: number;
  traffic?: number;
  traffic_percent?: number;
  volume?: number;
  keyword_difficulty?: number;
  url?: string;
}

export interface SemrushSiteInsightResult {
  source?: 'semrush' | 'ahrefs';
  site_name: string;
  site_url?: string;
  ranking_keywords: string[];
  confidence_score?: number;
  summary?: string;
  keyword_metrics: SemrushKeywordMetric[];
}

export interface SemrushInsightsJobPayload {
  tenant_id: string;
  project_id: string;
  generation_run_id: string;
  semrush_url: string;
  latest_prompt?: string;
  sites: SemrushSiteInput[];
}

export interface AhrefsInsightsJobPayload {
  tenant_id: string;
  project_id: string;
  generation_run_id: string;
  ahrefs_url: string;
  latest_prompt?: string;
  sites: SemrushSiteInput[];
}
