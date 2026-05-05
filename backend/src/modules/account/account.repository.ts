import { AccountJoinRequestStatus } from '@prisma/client';

import { BaseRepository } from '../../core/repository';
import { prisma } from '../../utils/prisma';

export class AccountRepository extends BaseRepository {
  listMemberships(user_id: string) {
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

  findMembership(user_id: string, tenant_id: string) {
    return prisma.tenantMember.findFirst({
      where: { user_id, tenant_id },
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

  findTenantBySlug(slug: string) {
    return prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
      },
    });
  }

  findPendingRequest(tenant_id: string, requestor_user_id: string) {
    return prisma.accountJoinRequest.findFirst({
      where: {
        tenant_id,
        requestor_user_id,
        status: AccountJoinRequestStatus.pending,
      },
      orderBy: { requested_at: 'desc' },
    });
  }

  createJoinRequest(tenant_id: string, requestor_user_id: string) {
    return prisma.accountJoinRequest.create({
      data: {
        tenant_id,
        requestor_user_id,
        status: AccountJoinRequestStatus.pending,
      },
      include: {
        tenant: {
          select: { id: true, slug: true, name: true },
        },
      },
    });
  }

  listJoinRequests(tenant_id: string, status?: AccountJoinRequestStatus) {
    return prisma.accountJoinRequest.findMany({
      where: {
        tenant_id,
        ...(status ? { status } : {}),
      },
      include: {
        requestor_user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: { requested_at: 'desc' },
    });
  }

  findJoinRequest(tenant_id: string, request_id: string) {
    return prisma.accountJoinRequest.findFirst({
      where: {
        tenant_id,
        id: request_id,
      },
      include: {
        requestor_user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  }

  approveJoinRequest(params: { tenant_id: string; request_id: string; approver_user_id: string }) {
    return prisma.$transaction(async (tx) => {
      const request = await tx.accountJoinRequest.findFirst({
        where: {
          id: params.request_id,
          tenant_id: params.tenant_id,
        },
      });
      if (!request) {
        return null;
      }

      const membership = await tx.tenantMember.findFirst({
        where: {
          user_id: request.requestor_user_id,
          tenant_id: request.tenant_id,
        },
      });
      if (!membership) {
        await tx.tenantMember.create({
          data: {
            tenant_id: request.tenant_id,
            user_id: request.requestor_user_id,
            role: 'member',
          },
        });
      }

      await tx.user.update({
        where: { id: request.requestor_user_id },
        data: { active_tenant_id: request.tenant_id },
      });

      return tx.accountJoinRequest.update({
        where: { id: request.id },
        data: {
          status: AccountJoinRequestStatus.approved,
          resolved_at: new Date(),
          resolved_by_user_id: params.approver_user_id,
        },
      });
    });
  }

  rejectJoinRequest(params: { tenant_id: string; request_id: string; approver_user_id: string }) {
    return prisma.accountJoinRequest.updateMany({
      where: {
        id: params.request_id,
        tenant_id: params.tenant_id,
        status: AccountJoinRequestStatus.pending,
      },
      data: {
        status: AccountJoinRequestStatus.rejected,
        resolved_at: new Date(),
        resolved_by_user_id: params.approver_user_id,
      },
    });
  }
}

export const accountRepository = new AccountRepository();
