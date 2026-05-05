export interface OnboardingActiveAccount {
  tenant_id: string;
  slug: string;
  name: string;
  member_role: string;
}

export interface OnboardingDomainSummary {
  domain_id: string;
  normalized_domain: string;
  scrape_status: 'queued' | 'running' | 'completed' | 'failed';
  last_scraped_at?: Date | null;
}

export interface OnboardingJoinRequestSummary {
  request_id: string;
  account_slug: string;
  status: 'pending';
}

export interface OnboardingContextPayload {
  active_account?: OnboardingActiveAccount;
  domains: OnboardingDomainSummary[];
  needs_onboarding: boolean;
  join_request?: OnboardingJoinRequestSummary;
}
