import { BaseService } from '../../core/service';
import { HttpException } from '../../core/http-exception';
import { OPENAI_API_KEY, OPENAI_MODEL } from '../../config/env';
import { DomainRepository, domainRepository } from './domain.repository';
import { DomainContextPayload, DomainSummary } from './domain.model';

const SCRAPE_MAX_PAGES = 12;
const SCRAPE_PAGE_TIMEOUT_MS = 8_000;
const SCRAPE_TOTAL_TIMEOUT_MS = 45_000;
const OPENAI_TIMEOUT_MS = 20_000;
const AI_CONTEXT_MAX_CHARS = 26_000;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'to', 'in', 'of', 'for', 'on', 'at', 'is', 'are', 'with', 'and', 'or', 'from', 'by', 'that', 'this',
  'you', 'your', 'our', 'we', 'it', 'as', 'be', 'can', 'will', 'not', 'about', 'into', 'more', 'get', 'all', 'new',
]);

const KEY_PATH_HINTS = ['about', 'pricing', 'product', 'products', 'service', 'services', 'blog', 'contact', 'feature', 'features'];

interface NormalizedDomainInput {
  normalized_domain: string;
  display_domain: string;
  source_url: string;
  homepage_url: string;
}

interface ScrapedPage {
  url: string;
  title?: string;
  description?: string;
  excerpt?: string;
  text: string;
}

const normalize_domain_or_url = (value: string): NormalizedDomainInput => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpException(400, 'Domain is required');
  }
  const with_protocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(with_protocol);
  } catch {
    throw new HttpException(400, 'Invalid domain or URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpException(400, 'Only http/https domains are supported');
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.')) {
    throw new HttpException(400, 'Enter a valid domain');
  }

  const homepage_url = `${parsed.protocol}//${host}`;

  return {
    normalized_domain: host,
    display_domain: host,
    source_url: `${parsed.protocol}//${host}${parsed.pathname === '/' ? '' : parsed.pathname}`,
    homepage_url,
  };
};

const make_account_name_from_domain = (domain: string): string => {
  const root = domain.split('.')[0] ?? domain;
  const cleaned = root
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const candidate = cleaned.trim();
  return candidate.length ? `${candidate} Account` : `${domain} Account`;
};

const strip_html = (html: string): string => {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const extract_title = (html: string): string | undefined => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return undefined;
  return match[1].replace(/\s+/g, ' ').trim().slice(0, 220) || undefined;
};

const extract_meta_description = (html: string): string | undefined => {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
  if (!match?.[1]) return undefined;
  return match[1].replace(/\s+/g, ' ').trim().slice(0, 280) || undefined;
};

const extract_internal_links = (html: string, homepage: URL): string[] => {
  const href_matches = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi));
  const unique = new Map<string, number>();

  for (const match of href_matches) {
    const href = (match[1] ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, homepage);
    } catch {
      continue;
    }
    const hostname = resolved.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== homepage.hostname.toLowerCase().replace(/^www\./, '')) continue;
    resolved.hash = '';
    resolved.search = '';
    const as_string = resolved.toString().replace(/\/$/, '');
    const path = resolved.pathname.toLowerCase();

    let score = 0;
    if (path === '/' || path === '') score += 1;
    if (path.split('/').filter(Boolean).length <= 2) score += 2;
    if (KEY_PATH_HINTS.some((hint) => path.includes(`/${hint}`))) score += 4;
    unique.set(as_string, Math.max(unique.get(as_string) ?? 0, score));
  }

  return Array.from(unique.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, 30);
};

const with_timeout = async <T>(promise_factory: (signal: AbortSignal) => Promise<T>, timeout_ms: number): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeout_ms);
  try {
    return await promise_factory(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const fetch_html_page = async (url: string): Promise<string> => {
  const response = await with_timeout(
    (signal) => fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'AISEOContextBot/1.0' } }),
    SCRAPE_PAGE_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }
  return response.text();
};

const build_keywords = (text: string): string[] => {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);
};

const summarize_text = (text: string): string => {
  if (!text) return '';
  const trimmed = text.slice(0, 2000);
  const sentences = trimmed.split(/[.!?]\s+/).map((s) => s.trim()).filter(Boolean);
  return sentences.slice(0, 3).join('. ').slice(0, 450);
};

const to_record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const to_array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const get_string = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const normalize_string_array = (value: unknown, limit = 12): string[] =>
  to_array(value)
    .map((item) => get_string(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);

const parse_json_object_from_text = (text: string): Record<string, unknown> | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return to_record(parsed);
  } catch {
    // continue with slice parsing
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return to_record(JSON.parse(trimmed.slice(start, end + 1)) as unknown);
  } catch {
    return null;
  }
};

interface PuppeteerPageLike {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  content: () => Promise<string>;
  url: () => string;
  close: () => Promise<void>;
  setUserAgent?: (user_agent: string) => Promise<void>;
  setViewport?: (viewport: { width: number; height: number }) => Promise<void>;
}

interface PuppeteerBrowserLike {
  newPage: () => Promise<PuppeteerPageLike>;
  close: () => Promise<void>;
}

interface PuppeteerModuleLike {
  launch: (options: Record<string, unknown>) => Promise<PuppeteerBrowserLike>;
}

const load_puppeteer_module = (): PuppeteerModuleLike | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const loaded = require('puppeteer') as { default?: unknown } | unknown;
    const module_like = to_record(loaded)?.default ?? loaded;
    if (!module_like || typeof (module_like as { launch?: unknown }).launch !== 'function') {
      return null;
    }
    return module_like as PuppeteerModuleLike;
  } catch {
    return null;
  }
};

const launch_puppeteer_browser = async (): Promise<PuppeteerBrowserLike | null> => {
  const puppeteer = load_puppeteer_module();
  if (!puppeteer) return null;
  try {
    return await puppeteer.launch({
      headless: true,
      timeout: SCRAPE_PAGE_TIMEOUT_MS,
      ignoreHTTPSErrors: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  } catch {
    return null;
  }
};

const fetch_html_page_with_puppeteer = async (browser: PuppeteerBrowserLike, url: string): Promise<{ html: string; final_url: string }> => {
  const page = await browser.newPage();
  try {
    if (page.setUserAgent) {
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36');
    }
    if (page.setViewport) {
      await page.setViewport({ width: 1366, height: 900 });
    }
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: SCRAPE_PAGE_TIMEOUT_MS,
    });
    const html = await page.content();
    return { html, final_url: page.url() || url };
  } finally {
    await page.close().catch(() => undefined);
  }
};

const build_heuristic_domain_sections = (params: {
  summary: string;
  keywords: string[];
  key_pages: Array<{ url: string; title?: string; description?: string; excerpt?: string }>;
}): Record<string, unknown> => {
  const page_lines = params.key_pages
    .slice(0, 5)
    .map((page) => page.title || page.description || page.excerpt || page.url)
    .filter((item): item is string => Boolean(item));

  return {
    business_context: params.summary || 'Domain content was scraped, but a detailed profile is still being assembled.',
    market_context: page_lines.slice(0, 3),
    audience_context: [],
    goals_positioning: [],
    products_services: page_lines.slice(0, 4),
    opportunities: params.keywords.slice(0, 8),
    risks: [],
    messaging: [],
    seo_focus_keywords: params.keywords.slice(0, 12),
  };
};

const build_openai_domain_context = async (params: {
  domain: string;
  summary: string;
  keywords: string[];
  pages: ScrapedPage[];
}): Promise<Record<string, unknown> | null> => {
  if (!OPENAI_API_KEY) {
    return null;
  }

  const snippets = params.pages
    .slice(0, 8)
    .map((page, index) =>
      [
        `Page ${index + 1}: ${page.url}`,
        page.title ? `Title: ${page.title}` : '',
        page.description ? `Description: ${page.description}` : '',
        page.excerpt ? `Excerpt: ${page.excerpt}` : '',
        page.text ? `Text: ${page.text.slice(0, 900)}` : '',
      ].filter(Boolean).join('\n'),
    )
    .join('\n\n')
    .slice(0, AI_CONTEXT_MAX_CHARS);

  const response = await with_timeout(
    (signal) =>
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                'You are an AI SEO analyst.',
                'Return strict JSON only.',
                'Output keys:',
                'summary (string),',
                'business_context (string),',
                'market_context (string),',
                'audience_context (string),',
                'goals_positioning (string),',
                'products_services (array of strings),',
                'opportunities (array of strings),',
                'risks (array of strings),',
                'messaging (array of strings),',
                'seo_focus_keywords (array of strings).',
                'Do not include markdown.',
              ].join(' '),
            },
            {
              role: 'user',
              content: [
                `Domain: ${params.domain}`,
                `Summary: ${params.summary}`,
                `Keywords: ${params.keywords.join(', ') || 'none'}`,
                'Pages:',
                snippets,
              ].join('\n\n'),
            },
          ],
        }),
      }),
    OPENAI_TIMEOUT_MS,
  );

  const raw_text = await response.text();
  if (!response.ok) {
    return null;
  }
  const parsed = parse_json_object_from_text(raw_text);
  const choice = to_record(to_array(to_record(parsed)?.choices)[0]) ?? {};
  const message = to_record(choice.message) ?? {};
  const content = get_string(message.content);
  if (!content) return null;
  return parse_json_object_from_text(content);
};

const to_domain_summary = (domain: {
  id: string;
  normalized_domain: string;
  display_domain: string;
  source_url: string;
  scrape_status: 'queued' | 'running' | 'completed' | 'failed';
  last_scraped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): DomainSummary => ({
  domain_id: domain.id,
  normalized_domain: domain.normalized_domain,
  display_domain: domain.display_domain,
  source_url: domain.source_url,
  scrape_status: domain.scrape_status,
  last_scraped_at: domain.last_scraped_at,
  created_at: domain.created_at,
  updated_at: domain.updated_at,
});

export class DomainService extends BaseService {
  constructor(private readonly repository: DomainRepository = domainRepository) {
    super();
  }

  static normalizeDomainInput = normalize_domain_or_url;
  static accountNameFromDomain = make_account_name_from_domain;

  async listDomains(tenant_id: string): Promise<DomainSummary[]> {
    const domains = await this.repository.listDomains(tenant_id);
    return domains.map((domain) => to_domain_summary(domain));
  }

  async getDomainContext(tenant_id: string, domain_id: string): Promise<DomainContextPayload> {
    const domain = await this.repository.findDomainById(tenant_id, domain_id);
    if (!domain) {
      throw new HttpException(404, 'Domain not found');
    }
    const context_record = domain.context?.context_json as Record<string, unknown> | null;
    const pages = Array.isArray(context_record?.['key_pages']) ? context_record?.['key_pages'] : [];
    const keywords = Array.isArray(context_record?.['keywords']) ? context_record?.['keywords'] : [];
    const summary = String(context_record?.['summary'] ?? '');
    return {
      domain: to_domain_summary(domain),
      context: context_record
        ? {
          ...context_record,
          extracted_at: domain.context?.extracted_at,
          summary,
          key_pages: pages as Array<{ url: string; title?: string; description?: string; excerpt?: string }>,
          keywords: keywords as string[],
        }
        : null,
    };
  }

  async createDomainAndScrape(params: { tenant_id: string; user_id: string; domain_url: string }): Promise<DomainContextPayload> {
    const normalized = normalize_domain_or_url(params.domain_url);
    const existing = await this.repository.findByNormalizedDomain(params.tenant_id, normalized.normalized_domain);
    if (existing) {
      throw new HttpException(409, 'Domain already exists in this account');
    }

    const created = await this.repository.createDomain({
      tenant_id: params.tenant_id,
      user_id: params.user_id,
      normalized_domain: normalized.normalized_domain,
      display_domain: normalized.display_domain,
      source_url: normalized.source_url,
    });

      await this.scrapeDomainOrThrow({
        domain_id: created.id,
        homepage_url: normalized.homepage_url,
      });

    return this.getDomainContext(params.tenant_id, created.id);
  }

  async rescrapeDomain(tenant_id: string, domain_id: string): Promise<DomainContextPayload> {
    const existing = await this.repository.findDomainById(tenant_id, domain_id);
    if (!existing) {
      throw new HttpException(404, 'Domain not found');
    }
    const homepage_url = `https://${existing.normalized_domain}`;
    await this.scrapeDomainOrThrow({
      domain_id,
      homepage_url,
    });
    return this.getDomainContext(tenant_id, domain_id);
  }

  private async scrapeDomainOrThrow(params: { domain_id: string; homepage_url: string }) {
    const run = await this.repository.createScrapeRun(params.domain_id);
    await this.repository.markDomainRunning(params.domain_id);

    const started_at = Date.now();
    let browser: PuppeteerBrowserLike | null = null;
    try {
      browser = await launch_puppeteer_browser();
      const scrape_engine = browser ? 'puppeteer' : 'http_fetch';

      const homepage_response = browser
        ? await fetch_html_page_with_puppeteer(browser, params.homepage_url).catch(() => null)
        : null;
      const homepage_html = homepage_response?.html ?? await fetch_html_page(params.homepage_url);
      const homepage_url = new URL(homepage_response?.final_url ?? params.homepage_url);
      const candidate_links = extract_internal_links(homepage_html, homepage_url);
      const target_urls = [params.homepage_url, ...candidate_links]
        .filter((url, index, arr) => arr.indexOf(url) === index)
        .slice(0, SCRAPE_MAX_PAGES);

      const scraped_pages: ScrapedPage[] = [];
      for (const url of target_urls) {
        if (Date.now() - started_at > SCRAPE_TOTAL_TIMEOUT_MS) {
          break;
        }
        try {
          let html = homepage_html;
          let final_url = url;
          if (url !== params.homepage_url) {
            if (browser) {
              const browser_page = await fetch_html_page_with_puppeteer(browser, url).catch(() => null);
              if (browser_page) {
                html = browser_page.html;
                final_url = browser_page.final_url;
              } else {
                html = await fetch_html_page(url);
              }
            } else {
              html = await fetch_html_page(url);
            }
          }
          const text = strip_html(html).slice(0, 3200);
          scraped_pages.push({
            url: final_url,
            title: extract_title(html),
            description: extract_meta_description(html),
            excerpt: summarize_text(text),
            text,
          });
        } catch {
          // Best effort: skip failed page and continue.
        }
      }

      if (!scraped_pages.length) {
        throw new Error('Could not scrape any page content');
      }

      const corpus = scraped_pages.map((page) => page.text).join(' ');
      const keywords = build_keywords(corpus);
      const summary = summarize_text(corpus);

      const key_pages = scraped_pages.map((page) => ({
        url: page.url,
        title: page.title,
        description: page.description,
        excerpt: page.excerpt,
      }));

      const ai_context = await build_openai_domain_context({
        domain: new URL(params.homepage_url).hostname,
        summary,
        keywords,
        pages: scraped_pages,
      }).catch(() => null);
      const heuristic_context = build_heuristic_domain_sections({ summary, keywords, key_pages });

      const context_json: Record<string, unknown> = {
        summary: get_string(ai_context?.summary) ?? summary,
        keywords: normalize_string_array(ai_context?.seo_focus_keywords ?? ai_context?.keywords, 18).length
          ? normalize_string_array(ai_context?.seo_focus_keywords ?? ai_context?.keywords, 18)
          : keywords,
        key_pages,
        business_context: get_string(ai_context?.business_context) ?? heuristic_context.business_context,
        market_context: get_string(ai_context?.market_context) ?? heuristic_context.market_context,
        audience_context: get_string(ai_context?.audience_context) ?? heuristic_context.audience_context,
        goals_positioning: get_string(ai_context?.goals_positioning) ?? heuristic_context.goals_positioning,
        products_services: normalize_string_array(ai_context?.products_services, 10).length
          ? normalize_string_array(ai_context?.products_services, 10)
          : (heuristic_context.products_services as string[]),
        opportunities: normalize_string_array(ai_context?.opportunities, 12).length
          ? normalize_string_array(ai_context?.opportunities, 12)
          : (heuristic_context.opportunities as string[]),
        risks: normalize_string_array(ai_context?.risks, 10),
        messaging: normalize_string_array(ai_context?.messaging, 10),
        seo_focus_keywords: normalize_string_array(ai_context?.seo_focus_keywords, 18).length
          ? normalize_string_array(ai_context?.seo_focus_keywords, 18)
          : keywords,
        scrape_engine,
        summary_provider: ai_context ? 'openai' : 'heuristic',
      };

      await this.repository.saveDomainContext({
        domain_id: params.domain_id,
        context_json,
        pages_json: key_pages,
      });
      await this.repository.completeScrapeRun({
        domain_id: params.domain_id,
        run_id: run.id,
        page_count: key_pages.length,
      });
    } catch (error) {
      await this.repository.failScrapeRun({
        domain_id: params.domain_id,
        run_id: run.id,
        error_message: error instanceof Error ? error.message : 'Scrape failed',
      });
      throw new HttpException(502, error instanceof Error ? error.message : 'Failed to scrape website');
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }
}

export const domainService = new DomainService();
