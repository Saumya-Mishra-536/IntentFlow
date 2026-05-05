import { useEffect, useState } from 'react';
import { AnalyticsRange, auth_storage, get_campaign_prompt_analytics, PromptAnalyticsResponse } from '@/shared/lib/auth';

const prompt_analytics_cache = new Map<string, PromptAnalyticsResponse>();

export function usePromptAnalytics(campaignId?: string, versionId?: string, range: AnalyticsRange = '30d', enabled = true) {
  const [data, setData] = useState<PromptAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!campaignId || !enabled) {
      setLoading(false);
      return;
    }
    const token = auth_storage.get_access_token();
    if (!token) return;
    const cache_key = `${campaignId}|${versionId ?? 'active'}|${range}|prompts`;
    const cached = prompt_analytics_cache.get(cache_key);
    if (cached) {
      setData(cached);
      setError('');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    void get_campaign_prompt_analytics(token, campaignId, { version_id: versionId, range }, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        prompt_analytics_cache.set(cache_key, payload);
        setData(payload);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load prompt analytics');
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
