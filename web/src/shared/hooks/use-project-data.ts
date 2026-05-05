import { useEffect, useState } from 'react';
import {
  AccountMembership,
  auth_storage,
  CampaignWithTree,
  DomainSummary,
  get_account_memberships,
  get_campaigns,
  get_me,
  get_onboarding_context,
  logout,
  OnboardingContext,
  switch_account,
} from '../lib/auth';
import { analytics_api } from '../lib/analytics';

export interface ProjectUser {
  id: string;
  email: string;
  name?: string | null;
  app_role?: string;
}

export function useProjectData(selected_domain_id?: string) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<ProjectUser | null>(null);
  const [projectsData, setProjectsData] = useState<CampaignWithTree[]>([]);
  const [onboardingContext, setOnboardingContext] = useState<OnboardingContext | null>(null);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [memberships, setMemberships] = useState<AccountMembership[]>([]);

  const boot = async () => {
    if (typeof performance !== 'undefined') {
      performance.mark('app_boot_start');
    }
    const token = auth_storage.get_access_token();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const [me, context, membership_rows] = await Promise.all([
        get_me(token),
        get_onboarding_context(token),
        get_account_memberships(token).catch(() => []),
      ]);

      const normalized_memberships = membership_rows.map((item) => ({
        tenant_id: item.account.tenant_id,
        slug: item.account.slug,
        name: item.account.name,
        member_role: item.role,
      }));

      const campaigns = await get_campaigns(
        token,
        selected_domain_id ? { domain_id: selected_domain_id } : undefined,
      );
      const campaign_summaries: CampaignWithTree[] = campaigns.map((campaign) => ({ project: campaign, roots: [] }));

      setUser({ id: me.id, email: me.email, name: me.name, app_role: me.app_role });
      setOnboardingContext(context);
      setDomains(context.domains ?? []);
      setMemberships(normalized_memberships);
      setProjectsData(campaign_summaries);
    } catch (err) {
      console.error('[useProjectData] boot failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('Unauthorized') ||
        msg.includes('Invalid token') ||
        msg.includes('expired') ||
        msg.includes('This workspace is not available')
      ) {
        auth_storage.clear();
        window.location.href = '/';
      }
    } finally {
      setLoading(false);
      if (typeof performance !== 'undefined') {
        performance.mark('app_boot_end');
        performance.measure('app_boot_duration', 'app_boot_start', 'app_boot_end');
        const measures = performance.getEntriesByName('app_boot_duration');
        const latest = measures[measures.length - 1];
        if (latest && Math.random() < 0.15) {
          void analytics_api.track_event({
            event_name: 'web_perf_app_boot',
            properties: {
              duration_ms: Math.round(latest.duration),
            },
          });
        }
      }
    }
  };

  useEffect(() => {
    void boot();
  }, [selected_domain_id]);

  const handleLogout = async () => {
    const refresh_token = auth_storage.get_refresh_token();
    try {
      if (refresh_token) await logout(refresh_token);
    } finally {
      auth_storage.clear();
      window.location.href = '/';
    }
  };

  const switchAccountAndReload = async (tenant_id: string) => {
    const access_token = auth_storage.get_access_token();
    if (!access_token) return;
    await switch_account(access_token, tenant_id);
    await boot();
  };

  return {
    loading,
    user,
    projectsData,
    onboardingContext,
    domains,
    memberships,
    handleLogout,
    switchAccountAndReload,
    reloadProjectData: boot,
  };
}
