import { Prisma, TenantMember } from '@prisma/client';

import { BaseRepository } from '../../core/repository';
import { prisma } from '../../utils/prisma';

export interface ActiveAccountMembership {
  tenant_id: string;
  role: string;
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
}

export class OnboardingRepository extends BaseRepository {
  private async find_active_membership_with_tx(
    tx: Prisma.TransactionClient,
    user_id: string,
  ): Promise<ActiveAccountMembership | null> {
    const user = await tx.user.findUnique({
      where: { id: user_id },
      select: { active_tenant_id: true },
    });
    if (!user) {
      throw new Error('User not found while resolving active account');
    }

    if (user.active_tenant_id) {
      const active_membership = await tx.tenantMember.findFirst({
        where: { user_id, tenant_id: user.active_tenant_id },
        include: {
          tenant: {
            select: {
              id: true,
              slug: true,
              name: true,
            },
          },
        },
      });
      if (active_membership) {
        return active_membership;
      }
    }

    const fallback = await tx.tenantMember.findFirst({
      where: { user_id },
      orderBy: { created_at: 'asc' },
      include: {
        tenant: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    });

    if (!fallback) return null;

    if (!user.active_tenant_id || user.active_tenant_id !== fallback.tenant_id) {
      await tx.user.update({
        where: { id: user_id },
        data: { active_tenant_id: fallback.tenant_id },
      });
    }
    return fallback;
  }

  resolveActiveMembership(user_id: string): Promise<ActiveAccountMembership | null> {
    return prisma.$transaction((tx) => this.find_active_membership_with_tx(tx, user_id));
  }

  listMemberships(user_id: string): Promise<Array<TenantMember & { tenant: { id: string; slug: string; name: string } }>> {
    return prisma.tenantMember.findMany({
      where: { user_id },
      orderBy: { created_at: 'asc' },
      include: {
        tenant: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    });
  }

  setActiveTenant(user_id: string, tenant_id: string): Promise<void> {
    return prisma.user.update({
      where: { id: user_id },
      data: { active_tenant_id: tenant_id },
      select: { id: true },
    }).then(() => undefined);
  }

  findTenantBySlug(slug: string) {
    return prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        owner_user_id: true,
      },
    });
  }

  findMembership(user_id: string, tenant_id: string) {
    return prisma.tenantMember.findFirst({
      where: { user_id, tenant_id },
    });
  }

  createJoinRequest(params: { tenant_id: string; requestor_user_id: string }) {
    return prisma.accountJoinRequest.create({
      data: {
        tenant_id: params.tenant_id,
        requestor_user_id: params.requestor_user_id,
        status: 'pending',
      },
    });
  }

  findPendingJoinRequest(params: { tenant_id: string; requestor_user_id: string }) {
    return prisma.accountJoinRequest.findFirst({
      where: {
        tenant_id: params.tenant_id,
        requestor_user_id: params.requestor_user_id,
        status: 'pending',
      },
      orderBy: { created_at: 'desc' },
    });
  }

  createTenantWithOwner(params: { user_id: string; name: string; slug: string }) {
    return prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: params.name,
          slug: params.slug,
          owner_user_id: params.user_id,
        },
      });
      await tx.tenantMember.create({
        data: {
          tenant_id: tenant.id,
          user_id: params.user_id,
          role: 'owner',
        },
      });
      await tx.user.update({
        where: { id: params.user_id },
        data: { active_tenant_id: tenant.id },
      });
      return tenant;
    });
  }

  listDomains(tenant_id: string) {
    return prisma.domain.findMany({
      where: { tenant_id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        normalized_domain: true,
        scrape_status: true,
        last_scraped_at: true,
      },
    });
  }
}

export const onboardingRepository = new OnboardingRepository();
