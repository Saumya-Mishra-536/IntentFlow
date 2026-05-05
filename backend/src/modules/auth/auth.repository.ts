import { AuthCodeStatus } from '@prisma/client';

import { BaseRepository } from '../../core/repository';
import { prisma } from '../../utils/prisma';

export class AuthRepository extends BaseRepository {
  findUserById(user_id: string) {
    return prisma.user.findUnique({ where: { id: user_id } });
  }

  findUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  createUser(data: { email: string; name?: string | null; avatar_url?: string | null }) {
    return prisma.user.create({
      data: {
        email: data.email,
        name: data.name ?? null,
        avatar_url: data.avatar_url ?? null,
      },
    });
  }

  updateUserProfile(params: {
    user_id: string;
    name?: string | null;
    avatar_url?: string | null;
    company_name?: string | null;
    company_domain?: string | null;
    linkedin_url?: string | null;
    x_url?: string | null;
    other_social_urls?: string[];
    timezone?: string | null;
    locale?: string | null;
    job_role?: string | null;
  }) {
    return prisma.user.update({
      where: { id: params.user_id },
      data: {
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.avatar_url !== undefined ? { avatar_url: params.avatar_url } : {}),
        ...(params.company_name !== undefined ? { company_name: params.company_name } : {}),
        ...(params.company_domain !== undefined ? { company_domain: params.company_domain } : {}),
        ...(params.linkedin_url !== undefined ? { linkedin_url: params.linkedin_url } : {}),
        ...(params.x_url !== undefined ? { x_url: params.x_url } : {}),
        ...(params.other_social_urls !== undefined ? { other_social_urls: params.other_social_urls } : {}),
        ...(params.timezone !== undefined ? { timezone: params.timezone } : {}),
        ...(params.locale !== undefined ? { locale: params.locale } : {}),
        ...(params.job_role !== undefined ? { job_role: params.job_role } : {}),
      },
    });
  }

  findUserByOAuthAccount(provider: string, provider_account_id: string) {
    return prisma.oAuthAccount
      .findUnique({
        where: {
          provider_provider_account_id: {
            provider,
            provider_account_id,
          },
        },
        include: {
          user: true,
        },
      })
      .then((account) => account?.user ?? null);
  }

  async upsertOAuthAccount(params: {
    user_id: string;
    provider: string;
    provider_account_id: string;
  }) {
    return prisma.oAuthAccount.upsert({
      where: {
        provider_provider_account_id: {
          provider: params.provider,
          provider_account_id: params.provider_account_id,
        },
      },
      update: { user_id: params.user_id },
      create: {
        user_id: params.user_id,
        provider: params.provider,
        provider_account_id: params.provider_account_id,
      },
    });
  }

  createAuthCode(params: {
    user_id: string;
    code_hash: string;
    redirect_uri: string;
    state?: string;
    expires_at: Date;
  }) {
    return prisma.authCode.create({
      data: {
        user_id: params.user_id,
        code_hash: params.code_hash,
        redirect_uri: params.redirect_uri,
        state: params.state,
        expires_at: params.expires_at,
        status: AuthCodeStatus.active,
      },
    });
  }

  findActiveAuthCodeByHash(code_hash: string, now: Date) {
    return prisma.authCode.findFirst({
      where: {
        code_hash,
        status: AuthCodeStatus.active,
        expires_at: { gt: now },
      },
      include: {
        user: true,
      },
    });
  }

  markAuthCodeUsed(id: string, used_at: Date) {
    return prisma.authCode.update({
      where: { id },
      data: {
        status: AuthCodeStatus.used,
        used_at,
      },
    });
  }

  createRefreshToken(params: { user_id: string; token_hash: string; expires_at: Date }) {
    return prisma.refreshToken.create({
      data: {
        user_id: params.user_id,
        token_hash: params.token_hash,
        expires_at: params.expires_at,
      },
    });
  }

  findValidRefreshTokenByHash(token_hash: string, now: Date) {
    return prisma.refreshToken.findFirst({
      where: {
        token_hash,
        revoked_at: null,
        expires_at: { gt: now },
      },
      include: {
        user: true,
      },
    });
  }

  revokeRefreshToken(id: string, revoked_at: Date) {
    return prisma.refreshToken.update({
      where: { id },
      data: { revoked_at },
    });
  }

  findMembership(user_id: string, tenant_id: string) {
    return prisma.tenantMember.findFirst({
      where: {
        user_id,
        tenant_id,
      },
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

  setActiveTenantForUser(user_id: string, tenant_id: string) {
    return prisma.user.update({
      where: { id: user_id },
      data: { active_tenant_id: tenant_id },
      select: { id: true },
    });
  }
}

export const authRepository = new AuthRepository();
