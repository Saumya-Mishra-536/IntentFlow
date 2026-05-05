import { useEffect, useState } from 'react';
import { AnalyticsRange, auth_storage, get_campaign_pipeline_analytics, PipelineAnalyticsResponse } from '@/shared/lib/auth';

export function usePipelineAnalytics(campaignId?: string, versionId?: string, range: AnalyticsRange = '30d') {
  const [data, setData] = useState<PipelineAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!campaignId) return;
    const token = auth_storage.get_access_token();
    if (!token) return;
    let mounted = true;
    setLoading(true);
    setError('');
    void get_campaign_pipeline_analytics(token, campaignId, { version_id: versionId, range })
      .then((payload) => {
        if (!mounted) return;
        setData(payload);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load pipeline analytics');
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [campaignId, versionId, range]);

  return { data, loading, error };
}
