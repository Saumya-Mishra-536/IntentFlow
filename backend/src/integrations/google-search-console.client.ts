import { logger } from '../utils/logger';

/**
 * Interface representing the keyword metrics we expect.
 * Maps to SemrushKeywordMetric type for compatibility.
 */
export interface KeywordMetric {
  keyword: string;
  position: number;
  search_volume: number;
  keyword_difficulty: number;
  url: string;
  timestamp: string;
}

/**
 * Google Search Console API Client
 * 
 * This is a free drop-in replacement for Semrush/Ahrefs.
 * It uses the Google Search Console API to get real ranking data.
 */
export class GoogleSearchConsoleClient {
  /**
   * Fetches search analytics data for a given domain.
   * 
   * @param accessToken - Google OAuth access token
   * @param siteUrl - The site URL (e.g., 'sc-domain:example.com' or 'https://example.com/')
   * @param startDate - Format YYYY-MM-DD
   * @param endDate - Format YYYY-MM-DD
   */
  static async getKeywordMetrics(
    accessToken: string,
    siteUrl: string,
    startDate: string,
    endDate: string
  ): Promise<KeywordMetric[]> {
    logger.info(`[GSC] Fetching metrics for ${siteUrl} (${startDate} to ${endDate})`);

    try {
      const response = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: ['query', 'page'],
            rowLimit: 1000,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`GSC API Error: ${error}`);
      }

      const data = await response.json();
      const rows = data.rows || [];

      return rows.map((row: any) => ({
        keyword: row.keys[0],
        url: row.keys[1],
        position: Math.round(row.position),
        search_volume: 0, // GSC doesn't provide global search volume, only impressions
        keyword_difficulty: 0,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      logger.error('[GSC] Failed to fetch metrics', error);
      return [];
    }
  }
}
