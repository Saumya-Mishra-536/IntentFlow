import { AccountJoinRequestStatus } from '@prisma/client';

import { BaseService } from '../../core/service';
import { HttpException } from '../../core/http-exception';
import { accountRepository, AccountRepository } from './account.repository';

export class AccountService extends BaseService {
  constructor(private readonly repository: AccountRepository = accountRepository) {
    super();
  }

  async listMemberships(user_id: string) {
    const memberships = await this.repository.listMemberships(user_id);
    return memberships.map((membership) => ({
      tenant_id: membership.tenant_id,
      role: membership.role,
      account: {
        tenant_id: membership.tenant.id,
        slug: membership.tenant.slug,
        name: membership.tenant.name,
      },
      joined_at: membership.created_at,
    }));
  }

  async createJoinRequest(params: { user_id: string; account_slug: string }) {
    const slug = params.account_slug.trim().toLowerCase();
    const tenant = await this.repository.findTenantBySlug(slug);
    if (!tenant) {
      throw new HttpException(404, 'Account not found');
    }

    const existing_membership = await this.repository.findMembership(params.user_id, tenant.id);
    if (existing_membership) {
      return {
        already_member: true,
        tenant_id: tenant.id,
        account_slug: tenant.slug,
        status: 'approved',
      };
    }

    const existing_pending = await this.repository.findPendingRequest(tenant.id, params.user_id);
    if (existing_pending) {
      return {
        request_id: existing_pending.id,
        account_slug: tenant.slug,
        tenant_id: tenant.id,
        status: existing_pending.status,
      };
    }

    const created = await this.repository.createJoinRequest(tenant.id, params.user_id);
    return {
      request_id: created.id,
      account_slug: created.tenant.slug,
      tenant_id: created.tenant.id,
      status: created.status,
    };
  }

  async listJoinRequests(tenant_id: string, status?: string) {
    let normalized_status: AccountJoinRequestStatus | undefined;
    if (status) {
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        throw new HttpException(400, 'Invalid join request status');
      }
      normalized_status = status as AccountJoinRequestStatus;
    }
    const rows = await this.repository.listJoinRequests(tenant_id, normalized_status);
    return rows.map((row) => ({
      request_id: row.id,
      status: row.status,
      requested_at: row.requested_at,
      resolved_at: row.resolved_at,
      requestor: row.requestor_user,
    }));
  }

  async approveJoinRequest(params: { tenant_id: string; approver_user_id: string; request_id: string }) {
    const updated = await this.repository.approveJoinRequest(params);
    if (!updated) {
      throw new HttpException(404, 'Join request not found');
    }
    return {
      request_id: updated.id,
      status: updated.status,
      resolved_at: updated.resolved_at,
    };
  }

  async rejectJoinRequest(params: { tenant_id: string; approver_user_id: string; request_id: string }) {
    const result = await this.repository.rejectJoinRequest(params);
    if (result.count === 0) {
      throw new HttpException(404, 'Join request not found');
    }
    return {
      request_id: params.request_id,
      status: 'rejected',
    };
  }
}

export const accountService = new AccountService();
