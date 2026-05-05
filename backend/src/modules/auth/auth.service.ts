import jwt, { SignOptions } from 'jsonwebtoken';

import config from '../../config';
import { HttpException } from '../../core/http-exception';
import { BaseService } from '../../core/service';
import { comparePassword, hashPassword } from '../../utils/bcrypt';
import { hashToken, randomToken } from '../../utils/tokens';
import { prisma } from '../../utils/prisma';
import { onboardingRepository } from '../onboarding/onboarding.repository';
import { onboardingService } from '../onboarding/onboarding.service';
import { AuthRepository, authRepository } from './auth.repository';

const GOOGLE_PROVIDER = 'google';
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_SIGN_OPTIONS: SignOptions = {
  expiresIn: config.JWT_ACCESS_TTL as SignOptions['expiresIn'],
};

interface OAuthStatePayload {
  redirect_uri: string;
  client_state?: string;
  action?: 'signin' | 'signup';
}

interface GoogleUserInfo {
  id?: string;
  email?: string;
  name?: string;
  picture?: string;
}

type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  app_role: 'admin' | 'user';
  password: string | null;
  avatar_url?: string | null;
};

const encodeState = (payload: OAuthStatePayload): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const decodeState = (value: string): OAuthStatePayload => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as OAuthStatePayload;
  } catch {
    throw new HttpException(400, 'Invalid OAuth state');
  }
};

const is_valid_redirect_uri = (value: string): boolean => {
  if (value.startsWith('chrome-extension://')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export class AuthService extends BaseService {
  constructor(private readonly repository: AuthRepository = authRepository) {
    super();
  }

  decodeOAuthState(state: string) {
    return decodeState(state);
  }

  startGoogleOAuth(params: { redirect_uri?: string; client_state?: string; action?: 'signin' | 'signup' }) {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET || !config.GOOGLE_REDIRECT_URI) {
      throw new HttpException(500, 'Google OAuth is not configured');
    }

    const redirect_uri = params.redirect_uri || config.OAUTH_DEFAULT_EXTENSION_REDIRECT_URI;
    if (!redirect_uri || !is_valid_redirect_uri(redirect_uri)) {
      throw new HttpException(400, 'A valid redirect_uri is required');
    }

    const state = encodeState({ redirect_uri, client_state: params.client_state, action: params.action });

    const search = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${search.toString()}`;
  }

  async completeGoogleOAuth(params: { code: string; state: string }) {
    if (!params.code) {
      throw new HttpException(400, 'Missing OAuth code');
    }

    const state = decodeState(params.state);
    if (!state.redirect_uri || !is_valid_redirect_uri(state.redirect_uri)) {
      throw new HttpException(400, 'Invalid redirect_uri in OAuth state');
    }

    const token_response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: params.code,
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        redirect_uri: config.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!token_response.ok) {
      throw new HttpException(401, 'Failed to exchange Google OAuth code');
    }

    const token_data = (await token_response.json()) as { access_token?: string };
    if (!token_data.access_token) {
      throw new HttpException(401, 'Google OAuth access token missing');
    }

    const profile_response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token_data.access_token}` },
    });

    if (!profile_response.ok) {
      throw new HttpException(401, 'Failed to fetch Google profile');
    }

    const profile = (await profile_response.json()) as GoogleUserInfo;
    if (!profile.email || !profile.id) {
      throw new HttpException(401, 'Google profile missing required identifiers');
    }

    const existing_by_oauth = await this.repository.findUserByOAuthAccount(GOOGLE_PROVIDER, profile.id);
    const existing_by_email = existing_by_oauth ? null : await this.repository.findUserByEmail(profile.email.toLowerCase());

    if (state.action === 'signin' && !existing_by_oauth && !existing_by_email) {
      return {
        redirect_uri: state.redirect_uri,
        state: state.client_state,
        error: 'user_not_found',
      };
    }

    const user =
      existing_by_oauth ??
      existing_by_email ??
      (await this.repository.createUser({
        email: profile.email.toLowerCase(),
        name: profile.name ?? null,
        avatar_url: profile.picture ?? null,
      }));

    await this.repository.upsertOAuthAccount({
      user_id: user.id,
      provider: GOOGLE_PROVIDER,
      provider_account_id: profile.id,
    });

    if (existing_by_oauth || existing_by_email) {
      await this.repository.updateUserProfile({
        user_id: user.id,
        name: profile.name ?? user.name ?? null,
        avatar_url: profile.picture ?? (user as { avatar_url?: string | null }).avatar_url ?? null,
      });
    }

    return this.issueAuthCodeForUser({
      user_id: user.id,
      redirect_uri: state.redirect_uri,
      state: state.client_state,
    });
  }

  private async buildSession(user: AuthUser) {
    const now = new Date();
    const active_membership = await onboardingRepository.resolveActiveMembership(user.id);
    const access_token = jwt.sign(
      {
        user_id: user.id,
        tenant_id: active_membership?.tenant_id ?? '',
        tenant_role: active_membership?.role,
        app_role: user.app_role,
      },
      config.JWT_SECRET,
      ACCESS_TOKEN_SIGN_OPTIONS,
    );

    const refresh_token = randomToken(48);
    const refresh_expiry = new Date(now.getTime() + config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.repository.createRefreshToken({
      user_id: user.id,
      token_hash: hashToken(refresh_token),
      expires_at: refresh_expiry,
    });

    const memberships = await onboardingRepository.listMemberships(user.id);
    const onboarding_context = await onboardingService.getContext(user.id);

    return {
      access_token,
      refresh_token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url ?? null,
        app_role: user.app_role,
        needs_password: user.password === null,
      },
      active_account: onboarding_context.active_account,
      memberships: memberships.map((membership) => ({
        tenant_id: membership.tenant.id,
        slug: membership.tenant.slug,
        name: membership.tenant.name,
        member_role: membership.role,
      })),
      onboarding_context,
    };
  }

  async exchangeExtensionCode(code: string) {
    const now = new Date();
    const auth_code = await this.repository.findActiveAuthCodeByHash(hashToken(code), now);
    if (!auth_code) {
      throw new HttpException(401, 'Invalid or expired auth code');
    }

    await this.repository.markAuthCodeUsed(auth_code.id, now);

    return this.buildSession({
      id: auth_code.user.id,
      email: auth_code.user.email,
      name: auth_code.user.name,
      app_role: auth_code.user.app_role,
      password: auth_code.user.password,
      avatar_url: (auth_code.user as { avatar_url?: string | null }).avatar_url ?? null,
    });
  }

  async loginWithEmail(email: string, password_attempt: string) {
    const user = await this.repository.findUserByEmail(email.toLowerCase());
    if (!user || user.password === null) {
      throw new HttpException(401, 'Invalid email or password');
    }

    const is_valid = await comparePassword(password_attempt, user.password);
    if (!is_valid) {
      throw new HttpException(401, 'Invalid email or password');
    }

    return this.buildSession({
      id: user.id,
      email: user.email,
      name: user.name,
      app_role: user.app_role,
      password: user.password,
      avatar_url: (user as { avatar_url?: string | null }).avatar_url ?? null,
    });
  }

  async refreshAccessToken(refresh_token: string) {
    const now = new Date();
    const token = await this.repository.findValidRefreshTokenByHash(hashToken(refresh_token), now);
    if (!token) {
      throw new HttpException(401, 'Invalid or expired refresh token');
    }

    await this.repository.revokeRefreshToken(token.id, now);

    const active_membership = await onboardingRepository.resolveActiveMembership(token.user_id);
    const access_token = jwt.sign(
      {
        user_id: token.user_id,
        tenant_id: active_membership?.tenant_id ?? '',
        tenant_role: active_membership?.role,
        app_role: token.user.app_role,
      },
      config.JWT_SECRET,
      ACCESS_TOKEN_SIGN_OPTIONS,
    );

    const next_refresh_token = randomToken(48);
    const refresh_expiry = new Date(now.getTime() + config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.repository.createRefreshToken({
      user_id: token.user_id,
      token_hash: hashToken(next_refresh_token),
      expires_at: refresh_expiry,
    });

    return { access_token, refresh_token: next_refresh_token };
  }

  async switchAccount(params: { user_id: string; tenant_id: string }) {
    const membership = await this.repository.findMembership(params.user_id, params.tenant_id);
    if (!membership) {
      throw new HttpException(403, 'This account is not available to your user');
    }
    await this.repository.setActiveTenantForUser(params.user_id, params.tenant_id);

    const user = await this.repository.findUserById(params.user_id);
    if (!user) {
      throw new HttpException(404, 'User not found');
    }

    const session = await this.buildSession({
      id: user.id,
      email: user.email,
      name: user.name,
      app_role: user.app_role,
      password: user.password,
      avatar_url: (user as { avatar_url?: string | null }).avatar_url ?? null,
    });

    return session;
  }

  async setPassword(user_id: string, new_password: string) {
    const user = await this.repository.findUserById(user_id);
    if (!user) {
      throw new HttpException(404, 'User not found');
    }
    const hashed_password = await hashPassword(new_password);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed_password },
    });
  }

  async logout(refresh_token: string) {
    const now = new Date();
    const token = await this.repository.findValidRefreshTokenByHash(hashToken(refresh_token), now);
    if (!token) return { revoked: false };
    await this.repository.revokeRefreshToken(token.id, now);
    return { revoked: true };
  }

  async issueAuthCodeForUser(params: { user_id: string; redirect_uri: string; state?: string }) {
    if (!is_valid_redirect_uri(params.redirect_uri)) {
      throw new HttpException(400, 'Invalid redirect_uri');
    }

    const auth_code = randomToken(24);
    await this.repository.createAuthCode({
      user_id: params.user_id,
      code_hash: hashToken(auth_code),
      redirect_uri: params.redirect_uri,
      state: params.state,
      expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS),
    });

    return {
      redirect_uri: params.redirect_uri,
      code: auth_code,
      state: params.state,
    };
  }

  async getMe(user_id: string) {
    const user = await this.repository.findUserById(user_id);
    if (!user) {
      throw new HttpException(404, 'User not found');
    }
    const active_membership = await onboardingRepository.resolveActiveMembership(user_id);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: (user as { avatar_url?: string | null }).avatar_url ?? null,
      app_role: user.app_role,
      needs_password: user.password === null,
      active_tenant_id: active_membership?.tenant_id ?? null,
      active_tenant_role: active_membership?.role ?? null,
    };
  }
}

export const authService = new AuthService();
