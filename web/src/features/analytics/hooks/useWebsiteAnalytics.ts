import { useEffect, useState } from 'react';
import { AnalyticsRange, auth_storage, get_campaign_website_analytics, WebsiteAnalyticsResponse } from '@/shared/lib/auth';

const website_analytics_cache = new Map<string, WebsiteAnalyticsResponse>();

export function useWebsiteAnalytics(campaignId?: string, versionId?: string, range: AnalyticsRange = '30d', enabled = true) {
  const [data, setData] = useState<WebsiteAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!campaignId || !enabled) {
      setLoading(false);
      return;
    }
    const token = auth_storage.get_access_token();
    if (!token) return;
    const cache_key = `${campaignId}|${versionId ?? 'active'}|${range}|websites`;
    const cached = website_analytics_cache.get(cache_key);
    if (cached) {
      setData(cached);
      setError('');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    void get_campaign_website_analytics(token, campaignId, { version_id: versionId, range }, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        website_analytics_cache.set(cache_key, payload);
        setData(payload);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load website analytics');
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [campaignId, enabled, range, versionId]);

  return { data, loading, error };
}
