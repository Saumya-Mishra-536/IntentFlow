import { useEffect, useState } from 'react';
import { AnalyticsRange, auth_storage, DashboardAnalyticsResponse, get_dashboard_analytics } from '@/shared/lib/auth';

const dashboard_analytics_cache = new Map<string, DashboardAnalyticsResponse>();

export function useDashboardAnalytics(range: AnalyticsRange) {
  const [data, setData] = useState<DashboardAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = auth_storage.get_access_token();
    if (!token) return;
    const cache_key = `dashboard|${range}`;
    const cached = dashboard_analytics_cache.get(cache_key);
    if (cached) {
      setData(cached);
      setError('');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    void get_dashboard_analytics(token, { range }, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        dashboard_analytics_cache.set(cache_key, payload);
        setData(payload);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load dashboard analytics');
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [range]);

  return { data, loading, error };
}
