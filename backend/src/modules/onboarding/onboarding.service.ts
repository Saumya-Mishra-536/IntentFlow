import { BaseService } from '../../core/service';
import { HttpException } from '../../core/http-exception';
import { BootstrapOnboardingDto } from './dto/bootstrap-onboarding.dto';
import { OnboardingContextPayload } from './onboarding.model';
import { onboardingRepository, OnboardingRepository } from './onboarding.repository';
import { domainService, DomainService } from '../domain/domain.service';

const slugify = (value: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return cleaned.length ? cleaned : 'account';
};

const random_suffix = (): string => Math.random().toString(36).slice(2, 8);

export class OnboardingService extends BaseService {
  constructor(private readonly repository: OnboardingRepository = onboardingRepository) {
    super();
  }

  private async to_context_payload(user_id: string): Promise<OnboardingContextPayload> {
    const active_membership = await this.repository.resolveActiveMembership(user_id);
    if (!active_membership) {
      return {
        needs_onboarding: true,
        domains: [],
      };
    }

    const domains = await this.repository.listDomains(active_membership.tenant_id);

    return {
      active_account: {
        tenant_id: active_membership.tenant.id,
        slug: active_membership.tenant.slug,
        name: active_membership.tenant.name,
        member_role: active_membership.role,
      },
      domains: domains.map((domain) => ({
        domain_id: domain.id,
        normalized_domain: domain.normalized_domain,
        scrape_status: domain.scrape_status,
        last_scraped_at: domain.last_scraped_at,
      })),
      needs_onboarding: domains.length === 0,
    };
  }

  private async build_unique_account_slug(seed: string): Promise<string> {
    const base = slugify(seed);
    let candidate = base;
    for (let i = 0; i < 5; i += 1) {
      const existing = await this.repository.findTenantBySlug(candidate);
      if (!existing) {
        return candidate;
      }
      candidate = `${base}-${random_suffix()}`;
    }
    return `${base}-${Date.now().toString(36).slice(-4)}`;
  }

  async getContext(user_id: string): Promise<OnboardingContextPayload> {
    return this.to_context_payload(user_id);
  }

  async bootstrap(params: { user_id: string; payload: BootstrapOnboardingDto }): Promise<OnboardingContextPayload> {
    if (params.payload.mode === 'create_account') {
      const parsed = DomainService.normalizeDomainInput(params.payload.domain_url);
      const account_name_from_domain = DomainService.accountNameFromDomain(parsed.normalized_domain);
      const slug = await this.build_unique_account_slug(parsed.normalized_domain);

      const created_tenant = await this.repository.createTenantWithOwner({
        user_id: params.user_id,
        name: account_name_from_domain,
        slug,
      });

      await domainService.createDomainAndScrape({
        tenant_id: created_tenant.id,
        user_id: params.user_id,
        domain_url: params.payload.domain_url,
      });

      return this.to_context_payload(params.user_id);
    }

    const slug = params.payload.account_slug.trim().toLowerCase();
    const tenant = await this.repository.findTenantBySlug(slug);
    if (!tenant) {
      throw new HttpException(404, 'Account not found');
    }

    const existing_membership = await this.repository.findMembership(params.user_id, tenant.id);
    if (existing_membership) {
      await this.repository.setActiveTenant(params.user_id, tenant.id);
      return this.to_context_payload(params.user_id);
    }

    const pending_request = await this.repository.findPendingJoinRequest({
      tenant_id: tenant.id,
      requestor_user_id: params.user_id,
    }) ?? await this.repository.createJoinRequest({
      tenant_id: tenant.id,
      requestor_user_id: params.user_id,
    });

    const context = await this.to_context_payload(params.user_id);
    return {
      ...context,
      join_request: {
        request_id: pending_request.id,
        account_slug: tenant.slug,
        status: 'pending',
      },
    };
  }
}

export const onboardingService = new OnboardingService();
