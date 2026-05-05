export type DomainScrapeStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface DomainSummary {
  domain_id: string;
  normalized_domain: string;
  display_domain: string;
  source_url: string;
  scrape_status: DomainScrapeStatus;
  last_scraped_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DomainContextPayload {
  domain: DomainSummary;
  context: (Record<string, unknown> & {
    extracted_at?: Date;
    summary: string;
    key_pages: Array<{
      url: string;
      title?: string;
      description?: string;
      excerpt?: string;
    }>;
    keywords: string[];
  }) | null;
}
