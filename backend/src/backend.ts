import bcrypt from 'bcryptjs';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { leadIntelligenceService } from './utils/lead-intelligence/lead-intelligence.service';
import express, { Application, NextFunction, Request, RequestHandler, Response, Router } from 'express';
import helmet from 'helmet';
import jwt, { SignOptions } from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { AccountJoinRequestStatus, AppRole, AuthCodeStatus, Campaign, CampaignVersion, CaptureSession, NodeType, Prisma, PrismaClient, PromptNode, TenantMember, User as PrismaUser } from '@prisma/client';
import { Job, JobsOptions, Queue, QueueEvents, Worker } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';

dotenv.config();

const getEnv = (key: string, defaultValue?: string): string => {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
};

const PORT = parseInt(getEnv('PORT', '4000'), 10);
const NODE_ENV = getEnv('NODE_ENV', 'development');
const DATABASE_URL = getEnv('DATABASE_URL', '');
const JWT_SECRET = getEnv('JWT_SECRET', 'changeme');
const JWT_ACCESS_TTL = getEnv('JWT_ACCESS_TTL', '1h');
const JWT_REFRESH_TTL_DAYS = parseInt(getEnv('JWT_REFRESH_TTL_DAYS', '30'), 10);
const GOOGLE_CLIENT_ID = getEnv('GOOGLE_CLIENT_ID', '');
const GOOGLE_CLIENT_SECRET = getEnv('GOOGLE_CLIENT_SECRET', '');
const GOOGLE_REDIRECT_URI = getEnv('GOOGLE_REDIRECT_URI', '');
const OAUTH_DEFAULT_EXTENSION_REDIRECT_URI = getEnv('OAUTH_DEFAULT_EXTENSION_REDIRECT_URI', '');
const CORS_ALLOWED_ORIGINS = getEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:5173,https://ai-seo-monorepo.vercel.app');
const REQUEST_BODY_LIMIT = getEnv('REQUEST_BODY_LIMIT', '2mb');
const GEMINI_API_KEY = getEnv('GEMINI_API_KEY', '');
const SEMRUSH_URL = getEnv('SEMRUSH_URL', '');
const SEMRUSH_LOG_FULL_RESPONSE = getEnv('SEMRUSH_LOG_FULL_RESPONSE', 'false');
const AHREFS_URL = getEnv('AHREFS_URL', '');
const REDIS_URL = getEnv('REDIS_URL', 'redis://127.0.0.1:6379');

const config = {
  PORT, NODE_ENV, DATABASE_URL, JWT_SECRET, JWT_ACCESS_TTL, JWT_REFRESH_TTL_DAYS,
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, OAUTH_DEFAULT_EXTENSION_REDIRECT_URI,
  CORS_ALLOWED_ORIGINS, REQUEST_BODY_LIMIT, AHREFS_URL, REDIS_URL, GEMINI_API_KEY,
  SEMRUSH_URL, SEMRUSH_LOG_FULL_RESPONSE,
} as const;

// --- Merged from core/api-response.ts ---
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
}

export class ApiResponse {
  static success<T>(data: T, message?: string): ApiSuccessResponse<T> {
    return {
      success: true,
      data,
      message,
    };
  }
}


// --- Merged from core/controller.ts ---
/**
 * Base controller class.
 * Extend this class for shared controller utilities if needed.
 */
export abstract class BaseController {}


// --- Merged from core/http-exception.ts ---
export class HttpException extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}


// --- Merged from core/repository.ts ---
/**
 * Base repository class.
 * Extend this class for shared repository utilities if needed.
 */
export abstract class BaseRepository {}


// --- Merged from core/service.ts ---
/**
 * Base service class.
 * Extend this class for shared service utilities if needed.
 */
export abstract class BaseService {}


// --- Merged from index.ts ---


// --- Merged from app.ts ---
export async function createApp(): Promise<Application> {
  const app = express();
  await expressLoader(app);
  logger.info('Express initialized in ' + config.NODE_ENV + ' mode');
  return app;
}

// --- Merged from loaders/database.ts ---

export const initDatabase = async (): Promise<void> => {
  await prisma.$connect();
  logger.info('Database connected via Prisma');
};


// --- Merged from loaders/express.ts ---


// workspace_workflow_router is the second set of campaign routes (workspace API)
// It shares the same campaign_router instance and is declared after campaign routes are set up
// We use a proxy variable here to satisfy forward reference
let workspace_workflow_router: Router;

const expressLoader = async (app: Application): Promise<void> => {
  const normalize_origin = (value: string): string => value.trim().replace(/\/+$/, '');
  const allowed_origins = config.CORS_ALLOWED_ORIGINS
    .split(',')
    .map((entry) => normalize_origin(entry))
    .filter(Boolean);

  // ── Security guard: reject wildcard CORS in production ──────────────────
  if (config.NODE_ENV === 'production' && allowed_origins.includes('*')) {
    const msg = '[security] CORS_ALLOWED_ORIGINS contains a wildcard "*" — this is not allowed in production. Set explicit origins.';
    logger.error(msg);
    throw new Error(msg);
  }

  // ── Helmet — HTTP security headers (must be first middleware) ───────────
  app.use(helmet());

  // ── Per-request logger — goes right after helmet so every request is timed
  app.use(requestLoggerMiddleware);

  // ── CORS ────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (origin.startsWith('chrome-extension://')) {
          callback(null, true);
          return;
        }
        const normalized_origin = normalize_origin(origin);
        if (allowed_origins.includes('*') || allowed_origins.includes(normalized_origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin not allowed: ${origin}`));
      },
    }),
  );

  app.use(express.json({ limit: config.REQUEST_BODY_LIMIT }));

  // ── Register module routers ──────────────────────────────────────────────
  // Note: rate limiting is applied per-route inside auth.routes.ts
  app.use('/api/auth', auth_router);
  app.use('/api/onboarding', onboarding_router);
  app.use('/api/campaigns', campaign_router);
  app.use('/api/workspaces', workspace_workflow_router);
  app.use('/api/accounts', account_router);
  app.use('/api/domains', domain_router);
  app.use('/api/users', user_router);
  // roles_router: no routes defined yet
  // app.use('/api/admin/users', roles_router);
  app.use('/api/analytics', analytics_router);

  // Error middleware must be registered last
  app.use(errorMiddleware);
};

export const express_ts_entry =  expressLoader;
// --- Merged from loaders/index.ts ---

const loaders = async (): Promise<Application> => {
  await initDatabase();
  const app = await createApp();
  return app;
};

export const index_ts_entry = loaders;


// --- Merged from middlewares/auth.middleware.ts ---


export type AuthRequest = AuthenticatedRequest;

export const authMiddleware = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HttpException(401, 'Authorization header missing or invalid');
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as {
      user_id?: string;
      userId?: string;
      tenant_id?: string;
      tenant_role?: string;
      app_role?: string;
    };
    const user_id = payload.user_id ?? payload.userId;
    if (!user_id) {
      throw new HttpException(401, 'Invalid token payload');
    }
    req.user = {
      id: user_id,
      tenant_id: payload.tenant_id ?? '',
      tenant_role: payload.tenant_role,
      app_role: payload.app_role ?? 'user',
    };
    return next();
  } catch (err) {
    logger.debug('JWT verification failed', err);
    throw new HttpException(401, 'Invalid or expired token');
  }
};
// --- Merged from middlewares/error.middleware.ts ---


export const errorMiddleware = (
  err: Error,
  _req: Request,
  res: Response<ApiErrorResponse>,
  _next: NextFunction,
) => {
  const payload_too_large =
    (err as { type?: string }).type === 'entity.too.large' ||
    (err as { name?: string }).name === 'PayloadTooLargeError';
  if (payload_too_large) {
    logger.warn('Payload too large', { message: err.message });
    return res.status(413).json({ success: false, message: 'Payload too large. Reduce request size.' });
  }

  if (err instanceof HttpException) {
    logger.warn('Handled HttpException', { status: err.status, message: err.message });
    return res.status(err.status).json({ success: false, message: err.message });
  }

  logger.error('Unhandled error', err);
  return res.status(500).json({ success: false, message: 'Internal Server Error' });
};

// --- Merged from middlewares/request-logger.middleware.ts ---


const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

/**
 * Per-request HTTP logger.
 * Dev:  →  POST /api/auth/code/exchange  200  47ms
 * Prod: {"level":"info","method":"POST","path":"/api/auth/code/exchange","status":200,"ms":47}
 */
export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    res.on('finish', () => {
        const ms = Date.now() - start;
        const method = req.method.padEnd(6);
        const path = req.path;
        const status = res.statusCode;

        if (IS_PRODUCTION) {
            logger.info('http', { method: req.method, path, status, ms });
        } else {
            // Colour code by status bucket: 2xx green, 3xx cyan, 4xx yellow, 5xx red
            const statusStr =
                status >= 500 ? `\x1b[31m${status}\x1b[0m` :
                    status >= 400 ? `\x1b[33m${status}\x1b[0m` :
                        status >= 300 ? `\x1b[36m${status}\x1b[0m` :
                            `\x1b[32m${status}\x1b[0m`;

            // eslint-disable-next-line no-console
            console.log(`\x1b[90m→\x1b[0m  ${method} ${path.padEnd(45)} ${statusStr}  ${ms}ms`);
        }
    });

    next();
};
// --- Merged from middlewares/require-account-role.middleware.ts ---


export const requireAccountRole = (allowed_roles: string[]) => {
  const normalized = allowed_roles.map((role) => role.toLowerCase());
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const role = req.user?.tenant_role?.toLowerCase();
    if (!role) {
      throw new HttpException(403, 'Account role required');
    }
    if (!normalized.includes(role)) {
      throw new HttpException(403, 'Insufficient account permissions');
    }
    next();
  };
};
// --- Merged from middlewares/require-role.middleware.ts ---

export const requireRole = (requiredRole: AppRole | string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const authReq = req as AuthenticatedRequest;
        const user = authReq.user;

        if (!user || user.app_role !== requiredRole) {
            res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
            return;
        }

        next();
    };
};
// --- Merged from modules/account/account.controller.ts ---


class AccountController {
  constructor(private readonly service: AccountService = accountService) {}

  listMemberships = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const data = await this.service.listMemberships(req.user.id);
    return res.json(ApiResponse.success(data));
  };

  createJoinRequest = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const payload = createJoinRequestSchema.parse(req.body ?? {});
    const data = await this.service.createJoinRequest({
      user_id: req.user.id,
      account_slug: payload.account_slug,
    });
    return res.status(201).json(ApiResponse.success(data, 'Join request submitted'));
  };

  listJoinRequests = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.tenant_id) {
      throw new HttpException(400, 'Active account is required');
    }
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const data = await this.service.listJoinRequests(req.user.tenant_id, status);
    return res.json(ApiResponse.success(data));
  };

  approveJoinRequest = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id || !req.user?.tenant_id) {
      throw new HttpException(400, 'Active account is required');
    }
    const { request_id } = req.params;
    const data = await this.service.approveJoinRequest({
      tenant_id: req.user.tenant_id,
      approver_user_id: req.user.id,
      request_id,
    });
    return res.json(ApiResponse.success(data, 'Join request approved'));
  };

  rejectJoinRequest = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id || !req.user?.tenant_id) {
      throw new HttpException(400, 'Active account is required');
    }
    const { request_id } = req.params;
    const data = await this.service.rejectJoinRequest({
      tenant_id: req.user.tenant_id,
      approver_user_id: req.user.id,
      request_id,
    });
    return res.json(ApiResponse.success(data, 'Join request rejected'));
  };
}

export const accountController = new AccountController();
// --- Merged from modules/account/account.repository.ts ---


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
// --- Merged from modules/account/account.routes.ts ---


const account_router = Router();

account_router.get('/memberships', authMiddleware, accountController.listMemberships);
account_router.post('/join-requests', authMiddleware, accountController.createJoinRequest);
account_router.get('/join-requests', authMiddleware, requireAccountRole(['owner', 'admin']), accountController.listJoinRequests);
account_router.post('/join-requests/:request_id/approve', authMiddleware, requireAccountRole(['owner', 'admin']), accountController.approveJoinRequest);
account_router.post('/join-requests/:request_id/reject', authMiddleware, requireAccountRole(['owner', 'admin']), accountController.rejectJoinRequest);

export { account_router };
// --- Merged from modules/account/account.service.ts ---


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
    return rows.map((row: any) => ({
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
// --- Merged from modules/account/dto/create-join-request.dto.ts ---

export const createJoinRequestSchema = z.object({
  account_slug: z.string().min(2).max(64),
});

export type CreateJoinRequestDto = z.infer<typeof createJoinRequestSchema>;
// --- Merged from modules/analytics/analytics.controller.ts ---

const analytics_router = Router();

const trackEvent: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const user = authReq.user;
        if (!user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const parseResult = analyticsEventSchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({ error: 'Invalid event payload', details: parseResult.error.format() });
            return;
        }

        const result = await analyticsService.trackEvent(user.tenant_id, user.id, parseResult.data);
        res.status(201).json(result);
    } catch (error: any) {
        console.error('[AnalyticsController] trackEvent Error:', error);
        res.status(500).json({ error: 'Internal server error tracking event' });
    }
};

const cleanupOldEvents: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const days = Number(req.query.days) || 90;
        const result = await analyticsService.deleteOldEvents(days);
        res.status(200).json({ success: true, ...result });
    } catch (error: any) {
        console.error('[AnalyticsController] cleanupOldEvents Error:', error);
        res.status(500).json({ error: 'Internal server error cleaning up events' });
    }
};

// ── Admin-only aggregate endpoints ──────────────────────────────
const adminStats: RequestHandler = async (_req: Request, res: Response): Promise<void> => {
    const data = await analyticsService.getAdminStats();
    res.json({ success: true, data });
};

const adminListUsers: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const segment = typeof req.query.segment === 'string' ? req.query.segment : undefined;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const data = await analyticsService.listUsers({ search, segment, limit, offset });
    res.json({ success: true, data });
};

const adminListEvents: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    const event_name = typeof req.query.event_name === 'string' ? req.query.event_name : undefined;
    const user_id = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const data = await analyticsService.listEvents({ event_name, user_id, limit, offset });
    res.json({ success: true, data });
};

const adminListSignals: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    const signal_type = typeof req.query.signal_type === 'string' ? req.query.signal_type : undefined;
    const user_id = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const data = await analyticsService.listLeadSignals({ signal_type, user_id, limit, offset });
    res.json({ success: true, data });
};

analytics_router.post('/events', authMiddleware, trackEvent);
analytics_router.post('/cleanup', authMiddleware, requireRole('admin'), cleanupOldEvents);
analytics_router.get('/admin/stats', authMiddleware, requireRole('admin'), adminStats);
analytics_router.get('/admin/users', authMiddleware, requireRole('admin'), adminListUsers);
analytics_router.get('/admin/events', authMiddleware, requireRole('admin'), adminListEvents);
analytics_router.get('/admin/signals', authMiddleware, requireRole('admin'), adminListSignals);

// analytics_router already declared above
// --- Merged from modules/analytics/analytics.service.ts ---

const PII_KEYS = ['email', 'password', 'token', 'authorization', 'secret', 'phone', 'ssn', 'address'];

function scrubPII(obj: Record<string, any>): Record<string, any> {
    if (!obj || typeof obj !== 'object') return obj;
    const scrubbed = { ...obj };
    for (const [key, value] of Object.entries(scrubbed)) {
        if (PII_KEYS.some(pii => key.toLowerCase().includes(pii))) {
            scrubbed[key] = '[SCRUBBED]';
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            scrubbed[key] = scrubPII(value);
        }
    }
    return scrubbed;
}

export class AnalyticsService {
    async trackEvent(tenant_id: string, user_id: string, event: AnalyticsEventDto) {
        const safeProperties = scrubPII(event.properties);
        console.log(`[Analytics] Tracked Event: ${event.event_name} by user: ${user_id}`);

        return prisma.analyticsEvent.create({
            data: {
                tenant_id,
                user_id,
                campaign_id: event.campaign_id,
                session_id: event.session_id,
                event_name: event.event_name,
                properties: safeProperties as any,
            },
        });
    }

    async deleteOldEvents(days: number = 90) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        console.log(`[Analytics] Deleting events older than ${cutoffDate.toISOString()}`);

        const result = await prisma.analyticsEvent.deleteMany({
            where: {
                created_at: {
                    lt: cutoffDate,
                },
            },
        });

        console.log(`[Analytics] Deleted ${result.count} old events.`);
        return { count: result.count, cutoff: cutoffDate };
    }

    /** Admin-only: aggregate summary stats */
    async getAdminStats() {
        const [userCount, eventCount, signalCount, campaignCount] = await Promise.all([
            prisma.user.count(),
            prisma.analyticsEvent.count(),
            prisma.leadSignal.count(),
            prisma.campaign.count(),
        ]);
        return { user_count: userCount, event_count: eventCount, signal_count: signalCount, campaign_count: campaignCount };
    }

    /** Admin-only: list all users with lead score + signal count */
    async listUsers(opts: { search?: string; segment?: string; limit?: number; offset?: number }) {
        const { search, segment, limit = 50, offset = 0 } = opts;
        const where: any = {};
        if (search) where.OR = [{ email: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }];
        if (segment) where.lead_segment = segment;

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true, email: true, name: true, app_role: true,
                    created_at: true,
                    lead_score_current: true, lead_segment: true, lead_score_updated_at: true, scoring_model_version: true,
                    company_name: true, company_domain: true, linkedin_url: true, job_role: true,
                    _count: { select: { leadSignals: true } }
                },
                orderBy: { created_at: 'desc' },
                take: limit, skip: offset,
            }),
            prisma.user.count({ where }),
        ]);
        return { users, total };
    }

    /** Admin-only: list analytics events with filters */
    async listEvents(opts: { event_name?: string; user_id?: string; limit?: number; offset?: number }) {
        const { event_name, user_id, limit = 50, offset = 0 } = opts;
        const where: any = {};
        if (event_name) where.event_name = { contains: event_name, mode: 'insensitive' };
        if (user_id) where.user_id = user_id;

        const [events, total] = await Promise.all([
            prisma.analyticsEvent.findMany({
                where,
                include: { user: { select: { email: true, name: true } } },
                orderBy: { created_at: 'desc' },
                take: limit, skip: offset,
            }),
            prisma.analyticsEvent.count({ where }),
        ]);
        return { events, total };
    }

    /** Admin-only: list lead signals */
    async listLeadSignals(opts: { signal_type?: string; user_id?: string; limit?: number; offset?: number }) {
        const { signal_type, user_id, limit = 50, offset = 0 } = opts;
        const where: any = {};
        if (signal_type) where.signal_type = { contains: signal_type, mode: 'insensitive' };
        if (user_id) where.user_id = user_id;

        const [signals, total] = await Promise.all([
            prisma.leadSignal.findMany({
                where,
                include: { user: { select: { email: true, name: true } } },
                orderBy: { created_at: 'desc' },
                take: limit, skip: offset,
            }),
            prisma.leadSignal.count({ where }),
        ]);
        return { signals, total };
    }
}

export const analyticsService = new AnalyticsService();
// --- Merged from modules/analytics/dto/analytics.dto.ts ---

export const analyticsEventSchema = z.object({
    event_name: z.enum([
        'extension_installed',
        'first_campaign_created',
        'click_through_link',
        'session_duration',
        'extension_session_duration',
        'web_session_duration',
        'tab_active_time',
        'focus_blur_events',
        // add more from taxonomy as needed
    ]),
    campaign_id: z.string().optional(),
    session_id: z.string().optional(),
    properties: z.record(z.any()).default({}),
});

export type AnalyticsEventDto = z.infer<typeof analyticsEventSchema>;
// --- Merged from modules/auth/auth.controller.ts ---


class AuthController extends BaseController {
  constructor(private readonly service: AuthService = authService) {
    super();
  }

  startGoogle = async (req: Request, res: Response) => {
    const redirect_uri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const action = typeof req.query.action === 'string' && ['signin', 'signup'].includes(req.query.action) ? (req.query.action as 'signin' | 'signup') : undefined;
    const url = this.service.startGoogleOAuth({ redirect_uri, client_state: state, action });
    return res.redirect(url);
  };

  googleCallback = async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const googleError = typeof req.query.error === 'string' ? req.query.error : '';

    if (!state) {
      throw new HttpException(400, 'Missing OAuth state');
    }

    // Google returned an error (user denied, misconfiguration, etc.) or issued no code.
    // Decode the state so we can redirect the user back gracefully instead of crashing.
    if (googleError || !code) {
      const decoded = this.service.decodeOAuthState(state);
      const redirect_url = new URL(decoded.redirect_uri);
      redirect_url.searchParams.set('error', googleError || 'access_denied');
      if (decoded.client_state) redirect_url.searchParams.set('state', decoded.client_state);
      return res.redirect(redirect_url.toString());
    }

    const result = await this.service.completeGoogleOAuth({ code, state });
    const redirect_url = new URL(result.redirect_uri);

    if ('error' in result && result.error) {
      redirect_url.searchParams.set('error', result.error);
    } else if ('code' in result && result.code) {
      redirect_url.searchParams.set('code', result.code);
    }

    if (result.state) {
      redirect_url.searchParams.set('state', result.state);
    }
    return res.redirect(redirect_url.toString());
  };


  exchangeExtensionCode = async (req: Request, res: Response) => {
    const validated = exchangeExtensionSchema.parse(req.body);
    const data = await this.service.exchangeExtensionCode(validated.code);
    return res.json(ApiResponse.success(data, 'Extension auth exchange successful'));
  };

  issueAuthCode = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const validated = issueAuthCodeSchema.parse(req.body);
    const data = await this.service.issueAuthCodeForUser({
      user_id: req.user.id,
      redirect_uri: validated.redirect_uri,
      state: validated.state,
    });
    return res.json(ApiResponse.success(data, 'Auth code issued'));
  };

  refreshToken = async (req: Request, res: Response) => {
    const validated = refreshTokenSchema.parse(req.body);
    const data = await this.service.refreshAccessToken(validated.refresh_token);
    return res.json(ApiResponse.success(data, 'Token refreshed'));
  };

  switchAccount = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const validated = switchAccountSchema.parse(req.body);
    const data = await this.service.switchAccount({
      user_id: req.user.id,
      tenant_id: validated.tenant_id,
    });
    return res.json(ApiResponse.success(data, 'Account switched'));
  };

  logout = async (req: Request, res: Response) => {
    const validated = refreshTokenSchema.parse(req.body);
    const data = await this.service.logout(validated.refresh_token);
    return res.json(ApiResponse.success(data, 'Logout processed'));
  };

  login = async (req: Request, res: Response) => {
    const validated = loginSchema.parse(req.body);
    const data = await this.service.loginWithEmail(validated.email, validated.password);
    return res.json(ApiResponse.success(data, 'Login successful'));
  };

  setPassword = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const validated = setPasswordSchema.parse(req.body);
    await this.service.setPassword(req.user.id, validated.password);
    return res.json(ApiResponse.success(null, 'Password updated successfully'));
  };

  me = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const data = await this.service.getMe(req.user.id);
    return res.json(ApiResponse.success(data));
  };
}

export const authController = new AuthController();
// --- Merged from modules/auth/auth.repository.ts ---


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
// --- Merged from modules/auth/auth.routes.ts ---


const auth_router = Router();

// Rate-limit only the token-issuing endpoints that could be brute-forced.
// OAuth flows (google/start, google/callback, extension/exchange) are
// exempt — they involve redirects and are already gated by Google's OAuth.
// Disabled in development so local testing is never blocked.
const isDev = process.env['NODE_ENV'] !== 'production';
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isDev ? 0 : 15,      // 0 = unlimited in dev
    skip: () => isDev,         // extra guard: skip entirely in dev
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests — please try again later.' },
});

auth_router.get('/google/start', authController.startGoogle);
auth_router.get('/google/callback', authController.googleCallback);
auth_router.post('/login', authRateLimiter, authController.login);
auth_router.post('/set-password', authMiddleware, authRateLimiter, authController.setPassword);
auth_router.post('/extension/exchange', authController.exchangeExtensionCode);
auth_router.post('/code/exchange', authController.exchangeExtensionCode);
auth_router.post('/issue-code', authMiddleware, authController.issueAuthCode);
auth_router.post('/token/refresh', authRateLimiter, authController.refreshToken); // rate-limited
auth_router.post('/logout', authRateLimiter, authController.logout);              // rate-limited
auth_router.post('/switch-account', authMiddleware, authController.switchAccount);
auth_router.get('/me', authMiddleware, authController.me);

export { auth_router };
// --- Merged from modules/auth/auth.service.ts ---


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
// --- Merged from modules/auth/dto/exchange-extension.dto.ts ---

export const exchangeExtensionSchema = z.object({
  code: z.string().min(1),
});

export type ExchangeExtensionDto = z.infer<typeof exchangeExtensionSchema>;
// --- Merged from modules/auth/dto/issue-auth-code.dto.ts ---

export const issueAuthCodeSchema = z.object({
  redirect_uri: z.string().min(1),
  state: z.string().optional(),
});

export type IssueAuthCodeDto = z.infer<typeof issueAuthCodeSchema>;
// --- Merged from modules/auth/dto/login.dto.ts ---

export const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

export type LoginDto = z.infer<typeof loginSchema>;
// --- Merged from modules/auth/dto/refresh-token.dto.ts ---

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
});

export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;
// --- Merged from modules/auth/dto/set-password.dto.ts ---

export const setPasswordSchema = z.object({
    password: z.string().min(8, 'Password must be at least 8 characters long'),
});

export type SetPasswordDto = z.infer<typeof setPasswordSchema>;
// --- Merged from modules/auth/dto/switch-account.dto.ts ---

export const switchAccountSchema = z.object({
  tenant_id: z.string().min(1),
});

export type SwitchAccountDto = z.infer<typeof switchAccountSchema>;
// --- Merged from modules/auth/roles.controller.ts ---


auth_router.post('/:userId/role', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId } = req.params;
        const { role } = req.body;

        if (!role || !['admin', 'user'].includes(role)) {
            res.status(400).json({ error: 'Invalid role provided. Must be admin or user.' });
            return;
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { app_role: role as AppRole },
        });

        res.json({ message: 'Role updated successfully', user: { id: updatedUser.id, role: updatedUser.app_role } });
    } catch (error) {
        console.error('[RolesController] Update role error:', error);
        res.status(500).json({ error: 'Internal server error resolving role assignment' });
    }
});

// roles_router uses a local Router declared above
// --- Merged from modules/campaign/campaign.controller.ts ---

const parse_version_id = (raw: unknown): string | undefined => {
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : undefined;
};

const get_campaign_id = (req: AuthRequest): string => req.params.campaign_id ?? req.params.workspace_id;
const get_version_id = (req: AuthRequest): string | undefined => req.params.version_id ?? parse_version_id(req.query.version_id);
const parse_analytics_range = (raw: unknown): '7d' | '30d' | 'all' => {
    if (raw === '7d' || raw === '30d' || raw === 'all') return raw;
    return '30d';
};

const parse_provider = (raw: unknown): 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'unknown' => {
    if (raw === 'chatgpt' || raw === 'claude' || raw === 'gemini' || raw === 'perplexity' || raw === 'grok' || raw === 'unknown') {
        return raw;
    }
    throw new HttpException(400, 'Invalid provider');
};

export class CampaignController {
    async createCampaign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const data = createCampaignSchema.parse(req.body);

            const campaign = await campaignService.createCampaign(tenant_id, user_id, data);
            res.status(201).json(ApiResponse.success(campaign, 'Campaign created'));
        } catch (error) {
            next(error);
        }
    }

    async listCampaigns(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const domain_id = typeof req.query.domain_id === 'string' ? req.query.domain_id : undefined;
            const campaigns = await campaignService.listCampaigns(tenant_id, domain_id);
            res.json(ApiResponse.success(campaigns));
        } catch (error) {
            next(error);
        }
    }

    async getCampaign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const campaign = await campaignService.getCampaign(tenant_id, campaign_id);
            res.json(ApiResponse.success(campaign));
        } catch (error) {
            next(error);
        }
    }

    async updateCampaign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const data = updateCampaignSchema.parse(req.body);

            const updated = await campaignService.updateCampaign(tenant_id, campaign_id, data);
            if (!updated) return res.status(404).json({ success: false, error: 'Campaign not found' });
            res.json(ApiResponse.success(updated, 'Campaign updated'));
        } catch (error) {
            next(error);
        }
    }

    async deleteCampaign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;

            const deleted = await campaignService.deleteCampaign(tenant_id, campaign_id);
            if (!deleted) return res.status(404).json({ success: false, error: 'Campaign not found' });
            res.status(200).json(ApiResponse.success({ campaign_id, deleted: true }, 'Campaign deleted'));
        } catch (error) {
            next(error);
        }
    }

    async getActiveTree(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const version_id = parse_version_id(req.query.version_id);
            const tree = await campaignService.getActiveTree(tenant_id, campaign_id, version_id);
            res.json(ApiResponse.success(tree));
        } catch (error) {
            next(error);
        }
    }

    async getActiveChatThreads(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;
            const version_id = parse_version_id(req.query.version_id);

            const threads = await campaignService.getActiveChatThreads(tenant_id, campaign_id, limit, offset, version_id);
            res.json(ApiResponse.success(threads));
        } catch (error) {
            next(error);
        }
    }

    async ingestTurn(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = parse_version_id(req.query.version_id);
            const data = ingestTurnSchema.parse(req.body);

            const tree = await campaignService.ingestTurn(tenant_id, user_id, campaign_id, data, version_id);
            const workflow = await campaignService.getWorkflowState(
                tenant_id,
                campaign_id,
                tree?.version?.id ?? version_id,
            );
            const normalized_prompt = data.prompt.trim().replace(/\s+/g, ' ').toLowerCase();
            const source_prompt_id =
                typeof data.metadata?.source_prompt_id === 'string' ? data.metadata.source_prompt_id : undefined;
            const executed_prompt = workflow.executedPrompts.find((item) => {
                if (source_prompt_id && item.sourcePromptId === source_prompt_id) return true;
                return item.text.trim().replace(/\s+/g, ' ').toLowerCase() === normalized_prompt;
            }) ?? null;
            res.status(201).json(ApiResponse.success({ ...tree, executedPrompt: executed_prompt }, 'Turn ingested'));
        } catch (error) {
            next(error);
        }
    }

    async refire(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const { campaign_id, version_number } = req.params;

            const newVersion = await campaignService.refire(tenant_id, campaign_id, user_id, parseInt(version_number));
            res.status(201).json(ApiResponse.success(newVersion, 'Refired'));
        } catch (error) {
            next(error);
        }
    }

    async refreshNode(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const { campaign_id, node_id } = req.params;
            const version_id = parse_version_id(req.query.version_id);
            const payload = refreshNodeSchema.parse(req.body ?? {});
            const result = await campaignService.refreshNode(tenant_id, user_id, campaign_id, node_id, payload, version_id);
            res.status(202).json(ApiResponse.success(result, 'Refresh accepted'));
        } catch (error) {
            next(error);
        }
    }
    // ── Short-form aliases ────────────────────────────────────────────────────
    // The web/extension clients call /:id/tree and /:id/chat-threads directly.
    // These delegate to the active-version handlers and return empty gracefully
    // for brand-new campaigns that have no data yet.

    async getTree(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const version_id = parse_version_id(req.query.version_id);
            const tree = await campaignService.getActiveTree(tenant_id, campaign_id, version_id);
            res.json(ApiResponse.success(tree));
        } catch (error) {
            next(error);
        }
    }

    async getChatThreads(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;
            const version_id = parse_version_id(req.query.version_id);
            const threads = await campaignService.getActiveChatThreads(tenant_id, campaign_id, limit, offset, version_id);
            res.json(ApiResponse.success(threads));
        } catch (error) {
            next(error);
        }
    }

    async linkChatThread(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const { campaign_id } = req.params;
            const version_id = parse_version_id(req.query.version_id);
            const data = linkChatThreadSchema.parse(req.body);

            const thread = await campaignService.linkChatThread(tenant_id, user_id, campaign_id, data, version_id);
            res.status(201).json(ApiResponse.success(thread, 'Chat thread linked'));
        } catch (error) {
            next(error);
        }
    }

    async markChatThreadOpened(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id, thread_id } = req.params;

            const result = await campaignService.markChatThreadOpened(tenant_id, campaign_id, thread_id);
            if (!result) return res.status(404).json({ success: false, message: 'Chat thread not found' });
            res.json(ApiResponse.success(result, 'Chat thread marked opened'));
        } catch (error) {
            next(error);
        }
    }

    async getGeneratedSuggestions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;
            const version_id = parse_version_id(req.query.version_id);
            const suggestions = await campaignService.getGeneratedSuggestions(tenant_id, campaign_id, limit, offset, version_id);
            res.json(ApiResponse.success(suggestions));
        } catch (error) {
            next(error);
        }
    }

    async generateSuggestions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const { campaign_id } = req.params;
            const version_id = parse_version_id(req.query.version_id);
            const raw_max = Number((req.body as Record<string, unknown> | undefined)?.max_suggestions);
            const max_suggestions = Number.isFinite(raw_max) ? raw_max : 5;
            const append = Boolean((req.body as Record<string, unknown> | undefined)?.append);
            const payload = await campaignService.generateSuggestions(tenant_id, user_id, campaign_id, max_suggestions, version_id, append);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async listVersions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const payload = await campaignService.listVersions(tenant_id, campaign_id);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async getWorkflowState(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const payload = await campaignService.getWorkflowState(tenant_id, campaign_id, version_id);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async getDashboardAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const range = parse_analytics_range(req.query.range);
            const payload = await campaignService.getDashboardAnalytics(tenant_id, range);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async getPipelineAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const range = parse_analytics_range(req.query.range);
            const payload = await campaignService.getPipelineAnalytics(tenant_id, user_id, campaign_id, version_id, range);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async getPromptAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const range = parse_analytics_range(req.query.range);
            const payload = await campaignService.getPromptAnalytics(tenant_id, user_id, campaign_id, version_id, range);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async getWebsiteAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const range = parse_analytics_range(req.query.range);
            const payload = await campaignService.getWebsiteAnalytics(tenant_id, user_id, campaign_id, version_id, range);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async ingestConversation(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const provider = parse_provider(req.params.provider);
            const payload = conversationIngestSchema.parse(req.body);
            const result = await campaignService.ingestConversation(tenant_id, user_id, campaign_id, provider, payload, version_id);
            res.status(201).json(ApiResponse.success(result, 'Conversation ingested'));
        } catch (error) {
            next(error);
        }
    }

    async addManualPrompt(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = req.params.version_id ?? parse_version_id(req.query.version_id);
            const payload = manualPromptSchema.parse(req.body);
            const result = await campaignService.addManualPromptCandidate(tenant_id, user_id, campaign_id, version_id, payload);
            res.status(201).json(ApiResponse.success(result, 'Manual prompt added'));
        } catch (error) {
            next(error);
        }
    }

    async selectPromptCandidates(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = req.params.version_id ?? parse_version_id(req.query.version_id);
            const payload = selectPromptCandidatesSchema.parse(req.body);
            const result = await campaignService.selectPromptCandidates(tenant_id, user_id, campaign_id, version_id, payload);
            res.json(ApiResponse.success(result));
        } catch (error) {
            next(error);
        }
    }

    async replacePromptSelection(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = req.params.version_id ?? parse_version_id(req.query.version_id);
            const payload = replacePromptSelectionSchema.parse(req.body);
            const result = await campaignService.replacePromptSelection(tenant_id, user_id, campaign_id, version_id, payload.selectedPromptIds);
            res.json(ApiResponse.success(result));
        } catch (error) {
            next(error);
        }
    }

    async executePrompts(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = req.params.version_id ?? parse_version_id(req.query.version_id);
            const payload = executePromptSchema.parse(req.body);
            const result = await campaignService.executePromptCandidates(tenant_id, user_id, campaign_id, version_id, payload);
            res.json(ApiResponse.success(result));
        } catch (error) {
            next(error);
        }
    }

    async getSiteTopQueries(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const payload = siteTopQueriesSchema.parse(req.body);
            const result = await campaignService.getSiteTopQueries(tenant_id, user_id, campaign_id, version_id, payload);
            res.json(ApiResponse.success(result));
        } catch (error) {
            next(error);
        }
    }
}

export const campaignController = new CampaignController();
// --- Merged from modules/campaign/campaign.repository.ts ---

export class CampaignRepository {
    async forkVersionForRefresh(params: {
        tenant_id: string;
        campaign_id: string;
        user_id: string;
        source_version_id: string;
        source_target_node_id: string;
        refresh_provider: string;
        refresh_scope: 'node' | 'branch';
    }): Promise<{ version: CampaignVersion; mapped_target_node_id: string }> {
        const { tenant_id, campaign_id, user_id, source_version_id, source_target_node_id, refresh_provider, refresh_scope } = params;
        return prisma.$transaction(async (tx) => {
            const source_version = await tx.campaignVersion.findFirst({
                where: { id: source_version_id, tenant_id, campaign_id },
            });
            if (!source_version) {
                throw new Error('Source version not found');
            }

            await tx.campaignVersion.updateMany({
                where: { tenant_id, campaign_id, is_active: true },
                data: { is_active: false, status: 'archived', archived_at: new Date() },
            });

            const latest = await tx.campaignVersion.findFirst({
                where: { tenant_id, campaign_id },
                orderBy: { version_number: 'desc' },
            });
            const next_num = latest ? latest.version_number + 1 : source_version.version_number + 1;

            const new_version = await tx.campaignVersion.create({
                data: {
                    tenant_id,
                    campaign_id,
                    created_by_user_id: user_id,
                    version_number: next_num,
                    status: 'active',
                    is_active: true,
                    label: `Refresh (${refresh_scope}) from v${source_version.version_number}`,
                    config_json: {
                        refresh_source_version_id: source_version.id,
                        refresh_source_version_number: source_version.version_number,
                        refresh_provider,
                        refresh_scope,
                        refresh_target_source_node_id: source_target_node_id,
                    },
                },
            });

            const source_nodes = await tx.promptNode.findMany({
                where: { campaign_version_id: source_version.id, tenant_id },
                orderBy: { depth: 'asc' },
            });

            const old_to_new_id = new Map<string, string>(source_nodes.map((node) => [node.id, randomUUID()]));
            const mapped_target_node_id = old_to_new_id.get(source_target_node_id);
            if (!mapped_target_node_id) {
                throw new Error('Refresh target node not found in source graph');
            }

            const nodes_by_depth = new Map<number, PromptNode[]>();
            for (const node of source_nodes) {
                const bucket = nodes_by_depth.get(node.depth) ?? [];
                bucket.push(node);
                nodes_by_depth.set(node.depth, bucket);
            }

            const ordered_depths = Array.from(nodes_by_depth.keys()).sort((a, b) => a - b);
            for (const depth of ordered_depths) {
                const nodes = nodes_by_depth.get(depth) ?? [];
                if (!nodes.length) continue;

                await tx.promptNode.createMany({
                    data: nodes.map((node) => {
                        const mapped_parent_id = node.parent_id ? old_to_new_id.get(node.parent_id) : undefined;
                        return {
                            id: old_to_new_id.get(node.id)!,
                            tenant_id,
                            campaign_version_id: new_version.id,
                            type: node.type,
                            content: node.content,
                            depth: node.depth,
                            metadata: node.metadata || {},
                            parent_id: mapped_parent_id ?? null,
                            capture_session_id: null,
                            capture_turn_id: null,
                        };
                    }),
                });
            }

            return { version: new_version, mapped_target_node_id };
        }, { timeout: 30_000, maxWait: 10_000 });
    }

    async establishActiveVersion(campaign_id: string, user_id: string): Promise<CampaignVersion> {
        const active = await prisma.campaignVersion.findFirst({
            where: { campaign_id, is_active: true },
        });
        if (active) return active;

        const latest = await prisma.campaignVersion.findFirst({
            where: { campaign_id },
            orderBy: { version_number: 'desc' },
        });

        const next_version = latest ? latest.version_number + 1 : 1;

        return prisma.campaignVersion.create({
            data: {
                campaign_id,
                tenant_id: latest?.tenant_id || '', // Provided by caller context but needed here if making blind
                created_by_user_id: user_id,
                version_number: next_version,
                status: 'active',
                is_active: true,
            },
        });
    }

    async createCampaign(tenant_id: string, user_id: string, data: CreateCampaignDto): Promise<Campaign> {
        return prisma.$transaction(async (tx) => {
            const domain = await tx.domain.findFirst({
                where: {
                    id: data.domain_id,
                    tenant_id,
                },
                select: { id: true },
            });
            if (!domain) {
                throw new Error('Domain not found for campaign creation');
            }
            const campaign = await tx.campaign.create({
                data: {
                    tenant_id,
                    domain_id: data.domain_id,
                    created_by_user_id: user_id,
                    name: data.name,
                    description: data.description,
                    target_location: data.target_location,
                    industry_tag: data.industry_tag,
                    business_type: data.business_type,
                    primary_goal: data.primary_goal,
                },
            });

            await tx.campaignVersion.create({
                data: {
                    tenant_id,
                    campaign_id: campaign.id,
                    created_by_user_id: user_id,
                    version_number: 1,
                    status: 'active',
                    is_active: true,
                },
            });

            return campaign;
        });
    }

    async listCampaigns(tenant_id: string, domain_id?: string): Promise<any[]> {
        const campaigns = await prisma.campaign.findMany({
            where: {
                tenant_id,
                archived_at: null,
                ...(domain_id ? { domain_id } : {}),
            },
            orderBy: { updated_at: 'desc' },
            include: {
                versions: {
                    where: { is_active: true },
                    take: 1,
                },
            },
        });

        const active_version_ids = campaigns
            .map((campaign) => campaign.versions[0]?.id)
            .filter((value): value is string => Boolean(value));

        const [node_counts, root_prompt_counts] = await Promise.all([
            active_version_ids.length
                ? prisma.promptNode.groupBy({
                    by: ['campaign_version_id'],
                    where: {
                        tenant_id,
                        campaign_version_id: { in: active_version_ids },
                    },
                    _count: { _all: true },
                })
                : Promise.resolve([]),
            active_version_ids.length
                ? prisma.promptNode.groupBy({
                    by: ['campaign_version_id'],
                    where: {
                        tenant_id,
                        campaign_version_id: { in: active_version_ids },
                        parent_id: null,
                        type: 'prompt',
                    },
                    _count: { _all: true },
                })
                : Promise.resolve([]),
        ]);

        const total_nodes_by_version = new Map<string, number>(
            node_counts.map((row: any) => [row.campaign_version_id, row._count._all]),
        );
        const roots_by_version = new Map<string, number>(
            root_prompt_counts.map((row: any) => [row.campaign_version_id, row._count._all]),
        );

        return campaigns.map((campaign) => {
            const active_version = campaign.versions[0];
            const version_id = active_version?.id;
            return {
                id: campaign.id,
                domain_id: campaign.domain_id,
                name: campaign.name,
                description: campaign.description,
                created_at: campaign.created_at,
                updated_at: campaign.updated_at,
                active_version_number: active_version?.version_number ?? 1,
                total_nodes: version_id ? (total_nodes_by_version.get(version_id) ?? 0) : 0,
                root_prompt_count: version_id ? (roots_by_version.get(version_id) ?? 0) : 0,
            };
        });
    }

    async getCampaign(tenant_id: string, campaign_id: string): Promise<Campaign | null> {
        return prisma.campaign.findFirst({
            where: { id: campaign_id, tenant_id, archived_at: null },
            include: {
                versions: {
                    orderBy: { version_number: 'desc' },
                },
            },
        });
    }

    async updateCampaign(tenant_id: string, campaign_id: string, data: UpdateCampaignDto): Promise<Campaign | null> {
        const campaign = await prisma.campaign.findFirst({
            where: { id: campaign_id, tenant_id, archived_at: null },
        });
        if (!campaign) return null;

        return prisma.campaign.update({
            where: { id: campaign_id },
            data: {
                name: data.name,
                description: data.description,
                ...(data.target_location !== undefined ? { target_location: data.target_location } : {}),
                ...(data.industry_tag !== undefined ? { industry_tag: data.industry_tag } : {}),
                ...(data.business_type !== undefined ? { business_type: data.business_type } : {}),
                ...(data.primary_goal !== undefined ? { primary_goal: data.primary_goal } : {}),
            },
        });
    }

    async deleteCampaign(tenant_id: string, campaign_id: string): Promise<boolean> {
        const campaign = await prisma.campaign.findFirst({
            where: { id: campaign_id, tenant_id },
        });
        if (!campaign) return false;

        await prisma.campaign.update({
            where: { id: campaign_id },
            data: { archived_at: new Date() },
        });
        return true;
    }

    async getActiveVersion(tenant_id: string, campaign_id: string): Promise<CampaignVersion | null> {
        return prisma.campaignVersion.findFirst({
            where: { campaign_id, tenant_id, is_active: true },
        });
    }

    async getVersionById(tenant_id: string, campaign_id: string, version_id: string): Promise<CampaignVersion | null> {
        return prisma.campaignVersion.findFirst({
            where: { id: version_id, tenant_id, campaign_id },
        });
    }

    async listVersions(tenant_id: string, campaign_id: string): Promise<CampaignVersion[]> {
        return prisma.campaignVersion.findMany({
            where: { tenant_id, campaign_id },
            orderBy: { version_number: 'desc' },
        });
    }

    async getVersionNodes(tenant_id: string, campaign_version_id: string): Promise<PromptNode[]> {
        return prisma.promptNode.findMany({
            where: { campaign_version_id, tenant_id },
            orderBy: { created_at: 'asc' },
        });
    }

    async getChatThreads(tenant_id: string, campaign_version_id: string, limit: number, offset: number) {
        const sessions = await prisma.captureSession.findMany({
            where: { tenant_id, campaign_version_id },
            orderBy: { started_at: 'desc' },
            skip: offset,
            take: limit,
            include: {
                _count: {
                    select: { turns: true },
                },
                turns: {
                    orderBy: { created_at: 'desc' },
                    take: 1,
                },
            },
        });

        return sessions.map((s: any) => ({
            chat_thread_id: s.id,
            chat_provider: s.chat_provider,
            chat_title: s.chat_title,
            chat_url: s.chat_url,
            provider_chat_id: s.provider_chat_id,
            conversation_id: s.conversation_id,
            started_at: s.started_at,
            turn_count: s._count.turns,
            last_event_at: s.last_event_at,
            last_opened_at: s.last_opened_at,
            status: s.status,
            latest_turn_prompt: s.turns[0]?.prompt ?? null,
        }));
    }

    async findOrCreateSession(
        tenant_id: string,
        campaign_version_id: string,
        chat_provider: any,
        conversation_id: string
    ): Promise<CaptureSession> {
        const existing = await prisma.captureSession.findFirst({
            where: { tenant_id, campaign_version_id, chat_provider, conversation_id },
        });
        if (existing) {
            return existing;
        }

        try {
            return await prisma.captureSession.create({
                data: {
                    tenant_id,
                    campaign_version_id,
                    chat_provider,
                    conversation_id,
                },
            });
        } catch (error) {
            // Race-safe find-or-create: if another request created the row first, read and return it.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const raced = await prisma.captureSession.findFirst({
                    where: { tenant_id, campaign_version_id, chat_provider, conversation_id },
                });
                if (raced) {
                    return raced;
                }
            }
            throw error;
        }
    }

    async linkChatThread(params: {
        tenant_id: string;
        campaign_version_id: string;
        chat_provider: string;
        conversation_id?: string;
        provider_chat_id?: string;
        chat_url?: string;
        chat_title?: string;
    }): Promise<CaptureSession> {
        // Try to find by provider_chat_id first, then conversation_id
        const existing = await prisma.captureSession.findFirst({
            where: {
                tenant_id: params.tenant_id,
                campaign_version_id: params.campaign_version_id,
                chat_provider: params.chat_provider as any,
                ...(params.provider_chat_id
                    ? { provider_chat_id: params.provider_chat_id }
                    : params.conversation_id
                        ? { conversation_id: params.conversation_id }
                        : {}),
            },
        });

        if (existing) {
            return prisma.captureSession.update({
                where: { id: existing.id },
                data: {
                    chat_url: params.chat_url ?? existing.chat_url,
                    chat_title: params.chat_title ?? existing.chat_title,
                    provider_chat_id: params.provider_chat_id ?? existing.provider_chat_id,
                },
            });
        }

        return prisma.captureSession.create({
            data: {
                tenant_id: params.tenant_id,
                campaign_version_id: params.campaign_version_id,
                chat_provider: params.chat_provider as any,
                conversation_id: params.conversation_id ?? `web-linked-${Date.now()}`,
                provider_chat_id: params.provider_chat_id,
                chat_url: params.chat_url,
                chat_title: params.chat_title,
            },
        });
    }

    async markChatThreadOpened(tenant_id: string, session_id: string): Promise<CaptureSession | null> {
        const session = await prisma.captureSession.findFirst({
            where: { id: session_id, tenant_id },
        });
        if (!session) return null;

        return prisma.captureSession.update({
            where: { id: session_id },
            data: { last_opened_at: new Date() },
        });
    }

    async createNode(data: any): Promise<PromptNode> {
        return prisma.promptNode.create({ data });
    }

    async refireVersion(tenant_id: string, campaign_id: string, user_id: string, target_version_number: number): Promise<CampaignVersion> {
        return prisma.$transaction(async (tx) => {
            // 1. Get the target version
            const source_version = await tx.campaignVersion.findFirst({
                where: { tenant_id, campaign_id, version_number: target_version_number },
            });
            if (!source_version) throw new Error('Source version not found');

            // 2. Archive active version
            await tx.campaignVersion.updateMany({
                where: { tenant_id, campaign_id, is_active: true },
                data: { is_active: false, status: 'archived', archived_at: new Date() },
            });

            // 3. Determine next version number
            const latest = await tx.campaignVersion.findFirst({
                where: { tenant_id, campaign_id },
                orderBy: { version_number: 'desc' },
            });
            const next_num = latest ? latest.version_number + 1 : target_version_number + 1;

            // 4. Create new version
            const new_version = await tx.campaignVersion.create({
                data: {
                    tenant_id,
                    campaign_id,
                    created_by_user_id: user_id,
                    version_number: next_num,
                    status: 'active',
                    is_active: true,
                    label: `Refire from v${target_version_number}`,
                },
            });

            // 5. Clone nodes
            const source_nodes = await tx.promptNode.findMany({
                where: { campaign_version_id: source_version.id, tenant_id },
                orderBy: { depth: 'asc' }, // Ensure we clone top-down
            });

            const old_to_new_id = new Map<string, string>(
                source_nodes.map((node) => [node.id, randomUUID()]),
            );

            const nodes_by_depth = new Map<number, PromptNode[]>();
            for (const node of source_nodes) {
                const bucket = nodes_by_depth.get(node.depth) ?? [];
                bucket.push(node);
                nodes_by_depth.set(node.depth, bucket);
            }

            const ordered_depths = Array.from(nodes_by_depth.keys()).sort((a, b) => a - b);
            for (const depth of ordered_depths) {
                const nodes = nodes_by_depth.get(depth) ?? [];
                if (!nodes.length) continue;

                await tx.promptNode.createMany({
                    data: nodes.map((node) => {
                        const mapped_parent_id = node.parent_id ? old_to_new_id.get(node.parent_id) : undefined;
                        return {
                            id: old_to_new_id.get(node.id)!,
                            tenant_id,
                            campaign_version_id: new_version.id,
                            type: node.type,
                            content: node.content,
                            depth: node.depth,
                            metadata: node.metadata || {},
                            parent_id: mapped_parent_id ?? null,
                            capture_session_id: null,
                            capture_turn_id: null,
                        };
                    }),
                });
            }

            return new_version;
        }, { timeout: 30_000, maxWait: 10_000 });
    }
}

export const campaignRepository = new CampaignRepository();
// --- Merged from modules/campaign/campaign.routes.ts ---

const campaign_router = Router();

campaign_router.get('/analytics/dashboard', authMiddleware, campaignController.getDashboardAnalytics);

// Campaign endpoints
campaign_router.get('/', authMiddleware, campaignController.listCampaigns);
campaign_router.post('/', authMiddleware, campaignController.createCampaign);
campaign_router.get('/:campaign_id', authMiddleware, campaignController.getCampaign);
campaign_router.patch('/:campaign_id', authMiddleware, campaignController.updateCampaign);
campaign_router.delete('/:campaign_id', authMiddleware, campaignController.deleteCampaign);
campaign_router.get('/:campaign_id/versions', authMiddleware, campaignController.listVersions);

// Short-form aliases — what the web/extension clients actually call
campaign_router.get('/:campaign_id/tree', authMiddleware, campaignController.getTree);
campaign_router.get('/:campaign_id/chat-threads', authMiddleware, campaignController.getChatThreads);
campaign_router.post('/:campaign_id/chat-threads/link', authMiddleware, campaignController.linkChatThread);
campaign_router.post('/:campaign_id/chat-threads/:thread_id/opened', authMiddleware, campaignController.markChatThreadOpened);
campaign_router.get('/:campaign_id/suggestions/generated', authMiddleware, campaignController.getGeneratedSuggestions);
campaign_router.post('/:campaign_id/suggestions/generate', authMiddleware, campaignController.generateSuggestions);
campaign_router.post('/:campaign_id/capture/ingest-turn', authMiddleware, campaignController.ingestTurn);
campaign_router.post('/:campaign_id/nodes/:node_id/refresh', authMiddleware, campaignController.refreshNode);
campaign_router.get('/:campaign_id/workflow/state', authMiddleware, campaignController.getWorkflowState);
campaign_router.post('/:campaign_id/providers/:provider/conversations/ingest', authMiddleware, campaignController.ingestConversation);
campaign_router.post('/:campaign_id/versions/:version_id/prompts/manual', authMiddleware, campaignController.addManualPrompt);
campaign_router.post('/:campaign_id/versions/:version_id/prompts/select', authMiddleware, campaignController.selectPromptCandidates);
campaign_router.post('/:campaign_id/versions/:version_id/prompts/selection-set', authMiddleware, campaignController.replacePromptSelection);
campaign_router.post('/:campaign_id/versions/:version_id/execute', authMiddleware, campaignController.executePrompts);
campaign_router.post('/:campaign_id/site-keywords/top-queries', authMiddleware, campaignController.getSiteTopQueries);
campaign_router.get('/:campaign_id/analytics/pipeline', authMiddleware, campaignController.getPipelineAnalytics);
campaign_router.get('/:campaign_id/analytics/prompts', authMiddleware, campaignController.getPromptAnalytics);
campaign_router.get('/:campaign_id/analytics/websites', authMiddleware, campaignController.getWebsiteAnalytics);

// Version specific (defaulting to active version for ease of extension/ui adoption)
campaign_router.get('/:campaign_id/versions/active/tree', authMiddleware, campaignController.getActiveTree);
campaign_router.get('/:campaign_id/versions/active/chat-threads', authMiddleware, campaignController.getActiveChatThreads);
campaign_router.post('/:campaign_id/versions/active/capture/ingest-turn', authMiddleware, campaignController.ingestTurn);

// Refire
campaign_router.post('/:campaign_id/versions/:version_number/refire', authMiddleware, campaignController.refire);


// campaign_router already declared
workspace_workflow_router = campaign_router; // workspace routes use same router
// --- Merged from modules/campaign/campaign.service.ts ---

type StreamEventType = 'prompt_sent' | 'search_queries' | 'search_results' | 'response_finished';
type StreamProvider = 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'unknown';
type AnalyticsRange = '7d' | '30d' | 'all';

interface MaterializedSite {
    site_name: string;
    url?: string;
    title?: string;
    result_ref: string;
    first_seen_seq: number;
}

interface MaterializedSubquery {
    query_key: string;
    label: string;
    subquery_ref: string;
    first_seen_seq: number;
    sites: MaterializedSite[];
}

type NodeRefreshStatus = 'idle' | 'queued' | 'running' | 'failed' | 'done';

interface CanonicalNodeMetadata {
    source?: string;
    prompt_ref?: string;
    subquery_ref?: string;
    result_ref?: string;
    query_key?: string;
    url?: string;
    domain?: string;
    citation_title?: string;
    lineage: {
        capture_turn_id?: string;
        origin_provider?: string;
        origin_request_id?: string;
        source_version_id?: string;
    };
    refresh: {
        refreshable: boolean;
        refresh_count: number;
        refresh_status: NodeRefreshStatus;
        last_refreshed_at?: string;
        last_refresh_run_id?: string;
        refresh_provider?: string;
        refresh_source_version_id?: string;
    };
    ui: {
        display_label?: string;
        is_unmapped?: boolean;
        is_system?: boolean;
    };
}

interface NormalizedTurnEvent {
    capture_turn_id: string;
    provider: StreamProvider;
    provider_conversation_id: string;
    provider_request_id?: string;
    provider_turn_id: string;
    seq: number;
    event_type: StreamEventType;
    source_ref: string;
    payload: Record<string, unknown>;
    occurred_at: string;
}

const MAX_QUERY_COUNT = 20;
const MAX_SITES_PER_QUERY = 8;
const MAX_UNSCOPED_SITES = 4;
const MAX_PROMPT_LENGTH = 8000;
const MAX_QUERY_LENGTH = 240;
const MAX_SITE_NAME_LENGTH = 200;
const MAX_URL_LENGTH = 1200;
const MAX_TITLE_LENGTH = 300;
const SITE_KEYWORD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const IMPORTED_PROMPT_FALLBACK = 'Imported conversation prompt';
const DAY_MS = 24 * 60 * 60 * 1000;

type PromptCandidateStatus = 'new' | 'fired' | 'running' | 'failed';

interface PromptCandidateResponse {
    id?: string;
    node_id?: string;
    text?: string;
    source?: string;
    selected?: boolean;
    status?: string;
    lastExecutionAt?: string;
}

interface ExecutedPromptResponse {
    id: string;
    text: string;
    provider: StreamProvider;
    status: 'completed' | 'failed';
    lastExecutionAt: string;
    sourcePromptId?: string;
    searchedKeywords: KeywordQueryItem[];
    crawledWebsites: CrawledWebsiteItem[];
    placesFound: PlaceFoundItem[];
}

interface WorkflowStatePayload {
    version: {
        id: string;
        version_number: number;
        is_active: boolean;
        status: string;
        label: string | null;
        created_at: Date;
        archived_at: Date | null;
    } | null;
    promptCandidates: PromptCandidateResponse[];
    executedPrompts: ExecutedPromptResponse[];
    searchedKeywords: KeywordQueryItem[];
    crawledWebsites: CrawledWebsiteItem[];
    placesFound: PlaceFoundItem[];
    warnings: string[];
    versionMeta: {
        versionDate?: string;
        lastExecutionDate?: string;
        provider: StreamProvider;
        conversationId: string;
    };
}

const to_record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const to_array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const get_string = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
};

const to_day_key = (date: Date): string => date.toISOString().slice(0, 10);

const range_start_for = (range: AnalyticsRange): Date | null => {
    if (range === 'all') return null;
    const days = range === '7d' ? 7 : 30;
    return new Date(Date.now() - days * DAY_MS);
};

const is_in_range = (value: string | undefined, start: Date | null): boolean => {
    if (!value) return false;
    if (!start) return true;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return date.getTime() >= start.getTime();
};

const freshness_bucket_for = (value?: string | null): 'pending' | '0_24h' | '1_3d' | '3_7d' | '7d_plus' => {
    if (!value) return 'pending';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'pending';
    const age = Date.now() - date.getTime();
    if (age <= DAY_MS) return '0_24h';
    if (age <= 3 * DAY_MS) return '1_3d';
    if (age <= 7 * DAY_MS) return '3_7d';
    return '7d_plus';
};

const to_number = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};

const normalize_query_key = (query: string): string => query.trim().toLowerCase();

const clamp = (value: string, max: number): string => value.slice(0, max);

const normalize_prompt = (value: string): string => clamp(value.trim(), MAX_PROMPT_LENGTH);

const normalize_query = (value: string): string => clamp(value.trim(), MAX_QUERY_LENGTH);

const normalize_site_name = (value: string): string => clamp(value.trim(), MAX_SITE_NAME_LENGTH);

const normalize_url = (value: string): string => clamp(value.trim(), MAX_URL_LENGTH);

const normalize_title = (value: string): string => clamp(value.trim(), MAX_TITLE_LENGTH);

const is_http_url = (value: string): boolean => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const canonicalize_url = (value?: string): string | undefined => {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (!is_http_url(trimmed)) return undefined;
    try {
        const parsed = new URL(trimmed);
        parsed.hash = '';
        const keys_to_delete: string[] = [];
        parsed.searchParams.forEach((_value, key) => {
            const lowered = key.toLowerCase();
            if (
                lowered.startsWith('utm_') ||
                lowered === 'gclid' ||
                lowered === 'fbclid' ||
                lowered === 'igshid'
            ) {
                keys_to_delete.push(key);
            }
        });
        keys_to_delete.forEach((key) => parsed.searchParams.delete(key));
        const normalized = parsed.toString();
        const without_trailing = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
        return normalize_url(without_trailing);
    } catch {
        return normalize_url(trimmed);
    }
};

const is_internal_site_name = (value: string): boolean => {
    const key = normalize_text_key(value);
    if (!key) return true;
    if (['default', 'unknown', 'null', 'undefined', 'sonic_tool', 'tool', 'styles'].includes(key)) return true;
    if (key.startsWith('mapbox.') || key.includes('mapbox')) return true;
    return false;
};

const infer_site_name_from_url = (url?: string): string | undefined => {
    if (!url) return undefined;
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return undefined;
    }
};

const normalize_text_key = (value: string): string => value.trim().toLowerCase();

const deterministic_hash = (...parts: Array<string | number | undefined>): string => {
    const normalized = parts
        .map((part) => (part === undefined ? '' : String(part).trim().toLowerCase()))
        .join('||');
    return createHash('sha1').update(normalized).digest('hex');
};

const parse_refresh_status = (value: unknown): NodeRefreshStatus => {
    if (value === 'queued' || value === 'running' || value === 'failed' || value === 'done') {
        return value;
    }
    return 'idle';
};

const to_positive_int = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
    return 0;
};

const node_display_label = (
    node_type: NodeType,
    content: string,
    metadata: Record<string, unknown>,
): { label: string; is_unmapped: boolean; is_system: boolean } => {
    const normalized_content = normalize_text_key(content);
    const query_key = normalize_text_key(get_string(metadata.query_key) ?? '');
    const source = normalize_text_key(get_string(metadata.source) ?? '');
    const is_unmapped =
        node_type === NodeType.subquery &&
        (query_key === '__unscoped__' || normalized_content === '__unscoped__' || normalized_content === 'unmapped_sources');
    const is_system = source === 'system' || normalized_content === 'unmapped_sources';
    if (is_unmapped) {
        return { label: 'Unmapped results', is_unmapped: true, is_system };
    }
    return { label: content, is_unmapped: false, is_system };
};

const truncate_for_log = (value: string, max = 120): string => (value.length <= max ? value : `${value.slice(0, max)}...`);

const safe_json_record = (value: unknown): Record<string, unknown> => {
    const obj = to_record(value);
    return obj ?? {};
};

const provider_turn_id_for = (data: IngestTurnDto): string =>
    deterministic_hash(data.chat_provider, data.conversation_id, data.request_id ?? '', data.turn_exchange_id ?? '');

const infer_query_from_obj = (obj: Record<string, unknown>): string | undefined =>
    get_string(obj.query) ??
    get_string(obj.search_query) ??
    get_string(obj.keyword) ??
    get_string(obj.q);

const infer_group_ref_from_obj = (obj: Record<string, unknown>, path: string): string =>
    deterministic_hash(
        get_string(obj.group_ref) ??
        get_string(obj.group_id) ??
        get_string(obj.groupId) ??
        get_string(obj.block_id) ??
        get_string(obj.id) ??
        path,
    );

const extract_result_candidates = (result_groups: unknown[] | undefined): Array<{
    query?: string;
    site_name: string;
    url?: string;
    title?: string;
    group_ref: string;
}> => {
    if (!result_groups?.length) {
        return [];
    }

    const results: Array<{ query?: string; site_name: string; url?: string; title?: string; group_ref: string }> = [];
    const push_site = (params: { query?: string; site_name: string; url?: string; title?: string; group_ref: string }) => {
        if (!params.site_name.trim()) return;
        results.push({
            query: params.query ? normalize_query(params.query) : undefined,
            site_name: normalize_site_name(params.site_name),
            url: params.url ? normalize_url(params.url) : undefined,
            title: params.title ? normalize_title(params.title) : undefined,
            group_ref: params.group_ref,
        });
    };

    const walk = (value: unknown, query_context?: string, path = 'root', depth = 0) => {
        if (depth > 10) return;
        if (Array.isArray(value)) {
            value.forEach((item, index) => walk(item, query_context, `${path}[${index}]`, depth + 1));
            return;
        }
        const obj = to_record(value);
        if (!obj) return;

        const local_query = infer_query_from_obj(obj);
        const active_query = local_query ?? query_context;
        const group_ref = infer_group_ref_from_obj(obj, path);

        const raw_url = get_string(obj.url) ?? get_string(obj.link) ?? get_string(obj.source_url) ?? get_string(obj.display_url);
        const url = canonicalize_url(raw_url);
        const site_name =
            get_string(obj.site_name) ??
            get_string(obj.domain) ??
            get_string(obj.source) ??
            get_string(obj.name) ??
            infer_site_name_from_url(url);
        const title = get_string(obj.title) ?? get_string(obj.headline) ?? get_string(obj.heading);
        if (site_name && !is_internal_site_name(site_name)) {
            push_site({ query: active_query, site_name, url, title, group_ref });
        }

        Object.entries(obj).forEach(([key, nested]) => {
            if (nested !== undefined && (Array.isArray(nested) || typeof nested === 'object')) {
                walk(nested, active_query, `${path}.${key}`, depth + 1);
            }
        });
    };

    walk(result_groups);
    return results;
};

const normalize_turn_events = (params: {
    capture_turn_id: string;
    data: IngestTurnDto;
    normalized_prompt: string;
    normalized_queries: string[];
    occurred_at: Date;
}): NormalizedTurnEvent[] => {
    const provider_turn_id = provider_turn_id_for(params.data);
    const provider = params.data.chat_provider;
    const occurred_at = params.occurred_at.toISOString();
    const events: NormalizedTurnEvent[] = [];
    let seq = 1;
    const prompt_ref = deterministic_hash(provider, provider_turn_id, params.normalized_prompt, seq);
    const subquery_ref_by_key = new Map<string, { subquery_ref: string; first_seen_seq: number; label: string }>();

    const emit = (event_type: StreamEventType, payload: Record<string, unknown>) => {
        const current_seq = seq++;
        events.push({
            capture_turn_id: params.capture_turn_id,
            provider,
            provider_conversation_id: params.data.conversation_id,
            provider_request_id: params.data.request_id,
            provider_turn_id,
            seq: current_seq,
            event_type,
            source_ref: deterministic_hash(provider_turn_id, event_type, current_seq),
            payload,
            occurred_at,
        });
    };

    emit('prompt_sent', {
        prompt: params.normalized_prompt,
        prompt_ref,
    });

    for (const query of params.normalized_queries) {
        const query_key = normalize_query_key(query);
        if (subquery_ref_by_key.has(query_key)) continue;
        const next_ref = deterministic_hash(provider, provider_turn_id, query_key, seq);
        subquery_ref_by_key.set(query_key, {
            subquery_ref: next_ref,
            first_seen_seq: seq,
            label: query,
        });
        emit('search_queries', {
            prompt_ref,
            query,
            query_key,
            subquery_ref: next_ref,
        });
    }

    const extracted_results = extract_result_candidates(params.data.result_groups);
    const should_infer_prompt_query = params.normalized_queries.length === 0 && extracted_results.length > 0;
    let inferred_prompt_query_key: string | undefined;
    let inferred_prompt_query_label: string | undefined;
    if (should_infer_prompt_query) {
        inferred_prompt_query_label = normalize_query(params.normalized_prompt);
        inferred_prompt_query_key = normalize_query_key(inferred_prompt_query_label);
        const inferred_ref = deterministic_hash(provider, provider_turn_id, inferred_prompt_query_key, 'inferred_prompt');
        subquery_ref_by_key.set(inferred_prompt_query_key, {
            subquery_ref: inferred_ref,
            first_seen_seq: seq,
            label: inferred_prompt_query_label,
        });
        emit('search_queries', {
            prompt_ref,
            query: inferred_prompt_query_label,
            query_key: inferred_prompt_query_key,
            subquery_ref: inferred_ref,
            inferred: true,
            inferred_from_prompt: true,
        });
    }

    for (const result of extracted_results) {
        const resolved_query = result.query ?? inferred_prompt_query_label ?? '__unscoped__';
        const query_key = normalize_query_key(resolved_query);
        if (query_key !== '__unscoped__' && !subquery_ref_by_key.has(query_key)) {
            const inferred_label = normalize_query(result.query ?? query_key);
            const inferred_ref = deterministic_hash(provider, provider_turn_id, query_key, seq);
            subquery_ref_by_key.set(query_key, {
                subquery_ref: inferred_ref,
                first_seen_seq: seq,
                label: inferred_label,
            });
            emit('search_queries', {
                prompt_ref,
                query: inferred_label,
                query_key,
                subquery_ref: inferred_ref,
                inferred: true,
            });
        }

        const linked_subquery = subquery_ref_by_key.get(query_key);
        const result_ref = deterministic_hash(
            provider,
            provider_turn_id,
            query_key,
            normalize_text_key(result.site_name),
            normalize_text_key(canonicalize_url(result.url) ?? ''),
        );

        emit('search_results', {
            prompt_ref,
            query: query_key === '__unscoped__' ? undefined : resolved_query,
            query_key,
            subquery_ref: linked_subquery?.subquery_ref,
            result_ref,
            group_ref: result.group_ref,
            site_name: result.site_name,
            url: canonicalize_url(result.url),
            title: result.title,
        });
    }

    emit('response_finished', {
        prompt_ref,
        reason: params.data.finished_reason ?? 'status_finished_successfully',
    });

    return events;
};

const materialize_turn_from_events = (events: NormalizedTurnEvent[]): {
    prompt: { prompt_ref: string; text: string; first_seen_seq: number };
    subqueries: MaterializedSubquery[];
    expected_counts: { subquery_count: number; result_count: number; unscoped_count: number };
} => {
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    const prompt_event = sorted.find((event) => event.event_type === 'prompt_sent');
    const prompt_payload = safe_json_record(prompt_event?.payload);
    const prompt_text = get_string(prompt_payload.prompt) ?? '';
    const prompt_ref = get_string(prompt_payload.prompt_ref) ?? deterministic_hash(prompt_text);

    const subquery_map = new Map<string, MaterializedSubquery>();
    const subquery_ref_by_key = new Map<string, string>();
    const upsert_subquery = (params: {
        query_key: string;
        label: string;
        subquery_ref: string;
        first_seen_seq: number;
    }): MaterializedSubquery => {
        const existing = subquery_map.get(params.subquery_ref);
        if (existing) {
            if (params.first_seen_seq < existing.first_seen_seq) {
                existing.first_seen_seq = params.first_seen_seq;
            }
            return existing;
        }
        const next: MaterializedSubquery = {
            query_key: params.query_key,
            label: params.label,
            subquery_ref: params.subquery_ref,
            first_seen_seq: params.first_seen_seq,
            sites: [],
        };
        subquery_map.set(params.subquery_ref, next);
        if (params.query_key !== '__unscoped__' && !subquery_ref_by_key.has(params.query_key)) {
            subquery_ref_by_key.set(params.query_key, params.subquery_ref);
        }
        return next;
    };

    const seen_result_by_subquery = new Map<string, Set<string>>();
    const ensure_site_set = (subquery_ref: string): Set<string> => {
        const existing = seen_result_by_subquery.get(subquery_ref);
        if (existing) return existing;
        const next = new Set<string>();
        seen_result_by_subquery.set(subquery_ref, next);
        return next;
    };

    let unscoped_ref: string | null = null;
    const ensure_unscoped = (first_seen_seq: number): MaterializedSubquery => {
        if (!unscoped_ref) {
            unscoped_ref = deterministic_hash(prompt_ref, '__unscoped__');
        }
        return upsert_subquery({
            query_key: '__unscoped__',
            label: '__unscoped__',
            subquery_ref: unscoped_ref,
            first_seen_seq,
        });
    };

    for (const event of sorted) {
        const payload = safe_json_record(event.payload);
        if (event.event_type === 'search_queries') {
            const query_key = normalize_query_key(get_string(payload.query_key) ?? get_string(payload.query) ?? '__unscoped__');
            const label = normalize_query(get_string(payload.query) ?? query_key);
            const subquery_ref =
                get_string(payload.subquery_ref) ??
                deterministic_hash(prompt_ref, query_key);
            upsert_subquery({
                query_key,
                label: query_key === '__unscoped__' ? '__unscoped__' : label,
                subquery_ref,
                first_seen_seq: event.seq,
            });
            continue;
        }

        if (event.event_type !== 'search_results') continue;
        const query_key = normalize_query_key(get_string(payload.query_key) ?? get_string(payload.query) ?? '__unscoped__');
        const requested_subquery_ref = get_string(payload.subquery_ref);
        const site_name = normalize_site_name(get_string(payload.site_name) ?? '');
        if (!site_name || is_internal_site_name(site_name)) continue;
        const url = canonicalize_url(get_string(payload.url));
        const title = get_string(payload.title);
        const fallback_result_ref = deterministic_hash(
            event.provider,
            event.provider_turn_id,
            query_key,
            normalize_text_key(site_name),
            normalize_text_key(url ?? ''),
        );
        const result_ref = get_string(payload.result_ref) ?? fallback_result_ref;

        let target_subquery: MaterializedSubquery | undefined;
        if (requested_subquery_ref) {
            target_subquery = subquery_map.get(requested_subquery_ref);
        }
        if (!target_subquery && query_key !== '__unscoped__') {
            const known_ref = subquery_ref_by_key.get(query_key);
            if (known_ref) {
                target_subquery = subquery_map.get(known_ref);
            }
        }
        if (!target_subquery && query_key !== '__unscoped__') {
            const inferred_ref = deterministic_hash(prompt_ref, query_key);
            target_subquery = upsert_subquery({
                query_key,
                label: normalize_query(get_string(payload.query) ?? query_key),
                subquery_ref: inferred_ref,
                first_seen_seq: event.seq,
            });
        }
        if (!target_subquery) {
            const non_unscoped_subqueries = Array.from(subquery_map.values()).filter((subquery) => subquery.query_key !== '__unscoped__');
            if (query_key === '__unscoped__' && non_unscoped_subqueries.length === 1) {
                target_subquery = non_unscoped_subqueries[0];
            } else {
                target_subquery = ensure_unscoped(event.seq);
            }
        }

        const seen_results = ensure_site_set(target_subquery.subquery_ref);
        if (seen_results.has(result_ref)) continue;
        seen_results.add(result_ref);
        target_subquery.sites.push({
            site_name,
            url: url ?? undefined,
            title: title ? normalize_title(title) : undefined,
            result_ref,
            first_seen_seq: event.seq,
        });
    }

    const subqueries = Array.from(subquery_map.values())
        .sort((a, b) => a.first_seen_seq - b.first_seen_seq)
        .map((subquery) => ({
            ...subquery,
            sites: [...subquery.sites].sort((a, b) => a.first_seen_seq - b.first_seen_seq),
        }));

    const unscoped = subqueries.find((subquery) => subquery.query_key === '__unscoped__');
    const expected_counts = {
        subquery_count: subqueries.length,
        result_count: subqueries.reduce((acc, subquery) => acc + subquery.sites.length, 0),
        unscoped_count: unscoped?.sites.length ?? 0,
    };

    return {
        prompt: {
            prompt_ref,
            text: prompt_text,
            first_seen_seq: prompt_event?.seq ?? 1,
        },
        subqueries,
        expected_counts,
    };
};

interface SuggestedPromptCandidate {
    prompt: string;
    reason: string;
}

const parse_json_object_from_text = (raw: string): Record<string, unknown> | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const candidates: string[] = [trimmed];
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        candidates.push(fenced[1].trim());
    }

    const first_brace = trimmed.indexOf('{');
    const last_brace = trimmed.lastIndexOf('}');
    if (first_brace >= 0 && last_brace > first_brace) {
        candidates.push(trimmed.slice(first_brace, last_brace + 1));
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as unknown;
            const record = to_record(parsed);
            if (record) return record;
        } catch {
            // Continue trying other candidates.
        }
    }

    return null;
};

const normalize_suggested_prompts = (
    raw: unknown,
    limit: number,
): SuggestedPromptCandidate[] => {
    const rows = Array.isArray(raw)
        ? raw
        : Array.isArray(to_record(raw)?.suggestions)
            ? (to_record(raw)?.suggestions as unknown[])
            : [];

    const seen = new Set<string>();
    const output: SuggestedPromptCandidate[] = [];
    for (const row of rows) {
        const record = to_record(row);
        if (!record) continue;
        const prompt = normalize_prompt(get_string(record.prompt) ?? '');
        if (!prompt || is_imported_prompt_fallback(prompt)) continue;
        const key = normalize_text_key(prompt);
        if (seen.has(key)) continue;
        seen.add(key);
        const reason = get_string(record.reason) ?? 'Suggested from executed prompt history';
        output.push({ prompt, reason });
        if (output.length >= limit) break;
    }

    return output;
};

const build_suggestions_from_openai = async (
    recent_prompts: string[],
    max_suggestions: number,
): Promise<SuggestedPromptCandidate[]> => {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not configured');
    }

    const limit = Math.min(Math.max(max_suggestions, 1), 25);
    const prompt_lines = recent_prompts
        .slice(0, 20)
        .map((prompt, index) => `${index + 1}. ${prompt}`)
        .join('\n');

    const system_message = [
        'Generate realistic follow-up prompts a human would type into an LLM.',
        'Use only the executed prompt history context.',
        `Return strictly JSON object: {"suggestions":[{"prompt":"...","reason":"..."}]} with ${limit} unique suggestions.`,
        'Each prompt should be concise and practical.',
    ].join(' ');

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: system_message }] },
                contents: [
                    {
                        parts: [{ text: `Executed prompts:\n${prompt_lines}` }]
                    }
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                }
            })
        }
    );

    const raw_text = await response.text();
    if (!response.ok) {
        throw new Error(`Suggestion generation failed (${response.status}): ${raw_text.slice(0, 260)}`);
    }

    let payload: unknown = null;
    try {
        payload = JSON.parse(raw_text) as unknown;
    } catch {
        throw new Error('Suggestion generation returned invalid JSON');
    }

    const candidates = to_array(to_record(payload)?.candidates) ?? [];
    const firstCandidate = to_record(candidates[0]) ?? {};
    const content = to_record(firstCandidate.content) ?? {};
    const parts = to_array(content.parts) ?? [];
    const firstPart = to_record(parts[0]) ?? {};
    const content_raw = get_string(firstPart.text) ?? '';
    const parsed_content = parse_json_object_from_text(content_raw);
    if (!parsed_content) {
        throw new Error('Suggestion generation returned unparsable content');
    }

    const suggestions = normalize_suggested_prompts(parsed_content, limit);
    if (!suggestions.length) {
        throw new Error('No prompt suggestions could be generated');
    }
    return suggestions;
};

const parse_prompt_candidate_status = (value: unknown): PromptCandidateStatus => {
    if (value === 'fired' || value === 'running' || value === 'failed') return value;
    return 'new';
};

const parse_bool = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    return fallback;
};

const is_imported_prompt_fallback = (prompt: string): boolean => {
    const key = normalize_text_key(prompt);
    const fallback = normalize_text_key(IMPORTED_PROMPT_FALLBACK);
    return key === fallback || key.startsWith(`${fallback} `);
};

const prompt_quality_score = (prompt: string): number => {
    const key = normalize_text_key(prompt);
    if (!key) return 0;
    if (is_imported_prompt_fallback(prompt)) return 1;
    return 3;
};

const prompt_source_score = (source?: string): number => {
    const key = normalize_text_key(source ?? '');
    if (key === 'extension_background_seq' || key === 'extension' || key === 'extension_capture') return 3;
    if (key === 'conversation_ingest') return 2;
    return 1;
};

interface SiteKeywordTarget {
    host: string;
    url?: string;
    cacheKey: string;
}

type SiteKeywordRequestTarget = {
    domain?: string;
    page_url?: string;
};

interface SiteTopQueryRow {
    query: string;
    volume?: number;
    traffic?: number;
    position?: number;
    trafficPercent?: number;
    keywordDifficulty?: number;
    sourceTimestamp: string;
}

const normalize_site_keyword_target = (value: string): SiteKeywordTarget | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
        parsed.hash = '';
        parsed.hostname = parsed.hostname.toLowerCase();
        const normalized = canonicalize_url(parsed.toString());
        const host = parsed.hostname.replace(/^www\./, '');
        if (!host) return undefined;
        return {
            host,
            ...(normalized ? { url: normalized } : {}),
            cacheKey: normalized ?? host,
        };
    } catch {
        const lowered = trimmed.toLowerCase();
        const raw = lowered.replace(/^https?:\/\//, '').replace(/^www\./, '');
        const host = raw.split('/')[0];
        if (!host || host.includes(' ')) return undefined;
        return {
            host,
            cacheKey: host,
        };
    }
};

const normalize_site_keyword_request_target = (value: SiteKeywordRequestTarget): SiteKeywordTarget | undefined => {
    const page_target = value.page_url ? normalize_site_keyword_target(value.page_url) : undefined;
    const domain_target = value.domain ? normalize_site_keyword_target(value.domain) : undefined;
    const host = page_target?.host ?? domain_target?.host;
    if (!host) return undefined;
    return {
        host,
        ...(page_target?.url ? { url: page_target.url } : {}),
        cacheKey: page_target?.url ?? host,
    };
};

const parse_keyword_items = (value: unknown): KeywordQueryItem[] => {
    const rows = Array.isArray(value) ? value : [];
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const output: KeywordQueryItem[] = [];
    for (const row of rows) {
        const record = to_record(row);
        if (!record) continue;
        const query = get_string(record.query);
        if (!query) continue;
        const key = normalize_text_key(query);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
            query,
            sourceProvider: (get_string(record.sourceProvider) as StreamProvider | undefined) ?? 'unknown',
            sourcePromptId: get_string(record.sourcePromptId),
            firstSeenAt: get_string(record.firstSeenAt) ?? now,
        });
    }
    return output;
};

const parse_website_items = (value: unknown): CrawledWebsiteItem[] => {
    const rows = Array.isArray(value) ? value : [];
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const output: CrawledWebsiteItem[] = [];
    for (const row of rows) {
        const record = to_record(row);
        if (!record) continue;
        const url = canonicalize_url(get_string(record.url));
        if (!url) continue;
        const host = infer_site_name_from_url(url);
        if (!host) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        output.push({
            url,
            host,
            source: get_string(record.source) ?? 'discovery',
            firstSeenAt: get_string(record.firstSeenAt) ?? now,
        });
    }
    return output;
};

const parse_place_items = (value: unknown): PlaceFoundItem[] => {
    const rows = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    const output: PlaceFoundItem[] = [];
    for (const row of rows) {
        const record = to_record(row);
        if (!record) continue;
        const name = get_string(record.name);
        if (!name) continue;
        const address = get_string(record.address);
        const key = `${normalize_text_key(name)}|${normalize_text_key(address ?? '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rating = to_number(record.rating);
        const review_count = to_number(record.reviewCount);
        const website_url = canonicalize_url(get_string(record.websiteUrl));
        const category = get_string(record.category);
        output.push({
            name,
            ...(address ? { address } : {}),
            ...(rating !== undefined ? { rating } : {}),
            ...(review_count !== undefined ? { reviewCount: Math.floor(review_count) } : {}),
            ...(website_url ? { websiteUrl: website_url } : {}),
            ...(category ? { category } : {}),
        });
    }
    return output;
};

const is_probable_host = (value: string): boolean => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value.trim());

const keyword_items_from_materialized_turn = (
    turn: { created_at: Date; capture_session: { chat_provider: StreamProvider } },
    materialized: ReturnType<typeof materialize_turn_from_events>,
): KeywordQueryItem[] => {
    const now_iso = turn.created_at.toISOString();
    const seen = new Set<string>();
    const output: KeywordQueryItem[] = [];
    for (const subquery of materialized.subqueries) {
        if (subquery.query_key === '__unscoped__') continue;
        const query = normalize_query(subquery.label || subquery.query_key);
        if (!query) continue;
        const key = normalize_text_key(query);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
            query,
            sourceProvider: turn.capture_session.chat_provider ?? 'unknown',
            firstSeenAt: now_iso,
        });
    }
    return output;
};

const website_items_from_materialized_turn = (
    turn: { created_at: Date },
    materialized: ReturnType<typeof materialize_turn_from_events>,
): CrawledWebsiteItem[] => {
    const seen = new Set<string>();
    const now_iso = turn.created_at.toISOString();
    const output: CrawledWebsiteItem[] = [];
    for (const subquery of materialized.subqueries) {
        for (const site of subquery.sites) {
            const from_url = canonicalize_url(site.url);
            const inferred_url =
                from_url ??
                (is_probable_host(site.site_name)
                    ? canonicalize_url(`https://${site.site_name.replace(/^www\./i, '')}`)
                    : undefined);
            if (!inferred_url) continue;
            if (seen.has(inferred_url)) continue;
            seen.add(inferred_url);
            const host = infer_site_name_from_url(inferred_url);
            if (!host) continue;
            output.push({
                url: inferred_url,
                host,
                source: 'capture_result',
                firstSeenAt: now_iso,
            });
        }
    }
    return output;
};

const to_iso_from_epoch_seconds = (value: unknown): string | undefined => {
    const numeric = to_number(value);
    if (numeric === undefined) return undefined;
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString();
};

const to_percent_number = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().replace(/%$/, '');
    if (!normalized) return undefined;
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return undefined;
    return numeric;
};

const extract_keyword_rows = (raw: unknown): Record<string, unknown>[] => {
    if (Array.isArray(raw)) {
        return raw.map((entry) => to_record(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
    const root = to_record(raw);
    if (!root) return [];

    if (get_string(root.keyword) || get_string(root.phrase) || get_string(root.query)) {
        return [root];
    }

    const collections = [
        root.data,
        root.output,
        root.result,
        root.payload,
        root.items,
        root.results,
        root.keywords,
        root.organic_keywords,
        root.organic,
        root.rows,
        root.records,
        root.top_queries,
    ];
    for (const collection of collections) {
        if (Array.isArray(collection)) {
            const rows = collection
                .map((entry) => to_record(entry))
                .filter((entry): entry is Record<string, unknown> => Boolean(entry));
            if (rows.length) return rows;
        }
        const as_record = to_record(collection);
        if (as_record) {
            const nested = extract_keyword_rows(as_record);
            if (nested.length) return nested;
        }
    }
    return [];
};

const parse_top_queries_from_payload = (
    payload: unknown,
    fallback_timestamp: string,
): SiteTopQueryRow[] => {
    const rows = extract_keyword_rows(payload);
    const seen = new Set<string>();
    const output: SiteTopQueryRow[] = [];
    for (const row of rows) {
        const query = get_string(row.query) ?? get_string(row.keyword) ?? get_string(row.phrase);
        if (!query) continue;
        const key = normalize_text_key(query);
        if (seen.has(key)) continue;
        seen.add(key);
        const volume = to_number(row.volume ?? row.search_volume ?? row.searchVolume);
        const traffic = to_number(row.traffic ?? row.estimated_traffic ?? row.estimatedTraffic);
        const position = to_number(row.position ?? row.rank ?? row.serp_position);
        const traffic_percent = to_percent_number(row.trafficPercent ?? row.traffic_percent);
        const keyword_difficulty = to_number(row.keywordDifficulty ?? row.keyword_difficulty ?? row.kd);
        const source_timestamp =
            get_string(row.sourceTimestamp) ??
            to_iso_from_epoch_seconds(row.crawledTime ?? row.crawled_time ?? row.updated_at ?? row.timestamp) ??
            fallback_timestamp;
        output.push({
            query,
            ...(volume !== undefined ? { volume } : {}),
            ...(traffic !== undefined ? { traffic } : {}),
            ...(position !== undefined ? { position } : {}),
            ...(traffic_percent !== undefined ? { trafficPercent: traffic_percent } : {}),
            ...(keyword_difficulty !== undefined ? { keywordDifficulty: keyword_difficulty } : {}),
            sourceTimestamp: source_timestamp,
        });
    }

    return output.sort((a, b) => {
        const traffic_delta = (b.traffic ?? 0) - (a.traffic ?? 0);
        if (traffic_delta !== 0) return traffic_delta;
        return (b.volume ?? 0) - (a.volume ?? 0);
    });
};

const extract_site_target_from_snapshot = (
    summary_metrics: Prisma.JsonValue | null,
): { url?: string; host?: string; key?: string } => {
    const summary = to_record(summary_metrics) ?? {};
    const url = canonicalize_url(get_string(summary.target_url) ?? get_string(summary.site_url));
    const host =
        get_string(summary.host) ??
        get_string(summary.domain) ??
        (url ? infer_site_name_from_url(url) : undefined);
    const normalized_host = host ? host.replace(/^www\./i, '').toLowerCase() : undefined;
    return {
        ...(url ? { url } : {}),
        ...(normalized_host ? { host: normalized_host } : {}),
        key: url ?? normalized_host,
    };
};

const fetch_webhook_top_queries = async (params: {
    target: SiteKeywordTarget;
    country: string;
    limit: number;
}): Promise<SiteTopQueryRow[]> => {
    if (!SEMRUSH_URL) return [];

    const webhook_url = new URL(SEMRUSH_URL);
    if (params.target.url) {
        webhook_url.searchParams.set('url', params.target.url);
        webhook_url.searchParams.set('site_url', params.target.url);
    }
    webhook_url.searchParams.set('domain', params.target.host);
    webhook_url.searchParams.set('country', params.country);
    webhook_url.searchParams.set('limit', String(params.limit));

    const response = await fetch(webhook_url.toString(), { method: 'GET' });
    if (!response.ok) return [];
    const raw_text = await response.text();
    let raw_payload: unknown = null;
    try {
        raw_payload = JSON.parse(raw_text) as unknown;
    } catch {
        return [];
    }
    return parse_top_queries_from_payload(raw_payload, new Date().toISOString());
};

export class CampaignService {
    constructor(private repo: CampaignRepository) { }

    private toChatThreadSummary(session: {
        id?: string;
        chat_thread_id?: string;
        chat_provider: StreamProvider;
        conversation_id: string;
        provider_chat_id?: string | null;
        chat_url?: string | null;
        chat_title?: string | null;
        started_at?: Date | string | null;
        last_event_at?: Date | string | null;
        last_opened_at?: Date | string | null;
        turn_count?: number;
    }) {
        const to_iso = (value: Date | string | null | undefined): string | null => {
            if (!value) return null;
            if (typeof value === 'string') return value;
            return value.toISOString();
        };

        return {
            chat_thread_id: session.chat_thread_id ?? session.id ?? '',
            chat_provider: session.chat_provider,
            conversation_id: session.conversation_id,
            provider_chat_id: session.provider_chat_id ?? null,
            chat_url: session.chat_url ?? null,
            chat_title: session.chat_title ?? null,
            started_at: to_iso(session.started_at) ?? new Date(0).toISOString(),
            last_event_at: to_iso(session.last_event_at),
            last_opened_at: to_iso(session.last_opened_at),
            turn_count: session.turn_count ?? 0,
        };
    }

    private async resolveVersion(
        tenant_id: string,
        campaign_id: string,
        user_id?: string,
        version_id?: string,
        create_if_missing = false,
    ) {
        if (version_id) {
            const explicit_version = await this.repo.getVersionById(tenant_id, campaign_id, version_id);
            if (!explicit_version) {
                throw new Error('Campaign version not found');
            }
            return explicit_version;
        }

        let version = await this.repo.getActiveVersion(tenant_id, campaign_id);
        if (!version && create_if_missing && user_id) {
            version = await this.repo.establishActiveVersion(campaign_id, user_id);
        }
        return version;
    }

    private toVersionSummary(version: { id: string; version_number: number; is_active: boolean; status: string; label: string | null; created_at: Date; archived_at: Date | null; }) {
        return {
            id: version.id,
            version_number: version.version_number,
            is_active: version.is_active,
            status: version.status,
            label: version.label,
            created_at: version.created_at,
            archived_at: version.archived_at,
        };
    }

    private getVersionLastExecutionDate(version: { config_json: Prisma.JsonValue | null }): string | undefined {
        const config = to_record(version.config_json) ?? {};
        return get_string(config.workflow_last_execution_at);
    }

    private toPromptCandidate(node: { id: string; content: string; metadata: Prisma.JsonValue | null }): PromptCandidateResponse | null {
        const metadata = to_record(node.metadata) ?? {};
        const source = get_string(metadata.source);
        if (source !== 'suggestion' && source !== 'manual') {
            return null;
        }
        const selected_default = source === 'suggestion';
        const status = parse_prompt_candidate_status(get_string(metadata.status));
        return {
            id: node.id,
            node_id: node.id,
            text: node.content,
            source: source === 'manual' ? 'manual' : 'auto',
            selected: parse_bool(metadata.selected, selected_default),
            status,
            lastExecutionAt: get_string(metadata.last_execution_at),
        };
    }

    private async listPromptCandidatesForVersion(tenant_id: string, campaign_version_id: string): Promise<PromptCandidateResponse[]> {
        const version = await prisma.campaignVersion.findFirst({
            where: {
                id: campaign_version_id,
                tenant_id,
            },
            select: { config_json: true },
        });
        const version_config = to_record(version?.config_json) ?? {};
        const active_suggestion_batch_id = get_string(version_config.workflow_active_suggestion_batch_id);

        const generated_nodes = await prisma.promptNode.findMany({
            where: {
                tenant_id,
                campaign_version_id,
                type: NodeType.generated,
            },
            orderBy: { created_at: 'desc' },
        });

        const latest_suggestion_generation_run_id = active_suggestion_batch_id
            ? undefined
            : generated_nodes
                .map((node) => {
                    const metadata = to_record(node.metadata) ?? {};
                    const source = normalize_text_key(get_string(metadata.source) ?? '');
                    if (source !== 'suggestion') return undefined;
                    return get_string(metadata.generation_run_id);
                })
                .find((value): value is string => Boolean(value));

        const seen = new Set<string>();
        const candidates: PromptCandidateResponse[] = [];
        for (const node of generated_nodes) {
            const metadata = to_record(node.metadata) ?? {};
            const source = normalize_text_key(get_string(metadata.source) ?? '');
            if (source === 'suggestion') {
                const suggestion_batch_id = get_string(metadata.suggestion_batch_id) ?? get_string(metadata.generation_run_id);
                if (active_suggestion_batch_id && suggestion_batch_id !== active_suggestion_batch_id) {
                    continue;
                }
                const generation_run_id = get_string(metadata.generation_run_id);
                if (
                    !active_suggestion_batch_id &&
                    latest_suggestion_generation_run_id &&
                    generation_run_id &&
                    generation_run_id !== latest_suggestion_generation_run_id
                ) {
                    continue;
                }
            }
            const candidate = this.toPromptCandidate(node);
            if (!candidate) continue;
            const dedupe_key = `${candidate.source ?? ""}:${normalize_text_key(candidate.text ?? "")}`;
            if (seen.has(dedupe_key)) continue;
            seen.add(dedupe_key);
            candidates.push(candidate);
        }

        return candidates as unknown as PromptCandidateItem[];
    }

    private async listExecutedPromptsForVersion(
        tenant_id: string,
        campaign_version_id: string,
        prompt_candidates: PromptCandidateResponse[],
    ): Promise<ExecutedPromptResponse[]> {
        const turns = await prisma.captureTurn.findMany({
            where: {
                tenant_id,
                capture_session: {
                    campaign_version_id,
                },
            },
            include: {
                capture_session: {
                    select: {
                        chat_provider: true,
                        conversation_id: true,
                    },
                },
            },
            orderBy: { created_at: 'desc' },
            take: 200,
        });

        const candidate_by_prompt_key = new Map<string, string>();
        for (const candidate of prompt_candidates) {
            const key = normalize_text_key(candidate.text ?? "");
            if (!key || candidate_by_prompt_key.has(key)) continue;
            candidate_by_prompt_key.set(key, candidate.id ?? "");
        }

        const groups = new Map<string, {
            item: ExecutedPromptResponse;
            prompt_quality: number;
            source_quality: number;
            keyword_map: Map<string, KeywordQueryItem>;
            website_map: Map<string, CrawledWebsiteItem>;
            place_map: Map<string, PlaceFoundItem>;
        }>();
        for (const turn of turns) {
            const metadata = to_record(turn.metadata) ?? {};
            const workflow_discovery = to_record(metadata.workflow_discovery) ?? {};
            let searched_keywords = parse_keyword_items(workflow_discovery.searchedKeywords);
            let crawled_websites = parse_website_items(workflow_discovery.crawledWebsites);
            const places_found = parse_place_items(workflow_discovery.placesFound);

            if (!searched_keywords.length || !crawled_websites.length) {
                const raw_payload = to_record(turn.raw_event_json) ?? {};
                const event_rows = to_array(raw_payload.normalized_events)
                    .map((row: any) => to_record(row))
                    .filter((row): row is Record<string, unknown> => Boolean(row));
                if (event_rows.length) {
                    const normalized_events = event_rows as unknown as NormalizedTurnEvent[];
                    const materialized = materialize_turn_from_events(normalized_events);
                    if (!searched_keywords.length) {
                        searched_keywords = keyword_items_from_materialized_turn(
                            {
                                created_at: turn.created_at,
                                capture_session: {
                                    chat_provider: turn.capture_session.chat_provider as StreamProvider,
                                },
                            },
                            materialized,
                        );
                    }
                    if (!crawled_websites.length) {
                        crawled_websites = website_items_from_materialized_turn(
                            { created_at: turn.created_at },
                            materialized,
                        );
                    }
                }
            }

            const finished_reason_key = normalize_text_key(get_string(turn.finished_reason) ?? '');
            const status: 'completed' | 'failed' = finished_reason_key.includes('fail') ? 'failed' : 'completed';
            const source_prompt_id =
                get_string(metadata.source_prompt_id) ??
                candidate_by_prompt_key.get(normalize_text_key(turn.prompt));
            const source = get_string(metadata.source);
            const conversation_id = get_string(turn.capture_session.conversation_id);
            const request_id = get_string(turn.request_id);
            const turn_exchange_id = get_string(turn.turn_exchange_id);
            const fallback_prompt = is_imported_prompt_fallback(turn.prompt);
            if (fallback_prompt) {
                continue;
            }
            const group_key =
                conversation_id && request_id && turn_exchange_id
                    ? `${conversation_id}::${request_id}::${turn_exchange_id}`
                    : `turn:${turn.id}`;

            const item: ExecutedPromptResponse = {
                id: turn.id,
                text: turn.prompt,
                provider: (turn.capture_session.chat_provider as StreamProvider) ?? 'unknown',
                status,
                lastExecutionAt: turn.created_at.toISOString(),
                ...(source_prompt_id ? { sourcePromptId: source_prompt_id } : {}),
                searchedKeywords: searched_keywords,
                crawledWebsites: crawled_websites,
                placesFound: places_found,
            };

            const existing = groups.get(group_key);
            if (!existing) {
                groups.set(group_key, {
                    item,
                    prompt_quality: prompt_quality_score(item.text),
                    source_quality: prompt_source_score(source),
                    keyword_map: new Map(item.searchedKeywords.map((keyword) => [normalize_text_key(keyword.query), keyword])),
                    website_map: new Map(item.crawledWebsites.map((site) => [site.url, site])),
                    place_map: new Map(item.placesFound.map((place) => [`${normalize_text_key(place.name)}|${normalize_text_key(place.address ?? '')}`, place])),
                });
                continue;
            }

            for (const keyword of item.searchedKeywords) {
                const key = normalize_text_key(keyword.query);
                if (!existing.keyword_map.has(key)) {
                    existing.keyword_map.set(key, keyword);
                }
            }
            for (const site of item.crawledWebsites) {
                if (!existing.website_map.has(site.url)) {
                    existing.website_map.set(site.url, site);
                }
            }
            for (const place of item.placesFound) {
                const key = `${normalize_text_key(place.name)}|${normalize_text_key(place.address ?? '')}`;
                if (!existing.place_map.has(key)) {
                    existing.place_map.set(key, place);
                }
            }

            const incoming_prompt_quality = prompt_quality_score(item.text);
            const incoming_source_quality = prompt_source_score(source);
            const should_replace_prompt =
                incoming_prompt_quality > existing.prompt_quality ||
                (incoming_prompt_quality === existing.prompt_quality && incoming_source_quality > existing.source_quality) ||
                (incoming_prompt_quality === existing.prompt_quality &&
                    incoming_source_quality === existing.source_quality &&
                    item.text.length > existing.item.text.length);
            if (should_replace_prompt) {
                existing.item.text = item.text;
                existing.item.provider = item.provider;
                if (item.sourcePromptId) {
                    existing.item.sourcePromptId = item.sourcePromptId;
                }
                existing.prompt_quality = incoming_prompt_quality;
                existing.source_quality = incoming_source_quality;
            }

            if (item.status === 'failed') {
                existing.item.status = 'failed';
            }
            if (new Date(item.lastExecutionAt).getTime() > new Date(existing.item.lastExecutionAt).getTime()) {
                existing.item.lastExecutionAt = item.lastExecutionAt;
            }
        }

        return Array.from(groups.values())
            .map((group) => ({
                ...group.item,
                searchedKeywords: Array.from(group.keyword_map.values()),
                crawledWebsites: Array.from(group.website_map.values()),
                placesFound: Array.from(group.place_map.values()),
            }))
            .sort((a, b) => new Date(b.lastExecutionAt).getTime() - new Date(a.lastExecutionAt).getTime());
    }

    private async getLatestWorkflowDiscovery(tenant_id: string, campaign_version_id: string): Promise<{
        searchedKeywords: KeywordQueryItem[];
        crawledWebsites: CrawledWebsiteItem[];
        placesFound: PlaceFoundItem[];
        warnings: string[];
        provider: StreamProvider;
        conversationId: string;
    }> {
        const latest_turn = await prisma.captureTurn.findFirst({
            where: {
                tenant_id,
                capture_session: {
                    campaign_version_id,
                },
            },
            include: {
                capture_session: {
                    select: {
                        chat_provider: true,
                        conversation_id: true,
                    },
                },
            },
            orderBy: { created_at: 'desc' },
        });

        if (!latest_turn) {
            return {
                searchedKeywords: [],
                crawledWebsites: [],
                placesFound: [],
                warnings: ['No capture turns found for this version yet.'],
                provider: 'unknown',
                conversationId: '',
            };
        }

        const metadata = to_record(latest_turn.metadata) ?? {};
        const workflow_discovery = to_record(metadata.workflow_discovery) ?? {};
        const searched_keywords = parse_keyword_items(workflow_discovery.searchedKeywords);
        const crawled_websites = parse_website_items(workflow_discovery.crawledWebsites);
        const places = parse_place_items(workflow_discovery.placesFound);
        const warnings = Array.isArray(workflow_discovery.warnings)
            ? workflow_discovery.warnings.map((item: any) => get_string(item)).filter((item): item is string => Boolean(item))
            : [];

        if (!searched_keywords.length || !crawled_websites.length) {
            const nodes = await this.repo.getVersionNodes(tenant_id, campaign_version_id);
            const inferred_keywords = searched_keywords.length
                ? searched_keywords
                : nodes
                    .filter((node) => node.type === NodeType.subquery)
                    .map((node) => node.content.trim())
                    .filter((content) => content && content !== '__unscoped__' && content.toLowerCase() !== 'unmapped_sources')
                    .map((query: any) => ({
                        query,
                        sourceProvider: (latest_turn.capture_session.chat_provider as StreamProvider) ?? 'unknown',
                        firstSeenAt: latest_turn.created_at.toISOString(),
                    }));

            const inferred_sites = crawled_websites.length
                ? crawled_websites
                : nodes
                    .filter((node) => node.type === NodeType.site)
                    .map((node) => {
                        const node_meta = to_record(node.metadata) ?? {};
                        const url = canonicalize_url(get_string(node_meta.url));
                        const host = url ? infer_site_name_from_url(url) : undefined;
                        if (!url || !host) return null;
                        return {
                            url,
                            host,
                            source: get_string(node_meta.source) ?? 'tree_site',
                            firstSeenAt: node.created_at.toISOString(),
                        } satisfies CrawledWebsiteItem;
                    })
                    .filter((item): item is CrawledWebsiteItem => Boolean(item));

            return {
                searchedKeywords: inferred_keywords,
                crawledWebsites: inferred_sites,
                placesFound: places,
                warnings,
                provider: (latest_turn.capture_session.chat_provider as StreamProvider) ?? 'unknown',
                conversationId: latest_turn.capture_session.conversation_id,
            };
        }

        return {
            searchedKeywords: searched_keywords,
            crawledWebsites: crawled_websites,
            placesFound: places,
            warnings,
            provider: (latest_turn.capture_session.chat_provider as StreamProvider) ?? 'unknown',
            conversationId: latest_turn.capture_session.conversation_id,
        };
    }

    async getWorkflowState(tenant_id: string, campaign_id: string, version_id?: string): Promise<WorkflowStatePayload> {
        const version = await this.resolveVersion(tenant_id, campaign_id, undefined, version_id, false);
        if (!version) {
            return {
                version: null,
                promptCandidates: [],
                executedPrompts: [],
                searchedKeywords: [],
                crawledWebsites: [],
                placesFound: [],
                warnings: ['No active version found for campaign.'],
                versionMeta: {
                    provider: 'unknown',
                    conversationId: '',
                },
            };
        }

        const prompt_candidates = await this.listPromptCandidatesForVersion(tenant_id, version.id);
        const executed_prompts = await this.listExecutedPromptsForVersion(tenant_id, version.id, prompt_candidates);
        const discovery = await this.getLatestWorkflowDiscovery(tenant_id, version.id);
        const last_execution_date = this.getVersionLastExecutionDate(version) ?? executed_prompts[0]?.lastExecutionAt;
        return {
            version,
            promptCandidates: prompt_candidates as unknown as PromptCandidateItem[],
            executedPrompts: executed_prompts,
            searchedKeywords: discovery.searchedKeywords,
            crawledWebsites: discovery.crawledWebsites,
            placesFound: discovery.placesFound,
            warnings: discovery.warnings,
            versionMeta: {
                versionDate: version.created_at.toISOString(),
                lastExecutionDate: last_execution_date,
                provider: discovery.provider,
                conversationId: discovery.conversationId,
            },
        };
    }

    async ingestConversation(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        provider: StreamProvider,
        data: ConversationIngestDto,
        version_id?: string,
    ) {
        const resolved_version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id ?? data.promptVersionId, true);
        if (!resolved_version) {
            throw new Error('Campaign has no active version');
        }

        const prompt_candidates = await this.listPromptCandidatesForVersion(tenant_id, resolved_version.id);
        const normalized: NormalizedConversationData = normalize_conversation_payload({
            provider,
            conversationId: data.conversationId,
            payload: data.payload,
            promptCandidates: prompt_candidates as unknown as PromptCandidateItem[],
            versionDate: resolved_version.created_at.toISOString(),
            lastExecutionDate: this.getVersionLastExecutionDate(resolved_version),
        });
        const ingest_source = normalize_text_key(data.source ?? '') || 'conversation_ingest';
        const explicit_prompt = normalize_prompt(data.prompt ?? '');
        const normalized_prompt = normalize_prompt(normalized.prompt ?? '');
        const resolved_prompt = explicit_prompt
            || (!is_imported_prompt_fallback(normalized_prompt) ? normalized_prompt : '');
        if (!resolved_prompt) {
            throw new Error('Unable to resolve prompt text from conversation payload');
        }

        await this.ingestTurn(
            tenant_id,
            user_id,
            campaign_id,
            {
                chat_provider: provider,
                conversation_id: data.conversationId,
                prompt: resolved_prompt,
                queries: normalized.searchedKeywords.map((item: any) => item.query),
                result_groups: normalized.resultGroups,
                metadata: {
                    source: ingest_source,
                    ...(data.sourcePromptId ? { source_prompt_id: data.sourcePromptId } : {}),
                    workflow_discovery: {
                        searchedKeywords: normalized.searchedKeywords,
                        crawledWebsites: normalized.crawledWebsites,
                        placesFound: normalized.placesFound,
                        warnings: normalized.warnings,
                    },
                },
            },
            resolved_version.id,
        );

        const workflow_state = await this.getWorkflowState(tenant_id, campaign_id, resolved_version.id);
        const normalized_prompt_key = normalize_text_key(resolved_prompt);
        const executed_prompt = workflow_state.executedPrompts.find((item) => {
            if (data.sourcePromptId && item.sourcePromptId === data.sourcePromptId) return true;
            return normalize_text_key(item.text ?? "") === normalized_prompt_key;
        }) ?? null;
        return {
            ...workflow_state,
            executedPrompt: executed_prompt,
            warnings: Array.from(new Set([...(workflow_state.warnings ?? []), ...(normalized.warnings ?? [])])),
            versionMeta: {
                ...workflow_state.versionMeta,
                provider,
                conversationId: data.conversationId,
            },
        };
    }

    async addManualPromptCandidate(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        payload: ManualPromptDto,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        await this.repo.createNode({
            tenant_id,
            campaign_version_id: version.id,
            type: NodeType.generated,
            content: normalize_prompt(payload.text),
            depth: 0,
            metadata: {
                source: 'manual',
                selected: true,
                status: 'new',
                created_by_user_id: user_id,
                source_version_id: version.id,
                refreshable: true,
                refresh_count: 0,
                refresh_status: 'idle',
            },
        });

        return this.getWorkflowState(tenant_id, campaign_id, version.id);
    }

    async selectPromptCandidates(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        payload: SelectPromptCandidatesDto,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const rows = await prisma.promptNode.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                id: { in: payload.promptIds },
                type: NodeType.generated,
            },
        });

        await Promise.all(rows.map(async (row) => {
            const metadata = to_record(row.metadata) ?? {};
            const source = get_string(metadata.source);
            if (source !== 'suggestion' && source !== 'manual') return;
            await prisma.promptNode.update({
                where: { id: row.id },
                data: {
                    metadata: {
                        ...metadata,
                        selected: payload.selected,
                    } as Prisma.InputJsonValue,
                },
            });
        }));

        return this.getWorkflowState(tenant_id, campaign_id, version.id);
    }

    async replacePromptSelection(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        selected_prompt_ids: string[],
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }
        const selected_set = new Set(selected_prompt_ids.map((id) => id.trim()).filter(Boolean));
        const rows = await prisma.promptNode.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                type: NodeType.generated,
            },
        });

        await Promise.all(rows.map(async (row) => {
            const metadata = to_record(row.metadata) ?? {};
            const source = get_string(metadata.source);
            if (source !== 'suggestion' && source !== 'manual') return;
            await prisma.promptNode.update({
                where: { id: row.id },
                data: {
                    metadata: {
                        ...metadata,
                        selected: selected_set.has(row.id),
                    } as Prisma.InputJsonValue,
                },
            });
        }));

        return this.getWorkflowState(tenant_id, campaign_id, version.id);
    }

    async executePromptCandidates(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        payload: ExecutePromptDto,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const rows = await prisma.promptNode.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                id: { in: payload.promptIds },
                type: NodeType.generated,
            },
        });
        const by_id = new Map(rows.map((row: any) => [row.id, row]));
        const ordered_rows = payload.promptIds
            .map((id) => by_id.get(id))
            .filter((row): row is typeof rows[number] => Boolean(row));

        if (!ordered_rows.length) {
            throw new Error('No valid prompt candidates found for execution');
        }

        const now_iso = new Date().toISOString();
        await Promise.all(ordered_rows.map(async (row) => {
            const metadata = to_record(row.metadata) ?? {};
            await prisma.promptNode.update({
                where: { id: row.id },
                data: {
                    metadata: {
                        ...metadata,
                        status: 'fired',
                        selected: true,
                        last_execution_at: now_iso,
                        last_execution_provider: payload.provider,
                        last_execution_mode: payload.mode,
                    } as Prisma.InputJsonValue,
                },
            });
        }));

        const version_config = to_record(version.config_json) ?? {};
        await prisma.campaignVersion.update({
            where: { id: version.id },
            data: {
                config_json: {
                    ...version_config,
                    workflow_last_execution_at: now_iso,
                    workflow_last_execution_provider: payload.provider,
                    workflow_last_execution_mode: payload.mode,
                } as Prisma.InputJsonValue,
            },
        });

        const execution_id = randomUUID();
        return {
            executionId: execution_id,
            mode: payload.mode,
            provider: payload.provider,
            status: 'queued' as const,
            orderedQueue: ordered_rows.map((row: any, index: any) => ({
                promptId: row.id,
                text: row.content,
                index,
                status: 'queued' as const,
            })),
            version: this.toVersionSummary(version),
            lastExecutionDate: now_iso,
        };
    }

    async getSiteTopQueries(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        payload: SiteTopQueriesDto,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const target_by_cache_key = new Map<string, SiteKeywordTarget>();
        for (const raw_target of payload.targets ?? []) {
            const target = normalize_site_keyword_request_target(raw_target as SiteKeywordRequestTarget);
            if (!target) continue;
            if (!target_by_cache_key.has(target.cacheKey)) {
                target_by_cache_key.set(target.cacheKey, target);
            }
        }
        for (const raw_host of payload.hosts ?? []) {
            const target = normalize_site_keyword_target(raw_host);
            if (!target) continue;
            if (!target_by_cache_key.has(target.cacheKey)) {
                target_by_cache_key.set(target.cacheKey, target);
            }
        }
        const normalized_targets = Array.from(target_by_cache_key.values());
        if (!normalized_targets.length) {
            throw new Error('No valid targets, hosts, or URLs were supplied');
        }

        const now = Date.now();
        const results: Array<{
            host: string;
            target_url?: string;
            top_queries: SiteTopQueryRow[];
            cached: boolean;
            provider?: 'semrush' | 'ahrefs';
            fetched_at?: string;
            error?: string;
        }> = [];

        for (const target of normalized_targets) {
            const cache_key = `site-keywords:${target.cacheKey}:${payload.country}`;
            const cached = await prisma.semrushSnapshot.findFirst({
                where: {
                    tenant_id,
                    campaign_version_id: version.id,
                    query_text: cache_key,
                },
                orderBy: { fetched_at: 'desc' },
            });

            const use_cache =
                !payload.forceRefresh &&
                cached &&
                now - cached.fetched_at.getTime() <= SITE_KEYWORD_CACHE_TTL_MS;

            if (use_cache && cached) {
                const raw = to_record(cached.raw_response) ?? {};
                const top_queries = to_array(raw.top_queries)
                    .map((row: unknown) => to_record(row))
                    .filter((row): row is Record<string, unknown> => Boolean(row))
                    .map((row: Record<string, unknown>) => {
                        const query = get_string(row.query) ?? get_string(row.keyword) ?? get_string(row.phrase) ?? '';
                        if (!query) return null;
                        const volume = to_number(row.volume);
                        const traffic = to_number(row.traffic);
                        const position = to_number(row.position);
                        const traffic_percent = to_percent_number(row.trafficPercent ?? row.traffic_percent);
                        const keyword_difficulty = to_number(row.keywordDifficulty ?? row.keyword_difficulty);
                        return {
                            query,
                            ...(volume !== undefined ? { volume } : {}),
                            ...(traffic !== undefined ? { traffic } : {}),
                            ...(position !== undefined ? { position } : {}),
                            ...(traffic_percent !== undefined ? { trafficPercent: traffic_percent } : {}),
                            ...(keyword_difficulty !== undefined ? { keywordDifficulty: keyword_difficulty } : {}),
                            sourceTimestamp: get_string(row.sourceTimestamp) ?? cached.fetched_at.toISOString(),
                        };
                    })
                    .filter((row): row is SiteTopQueryRow => Boolean(row))
                    .slice(0, payload.limit);

                results.push({
                    host: target.host,
                    ...(target.url ? { target_url: target.url } : {}),
                    top_queries,
                    cached: true,
                    provider: (get_string(raw.provider) as 'semrush' | 'ahrefs' | undefined) ?? undefined,
                    fetched_at: cached.fetched_at.toISOString(),
                });
                continue;
            }

            try {
                if (!SEMRUSH_URL && !AHREFS_URL) {
                    results.push({
                        host: target.host,
                        ...(target.url ? { target_url: target.url } : {}),
                        top_queries: [],
                        cached: false,
                        error: 'No keyword provider configured',
                    });
                    continue;
                }

                let provider: 'semrush' | 'ahrefs' = 'semrush';
                const fetched_at = new Date().toISOString();
                const cache_limit = Math.max(payload.limit, 50);
                let top_queries = await fetch_webhook_top_queries({
                    target,
                    country: payload.country,
                    limit: cache_limit,
                });

                let insight: Awaited<ReturnType<typeof fetch_semrush_site_insights>>[number] | null = null;
                if (!top_queries.length && SEMRUSH_URL) {
                    const insights = await fetch_semrush_site_insights({
                        semrush_url: SEMRUSH_URL,
                        sites: [{
                            site_name: target.host,
                            site_url: target.url,
                        } satisfies SemrushSiteInput],
                        latest_prompt: target.host,
                    });
                    insight = insights[0] ?? null;
                    top_queries = insight
                        ? (
                            insight.keyword_metrics.length
                                ? insight.keyword_metrics.slice(0, cache_limit).map((metric) => ({
                                    query: metric.keyword,
                                    volume: metric.volume,
                                    traffic: metric.traffic,
                                    sourceTimestamp: fetched_at,
                                }))
                                : insight.ranking_keywords.slice(0, cache_limit).map((keyword) => ({
                                    query: keyword,
                                    sourceTimestamp: fetched_at,
                                }))
                        )
                        : [];
                }
                if (!top_queries.length && AHREFS_URL) {
                    provider = 'ahrefs';
                    const insights = await fetch_ahrefs_site_insights({
                        ahrefs_url: AHREFS_URL,
                        sites: [{
                            site_name: target.host,
                            site_url: target.url,
                        } satisfies SemrushSiteInput],
                        latest_prompt: target.host,
                    });
                    insight = insights[0] ?? null;
                    top_queries = insight
                        ? (
                            insight.keyword_metrics.length
                                ? insight.keyword_metrics.slice(0, cache_limit).map((metric) => ({
                                    query: metric.keyword,
                                    volume: metric.volume,
                                    traffic: metric.traffic,
                                    sourceTimestamp: fetched_at,
                                }))
                                : insight.ranking_keywords.slice(0, cache_limit).map((keyword) => ({
                                    query: keyword,
                                    sourceTimestamp: fetched_at,
                                }))
                        )
                        : [];
                }

                await prisma.semrushSnapshot.create({
                    data: {
                        tenant_id,
                        campaign_version_id: version.id,
                        query_text: cache_key,
                        summary_metrics: {
                            host: target.host,
                            target_url: target.url,
                            country: payload.country,
                            limit: payload.limit,
                            provider,
                        } as Prisma.InputJsonValue,
                        raw_response: {
                            provider,
                            top_queries: top_queries,
                            insight: insight ?? null,
                        } as unknown as Prisma.InputJsonValue,
                    },
                });

                results.push({
                    host: target.host,
                    ...(target.url ? { target_url: target.url } : {}),
                    top_queries: top_queries.slice(0, payload.limit),
                    cached: false,
                    provider,
                    fetched_at,
                });
            } catch (error) {
                results.push({
                    host: target.host,
                    ...(target.url ? { target_url: target.url } : {}),
                    top_queries: [],
                    cached: false,
                    error: error instanceof Error ? error.message : 'Failed to fetch top queries',
                });
            }
        }

        const warnings = results
            .filter((row) => row.error)
            .map((row: any) => `${row.host}: ${row.error}`);

        return {
            country: payload.country,
            limit: payload.limit,
            ttlHours: 24,
            results,
            warnings,
        };
    }

    async getDashboardAnalytics(tenant_id: string, range: AnalyticsRange) {
        const range_start = range_start_for(range);
        const campaigns = await this.repo.listCampaigns(tenant_id);
        const campaign_ids = campaigns.map((campaign) => campaign.id);
        const by_campaign = new Map<string, {
            executed: number;
            completed: number;
            failed: number;
            last_execution_at: string | null;
            discovered_sites: Set<string>;
            fetched_sites: Set<string>;
            provider_totals: {
                chatgpt: number;
                claude: number;
                gemini: number;
                perplexity: number;
                grok: number;
                unknown: number;
            };
        }>();
        for (const campaign of campaigns) {
            by_campaign.set(campaign.id, {
                executed: 0,
                completed: 0,
                failed: 0,
                last_execution_at: null,
                discovered_sites: new Set<string>(),
                fetched_sites: new Set<string>(),
                provider_totals: {
                    chatgpt: 0,
                    claude: 0,
                    gemini: 0,
                    perplexity: 0,
                    grok: 0,
                    unknown: 0,
                },
            });
        }

        const momentum_by_day = new Map<string, {
            date: string;
            chatgpt: number;
            claude: number;
            gemini: number;
            perplexity: number;
            grok: number;
            unknown: number;
        }>();
        const freshness_buckets = {
            pending: 0,
            '0_24h': 0,
            '1_3d': 0,
            '3_7d': 0,
            '7d_plus': 0,
        };

        if (campaign_ids.length) {
            const turns = await prisma.captureTurn.findMany({
                where: {
                    tenant_id,
                    ...(range_start ? { created_at: { gte: range_start } } : {}),
                    capture_session: {
                        campaign_version: {
                            campaign_id: { in: campaign_ids },
                        },
                    },
                },
                select: {
                    created_at: true,
                    finished_reason: true,
                    metadata: true,
                    capture_session: {
                        select: {
                            chat_provider: true,
                            campaign_version: {
                                select: { campaign_id: true },
                            },
                        },
                    },
                },
            });

            for (const turn of turns) {
                const campaign_id = turn.capture_session.campaign_version.campaign_id;
                const metric = by_campaign.get(campaign_id);
                if (!metric) continue;

                metric.executed += 1;
                const failed = normalize_text_key(get_string(turn.finished_reason) ?? '').includes('fail');
                if (failed) metric.failed += 1;
                else metric.completed += 1;

                const turn_iso = turn.created_at.toISOString();
                if (!metric.last_execution_at || new Date(turn_iso).getTime() > new Date(metric.last_execution_at).getTime()) {
                    metric.last_execution_at = turn_iso;
                }

                const day = to_day_key(turn.created_at);
                const row = momentum_by_day.get(day) ?? {
                    date: day,
                    chatgpt: 0,
                    claude: 0,
                    gemini: 0,
                    perplexity: 0,
                    grok: 0,
                    unknown: 0,
                };
                const provider = turn.capture_session.chat_provider as StreamProvider;
                if (provider === 'chatgpt') {
                    row.chatgpt += 1;
                    metric.provider_totals.chatgpt += 1;
                } else if (provider === 'claude') {
                    row.claude += 1;
                    metric.provider_totals.claude += 1;
                } else if (provider === 'gemini') {
                    row.gemini += 1;
                    metric.provider_totals.gemini += 1;
                } else if (provider === 'perplexity') {
                    row.perplexity += 1;
                    metric.provider_totals.perplexity += 1;
                } else if (provider === 'grok') {
                    row.grok += 1;
                    metric.provider_totals.grok += 1;
                } else {
                    row.unknown += 1;
                    metric.provider_totals.unknown += 1;
                }
                momentum_by_day.set(day, row);

                const metadata = to_record(turn.metadata) ?? {};
                const workflow_discovery = to_record(metadata.workflow_discovery) ?? {};
                const discovered = parse_website_items(workflow_discovery.crawledWebsites);
                for (const site of discovered) {
                    metric.discovered_sites.add(site.url);
                }
            }

            const snapshots = await prisma.semrushSnapshot.findMany({
                where: {
                    tenant_id,
                    query_text: { startsWith: 'site-keywords:' },
                    ...(range_start ? { fetched_at: { gte: range_start } } : {}),
                    campaign_version: {
                        campaign_id: { in: campaign_ids },
                    },
                },
                select: {
                    summary_metrics: true,
                    campaign_version: {
                        select: { campaign_id: true },
                    },
                },
            });

            for (const snapshot of snapshots) {
                const campaign_id = snapshot.campaign_version.campaign_id;
                const metric = by_campaign.get(campaign_id);
                if (!metric) continue;
                const target = extract_site_target_from_snapshot(snapshot.summary_metrics);
                if (target.key) {
                    metric.fetched_sites.add(target.key);
                }
            }
        }

        const health_matrix = campaigns.map((campaign) => {
            const metric = by_campaign.get(campaign.id)!;
            const discovered_count = metric.discovered_sites.size;
            const fetched_count = metric.fetched_sites.size;
            const fetched_ratio = discovered_count ? fetched_count / discovered_count : 0;
            const bucket = freshness_bucket_for(metric.last_execution_at);
            freshness_buckets[bucket] += 1;
            return {
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                executed_prompts: metric.executed,
                fetched_ratio,
                total_nodes: campaign.total_nodes,
                completed: metric.completed,
                failed: metric.failed,
                last_execution_at: metric.last_execution_at,
                provider_totals: metric.provider_totals,
            };
        });

        return {
            range,
            generated_at: new Date().toISOString(),
            momentum: Array.from(momentum_by_day.values()).sort((a, b) => a.date.localeCompare(b.date)),
            health_matrix,
            freshness_buckets: [
                { bucket: 'pending', count: freshness_buckets.pending },
                { bucket: '0_24h', count: freshness_buckets['0_24h'] },
                { bucket: '1_3d', count: freshness_buckets['1_3d'] },
                { bucket: '3_7d', count: freshness_buckets['3_7d'] },
                { bucket: '7d_plus', count: freshness_buckets['7d_plus'] },
            ],
        };
    }

    async getPipelineAnalytics(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        range: AnalyticsRange,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }
        const workflow_state = await this.getWorkflowState(tenant_id, campaign_id, version.id);
        const range_start = range_start_for(range);
        const executed_in_range = workflow_state.executedPrompts.filter((item) => is_in_range(item.lastExecutionAt, range_start));

        const discovered_sites = new Set<string>();
        for (const executed of executed_in_range) {
            for (const site of executed.crawledWebsites) {
                discovered_sites.add(site.url);
            }
        }

        const snapshots = await prisma.semrushSnapshot.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                query_text: { startsWith: 'site-keywords:' },
                ...(range_start ? { fetched_at: { gte: range_start } } : {}),
            },
            select: {
                summary_metrics: true,
            },
        });
        const fetched_sites = new Set<string>();
        for (const snapshot of snapshots) {
            const target = extract_site_target_from_snapshot(snapshot.summary_metrics);
            if (target.key) fetched_sites.add(target.key);
        }

        const heatmap = new Map<string, { day: string; hour: number; count: number }>();
        const provider_map = new Map<StreamProvider, { provider: StreamProvider; completed: number; failed: number; total: number }>();
        for (const executed of executed_in_range) {
            const date = new Date(executed.lastExecutionAt);
            if (!Number.isNaN(date.getTime())) {
                const day = to_day_key(date);
                const hour = date.getHours();
                const key = `${day}::${hour}`;
                const cell = heatmap.get(key) ?? { day, hour, count: 0 };
                cell.count += 1;
                heatmap.set(key, cell);
            }

            const provider = executed.provider;
            const summary = provider_map.get(provider) ?? { provider, completed: 0, failed: 0, total: 0 };
            summary.total += 1;
            if (executed.status === 'failed') summary.failed += 1;
            else summary.completed += 1;
            provider_map.set(provider, summary);
        }

        const fired_count = workflow_state.promptCandidates.filter((item) => item.status !== 'new').length;
        const completed_count = executed_in_range.filter((item) => item.status === 'completed').length;
        return {
            range,
            version_id: version.id,
            generated_at: new Date().toISOString(),
            funnel: {
                suggested: workflow_state.promptCandidates.length,
                selected: workflow_state.promptCandidates.filter((item) => item.selected).length,
                fired: fired_count,
                executed_completed: completed_count,
                websites_fetched: fetched_sites.size,
            },
            execution_rhythm: Array.from(heatmap.values()).sort((a, b) =>
                a.day === b.day ? a.hour - b.hour : a.day.localeCompare(b.day),
            ),
            provider_outcomes: Array.from(provider_map.values()).sort((a, b) => b.total - a.total),
            discovered_websites: discovered_sites.size,
            fetched_websites: fetched_sites.size,
        };
    }

    async getPromptAnalytics(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        range: AnalyticsRange,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }
        const workflow_state = await this.getWorkflowState(tenant_id, campaign_id, version.id);
        const range_start = range_start_for(range);
        const executed_in_range = workflow_state.executedPrompts.filter((item) => is_in_range(item.lastExecutionAt, range_start));

        const provider_map = new Map<StreamProvider, {
            provider: StreamProvider;
            completed: number;
            failed: number;
            websites_sum: number;
            total: number;
        }>();
        const points = executed_in_range.map((item: any) => {
            const row = provider_map.get(item.provider) ?? {
                provider: item.provider,
                completed: 0,
                failed: 0,
                websites_sum: 0,
                total: 0,
            };
            row.total += 1;
            row.websites_sum += item.crawledWebsites.length;
            if (item.status === 'failed') row.failed += 1;
            else row.completed += 1;
            provider_map.set(item.provider, row);

            return {
                prompt_id: item.id,
                prompt: item.text,
                provider: item.provider,
                status: item.status,
                timestamp: item.lastExecutionAt,
                keyword_count: item.searchedKeywords.length,
                website_count: item.crawledWebsites.length,
            };
        });

        const timeline = executed_in_range
            .map((item: any) => ({
                prompt_id: item.id,
                prompt: item.text,
                provider: item.provider,
                status: item.status,
                timestamp: item.lastExecutionAt,
            }))
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        return {
            range,
            version_id: version.id,
            generated_at: new Date().toISOString(),
            points,
            provider_outcomes: Array.from(provider_map.values()).map((item: any) => ({
                provider: item.provider,
                completed: item.completed,
                failed: item.failed,
                avg_websites_per_prompt: item.total ? item.websites_sum / item.total : 0,
                total: item.total,
            })),
            timeline,
        };
    }

    async getWebsiteAnalytics(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        version_id: string | undefined,
        range: AnalyticsRange,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }
        const workflow_state = await this.getWorkflowState(tenant_id, campaign_id, version.id);
        const range_start = range_start_for(range);
        const executed_in_range = workflow_state.executedPrompts.filter((item) => is_in_range(item.lastExecutionAt, range_start));

        const site_map = new Map<string, {
            url: string;
            host: string;
            prompt_ids: Set<string>;
            providers: Set<StreamProvider>;
            last_seen_at: string;
        }>();

        for (const executed of executed_in_range) {
            for (const site of executed.crawledWebsites) {
                const entry = site_map.get(site.url) ?? {
                    url: site.url,
                    host: site.host.replace(/^www\./i, '').toLowerCase(),
                    prompt_ids: new Set<string>(),
                    providers: new Set<StreamProvider>(),
                    last_seen_at: executed.lastExecutionAt,
                };
                entry.prompt_ids.add(executed.id);
                entry.providers.add(executed.provider);
                if (new Date(executed.lastExecutionAt).getTime() > new Date(entry.last_seen_at).getTime()) {
                    entry.last_seen_at = executed.lastExecutionAt;
                }
                site_map.set(site.url, entry);
            }
        }

        const snapshots = await prisma.semrushSnapshot.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                query_text: { startsWith: 'site-keywords:' },
                ...(range_start ? { fetched_at: { gte: range_start } } : {}),
            },
            select: {
                summary_metrics: true,
                raw_response: true,
                fetched_at: true,
            },
        });
        const metrics_by_key = new Map<string, { volume: number; traffic: number; last_fetched_at: string }>();
        for (const snapshot of snapshots) {
            const target = extract_site_target_from_snapshot(snapshot.summary_metrics);
            if (!target.key) continue;
            const raw = to_record(snapshot.raw_response) ?? {};
            const rows = parse_top_queries_from_payload(raw.top_queries ?? raw, snapshot.fetched_at.toISOString());
            const volume_sum = rows.reduce((sum, row) => sum + (row.volume ?? 0), 0);
            const traffic_sum = rows.reduce((sum, row) => sum + (row.traffic ?? 0), 0);
            const existing = metrics_by_key.get(target.key) ?? {
                volume: 0,
                traffic: 0,
                last_fetched_at: snapshot.fetched_at.toISOString(),
            };
            existing.volume += volume_sum;
            existing.traffic += traffic_sum;
            if (snapshot.fetched_at.getTime() > new Date(existing.last_fetched_at).getTime()) {
                existing.last_fetched_at = snapshot.fetched_at.toISOString();
            }
            metrics_by_key.set(target.key, existing);
        }

        const freshness_buckets = {
            pending: 0,
            '0_24h': 0,
            '1_3d': 0,
            '3_7d': 0,
            '7d_plus': 0,
        };
        const host_coverage_map = new Map<string, { host: string; prompt_ids: Set<string>; website_count: number }>();

        const points = Array.from(site_map.values()).map((site) => {
            const metric = metrics_by_key.get(site.url) ?? metrics_by_key.get(site.host);
            const fetched_at = metric?.last_fetched_at ?? null;
            const bucket = freshness_bucket_for(fetched_at);
            freshness_buckets[bucket] += 1;

            const coverage = host_coverage_map.get(site.host) ?? {
                host: site.host,
                prompt_ids: new Set<string>(),
                website_count: 0,
            };
            for (const prompt_id of site.prompt_ids) {
                coverage.prompt_ids.add(prompt_id);
            }
            coverage.website_count += 1;
            host_coverage_map.set(site.host, coverage);

            return {
                url: site.url,
                host: site.host,
                prompt_count: site.prompt_ids.size,
                providers: Array.from(site.providers),
                aggregated_volume: metric?.volume ?? 0,
                aggregated_traffic: metric?.traffic ?? 0,
                fetched_at,
                freshness_bucket: bucket,
                last_seen_at: site.last_seen_at,
            };
        });

        return {
            range,
            version_id: version.id,
            generated_at: new Date().toISOString(),
            points: points.sort((a, b) => b.prompt_count - a.prompt_count),
            freshness_buckets: [
                { bucket: 'pending', count: freshness_buckets.pending },
                { bucket: '0_24h', count: freshness_buckets['0_24h'] },
                { bucket: '1_3d', count: freshness_buckets['1_3d'] },
                { bucket: '3_7d', count: freshness_buckets['3_7d'] },
                { bucket: '7d_plus', count: freshness_buckets['7d_plus'] },
            ],
            host_coverage: Array.from(host_coverage_map.values())
                .map((entry) => ({
                    host: entry.host,
                    prompt_count: entry.prompt_ids.size,
                    website_count: entry.website_count,
                }))
                .sort((a, b) => b.prompt_count - a.prompt_count)
                .slice(0, 25),
        };
    }

    async createCampaign(tenant_id: string, user_id: string, data: CreateCampaignDto) {
        return this.repo.createCampaign(tenant_id, user_id, data);
    }

    async listCampaigns(tenant_id: string, domain_id?: string) {
        return this.repo.listCampaigns(tenant_id, domain_id);
    }

    async getCampaign(tenant_id: string, campaign_id: string) {
        const campaign = await this.repo.getCampaign(tenant_id, campaign_id);
        if (!campaign) throw new Error('Campaign not found');
        return campaign;
    }

    async updateCampaign(tenant_id: string, campaign_id: string, data: UpdateCampaignDto) {
        return this.repo.updateCampaign(tenant_id, campaign_id, data);
    }

    async deleteCampaign(tenant_id: string, campaign_id: string) {
        return this.repo.deleteCampaign(tenant_id, campaign_id);
    }

    async listVersions(tenant_id: string, campaign_id: string) {
        const campaign = await this.repo.getCampaign(tenant_id, campaign_id);
        if (!campaign) throw new Error('Campaign not found');
        const versions = await this.repo.listVersions(tenant_id, campaign_id);
        return {
            campaign: {
                id: campaign.id,
                domain_id: campaign.domain_id,
                name: campaign.name,
                description: campaign.description,
                created_at: campaign.created_at,
                updated_at: campaign.updated_at,
            },
            versions: versions.map((version) => this.toVersionSummary(version)),
        };
    }

    async getActiveTree(tenant_id: string, campaign_id: string, version_id?: string) {
        const campaign = await this.repo.getCampaign(tenant_id, campaign_id);
        const version = await this.resolveVersion(tenant_id, campaign_id, undefined, version_id, false);
        if (!campaign || !version) return { campaign, version: null, roots: [] };

        const flatNodes = await this.repo.getVersionNodes(tenant_id, version.id);
        const nodeMap = new Map<string, any>();
        const roots: any[] = [];

        for (const node of flatNodes) {
            const metadata = to_record(node.metadata) ?? {};
            const display = node_display_label(node.type, node.content, metadata);
            const canonical_metadata: CanonicalNodeMetadata = {
                source: get_string(metadata.source),
                prompt_ref: get_string(metadata.prompt_ref),
                subquery_ref: get_string(metadata.subquery_ref),
                result_ref: get_string(metadata.result_ref),
                query_key: get_string(metadata.query_key),
                url: get_string(metadata.url),
                domain: get_string(metadata.domain),
                citation_title: get_string(metadata.citation_title) ?? get_string(metadata.title),
                lineage: {
                    capture_turn_id: get_string(metadata.capture_turn_id) ?? node.capture_turn_id ?? undefined,
                    origin_provider: get_string(metadata.origin_provider) ?? get_string(metadata.chat_provider),
                    origin_request_id: get_string(metadata.origin_request_id) ?? get_string(metadata.request_id),
                    source_version_id: get_string(metadata.source_version_id) ?? version.id,
                },
                refresh: {
                    refreshable:
                        node.type === NodeType.prompt ||
                        node.type === NodeType.subquery ||
                        (node.type === NodeType.generated && get_string(metadata.source) === 'suggestion'),
                    refresh_count: to_positive_int(metadata.refresh_count),
                    refresh_status: parse_refresh_status(metadata.refresh_status),
                    last_refreshed_at: get_string(metadata.last_refreshed_at),
                    last_refresh_run_id: get_string(metadata.last_refresh_run_id),
                    refresh_provider: get_string(metadata.refresh_provider),
                    refresh_source_version_id: get_string(metadata.refresh_source_version_id),
                },
                ui: {
                    display_label: display.label,
                    is_unmapped: display.is_unmapped,
                    is_system: display.is_system,
                },
            };
            nodeMap.set(node.id, {
                ...node,
                metadata: canonical_metadata,
                children: [],
            });
        }

        for (const node of nodeMap.values()) {
            if (node.parent_id && nodeMap.has(node.parent_id)) {
                nodeMap.get(node.parent_id).children.push(node);
            } else {
                roots.push(node);
            }
        }

        return { campaign, version: this.toVersionSummary(version), roots };
    }

    async getActiveChatThreads(tenant_id: string, campaign_id: string, limit: number, offset: number, version_id?: string) {
        const version = await this.resolveVersion(tenant_id, campaign_id, undefined, version_id, false);
        // New campaign has no threads yet — return empty list, not an error
        if (!version) return { threads: [], total_count: 0, limit, offset, has_more: false };
        const raw_threads = await this.repo.getChatThreads(tenant_id, version.id, limit, offset);
        const threads = raw_threads.map((thread) => this.toChatThreadSummary(thread));
        return {
            version: this.toVersionSummary(version),
            threads,
            total_count: threads.length,
            limit,
            offset,
            has_more: false,
        };
    }

    async linkChatThread(tenant_id: string, user_id: string, campaign_id: string, data: LinkChatThreadDto, version_id?: string) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }
        const linked = await this.repo.linkChatThread({
            tenant_id,
            campaign_version_id: version.id,
            chat_provider: data.chat_provider,
            conversation_id: data.conversation_id,
            provider_chat_id: data.provider_chat_id,
            chat_url: data.chat_url,
            chat_title: data.chat_title,
        });
        return this.toChatThreadSummary({
            ...linked,
            chat_provider: linked.chat_provider as StreamProvider,
            turn_count: 0,
        });
    }

    async markChatThreadOpened(tenant_id: string, campaign_id: string, thread_id: string) {
        // Verify campaign belongs to tenant first
        const campaign = await this.repo.getCampaign(tenant_id, campaign_id);
        if (!campaign) return null;
        const opened = await this.repo.markChatThreadOpened(tenant_id, thread_id);
        if (!opened) return null;
        const turn_count = await prisma.captureTurn.count({ where: { capture_session_id: opened.id, tenant_id } });
        return this.toChatThreadSummary({
            ...opened,
            chat_provider: opened.chat_provider as StreamProvider,
            turn_count,
        });
    }

    async getGeneratedSuggestions(tenant_id: string, campaign_id: string, limit: number, offset: number, version_id?: string) {
        const normalized_limit = Math.min(Math.max(limit, 1), 50);
        const normalized_offset = Math.max(offset, 0);
        const version = await this.resolveVersion(tenant_id, campaign_id, undefined, version_id, false);
        if (!version) {
            return {
                version: null,
                prompts: [],
                total_count: 0,
                limit: normalized_limit,
                offset: normalized_offset,
                has_more: false,
            };
        }

        const all_generated = await prisma.promptNode.findMany({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                type: NodeType.generated,
            },
            orderBy: { created_at: 'desc' },
        });

        const suggestion_nodes = all_generated.filter((node) => {
            const metadata = to_record(node.metadata) ?? {};
            return get_string(metadata.source) === 'suggestion';
        });

        const page = suggestion_nodes.slice(normalized_offset, normalized_offset + normalized_limit);
        return {
            version: this.toVersionSummary(version),
            prompts: page.map((node) => {
                const metadata = to_record(node.metadata) ?? {};
                return {
                    node_id: node.id,
                    prompt: node.content,
                    reason: get_string(metadata.reason),
                    target_subquery: get_string(metadata.target_subquery),
                    created_at: node.created_at.toISOString(),
                };
            }),
            total_count: suggestion_nodes.length,
            limit: normalized_limit,
            offset: normalized_offset,
            has_more: normalized_offset + page.length < suggestion_nodes.length,
        };
    }

    async generateSuggestions(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        max_suggestions: number,
        version_id?: string,
        append = false,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const turns = await prisma.captureTurn.findMany({
            where: {
                tenant_id,
                capture_session: {
                    campaign_version_id: version.id,
                },
            },
            orderBy: { created_at: 'desc' },
            take: 200,
        });
        const seen_prompt_keys = new Set<string>();
        const recent_prompt_texts: string[] = [];
        for (const turn of turns) {
            const prompt = normalize_prompt(turn.prompt);
            if (!prompt || is_imported_prompt_fallback(prompt)) continue;
            const key = normalize_text_key(prompt);
            if (seen_prompt_keys.has(key)) continue;
            seen_prompt_keys.add(key);
            recent_prompt_texts.push(prompt);
            if (recent_prompt_texts.length >= 20) break;
        }
        if (!recent_prompt_texts.length) {
            throw new Error('No executed prompts found yet to generate suggestions');
        }

        const parent_prompt_node = await prisma.promptNode.findFirst({
            where: {
                tenant_id,
                campaign_version_id: version.id,
                type: NodeType.prompt,
            },
            orderBy: { created_at: 'desc' },
            select: { id: true, depth: true, capture_turn_id: true },
        });

        const version_config = to_record(version.config_json) ?? {};
        const active_batch_id = get_string(version_config.workflow_active_suggestion_batch_id);
        const suggestion_batch_id = append
            ? (active_batch_id ?? randomUUID())
            : randomUUID();
        const generation_run_id = randomUUID();
        const generation_run = await prisma.generationRun.create({
            data: {
                tenant_id,
                campaign_version_id: version.id,
                capture_turn_id: parent_prompt_node?.capture_turn_id ?? undefined,
                status: 'processing',
                started_at: new Date(),
            },
        });

        try {
            const llm_suggestions = await build_suggestions_from_openai(recent_prompt_texts, max_suggestions);

            const existing_rows = append
                ? await prisma.promptNode.findMany({
                    where: {
                        tenant_id,
                        campaign_version_id: version.id,
                        type: NodeType.generated,
                    },
                    select: { content: true, metadata: true },
                })
                : [];
            const existing_keys = new Set<string>();
            for (const row of existing_rows) {
                const metadata = to_record(row.metadata) ?? {};
                if (get_string(metadata.source) !== 'suggestion') continue;
                const row_batch_id = get_string(metadata.suggestion_batch_id) ?? get_string(metadata.generation_run_id);
                if (row_batch_id !== suggestion_batch_id) continue;
                existing_keys.add(normalize_text_key(row.content));
            }

            const unique_suggestions = llm_suggestions.filter((item) => !existing_keys.has(normalize_text_key(item.prompt)));
            if (!unique_suggestions.length) {
                throw new Error('No new unique prompt suggestions were generated');
            }

            const parent_id = parent_prompt_node?.id ?? null;
            const base_depth = parent_prompt_node ? parent_prompt_node.depth + 1 : 0;
            await Promise.all(
                unique_suggestions.map((item: any) =>
                    this.repo.createNode({
                        tenant_id,
                        campaign_version_id: version.id,
                        parent_id,
                        type: NodeType.generated,
                        content: item.prompt,
                        depth: base_depth,
                        metadata: {
                            source: 'suggestion',
                            reason: item.reason,
                            generation_run_id,
                            suggestion_batch_id,
                            created_by_user_id: user_id,
                            origin_provider: 'system',
                            source_version_id: version.id,
                            refreshable: true,
                            refresh_count: 0,
                            refresh_status: 'idle',
                        },
                    }),
                ),
            );

            await prisma.campaignVersion.update({
                where: { id: version.id },
                data: {
                    config_json: {
                        ...version_config,
                        workflow_active_suggestion_batch_id: suggestion_batch_id,
                        workflow_last_suggestion_generation_at: new Date().toISOString(),
                    } as Prisma.InputJsonValue,
                },
            });

            await prisma.generationRun.update({
                where: { id: generation_run.id },
                data: {
                    status: 'completed',
                    finished_at: new Date(),
                    error_message: null,
                },
            });

            return {
                generation_run_id,
                version: this.toVersionSummary(version),
                site_insights: [],
                suggested_prompts: unique_suggestions,
            };
        } catch (error) {
            await prisma.generationRun.update({
                where: { id: generation_run.id },
                data: {
                    status: 'failed',
                    finished_at: new Date(),
                    error_message: error instanceof Error ? error.message : 'Failed to generate suggestions',
                },
            });
            throw error;
        }
    }

    async ingestTurn(tenant_id: string, user_id: string, campaign_id: string, data: IngestTurnDto, version_id?: string) {
        const normalized_prompt = normalize_prompt(data.prompt);
        const normalized_queries = Array.from(
            new Set(
                (data.queries ?? [])
                    .map((query: any) => normalize_query(query))
                    .filter((query) => Boolean(query)),
            ),
        ).slice(0, MAX_QUERY_COUNT);
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const session = await this.repo.findOrCreateSession(
            tenant_id,
            version.id,
            data.chat_provider,
            data.conversation_id
        );

        // Idempotency guard for duplicate provider events.
        if (data.request_id && data.turn_exchange_id) {
            const existing_turn = await prisma.captureTurn.findFirst({
                where: {
                    tenant_id,
                    capture_session_id: session.id,
                    request_id: data.request_id,
                    turn_exchange_id: data.turn_exchange_id,
                },
                select: { id: true },
            });
            if (existing_turn) {
                return this.getActiveTree(tenant_id, campaign_id, version.id);
            }
        }

        const ingest_metadata = to_record(data.metadata) ?? {};
        const refresh_target_node_id = get_string(ingest_metadata.refresh_target_node_id);
        let refresh_target_node:
            | { id: string; parent_id: string | null; depth: number; type: NodeType }
            | null = null;
        let refresh_delete_ids: string[] = [];
        let refresh_mode: 'none' | 'prompt' | 'subquery' = 'none';

        if (refresh_target_node_id) {
            const target = await prisma.promptNode.findFirst({
                where: {
                    id: refresh_target_node_id,
                    tenant_id,
                    campaign_version_id: version.id,
                },
                select: { id: true, parent_id: true, depth: true, type: true },
            });
            if (target) {
                refresh_target_node = target;
                refresh_mode = target.type === NodeType.subquery ? 'subquery' : 'prompt';

                const flat_nodes = await this.repo.getVersionNodes(tenant_id, version.id);
                const children_by_parent = new Map<string, string[]>();
                for (const row of flat_nodes) {
                    if (!row.parent_id) continue;
                    const bucket = children_by_parent.get(row.parent_id) ?? [];
                    bucket.push(row.id);
                    children_by_parent.set(row.parent_id, bucket);
                }
                const stack = [target.id];
                const seen = new Set<string>();
                while (stack.length) {
                    const current = stack.pop()!;
                    if (seen.has(current)) continue;
                    seen.add(current);
                    refresh_delete_ids.push(current);
                    const children = children_by_parent.get(current) ?? [];
                    for (const child of children) stack.push(child);
                }
            }
        }

        // Try to find the parent node if active_prompt_node_id is provided
        let parent_id = data.active_prompt_node_id || null;
        let depth = 0;

        if (refresh_target_node) {
            parent_id = refresh_target_node.parent_id;
            depth = refresh_target_node.depth;
        }

        if (parent_id) {
            const parent = await prisma.promptNode.findFirst({ where: { id: parent_id, tenant_id } });
            if (parent) {
                depth = parent.depth + 1;
            } else {
                parent_id = null; // invalid parent provided
            }
        }

        const capture_turn_id = randomUUID();
        const now = new Date();
        const normalized_events = normalize_turn_events({
            capture_turn_id,
            data,
            normalized_prompt,
            normalized_queries,
            occurred_at: now,
        });
        const normalized_fact_count = normalized_events.length;
        console.log('[AI-SEO][INGEST]', 'normalized facts before write', {
            capture_turn_id,
            provider: data.chat_provider,
            normalized_fact_count,
            prompt_preview: truncate_for_log(normalized_prompt),
        });

        let capture_turn;
        try {
            capture_turn = await prisma.captureTurn.create({
                data: {
                    id: capture_turn_id,
                    tenant_id,
                    capture_session_id: session.id,
                    request_id: data.request_id,
                    turn_exchange_id: data.turn_exchange_id,
                    prompt: normalized_prompt,
                    finished_reason: data.finished_reason,
                    metadata: data.metadata ?? Prisma.JsonNull,
                    raw_event_json: {
                        schema_version: 'v1-deterministic-stream-facts',
                        capture_turn_id,
                        provider: data.chat_provider,
                        provider_conversation_id: data.conversation_id,
                        provider_request_id: data.request_id,
                        provider_turn_exchange_id: data.turn_exchange_id,
                        normalized_events: normalized_events as unknown as Prisma.InputJsonValue,
                        normalized_fact_count,
                        query_input_count: normalized_queries.length,
                        result_group_input_count: data.result_groups?.length ?? 0,
                    } as Prisma.InputJsonValue,
                    prompt_detected_at: now,
                    response_finished_at: now,
                },
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002' &&
                data.request_id &&
                data.turn_exchange_id
            ) {
                // Duplicate ingest for same provider turn; treat as idempotent success.
                return this.getActiveTree(tenant_id, campaign_id, version.id);
            }
            throw error;
        }

        const persisted_payload = safe_json_record(capture_turn.raw_event_json);
        const persisted_events_raw = persisted_payload.normalized_events;
        const persisted_events = Array.isArray(persisted_events_raw) ? (persisted_events_raw as NormalizedTurnEvent[]) : [];
        console.log('[AI-SEO][INGEST]', 'persisted facts after write', {
            capture_turn_id,
            persisted_fact_count: persisted_events.length,
        });

        const materialized = materialize_turn_from_events(persisted_events);
        let persisted_subquery_count = 0;
        let persisted_result_count = 0;
        let persisted_unscoped_count = 0;
        let persisted_prompt_count = 0;
        if (refresh_mode === 'subquery') {
            const refresh_subqueries = materialized.subqueries.slice(0, MAX_QUERY_COUNT);
            const fallback_subqueries =
                refresh_subqueries.length > 0
                    ? refresh_subqueries
                    : [
                        {
                            query_key: normalize_query_key(normalized_prompt || '__unscoped__'),
                            label: normalized_prompt || '__unscoped__',
                            subquery_ref: deterministic_hash(capture_turn_id, 'subquery-fallback'),
                            first_seen_seq: 0,
                            sites: [],
                        },
                    ];

            for (const subquery of fallback_subqueries) {
                const subquery_node = await this.repo.createNode({
                    tenant_id,
                    campaign_version_id: version.id,
                    capture_session_id: session.id,
                    capture_turn_id: capture_turn.id,
                    parent_id,
                    type: NodeType.subquery,
                    content: subquery.query_key === '__unscoped__' ? '__unscoped__' : subquery.label,
                    depth,
                    metadata: {
                        source: 'capture_query',
                        query_key: subquery.query_key,
                        subquery_ref: subquery.subquery_ref,
                        first_seen_seq: subquery.first_seen_seq,
                        origin_provider: data.chat_provider,
                        origin_request_id: data.request_id,
                        capture_turn_id,
                        source_version_id: version.id,
                        refreshable: true,
                        refresh_count: 0,
                        refresh_status: 'idle',
                    },
                });
                persisted_subquery_count += 1;

                const max_sites = subquery.query_key === '__unscoped__' ? MAX_UNSCOPED_SITES : MAX_SITES_PER_QUERY;
                const sites = subquery.sites.slice(0, max_sites);
                if (subquery.query_key === '__unscoped__') {
                    persisted_unscoped_count += sites.length;
                }
                for (const site of sites) {
                    await this.repo.createNode({
                        tenant_id,
                        campaign_version_id: version.id,
                        capture_session_id: session.id,
                        capture_turn_id: capture_turn.id,
                        parent_id: subquery_node.id,
                        type: NodeType.site,
                        content: site.site_name,
                        depth: depth + 1,
                        metadata: {
                            source: 'citation',
                            url: site.url,
                            domain: infer_site_name_from_url(site.url),
                            citation_title: site.title,
                            result_ref: site.result_ref,
                            first_seen_seq: site.first_seen_seq,
                            subquery_ref: subquery.subquery_ref,
                            query_key: subquery.query_key,
                            origin_provider: data.chat_provider,
                            origin_request_id: data.request_id,
                            capture_turn_id,
                            source_version_id: version.id,
                            refreshable: false,
                            refresh_count: 0,
                            refresh_status: 'idle',
                        },
                    });
                    persisted_result_count += 1;
                }
            }
        } else {
            const prompt_node = await this.repo.createNode({
                tenant_id,
                campaign_version_id: version.id,
                capture_session_id: session.id,
                capture_turn_id: capture_turn.id,
                parent_id,
                type: NodeType.prompt,
                content: materialized.prompt.text || normalized_prompt,
                depth,
                metadata: {
                    source: 'extension',
                    imported_at: now.toISOString(),
                    request_id: data.request_id,
                    turn_exchange_id: data.turn_exchange_id,
                    chat_provider: data.chat_provider,
                    origin_provider: data.chat_provider,
                    origin_request_id: data.request_id,
                    prompt_ref: materialized.prompt.prompt_ref,
                    capture_turn_id,
                    provider_turn_id: provider_turn_id_for(data),
                    source_version_id: version.id,
                    refreshable: true,
                    refresh_count: 0,
                    refresh_status: 'idle',
                },
            });
            persisted_prompt_count = 1;

            for (const subquery of materialized.subqueries.slice(0, MAX_QUERY_COUNT)) {
                const subquery_node = await this.repo.createNode({
                    tenant_id,
                    campaign_version_id: version.id,
                    capture_session_id: session.id,
                    capture_turn_id: capture_turn.id,
                    parent_id: prompt_node.id,
                    type: NodeType.subquery,
                    content: subquery.query_key === '__unscoped__' ? '__unscoped__' : subquery.label,
                    depth: depth + 1,
                    metadata: {
                        source: 'capture_query',
                        query_key: subquery.query_key,
                        subquery_ref: subquery.subquery_ref,
                        first_seen_seq: subquery.first_seen_seq,
                        origin_provider: data.chat_provider,
                        origin_request_id: data.request_id,
                        capture_turn_id,
                        source_version_id: version.id,
                        refreshable: true,
                        refresh_count: 0,
                        refresh_status: 'idle',
                    },
                });
                persisted_subquery_count += 1;

                const max_sites = subquery.query_key === '__unscoped__' ? MAX_UNSCOPED_SITES : MAX_SITES_PER_QUERY;
                const sites = subquery.sites.slice(0, max_sites);
                if (subquery.query_key === '__unscoped__') {
                    persisted_unscoped_count += sites.length;
                }
                for (const site of sites) {
                    await this.repo.createNode({
                        tenant_id,
                        campaign_version_id: version.id,
                        capture_session_id: session.id,
                        capture_turn_id: capture_turn.id,
                        parent_id: subquery_node.id,
                        type: NodeType.site,
                        content: site.site_name,
                        depth: depth + 2,
                        metadata: {
                            source: 'citation',
                            url: site.url,
                            domain: infer_site_name_from_url(site.url),
                            citation_title: site.title,
                            result_ref: site.result_ref,
                            first_seen_seq: site.first_seen_seq,
                            subquery_ref: subquery.subquery_ref,
                            query_key: subquery.query_key,
                            origin_provider: data.chat_provider,
                            origin_request_id: data.request_id,
                            capture_turn_id,
                            source_version_id: version.id,
                            refreshable: false,
                            refresh_count: 0,
                            refresh_status: 'idle',
                        },
                    });
                    persisted_result_count += 1;
                }
            }
        }

        if (refresh_delete_ids.length) {
            await prisma.promptNode.deleteMany({
                where: {
                    tenant_id,
                    campaign_version_id: version.id,
                    id: { in: refresh_delete_ids },
                },
            });
        }

        const persisted_node_count = persisted_prompt_count + persisted_subquery_count + persisted_result_count;
        console.log('[AI-SEO][INGEST]', 'materialized node count before response', {
            capture_turn_id,
            persisted_node_count,
            persisted_subquery_count,
            persisted_result_count,
            persisted_unscoped_count,
        });
        const expected = materialized.expected_counts;
        if (
            expected.subquery_count !== persisted_subquery_count ||
            expected.result_count !== persisted_result_count ||
            expected.unscoped_count !== persisted_unscoped_count
        ) {
            console.warn('[AI-SEO][INGEST][MISMATCH]', {
                capture_turn_id,
                expected_subquery_count: expected.subquery_count,
                expected_result_count: expected.result_count,
                expected_unscoped_count: expected.unscoped_count,
                persisted_subquery_count,
                persisted_result_count,
                persisted_unscoped_count,
            });
        }

        await prisma.captureSession.update({
            where: { id: session.id },
            data: {
                last_event_at: now,
                provider_chat_id: data.provider_chat_id || session.provider_chat_id,
                chat_title: data.chat_title || session.chat_title,
                chat_url: data.chat_url || session.chat_url,
            }
        });

        // Fire and forget lead signal extraction
        leadIntelligenceService.extractSignalsFromTurn(
            tenant_id,
            user_id,
            capture_turn.id,
            normalized_prompt
        ).catch((err: any) => console.error('[LeadIntelligence] Extraction failed:', err));

        return this.getActiveTree(tenant_id, campaign_id, version.id);
    }

    async refreshNode(
        tenant_id: string,
        user_id: string,
        campaign_id: string,
        node_id: string,
        payload: RefreshNodeDto,
        version_id?: string,
    ) {
        const version = await this.resolveVersion(tenant_id, campaign_id, user_id, version_id, true);
        if (!version) {
            throw new Error('Campaign has no active version');
        }

        const node = await prisma.promptNode.findFirst({
            where: {
                id: node_id,
                tenant_id,
                campaign_version_id: version.id,
            },
        });
        if (!node) {
            throw new Error('Node not found in selected version');
        }

        const existing = to_record(node.metadata) ?? {};
        const refreshable =
            node.type === NodeType.prompt ||
            node.type === NodeType.subquery ||
            (node.type === NodeType.generated && get_string(existing.source) === 'suggestion');
        if (!refreshable) {
            throw new Error('Node is not refreshable');
        }

        const run_id = randomUUID();
        const now = new Date().toISOString();
        const next_refresh_count = to_positive_int(existing.refresh_count) + 1;
        const refresh_provider =
            payload.provider && payload.provider !== 'unknown'
                ? payload.provider
                : get_string(existing.origin_provider) ?? get_string(existing.chat_provider) ?? 'unknown';

        let target_node = node;
        if (payload.scope === 'branch' && node.type !== NodeType.prompt) {
            const flat_nodes = await this.repo.getVersionNodes(tenant_id, version.id);
            const by_id = new Map(flat_nodes.map((row: any) => [row.id, row]));
            let cursor = node.parent_id ? by_id.get(node.parent_id) : null;
            while (cursor) {
                if (cursor.type === NodeType.prompt) {
                    target_node = cursor;
                    break;
                }
                cursor = cursor.parent_id ? by_id.get(cursor.parent_id) ?? null : null;
            }
        }

        const replay_prompt = normalize_prompt(target_node.content);
        const replay_target_type =
            target_node.type === NodeType.subquery
                ? 'subquery'
                : target_node.type === NodeType.generated
                    ? 'generated'
                    : 'prompt';

        const forked = await this.repo.forkVersionForRefresh({
            tenant_id,
            campaign_id,
            user_id,
            source_version_id: version.id,
            source_target_node_id: target_node.id,
            refresh_provider,
            refresh_scope: payload.scope ?? 'node',
        });

        const cloned_target = await prisma.promptNode.findFirst({
            where: {
                id: forked.mapped_target_node_id,
                tenant_id,
                campaign_version_id: forked.version.id,
            },
        });
        if (!cloned_target) {
            throw new Error('Mapped refresh target node not found in new version');
        }

        const cloned_metadata = to_record(cloned_target.metadata) ?? {};
        const updated_metadata: Record<string, unknown> = {
            ...cloned_metadata,
            refreshable: true,
            refresh_count: next_refresh_count,
            refresh_status: 'queued',
            last_refresh_run_id: run_id,
            refresh_provider,
            refresh_source_version_id: version.id,
            refresh_scope: payload.scope ?? 'node',
            refresh_created_version_id: forked.version.id,
            refresh_target_source_node_id: target_node.id,
        };

        await prisma.promptNode.update({
            where: { id: cloned_target.id },
            data: {
                metadata: updated_metadata as Prisma.InputJsonValue,
                updated_at: new Date(),
            },
        });

        return {
            refresh_run_id: run_id,
            node_id: cloned_target.id,
            version_id: forked.version.id,
            status: 'queued' as const,
            provider: refresh_provider,
            scope: payload.scope ?? 'node',
            prompt: replay_prompt,
            target_node_id: cloned_target.id,
            target_node_type: replay_target_type as 'prompt' | 'subquery' | 'generated',
            started_at: now,
            message: 'Refresh queued in a new version. Re-run this prompt in the selected provider and ingest to replace this branch.',
        };
    }

    async refire(tenant_id: string, campaign_id: string, user_id: string, source_version_number: number) {
        return this.repo.refireVersion(tenant_id, campaign_id, user_id, source_version_number);
    }
}

export const campaignService = new CampaignService(campaignRepository);
// --- Merged from modules/campaign/conversation-normalizer.ts ---
type WorkflowProvider = 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'unknown';

export interface PromptCandidateItem {
    id: string;
    text: string;
    source: 'auto' | 'manual';
    selected: boolean;
    status: 'new' | 'fired' | 'running' | 'failed';
    lastExecutionAt?: string;
}

export interface KeywordQueryItem {
    query: string;
    sourceProvider: WorkflowProvider;
    sourcePromptId?: string;
    firstSeenAt: string;
}

export interface CrawledWebsiteItem {
    url: string;
    host: string;
    source: string;
    firstSeenAt: string;
}

export interface PlaceFoundItem {
    name: string;
    address?: string;
    rating?: number;
    reviewCount?: number;
    websiteUrl?: string;
    category?: string;
}

export interface PromptVersionMetaItem {
    versionDate?: string;
    lastExecutionDate?: string;
    provider: WorkflowProvider;
    conversationId: string;
}

export interface NormalizedConversationData {
    prompt: string;
    searchedKeywords: KeywordQueryItem[];
    crawledWebsites: CrawledWebsiteItem[];
    placesFound: PlaceFoundItem[];
    promptCandidates: PromptCandidateItem[];
    resultGroups: unknown[];
    versionMeta: PromptVersionMetaItem;
    warnings: string[];
}

interface NormalizeParams {
    provider: WorkflowProvider;
    conversationId: string;
    payload: unknown;
    promptCandidates?: PromptCandidateItem[];
    versionDate?: string;
    lastExecutionDate?: string;
}

interface MessageNode {
    id: string;
    order: number;
    role: string;
    authorName?: string;
    createTime?: number;
    message: Record<string, unknown>;
}

// Cleaned up duplicate block: // --- Duplicate to_record skipped ---
// Cleaned up duplicate block: // --- Duplicate to_array skipped ---
// Cleaned up duplicate block: // --- Duplicate get_string skipped ---
// Cleaned up duplicate block: // --- Duplicate to_number skipped ---
const collapse_spaces = (value: string): string => value.replace(/\s+/g, ' ').trim();
// Cleaned up duplicate block: // --- Duplicate normalize_text_key skipped ---
// Cleaned up duplicate block: // --- Duplicate canonicalize_url skipped ---
const host_from_url = (raw?: string): string | undefined => {
    if (!raw) return undefined;
    try {
        return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return undefined;
    }
};

const pick_latest_node = (nodes: MessageNode[]): MessageNode | undefined => {
    if (!nodes.length) return undefined;
    return [...nodes].sort((a, b) => {
        const a_time = a.createTime ?? -1;
        const b_time = b.createTime ?? -1;
        if (a_time !== b_time) return b_time - a_time;
        return b.order - a.order;
    })[0];
};

const extract_current_node_chain_rank = (payload: unknown): Map<string, number> => {
    const root = to_record(payload) ?? {};
    const mapping = to_record(root.mapping);
    const current_node = get_string(root.current_node);
    if (!mapping || !current_node) {
        return new Map();
    }

    const rank = new Map<string, number>();
    const seen = new Set<string>();
    let cursor: string | undefined = current_node;
    let index = 0;
    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        rank.set(cursor, index);
        index += 1;
        const entry = to_record(mapping[cursor]);
        cursor = get_string(entry?.parent);
    }
    return rank;
};

const extract_messages = (payload: unknown): MessageNode[] => {
    const root = to_record(payload) ?? {};
    const mapping = to_record(root.mapping);
    if (!mapping) return [];

    const nodes: MessageNode[] = [];
    Object.entries(mapping).forEach(([id, entry], index) => {
        const node = to_record(entry);
        if (!node) return;
        const message = to_record(node.message);
        if (!message) return;
        const author = to_record(message.author) ?? {};
        const role = get_string(author.role) ?? 'unknown';
        const author_name = get_string(author.name);
        const create_time = to_number(message.create_time) ?? to_number(node.create_time);
        nodes.push({
            id,
            order: index,
            role,
            authorName: author_name,
            createTime: create_time,
            message,
        });
    });
    return nodes;
};

const extract_message_text = (message: Record<string, unknown>): string | undefined => {
    const content = to_record(message.content);
    if (!content) return undefined;
    const parts = to_array(content.parts);
    for (const part of parts) {
        const text = get_string(part);
        if (text) return collapse_spaces(text);
    }
    return undefined;
};

const dedupe_queries = (queries: string[]): string[] => {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const query of queries) {
        const normalized = collapse_spaces(query);
        if (!normalized) continue;
        const key = normalize_text_key(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(normalized);
    }
    return output;
};

const get_latest_assistant_metadata = (messages: MessageNode[], payload: unknown): Record<string, unknown> | null => {
    const assistants = messages.filter((node) => node.role === 'assistant');
    if (!assistants.length) return null;

    const with_create_time = assistants.filter((node) => node.createTime !== undefined);
    const assistant = with_create_time.length
        ? pick_latest_node(with_create_time)
        : (() => {
            const chain_rank = extract_current_node_chain_rank(payload);
            const in_chain = assistants
                .map((node) => ({
                    node,
                    rank: chain_rank.get(node.id),
                }))
                .filter((item): item is { node: MessageNode; rank: number } => item.rank !== undefined)
                .sort((a, b) => a.rank - b.rank);
            if (in_chain.length) {
                return in_chain[0].node;
            }
            return pick_latest_node(assistants);
        })();

    if (!assistant) return null;
    const metadata = to_record(assistant.message.metadata);
    return metadata ?? null;
};

const extract_urls_from_search_groups = (search_groups: unknown): string[] => {
    const urls: string[] = [];
    const groups = to_array(search_groups);
    for (const group of groups) {
        const group_record = to_record(group);
        if (!group_record) continue;
        const entries = to_array(group_record.entries);
        for (const entry of entries) {
            const entry_record = to_record(entry);
            if (!entry_record) continue;
            const url = canonicalize_url(get_string(entry_record.url));
            if (url) urls.push(url);
        }
    }
    return urls;
};

const extract_assistant_websites = (metadata: Record<string, unknown> | null): Array<{ url: string; source: string }> => {
    if (!metadata) return [];
    const websites: Array<{ url: string; source: string }> = [];

    const push = (url: string | undefined, source: string) => {
        const normalized = canonicalize_url(url);
        if (!normalized) return;
        websites.push({ url: normalized, source });
    };

    const content_references = to_array(metadata.content_references);
    for (const reference of content_references) {
        const reference_record = to_record(reference);
        if (!reference_record) continue;
        const type = get_string(reference_record.type);
        if (type === 'grouped_webpages') {
            const items = to_array(reference_record.items);
            for (const item of items) {
                const item_record = to_record(item);
                if (!item_record) continue;
                push(get_string(item_record.url), 'grouped_webpages');
                const supporting = to_array(item_record.supporting_websites);
                for (const support of supporting) {
                    const support_record = to_record(support);
                    if (!support_record) continue;
                    push(get_string(support_record.url), 'supporting_website');
                }
            }
        }
        if (type === 'sources_footnote') {
            const sources = to_array(reference_record.sources);
            for (const source of sources) {
                const source_record = to_record(source);
                if (!source_record) continue;
                push(get_string(source_record.url), 'sources_footnote');
            }
        }
    }

    extract_urls_from_search_groups(metadata.search_result_groups).forEach((url) =>
        websites.push({ url, source: 'assistant_search_result_groups' }),
    );

    to_array(metadata.safe_urls).forEach((value) =>
        push(get_string(value), 'assistant_safe_urls'),
    );

    return websites;
};

const extract_top_level_safe_urls = (payload: unknown): string[] => {
    const root = to_record(payload) ?? {};
    return to_array(root.safe_urls)
        .map((value) => canonicalize_url(get_string(value)))
        .filter((value): value is string => Boolean(value));
};

const extract_tool_data = (messages: MessageNode[]): {
    queries: string[];
    urls: string[];
} => {
    const queries: string[] = [];
    const urls: string[] = [];

    for (const node of messages) {
        if (node.role !== 'tool' || node.authorName !== 'web.run') continue;
        const metadata = to_record(node.message.metadata) ?? {};
        const search_model_queries = to_record(metadata.search_model_queries);
        if (search_model_queries) {
            for (const query of to_array(search_model_queries.queries)) {
                const query_record = to_record(query);
                const text = get_string(query) ?? get_string(query_record?.q) ?? get_string(query_record?.query);
                if (text) queries.push(text);
            }
        }
        extract_urls_from_search_groups(metadata.search_result_groups).forEach((url) => urls.push(url));
    }

    return { queries: dedupe_queries(queries), urls };
};

const extract_places = (metadata: Record<string, unknown> | null): PlaceFoundItem[] => {
    if (!metadata) return [];
    const places: PlaceFoundItem[] = [];
    const seen = new Set<string>();
    const content_references = to_array(metadata.content_references);

    for (const reference of content_references) {
        const item = to_record(reference);
        if (!item || get_string(item.type) !== 'entity') continue;
        const entity_data = to_record(item.entity_data) ?? {};
        const name = get_string(item.name) ?? get_string(entity_data.name);
        if (!name) continue;
        const address =
            get_string(entity_data.address) ??
            get_string(to_record(item.extra_params)?.address);
        const website_url = canonicalize_url(get_string(entity_data.website_url));
        const rating = to_number(entity_data.rating);
        const review_count = to_number(entity_data.review_count);
        const category = get_string(to_array(entity_data.categories)[0]);
        const key = `${normalize_text_key(name)}|${normalize_text_key(address ?? '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        places.push({
            name,
            ...(address ? { address } : {}),
            ...(rating !== undefined ? { rating } : {}),
            ...(review_count !== undefined ? { reviewCount: Math.floor(review_count) } : {}),
            ...(website_url ? { websiteUrl: website_url } : {}),
            ...(category ? { category } : {}),
        });
    }

    return places;
};

const to_keyword_items = (queries: string[], provider: WorkflowProvider, now_iso: string): KeywordQueryItem[] =>
    queries.map((query: any) => ({
        query,
        sourceProvider: provider,
        firstSeenAt: now_iso,
    }));

const to_website_items = (websites: Array<{ url: string; source: string }>, now_iso: string): CrawledWebsiteItem[] => {
    const seen = new Set<string>();
    const output: CrawledWebsiteItem[] = [];
    for (const entry of websites) {
        const normalized = canonicalize_url(entry.url);
        if (!normalized || seen.has(normalized)) continue;
        const host = host_from_url(normalized);
        if (!host) continue;
        seen.add(normalized);
        output.push({
            url: normalized,
            host,
            source: entry.source,
            firstSeenAt: now_iso,
        });
    }
    return output;
};

const build_result_groups = (
    websites: CrawledWebsiteItem[],
    keywords: KeywordQueryItem[],
): unknown[] => {
    const site_rows = websites.slice(0, 8).map((site) => ({
        site_name: site.host,
        url: site.url,
        title: site.host,
    }));

    if (!site_rows.length) {
        return [];
    }

    if (!keywords.length) {
        return [{
            query: '__unscoped__',
            results: site_rows.slice(0, 4),
        }];
    }

    return keywords.slice(0, 20).map((item: any) => ({
        query: item.query,
        results: site_rows,
    }));
};

const extract_text_like = (value: unknown): string | undefined => {
    const direct = get_string(value);
    if (direct) return collapse_spaces(direct);
    if (Array.isArray(value)) {
        for (const entry of value) {
            const nested = extract_text_like(entry);
            if (nested) return nested;
        }
        return undefined;
    }
    const obj = to_record(value);
    if (!obj) return undefined;
    return (
        extract_text_like(obj.text) ??
        extract_text_like(obj.value) ??
        extract_text_like(obj.message) ??
        extract_text_like(obj.content)
    );
};

const extract_urls_from_unknown = (value: unknown): string[] => {
    const urls: string[] = [];
    const seen = new Set<unknown>();
    const walk = (current: unknown, depth = 0) => {
        if (depth > 10 || current === null || current === undefined) return;
        if (typeof current !== 'object') return;
        if (seen.has(current)) return;
        seen.add(current);

        if (Array.isArray(current)) {
            current.forEach((entry) => walk(entry, depth + 1));
            return;
        }

        const row = to_record(current);
        if (!row) return;

        const maybe_url =
            canonicalize_url(get_string(row.url)) ??
            canonicalize_url(get_string(row.source_url)) ??
            canonicalize_url(get_string(row.link)) ??
            canonicalize_url(get_string(row.display_url));
        if (maybe_url) {
            urls.push(maybe_url);
        }

        Object.values(row).forEach((nested) => {
            if (nested !== undefined && nested !== null && (typeof nested === 'object' || Array.isArray(nested))) {
                walk(nested, depth + 1);
            }
        });
    };
    walk(value);
    return urls;
};

const parse_chatgpt_payload = (params: NormalizeParams): Omit<NormalizedConversationData, 'promptCandidates' | 'versionMeta'> => {
    const now_iso = new Date().toISOString();
    const warnings: string[] = [];
    const messages = extract_messages(params.payload);
    const assistant_metadata = get_latest_assistant_metadata(messages, params.payload);
    const tool = extract_tool_data(messages);

    const user_prompt_node = pick_latest_node(messages.filter((node) => node.role === 'user'));
    const prompt = extract_message_text(user_prompt_node?.message ?? {}) ?? '';

    const searched_queries = dedupe_queries(tool.queries);
    if (!searched_queries.length) {
        warnings.push('No search_model_queries were found in tool metadata.');
    }

    const assistant_websites = extract_assistant_websites(assistant_metadata);
    const top_level_safe_urls = extract_top_level_safe_urls(params.payload);
    const website_rows =
        assistant_websites.length > 0
            ? assistant_websites
            : [
                ...tool.urls.map((url) => ({ url, source: 'tool_search_result_groups' })),
                ...top_level_safe_urls.map((url) => ({ url, source: 'payload_safe_urls' })),
            ];

    if (!website_rows.length) {
        warnings.push('No crawled websites were found in assistant/tool metadata.');
    }

    const places = extract_places(assistant_metadata);
    const keywords = to_keyword_items(searched_queries, params.provider, now_iso);
    const websites = to_website_items(website_rows, now_iso);
    const result_groups = build_result_groups(websites, keywords);

    return {
        prompt,
        searchedKeywords: keywords,
        crawledWebsites: websites,
        placesFound: places,
        resultGroups: result_groups,
        warnings,
    };
};

const parse_claude_payload = (params: NormalizeParams): Omit<NormalizedConversationData, 'promptCandidates' | 'versionMeta'> => {
    const now_iso = new Date().toISOString();
    const warnings: string[] = [];
    const root = to_record(params.payload) ?? {};
    const chat_messages = to_array(root.chat_messages);

    let prompt = '';
    const searched_queries: string[] = [];
    const website_rows: Array<{ url: string; source: string }> = [];

    for (let index = chat_messages.length - 1; index >= 0; index -= 1) {
        const message = to_record(chat_messages[index]);
        if (!message) continue;
        const sender = (get_string(message.sender) ?? '').toLowerCase();
        if (sender !== 'human' && sender !== 'user') continue;
        const content = to_array(message.content);
        const from_content = content
            .map((item: any) => extract_text_like(item))
            .find((item): item is string => Boolean(item));
        prompt = from_content ?? extract_text_like(message.text) ?? '';
        if (prompt) break;
    }

    chat_messages.forEach((message) => {
        const row = to_record(message);
        if (!row) return;
        const sender = (get_string(row.sender) ?? '').toLowerCase();
        if (sender !== 'assistant') return;

        const content = to_array(row.content);
        content.forEach((block) => {
            const block_record = to_record(block);
            if (!block_record) return;
            const block_type = get_string(block_record.type);

            if (block_type === 'tool_use') {
                const tool_name = get_string(block_record.name);
                if (tool_name === 'web_search') {
                    const input = to_record(block_record.input) ?? {};
                    const query_values = [
                        get_string(input.query),
                        get_string(input.q),
                        ...to_array(input.queries).map((item: any) => get_string(item)),
                    ].filter((item): item is string => Boolean(item));
                    query_values.forEach((query) => searched_queries.push(query));
                }
            }

            if (block_type === 'tool_result') {
                extract_urls_from_unknown(block_record.content).forEach((url) =>
                    website_rows.push({ url, source: 'claude_tool_result' }),
                );
            }

            if (block_type === 'text') {
                to_array(block_record.citations).forEach((citation) => {
                    const citation_record = to_record(citation);
                    const citation_url = canonicalize_url(get_string(citation_record?.url));
                    if (citation_url) {
                        website_rows.push({ url: citation_url, source: 'claude_citation' });
                    }
                });
            }
        });
    });

    if (!prompt) {
        prompt = extract_text_like(root.summary) ?? extract_text_like(root.name) ?? '';
    }

    const deduped_queries = dedupe_queries(searched_queries);
    if (!deduped_queries.length) {
        warnings.push('No Claude web_search queries were found in chat_messages.');
    }
    if (!website_rows.length) {
        warnings.push('No Claude crawled websites were found in chat_messages.');
    }

    const keywords = to_keyword_items(deduped_queries, params.provider, now_iso);
    const websites = to_website_items(website_rows, now_iso);

    return {
        prompt,
        searchedKeywords: keywords,
        crawledWebsites: websites,
        placesFound: [],
        resultGroups: build_result_groups(websites, keywords),
        warnings,
    };
};

const extract_perplexity_prompt = (payload: unknown): string => {
    const root = to_record(payload) ?? {};
    const top_prompt = get_string(root.query_str);
    if (top_prompt) return top_prompt;

    const entries = to_array(root.entries);
    for (const entry of entries) {
        const item = to_record(entry);
        const prompt = get_string(item?.query_str);
        if (prompt) return prompt;
    }

    return '';
};

const extract_perplexity_payload_data = (payload: unknown): {
    prompt: string;
    queries: string[];
    websites: Array<{ url: string; source: string }>;
} => {
    const prompt = extract_perplexity_prompt(payload);
    const queries: string[] = [];
    const websites: Array<{ url: string; source: string }> = [];
    const visited = new Set<unknown>();

    const push_query = (value?: string) => {
        if (!value) return;
        queries.push(value);
    };
    const push_url = (raw_url: unknown, source: string) => {
        const normalized = canonicalize_url(get_string(raw_url));
        if (!normalized) return;
        websites.push({ url: normalized, source });
    };

    const walk = (value: unknown, depth = 0) => {
        if (depth > 12 || value === null || value === undefined) return;
        if (typeof value !== 'object') return;
        if (visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
            value.forEach((entry) => walk(entry, depth + 1));
            return;
        }

        const row = to_record(value);
        if (!row) return;

        push_query(
            get_string(row.query)
            ?? get_string(row.q)
            ?? get_string(row.search_query)
            ?? get_string(row.keyword),
        );

        to_array(row.related_queries).forEach((entry) => {
            const text = get_string(entry);
            if (text) push_query(text);
        });
        to_array(row.related_query_items).forEach((entry) => {
            const item = to_record(entry);
            const text = get_string(item?.text);
            if (text) push_query(text);
        });

        to_array(row.queries).forEach((entry) => {
            const item = to_record(entry);
            const text = get_string(entry) ?? get_string(item?.query) ?? get_string(item?.q);
            if (text) push_query(text);
        });

        to_array(row.web_results).forEach((entry) => {
            const item = to_record(entry);
            push_url(item?.url ?? item?.link ?? item?.source_url ?? item?.display_url, 'perplexity_web_result');
        });

        const single_web_result = to_record(row.web_result);
        if (single_web_result) {
            push_url(
                single_web_result.url
                ?? single_web_result.link
                ?? single_web_result.source_url
                ?? single_web_result.display_url,
                'perplexity_web_result',
            );
        }

        Object.values(row).forEach((nested) => {
            if (nested !== undefined && (Array.isArray(nested) || typeof nested === 'object')) {
                walk(nested, depth + 1);
            }
        });
    };

    walk(payload);

    return {
        prompt,
        queries: dedupe_queries(queries),
        websites,
    };
};

const parse_perplexity_payload = (params: NormalizeParams): Omit<NormalizedConversationData, 'promptCandidates' | 'versionMeta'> => {
    const now_iso = new Date().toISOString();
    const warnings: string[] = [];
    const extracted = extract_perplexity_payload_data(params.payload);
    const prompt = extracted.prompt;
    const keywords = to_keyword_items(extracted.queries, params.provider, now_iso);
    const websites = to_website_items(extracted.websites, now_iso);

    if (!keywords.length) {
        warnings.push('No Perplexity search queries were found in payload.');
    }
    if (!websites.length) {
        warnings.push('No Perplexity crawled websites were found in payload.');
    }

    if (!prompt && !keywords.length && !websites.length) {
        return parse_generic_payload(params);
    }

    return {
        prompt,
        searchedKeywords: keywords,
        crawledWebsites: websites,
        placesFound: [],
        resultGroups: build_result_groups(websites, keywords),
        warnings,
    };
};

const parse_grok_tool_queries_from_text = (value: string): string[] => {
    const queries: string[] = [];
    const seen = new Set<string>();

    const push_query = (raw?: string) => {
        if (!raw) return;
        const normalized = collapse_spaces(raw);
        if (!normalized) return;
        const key = normalize_text_key(normalized);
        if (seen.has(key)) return;
        seen.add(key);
        queries.push(normalized);
    };

    const tool_args_regex = /<xai:tool_args><!\[CDATA\[(.*?)\]\]><\/xai:tool_args>/gs;
    let match: RegExpExecArray | null;
    while ((match = tool_args_regex.exec(value)) !== null) {
        const candidate = match[1]?.trim();
        if (!candidate) continue;
        try {
            const parsed = JSON.parse(candidate) as Record<string, unknown>;
            push_query(get_string(parsed.query) ?? get_string(parsed.q));
            to_array(parsed.queries).forEach((entry) => {
                const row = to_record(entry);
                push_query(get_string(entry) ?? get_string(row?.query) ?? get_string(row?.q));
            });
        } catch {
            // Fallback regex below covers malformed card payloads.
        }
    }

    const fallback_regex = /"query"\s*:\s*"([^"]+)"/g;
    let fallback_match: RegExpExecArray | null;
    while ((fallback_match = fallback_regex.exec(value)) !== null) {
        push_query(fallback_match[1]);
    }

    return queries;
};

const extract_grok_response_rows = (payload: unknown): Record<string, unknown>[] => {
    const root = to_record(payload) ?? {};
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    const push_row = (value: unknown) => {
        const row = to_record(value);
        if (!row) return;

        const sender = (get_string(row.sender) ?? '').toLowerCase();
        if (!(sender === 'assistant' || sender === 'human' || sender === 'user')) {
            return;
        }

        const response_id = get_string(row.responseId);
        const create_time = get_string(row.createTime);
        const message_preview = collapse_spaces(get_string(row.message) ?? '').slice(0, 80);
        const dedupe_key = response_id ?? `${sender}|${create_time ?? ''}|${message_preview}`;
        if (seen.has(dedupe_key)) return;
        seen.add(dedupe_key);
        rows.push(row);
    };

    to_array(root.responses).forEach((entry) => push_row(entry));

    const result = to_record(root.result);
    const envelope = result ?? root;
    const response = to_record(envelope.response);
    if (!response) {
        return rows;
    }

    push_row(response);
    push_row(response.userResponse);
    push_row(response.modelResponse);
    push_row(to_record(response.response));
    return rows;
};

const parse_grok_payload = (params: NormalizeParams): Omit<NormalizedConversationData, 'promptCandidates' | 'versionMeta'> => {
    const now_iso = new Date().toISOString();
    const warnings: string[] = [];
    const responses = extract_grok_response_rows(params.payload);

    const assistants = responses.filter((entry) => (get_string(entry.sender) ?? '').toLowerCase() === 'assistant');
    const humans = responses.filter((entry) => {
        const sender = (get_string(entry.sender) ?? '').toLowerCase();
        return sender === 'human' || sender === 'user';
    });

    const latest_assistant = [...assistants].sort((a, b) => {
        const a_time = new Date(get_string(a.createTime) ?? '').getTime();
        const b_time = new Date(get_string(b.createTime) ?? '').getTime();
        return (Number.isNaN(b_time) ? 0 : b_time) - (Number.isNaN(a_time) ? 0 : a_time);
    })[0] ?? null;

    const parent_response_id = get_string(latest_assistant?.parentResponseId);
    const parent_human = parent_response_id
        ? humans.find((entry) => get_string(entry.responseId) === parent_response_id) ?? null
        : null;
    const latest_human = [...humans].sort((a, b) => {
        const a_time = new Date(get_string(a.createTime) ?? '').getTime();
        const b_time = new Date(get_string(b.createTime) ?? '').getTime();
        return (Number.isNaN(b_time) ? 0 : b_time) - (Number.isNaN(a_time) ? 0 : a_time);
    })[0] ?? null;
    const prompt = get_string((parent_human ?? latest_human)?.message) ?? '';

    const queries: string[] = [];
    const website_rows: Array<{ url: string; source: string }> = [];
    const push_query = (value?: string) => {
        if (!value) return;
        queries.push(value);
    };
    const push_url = (raw_url: unknown, source: string) => {
        const normalized = canonicalize_url(get_string(raw_url));
        if (!normalized) return;
        website_rows.push({ url: normalized, source });
    };

    if (latest_assistant) {
        to_array(latest_assistant.webSearchResults).forEach((entry) => {
            const row = to_record(entry);
            push_url(row?.url ?? row?.link, 'grok_web_search_results');
        });
        to_array(latest_assistant.citedWebSearchResults).forEach((entry) => {
            const row = to_record(entry);
            push_url(row?.url ?? row?.link, 'grok_cited_web_search_results');
        });

        to_array(latest_assistant.steps).forEach((step) => {
            const step_row = to_record(step);
            if (!step_row) return;

            to_array(step_row.text).forEach((entry) => {
                const text = get_string(entry);
                if (!text) return;
                parse_grok_tool_queries_from_text(text).forEach((query) => push_query(query));
            });

            to_array(step_row.webSearchResults).forEach((entry) => {
                const row = to_record(entry);
                push_url(row?.url ?? row?.link, 'grok_step_web_search_results');
            });

            to_array(step_row.toolUsageResults).forEach((usage) => {
                const usage_row = to_record(usage);
                const web_search_results = to_record(usage_row?.webSearchResults);
                to_array(web_search_results?.results).forEach((entry) => {
                    const row = to_record(entry);
                    push_url(row?.url ?? row?.link, 'grok_tool_usage_results');
                });
            });
        });
    }

    const deduped_queries = dedupe_queries(queries);
    const keywords = to_keyword_items(deduped_queries, params.provider, now_iso);
    const websites = to_website_items(website_rows, now_iso);

    if (!deduped_queries.length) {
        warnings.push('No Grok tool queries were found in response payload.');
    }
    if (!websites.length) {
        warnings.push('No Grok crawled websites were found in response payload.');
    }

    if (!prompt && !keywords.length && !websites.length) {
        return parse_generic_payload(params);
    }

    return {
        prompt,
        searchedKeywords: keywords,
        crawledWebsites: websites,
        placesFound: [],
        resultGroups: build_result_groups(websites, keywords),
        warnings,
    };
};

const parse_generic_payload = (params: NormalizeParams): Omit<NormalizedConversationData, 'promptCandidates' | 'versionMeta'> => {
    const now_iso = new Date().toISOString();
    const warnings: string[] = [];
    const root = to_record(params.payload) ?? {};
    const walk_queries: string[] = [];
    const walk_websites: Array<{ url: string; source: string }> = [];

    const walk = (value: unknown, depth = 0) => {
        if (depth > 10) return;
        if (Array.isArray(value)) {
            value.forEach((entry) => walk(entry, depth + 1));
            return;
        }
        const obj = to_record(value);
        if (!obj) return;

        const query_candidates = [obj.query, obj.search_query, obj.keyword, obj.q];
        for (const candidate of query_candidates) {
            const text = get_string(candidate);
            if (text) walk_queries.push(text);
        }
        if (Array.isArray(obj.queries)) {
            obj.queries.forEach((query) => {
                const text = get_string(query);
                if (text) walk_queries.push(text);
            });
        }

        const url_candidates = [obj.url, obj.link, obj.source_url, obj.display_url];
        for (const candidate of url_candidates) {
            const url = canonicalize_url(get_string(candidate));
            if (url) walk_websites.push({ url, source: 'generic_payload' });
        }

        to_array(obj.safe_urls).forEach((entry) => {
            const url = canonicalize_url(get_string(entry));
            if (url) walk_websites.push({ url, source: 'generic_safe_urls' });
        });

        Object.values(obj).forEach((nested) => {
            if (nested !== undefined && (Array.isArray(nested) || typeof nested === 'object')) {
                walk(nested, depth + 1);
            }
        });
    };
    walk(params.payload);

    const prompt =
        get_string(root.prompt) ??
        get_string(root.title) ??
        '';
    const keywords = to_keyword_items(dedupe_queries(walk_queries), params.provider, now_iso);
    const websites = to_website_items(walk_websites, now_iso);
    if (!keywords.length) warnings.push('No keyword queries discovered in generic payload.');
    if (!websites.length) warnings.push('No websites discovered in generic payload.');

    return {
        prompt,
        searchedKeywords: keywords,
        crawledWebsites: websites,
        placesFound: [],
        resultGroups: build_result_groups(websites, keywords),
        warnings,
    };
};

export const normalize_conversation_payload = (params: NormalizeParams): NormalizedConversationData => {
    const base =
        params.provider === 'chatgpt'
            ? parse_chatgpt_payload(params)
            : params.provider === 'claude'
                ? parse_claude_payload(params)
            : params.provider === 'perplexity'
                ? parse_perplexity_payload(params)
            : params.provider === 'grok'
                ? parse_grok_payload(params)
                : parse_generic_payload(params);

    return {
        ...base,
        promptCandidates: params.promptCandidates ?? [],
        versionMeta: {
            versionDate: params.versionDate,
            lastExecutionDate: params.lastExecutionDate,
            provider: params.provider,
            conversationId: params.conversationId,
        },
    };
};
// --- Merged from modules/campaign/dto/campaign.dto.ts ---

const chatProviderSchema = z.enum(['chatgpt', 'claude', 'gemini', 'perplexity', 'grok', 'unknown']);

const createCampaignSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    domain_id: z.string().min(1, 'domain_id is required'),
    description: z.string().optional(),
    target_location: z.string().optional(),
    industry_tag: z.string().optional(),
    business_type: z.string().optional(),
    primary_goal: z.string().optional(),
});

export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

const updateCampaignSchema = z.object({
    name: z.string().min(1, 'Name is required').optional(),
    description: z.string().optional(),
    target_location: z.string().optional(),
    industry_tag: z.string().optional(),
    business_type: z.string().optional(),
    primary_goal: z.string().optional(),
});

export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;

const ingestTurnSchema = z.object({
    chat_provider: chatProviderSchema,
    conversation_id: z.string(),
    provider_chat_id: z.string().optional(),
    chat_url: z.string().optional(),
    chat_title: z.string().optional(),
    request_id: z.string().optional(),
    turn_exchange_id: z.string().optional(),
    prompt: z.string(),
    finished_reason: z.string().optional(),
    queries: z.array(z.string()).optional(),
    result_groups: z.array(z.any()).optional(),
    active_prompt_node_id: z.string().optional(),
    metadata: z.record(z.any()).optional(),
});

export type IngestTurnDto = z.infer<typeof ingestTurnSchema>;

export const refireSchema = z.object({
    source_version_number: z.number().int().positive(),
});

export type RefireDto = z.infer<typeof refireSchema>;

const linkChatThreadSchema = z.object({
    chat_provider: chatProviderSchema,
    conversation_id: z.string().optional(),
    provider_chat_id: z.string().optional(),
    chat_url: z.string().url().optional(),
    chat_title: z.string().optional(),
});

export type LinkChatThreadDto = z.infer<typeof linkChatThreadSchema>;

const refreshNodeSchema = z.object({
    provider: chatProviderSchema.optional(),
    scope: z.enum(['node', 'branch']).optional(),
});

export type RefreshNodeDto = z.infer<typeof refreshNodeSchema>;

const conversationIngestSchema = z.object({
    conversationId: z.string().min(1, 'conversationId is required'),
    payload: z.any(),
    promptVersionId: z.string().optional(),
    source: z.string().min(1).optional(),
    prompt: z.string().optional(),
    sourcePromptId: z.string().optional(),
});

export type ConversationIngestDto = z.infer<typeof conversationIngestSchema>;

const manualPromptSchema = z.object({
    text: z.string().min(1, 'text is required'),
});

export type ManualPromptDto = z.infer<typeof manualPromptSchema>;

const selectPromptCandidatesSchema = z.object({
    promptIds: z.array(z.string()).min(1, 'promptIds is required'),
    selected: z.boolean(),
});

export type SelectPromptCandidatesDto = z.infer<typeof selectPromptCandidatesSchema>;

const replacePromptSelectionSchema = z.object({
    selectedPromptIds: z.array(z.string()),
});

export type ReplacePromptSelectionDto = z.infer<typeof replacePromptSelectionSchema>;

const executePromptSchema = z.object({
    mode: z.enum(['fire', 'refire']),
    promptIds: z.array(z.string()).min(1, 'promptIds is required'),
    provider: chatProviderSchema,
});

export type ExecutePromptDto = z.infer<typeof executePromptSchema>;

const siteTopQueryTargetSchema = z.object({
    domain: z.string().min(1).optional(),
    page_url: z.string().url().optional(),
}).superRefine((value, ctx) => {
    if (!value.domain && !value.page_url) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Each target must include domain or page_url',
            path: ['target'],
        });
    }
});

const siteTopQueriesSchema = z.object({
    targets: z.array(siteTopQueryTargetSchema).optional(),
    hosts: z.array(z.string().min(1)).optional(),
    country: z.string().min(2).max(3).default('IN'),
    limit: z.number().int().min(1).max(50).default(10),
    forceRefresh: z.boolean().optional(),
}).superRefine((value, ctx) => {
    const has_targets = (value.targets?.length ?? 0) > 0;
    const has_hosts = (value.hosts?.length ?? 0) > 0;
    if (!has_targets && !has_hosts) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'targets or hosts are required',
            path: ['targets'],
        });
    }
});

export type SiteTopQueriesDto = z.infer<typeof siteTopQueriesSchema>;
// --- Merged from modules/campaign/workspace.routes.ts ---


campaign_router.get('/:workspace_id/workflow/state', authMiddleware, campaignController.getWorkflowState);
campaign_router.post('/:workspace_id/providers/:provider/conversations/ingest', authMiddleware, campaignController.ingestConversation);
campaign_router.post('/:workspace_id/prompt-versions/:version_id/prompts/manual', authMiddleware, campaignController.addManualPrompt);
campaign_router.post('/:workspace_id/prompt-versions/:version_id/prompts/select', authMiddleware, campaignController.selectPromptCandidates);
campaign_router.post('/:workspace_id/prompt-versions/:version_id/prompts/selection-set', authMiddleware, campaignController.replacePromptSelection);
campaign_router.post('/:workspace_id/prompt-versions/:version_id/execute', authMiddleware, campaignController.executePrompts);
campaign_router.post('/:workspace_id/site-keywords/top-queries', authMiddleware, campaignController.getSiteTopQueries);

// --- Merged from modules/domain/domain.controller.ts ---


class DomainController {
  constructor(private readonly service: DomainService = domainService) {}

  listDomains = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.tenant_id) {
      throw new HttpException(400, 'Active account is required');
    }
    const data = await this.service.listDomains(req.user.tenant_id);
    return res.json(ApiResponse.success(data));
  };

  createDomain = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id || !req.user?.tenant_id) {
      throw new HttpException(400, 'Active account is required');
    }
    const payload = createDomainSchema.parse(req.body ?? {});
    const data = await this.service.createDomainAndScrape({
      tenant_id: req.user.tenant_id,
      user_id: req.user.id,
      domain_url: payload.domain_url,
    });
    return res.status(201).json(ApiResponse.success(data, 'Domain created and scraped'));
  };

  getDomainContext = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.tenant_id) {
      throw new HttpException(400, 'Active account is required');
    }
    const { domain_id } = req.params;
    const data = await this.service.getDomainContext(req.user.tenant_id, domain_id);
    return res.json(ApiResponse.success(data));
  };

  rescrapeDomain = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.tenant_id) {
      throw new HttpException(400, 'Active account is required');
    }
    const { domain_id } = req.params;
    const data = await this.service.rescrapeDomain(req.user.tenant_id, domain_id);
    return res.json(ApiResponse.success(data, 'Domain rescraped'));
  };
}

export const domainController = new DomainController();
// --- Merged from modules/domain/domain.model.ts ---
export type DomainScrapeStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface DomainSummary {
  domain_id: string;
  normalized_domain: string;
  display_domain: string;
  source_url: string;
  scrape_status: DomainScrapeStatus;
  last_scraped_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DomainContextPayload {
  domain: DomainSummary;
  context: (Record<string, unknown> & {
    extracted_at?: Date;
    summary: string;
    key_pages: Array<{
      url: string;
      title?: string;
      description?: string;
      excerpt?: string;
    }>;
    keywords: string[];
  }) | null;
}
// --- Merged from modules/domain/domain.repository.ts ---


export class DomainRepository extends BaseRepository {
  listDomains(tenant_id: string) {
    return prisma.domain.findMany({
      where: { tenant_id },
      orderBy: { created_at: 'desc' },
    });
  }

  findDomainById(tenant_id: string, domain_id: string) {
    return prisma.domain.findFirst({
      where: {
        id: domain_id,
        tenant_id,
      },
      include: {
        context: true,
      },
    });
  }

  findByNormalizedDomain(tenant_id: string, normalized_domain: string) {
    return prisma.domain.findFirst({
      where: {
        tenant_id,
        normalized_domain,
      },
      include: {
        context: true,
      },
    });
  }

  createDomain(params: {
    tenant_id: string;
    user_id: string;
    normalized_domain: string;
    display_domain: string;
    source_url: string;
  }) {
    return prisma.domain.create({
      data: {
        tenant_id: params.tenant_id,
        created_by_user_id: params.user_id,
        normalized_domain: params.normalized_domain,
        display_domain: params.display_domain,
        source_url: params.source_url,
        scrape_status: 'queued',
      },
      include: {
        context: true,
      },
    });
  }

  async createScrapeRun(domain_id: string) {
    return prisma.domainScrapeRun.create({
      data: {
        domain_id,
        status: 'running',
        started_at: new Date(),
      },
    });
  }

  async completeScrapeRun(params: { domain_id: string; run_id: string; page_count: number }) {
    const now = new Date();
    await prisma.$transaction([
      prisma.domainScrapeRun.update({
        where: { id: params.run_id },
        data: {
          status: 'completed',
          finished_at: now,
          page_count: params.page_count,
          error_message: null,
        },
      }),
      prisma.domain.update({
        where: { id: params.domain_id },
        data: {
          scrape_status: 'completed',
          last_scraped_at: now,
        },
      }),
    ]);
  }

  async failScrapeRun(params: { domain_id: string; run_id: string; error_message: string }) {
    const now = new Date();
    await prisma.$transaction([
      prisma.domainScrapeRun.update({
        where: { id: params.run_id },
        data: {
          status: 'failed',
          finished_at: now,
          error_message: params.error_message.slice(0, 500),
        },
      }),
      prisma.domain.update({
        where: { id: params.domain_id },
        data: {
          scrape_status: 'failed',
        },
      }),
    ]);
  }

  async markDomainRunning(domain_id: string) {
    await prisma.domain.update({
      where: { id: domain_id },
      data: { scrape_status: 'running' },
    });
  }

  async saveDomainContext(params: {
    domain_id: string;
    context_json: Record<string, unknown>;
    pages_json: Array<Record<string, unknown>>;
  }) {
    const context_json = params.context_json as Prisma.InputJsonValue;
    const pages_json = params.pages_json as Prisma.InputJsonValue;
    await prisma.domainContext.upsert({
      where: { domain_id: params.domain_id },
      create: {
        domain_id: params.domain_id,
        context_json,
        pages_json,
        extracted_at: new Date(),
      },
      update: {
        context_json,
        pages_json,
        extracted_at: new Date(),
      },
    });
  }
}

export const domainRepository = new DomainRepository();
// --- Merged from modules/domain/domain.routes.ts ---


const domain_router = Router();

domain_router.get('/', authMiddleware, domainController.listDomains);
domain_router.post('/', authMiddleware, requireAccountRole(['owner', 'admin']), domainController.createDomain);
domain_router.get('/:domain_id/context', authMiddleware, domainController.getDomainContext);
domain_router.post('/:domain_id/rescrape', authMiddleware, requireAccountRole(['owner', 'admin']), domainController.rescrapeDomain);

export { domain_router };
// --- Merged from modules/domain/domain.service.ts ---

const SCRAPE_MAX_PAGES = 12;
const SCRAPE_PAGE_TIMEOUT_MS = 8_000;
const SCRAPE_TOTAL_TIMEOUT_MS = 45_000;
const OPENAI_TIMEOUT_MS = 20_000;
const AI_CONTEXT_MAX_CHARS = 26_000;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'to', 'in', 'of', 'for', 'on', 'at', 'is', 'are', 'with', 'and', 'or', 'from', 'by', 'that', 'this',
  'you', 'your', 'our', 'we', 'it', 'as', 'be', 'can', 'will', 'not', 'about', 'into', 'more', 'get', 'all', 'new',
]);

const KEY_PATH_HINTS = ['about', 'pricing', 'product', 'products', 'service', 'services', 'blog', 'contact', 'feature', 'features'];

interface NormalizedDomainInput {
  normalized_domain: string;
  display_domain: string;
  source_url: string;
  homepage_url: string;
}

interface ScrapedPage {
  url: string;
  title?: string;
  description?: string;
  excerpt?: string;
  text: string;
}

const normalize_domain_or_url = (value: string): NormalizedDomainInput => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpException(400, 'Domain is required');
  }
  const with_protocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(with_protocol);
  } catch {
    throw new HttpException(400, 'Invalid domain or URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpException(400, 'Only http/https domains are supported');
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.')) {
    throw new HttpException(400, 'Enter a valid domain');
  }

  const homepage_url = `${parsed.protocol}//${host}`;

  return {
    normalized_domain: host,
    display_domain: host,
    source_url: `${parsed.protocol}//${host}${parsed.pathname === '/' ? '' : parsed.pathname}`,
    homepage_url,
  };
};

const make_account_name_from_domain = (domain: string): string => {
  const root = domain.split('.')[0] ?? domain;
  const cleaned = root
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const candidate = cleaned.trim();
  return candidate.length ? `${candidate} Account` : `${domain} Account`;
};

const strip_html = (html: string): string => {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const extract_title = (html: string): string | undefined => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return undefined;
  return match[1].replace(/\s+/g, ' ').trim().slice(0, 220) || undefined;
};

const extract_meta_description = (html: string): string | undefined => {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
  if (!match?.[1]) return undefined;
  return match[1].replace(/\s+/g, ' ').trim().slice(0, 280) || undefined;
};

const extract_internal_links = (html: string, homepage: URL): string[] => {
  const href_matches = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi));
  const unique = new Map<string, number>();

  for (const match of href_matches) {
    const href = (match[1] ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, homepage);
    } catch {
      continue;
    }
    const hostname = resolved.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== homepage.hostname.toLowerCase().replace(/^www\./, '')) continue;
    resolved.hash = '';
    resolved.search = '';
    const as_string = resolved.toString().replace(/\/$/, '');
    const path = resolved.pathname.toLowerCase();

    let score = 0;
    if (path === '/' || path === '') score += 1;
    if (path.split('/').filter(Boolean).length <= 2) score += 2;
    if (KEY_PATH_HINTS.some((hint) => path.includes(`/${hint}`))) score += 4;
    unique.set(as_string, Math.max(unique.get(as_string) ?? 0, score));
  }

  return Array.from(unique.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, 30);
};

const with_timeout = async <T>(promise_factory: (signal: AbortSignal) => Promise<T>, timeout_ms: number): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeout_ms);
  try {
    return await promise_factory(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const fetch_html_page = async (url: string): Promise<string> => {
  const response = await with_timeout(
    (signal) => fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'AISEOContextBot/1.0' } }),
    SCRAPE_PAGE_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }
  return response.text();
};

const build_keywords = (text: string): string[] => {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);
};

const summarize_text = (text: string): string => {
  if (!text) return '';
  const trimmed = text.slice(0, 2000);
  const sentences = trimmed.split(/[.!?]\s+/).map((s) => s.trim()).filter(Boolean);
  return sentences.slice(0, 3).join('. ').slice(0, 450);
};

// Cleaned up duplicate block: // --- Duplicate to_record skipped ---
// Cleaned up duplicate block: // --- Duplicate to_array skipped ---
// Cleaned up duplicate block: // --- Duplicate get_string skipped ---
const normalize_string_array = (value: unknown, limit = 12): string[] =>
  to_array(value)
    .map((item: any) => get_string(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);

// Cleaned up duplicate block: // --- Duplicate parse_json_object_from_text skipped ---
interface PuppeteerPageLike {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  content: () => Promise<string>;
  url: () => string;
  close: () => Promise<void>;
  setUserAgent?: (user_agent: string) => Promise<void>;
  setViewport?: (viewport: { width: number; height: number }) => Promise<void>;
}

interface PuppeteerBrowserLike {
  newPage: () => Promise<PuppeteerPageLike>;
  close: () => Promise<void>;
}

interface PuppeteerModuleLike {
  launch: (options: Record<string, unknown>) => Promise<PuppeteerBrowserLike>;
}

const load_puppeteer_module = (): PuppeteerModuleLike | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const loaded = require('puppeteer') as { default?: unknown } | unknown;
    const module_like = to_record(loaded)?.default ?? loaded;
    if (!module_like || typeof (module_like as { launch?: unknown }).launch !== 'function') {
      return null;
    }
    return module_like as PuppeteerModuleLike;
  } catch {
    return null;
  }
};

const launch_puppeteer_browser = async (): Promise<PuppeteerBrowserLike | null> => {
  const puppeteer = load_puppeteer_module();
  if (!puppeteer) return null;
  try {
    return await puppeteer.launch({
      headless: true,
      timeout: SCRAPE_PAGE_TIMEOUT_MS,
      ignoreHTTPSErrors: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  } catch {
    return null;
  }
};

const fetch_html_page_with_puppeteer = async (browser: PuppeteerBrowserLike, url: string): Promise<{ html: string; final_url: string }> => {
  const page = await browser.newPage();
  try {
    if (page.setUserAgent) {
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36');
    }
    if (page.setViewport) {
      await page.setViewport({ width: 1366, height: 900 });
    }
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: SCRAPE_PAGE_TIMEOUT_MS,
    });
    const html = await page.content();
    return { html, final_url: page.url() || url };
  } finally {
    await page.close().catch(() => undefined);
  }
};

const build_heuristic_domain_sections = (params: {
  summary: string;
  keywords: string[];
  key_pages: Array<{ url: string; title?: string; description?: string; excerpt?: string }>;
}): Record<string, unknown> => {
  const page_lines = params.key_pages
    .slice(0, 5)
    .map((page) => page.title || page.description || page.excerpt || page.url)
    .filter((item): item is string => Boolean(item));

  return {
    business_context: params.summary || 'Domain content was scraped, but a detailed profile is still being assembled.',
    market_context: page_lines.slice(0, 3),
    audience_context: [],
    goals_positioning: [],
    products_services: page_lines.slice(0, 4),
    opportunities: params.keywords.slice(0, 8),
    risks: [],
    messaging: [],
    seo_focus_keywords: params.keywords.slice(0, 12),
  };
};

const build_gemini_domain_context = async (params: {
  domain: string;
  summary: string;
  keywords: string[];
  pages: ScrapedPage[];
}): Promise<Record<string, unknown> | null> => {
  if (!GEMINI_API_KEY) {
    return null;
  }

  const snippets = params.pages
    .slice(0, 8)
    .map((page, index) =>
      [
        `Page ${index + 1}: ${page.url}`,
        page.title ? `Title: ${page.title}` : '',
        page.description ? `Description: ${page.description}` : '',
        page.excerpt ? `Excerpt: ${page.excerpt}` : '',
        page.text ? `Text: ${page.text.slice(0, 900)}` : '',
      ].filter(Boolean).join('\n'),
    )
    .join('\n\n')
    .slice(0, 26000);

  const prompt = `
    You are an AI SEO analyst. 
    Analyze the following website data and return a JSON object containing:
    - summary (string): A 2-3 sentence overview of the business.
    - business_context (string): Deep dive into their business model.
    - market_context (string): Who are their competitors and where do they sit in the market?
    - audience_context (string): Who is the target customer?
    - goals_positioning (string): What are they trying to achieve?
    - products_services (array of strings): List of main offerings.
    - opportunities (array of strings): High-level growth/SEO opportunities.
    - risks (array of strings): Potential business/SEO threats.
    - messaging (array of strings): Key value propositions found.
    - seo_focus_keywords (array of strings): 10-15 keywords to target.

    Website: ${params.domain}
    Existing Summary: ${params.summary}
    Keywords: ${params.keywords.join(', ')}
    
    Page Content:
    ${snippets}

    Return ONLY raw JSON. Do not use markdown blocks.
  `;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          response_mime_type: "application/json"
        }
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[Gemini Error]', err);
      return null;
    }

    const data = await response.json();
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) return null;

    return parse_json_object_from_text(textContent);
  } catch (error) {
    console.error('[Gemini Request Failed]', error);
    return null;
  }
};

const to_domain_summary = (domain: {
  id: string;
  normalized_domain: string;
  display_domain: string;
  source_url: string;
  scrape_status: 'queued' | 'running' | 'completed' | 'failed';
  last_scraped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): DomainSummary => ({
  domain_id: domain.id,
  normalized_domain: domain.normalized_domain,
  display_domain: domain.display_domain,
  source_url: domain.source_url,
  scrape_status: domain.scrape_status,
  last_scraped_at: domain.last_scraped_at,
  created_at: domain.created_at,
  updated_at: domain.updated_at,
});

export class DomainService extends BaseService {
  constructor(private readonly repository: DomainRepository = domainRepository) {
    super();
  }

  static normalizeDomainInput = normalize_domain_or_url;
  static accountNameFromDomain = make_account_name_from_domain;

  async listDomains(tenant_id: string): Promise<DomainSummary[]> {
    const domains = await this.repository.listDomains(tenant_id);
    return domains.map((domain) => to_domain_summary(domain));
  }

  async getDomainContext(tenant_id: string, domain_id: string): Promise<DomainContextPayload> {
    const domain = await this.repository.findDomainById(tenant_id, domain_id);
    if (!domain) {
      throw new HttpException(404, 'Domain not found');
    }
    const context_record = domain.context?.context_json as Record<string, unknown> | null;
    const pages = Array.isArray(context_record?.['key_pages']) ? context_record?.['key_pages'] : [];
    const keywords = Array.isArray(context_record?.['keywords']) ? context_record?.['keywords'] : [];
    const summary = String(context_record?.['summary'] ?? '');
    return {
      domain: to_domain_summary(domain),
      context: context_record
        ? {
          ...context_record,
          extracted_at: domain.context?.extracted_at,
          summary,
          key_pages: pages as Array<{ url: string; title?: string; description?: string; excerpt?: string }>,
          keywords: keywords as string[],
        }
        : null,
    };
  }

  async createDomainAndScrape(params: { tenant_id: string; user_id: string; domain_url: string }): Promise<DomainContextPayload> {
    const normalized = normalize_domain_or_url(params.domain_url);
    const existing = await this.repository.findByNormalizedDomain(params.tenant_id, normalized.normalized_domain);
    if (existing) {
      throw new HttpException(409, 'Domain already exists in this account');
    }

    const created = await this.repository.createDomain({
      tenant_id: params.tenant_id,
      user_id: params.user_id,
      normalized_domain: normalized.normalized_domain,
      display_domain: normalized.display_domain,
      source_url: normalized.source_url,
    });

      await this.scrapeDomainOrThrow({
        domain_id: created.id,
        homepage_url: normalized.homepage_url,
      });

    return this.getDomainContext(params.tenant_id, created.id);
  }

  async rescrapeDomain(tenant_id: string, domain_id: string): Promise<DomainContextPayload> {
    const existing = await this.repository.findDomainById(tenant_id, domain_id);
    if (!existing) {
      throw new HttpException(404, 'Domain not found');
    }
    const homepage_url = `https://${existing.normalized_domain}`;
    await this.scrapeDomainOrThrow({
      domain_id,
      homepage_url,
    });
    return this.getDomainContext(tenant_id, domain_id);
  }

  private async scrapeDomainOrThrow(params: { domain_id: string; homepage_url: string }) {
    const run = await this.repository.createScrapeRun(params.domain_id);
    await this.repository.markDomainRunning(params.domain_id);

    const started_at = Date.now();
    let browser: PuppeteerBrowserLike | null = null;
    try {
      browser = await launch_puppeteer_browser();
      const scrape_engine = browser ? 'puppeteer' : 'http_fetch';

      const homepage_response = browser
        ? await fetch_html_page_with_puppeteer(browser, params.homepage_url).catch(() => null)
        : null;
      const homepage_html = homepage_response?.html ?? await fetch_html_page(params.homepage_url);
      const homepage_url = new URL(homepage_response?.final_url ?? params.homepage_url);
      const candidate_links = extract_internal_links(homepage_html, homepage_url);
      const target_urls = [params.homepage_url, ...candidate_links]
        .filter((url, index, arr) => arr.indexOf(url) === index)
        .slice(0, SCRAPE_MAX_PAGES);

      const scraped_pages: ScrapedPage[] = [];
      for (const url of target_urls) {
        if (Date.now() - started_at > SCRAPE_TOTAL_TIMEOUT_MS) {
          break;
        }
        try {
          let html = homepage_html;
          let final_url = url;
          if (url !== params.homepage_url) {
            if (browser) {
              const browser_page = await fetch_html_page_with_puppeteer(browser, url).catch(() => null);
              if (browser_page) {
                html = browser_page.html;
                final_url = browser_page.final_url;
              } else {
                html = await fetch_html_page(url);
              }
            } else {
              html = await fetch_html_page(url);
            }
          }
          const text = strip_html(html).slice(0, 3200);
          scraped_pages.push({
            url: final_url,
            title: extract_title(html),
            description: extract_meta_description(html),
            excerpt: summarize_text(text),
            text,
          });
        } catch {
          // Best effort: skip failed page and continue.
        }
      }

      if (!scraped_pages.length) {
        throw new Error('Could not scrape any page content');
      }

      const corpus = scraped_pages.map((page) => page.text).join(' ');
      const keywords = build_keywords(corpus);
      const summary = summarize_text(corpus);

      const key_pages = scraped_pages.map((page) => ({
        url: page.url,
        title: page.title,
        description: page.description,
        excerpt: page.excerpt,
      }));

      const ai_context = await build_gemini_domain_context({
        domain: new URL(params.homepage_url).hostname,
        summary,
        keywords,
        pages: scraped_pages,
      }).catch(() => null);
      const heuristic_context = build_heuristic_domain_sections({ summary, keywords, key_pages });

      const context_json: Record<string, unknown> = {
        summary: get_string(ai_context?.summary) ?? summary,
        keywords: normalize_string_array(ai_context?.seo_focus_keywords ?? ai_context?.keywords, 18).length
          ? normalize_string_array(ai_context?.seo_focus_keywords ?? ai_context?.keywords, 18)
          : keywords,
        key_pages,
        business_context: get_string(ai_context?.business_context) ?? heuristic_context.business_context,
        market_context: get_string(ai_context?.market_context) ?? heuristic_context.market_context,
        audience_context: get_string(ai_context?.audience_context) ?? heuristic_context.audience_context,
        goals_positioning: get_string(ai_context?.goals_positioning) ?? heuristic_context.goals_positioning,
        products_services: normalize_string_array(ai_context?.products_services, 10).length
          ? normalize_string_array(ai_context?.products_services, 10)
          : (heuristic_context.products_services as string[]),
        opportunities: normalize_string_array(ai_context?.opportunities, 12).length
          ? normalize_string_array(ai_context?.opportunities, 12)
          : (heuristic_context.opportunities as string[]),
        risks: normalize_string_array(ai_context?.risks, 10),
        messaging: normalize_string_array(ai_context?.messaging, 10),
        seo_focus_keywords: normalize_string_array(ai_context?.seo_focus_keywords, 18).length
          ? normalize_string_array(ai_context?.seo_focus_keywords, 18)
          : keywords,
        scrape_engine,
        summary_provider: ai_context ? 'gemini' : 'heuristic',
      };

      await this.repository.saveDomainContext({
        domain_id: params.domain_id,
        context_json,
        pages_json: key_pages,
      });
      await this.repository.completeScrapeRun({
        domain_id: params.domain_id,
        run_id: run.id,
        page_count: key_pages.length,
      });
    } catch (error) {
      await this.repository.failScrapeRun({
        domain_id: params.domain_id,
        run_id: run.id,
        error_message: error instanceof Error ? error.message : 'Scrape failed',
      });
      throw new HttpException(502, error instanceof Error ? error.message : 'Failed to scrape website');
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }
}

export const domainService = new DomainService();
// --- Merged from modules/domain/dto/create-domain.dto.ts ---

export const createDomainSchema = z.object({
  domain_url: z.string().min(1),
});

export type CreateDomainDto = z.infer<typeof createDomainSchema>;
// --- Merged from modules/domain/dto/rescrape-domain.dto.ts ---

export const rescrapeDomainSchema = z.object({});

export type RescrapeDomainDto = z.infer<typeof rescrapeDomainSchema>;

const createAccountSchema = z.object({
  mode: z.literal('create_account'),
  domain_url: z.string().min(1),
});

const joinAccountSchema = z.object({
  mode: z.literal('join_account'),
  account_slug: z.string().min(2).max(64),
});

export const bootstrapOnboardingSchema = z.discriminatedUnion('mode', [
  createAccountSchema,
  joinAccountSchema,
]);

export type BootstrapOnboardingDto = z.infer<typeof bootstrapOnboardingSchema>;
// --- Merged from modules/onboarding/onboarding.controller.ts ---


class OnboardingController extends BaseController {
  constructor(private readonly service: OnboardingService = onboardingService) {
    super();
  }

  getContext = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const data = await this.service.getContext(req.user.id);
    return res.json(ApiResponse.success(data, 'Onboarding context retrieved'));
  };

  bootstrap = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const validated = bootstrapOnboardingSchema.parse(req.body ?? {});
    const data = await this.service.bootstrap({
      user_id: req.user.id,
      payload: validated,
    });
    return res.json(ApiResponse.success(data, 'Onboarding bootstrap completed'));
  };
}

export const onboardingController = new OnboardingController();
// --- Merged from modules/onboarding/onboarding.model.ts ---
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
// --- Merged from modules/onboarding/onboarding.repository.ts ---


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
// --- Merged from modules/onboarding/onboarding.routes.ts ---


const onboarding_router = Router();

onboarding_router.get('/context', authMiddleware, onboardingController.getContext);
onboarding_router.post('/bootstrap', authMiddleware, onboardingController.bootstrap);

export { onboarding_router };
// --- Merged from modules/onboarding/onboarding.service.ts ---

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
// --- Merged from modules/user/dto/create-user.dto.ts ---

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;


// --- Merged from modules/user/dto/login-user.dto.ts ---

export const loginUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export type LoginUserDto = z.infer<typeof loginUserSchema>;


// --- Merged from modules/user/user.controller.ts ---


class UserController extends BaseController {
  constructor(private readonly service: UserService = userService) {
    super();
  }

  register = async (req: Request, res: Response) => {
    const validated = createUserSchema.parse(req.body);
    const user = await this.service.registerUser(validated);
    return res.json(ApiResponse.success(user, 'User registered'));
  };

  login = async (req: Request, res: Response) => {
    const validated = loginUserSchema.parse(req.body);
    const token = await this.service.loginUser(validated);
    return res.json(ApiResponse.success(token, 'Login successful'));
  };
}

export const userController = new UserController();


// --- Merged from modules/user/user.model.ts ---
export interface User {
  id: string;
  email: string;
  name?: string | null;
  password?: string | null;
  created_at: Date;
  updated_at: Date;
}
// --- Merged from modules/user/user.repository.ts ---


export class UserRepository extends BaseRepository {
  createUser(data: CreateUserDto & { password: string }): Promise<User> {
    return prisma.user.create({ data });
  }

  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }
}

export const userRepository = new UserRepository();
// --- Merged from modules/user/user.routes.ts ---


const user_router = Router();

user_router.post('/register', userController.register);
user_router.post('/login', userController.login);

export { user_router };


// --- Merged from modules/user/user.service.ts ---


export class UserService extends BaseService {
  constructor(private readonly repository: UserRepository = userRepository) {
    super();
  }

  async registerUser(payload: CreateUserDto): Promise<User> {
    const existing = await this.repository.findByEmail(payload.email);
    if (existing) {
      throw new HttpException(409, 'Email already in use');
    }

    const password = await hashPassword(payload.password);
    const user = await this.repository.createUser({ ...payload, password });
    return user;
  }

  async loginUser(payload: LoginUserDto): Promise<{ token: string }> {
    const user = await this.repository.findByEmail(payload.email);
    if (!user?.password) {
      throw new HttpException(401, 'Invalid credentials');
    }

    const isValid = await comparePassword(payload.password, user.password);
    if (!isValid) {
      throw new HttpException(401, 'Invalid credentials');
    }

    const token = jwt.sign({ user_id: user.id }, config.JWT_SECRET, { expiresIn: '1h' });
    return { token };
  }
}

export const userService = new UserService();
// queue connection config
const queue_connection = { url: config.REDIS_URL };

// --- Merged from queue/ahrefs.queue.ts ---



const ahrefs_queue_name = 'ahrefs_fetch_queue';

const default_job_options: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2500,
  },
  removeOnComplete: 200,
  removeOnFail: 200,
};

export const ahrefs_fetch_queue = new Queue<AhrefsInsightsJobPayload, SemrushSiteInsightResult[]>(ahrefs_queue_name, {
  connection: queue_connection,
  defaultJobOptions: default_job_options,
});

export const ahrefs_queue_events = new QueueEvents(ahrefs_queue_name, {
  connection: queue_connection,
});

const build_job_id = (payload: AhrefsInsightsJobPayload): string => {
  const hash_input = JSON.stringify({
    tenant_id: payload.tenant_id,
    project_id: payload.project_id,
    generation_run_id: payload.generation_run_id,
    ahrefs_url: payload.ahrefs_url,
    latest_prompt: payload.latest_prompt ?? '',
    sites: payload.sites,
  });
  const digest = createHash('sha256').update(hash_input).digest('hex').slice(0, 24);
  return `ahrefs:${payload.tenant_id}:${payload.project_id}:${digest}`;
};

export const enqueue_ahrefs_job = async (payload: AhrefsInsightsJobPayload): Promise<Job> => {
  const job_id = build_job_id(payload);
  const existing = await ahrefs_fetch_queue.getJob(job_id);
  if (existing) {
    return existing as Job;
  }
  return ahrefs_fetch_queue.add('ahrefs_fetch_insights', payload, { jobId: job_id }) as Promise<Job>;
};

export const wait_for_ahrefs_job = async (job: Job): Promise<SemrushSiteInsightResult[]> => {
  await ahrefs_queue_events.waitUntilReady();
  const result = await job.waitUntilFinished(ahrefs_queue_events, 90_000) as unknown;
  return Array.isArray(result) ? (result as SemrushSiteInsightResult[]) : [];
};
// --- Merged from queue/connection.ts ---

// queue_connection is exported from its declaration below
// --- Merged from queue/index.ts ---

let queue_workers_initialized = false;

export const init_queue_workers = () => {
  if (queue_workers_initialized) {
    return;
  }
  queue_workers_initialized = true;
  logger.info('[queue] workers initialized');
  void semrush_worker;
  void ahrefs_worker;
};
// --- Merged from queue/semrush.queue.ts ---



const semrush_queue_name = 'semrush_fetch_queue';

const semrush_default_job_options: JobsOptions = {
  attempts: 4,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: 200,
  removeOnFail: 200,
};

export const semrush_fetch_queue = new Queue<SemrushInsightsJobPayload, SemrushSiteInsightResult[]>(semrush_queue_name, {
  connection: queue_connection,
  defaultJobOptions: semrush_default_job_options,
});

export const semrush_queue_events = new QueueEvents(semrush_queue_name, {
  connection: queue_connection,
});

const build_semrush_job_id = (payload: SemrushInsightsJobPayload): string => {
  const hash_input = JSON.stringify({
    tenant_id: payload.tenant_id,
    project_id: payload.project_id,
    generation_run_id: payload.generation_run_id,
    semrush_url: payload.semrush_url,
    latest_prompt: payload.latest_prompt ?? '',
    sites: payload.sites,
  });
  const digest = createHash('sha256').update(hash_input).digest('hex').slice(0, 24);
  return `semrush:${payload.tenant_id}:${payload.project_id}:${digest}`;
};

export const enqueue_semrush_job = async (payload: SemrushInsightsJobPayload): Promise<Job> => {
  const job_id = build_semrush_job_id(payload);
  const existing = await semrush_fetch_queue.getJob(job_id);
  if (existing) {
    return existing as Job;
  }
  return semrush_fetch_queue.add('semrush_fetch_insights', payload, { jobId: job_id }) as Promise<Job>;
};

export const wait_for_semrush_job = async (job: Job): Promise<SemrushSiteInsightResult[]> => {
  await semrush_queue_events.waitUntilReady();
  const result = await job.waitUntilFinished(semrush_queue_events, 90_000) as unknown;
  return Array.isArray(result) ? (result as SemrushSiteInsightResult[]) : [];
};
// --- Merged from queue/semrush.types.ts ---
export interface SemrushSiteInput {
  site_name: string;
  site_url?: string;
}

export interface SemrushKeywordMetric {
  keyword: string;
  position?: number;
  traffic?: number;
  traffic_percent?: number;
  volume?: number;
  keyword_difficulty?: number;
  url?: string;
}

export interface SemrushSiteInsightResult {
  source?: 'semrush' | 'ahrefs';
  site_name: string;
  site_url?: string;
  ranking_keywords: string[];
  confidence_score?: number;
  summary?: string;
  keyword_metrics: SemrushKeywordMetric[];
}

export interface SemrushInsightsJobPayload {
  tenant_id: string;
  project_id: string;
  generation_run_id: string;
  semrush_url: string;
  latest_prompt?: string;
  sites: SemrushSiteInput[];
}

export interface AhrefsInsightsJobPayload {
  tenant_id: string;
  project_id: string;
  generation_run_id: string;
  ahrefs_url: string;
  latest_prompt?: string;
  sites: SemrushSiteInput[];
}
// --- Merged from queue/workers/ahrefs.client.ts ---

const normalize_key = (value: string): string => value.trim().toLowerCase();
const is_probable_domain = (value: string): boolean => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value.trim());

// Cleaned up duplicate block: // --- Duplicate get_string skipped ---
// Cleaned up duplicate block: // --- Duplicate to_record skipped ---
const parse_json_payload = (raw: unknown): Record<string, unknown> | null => {
  if (!raw) {
    return null;
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
};

// Cleaned up duplicate block: // --- Duplicate to_number skipped ---
// Cleaned up duplicate block: // --- Duplicate to_percent_number skipped ---
const extract_rows = (raw: unknown): Record<string, unknown>[] => {
  if (Array.isArray(raw)) {
    return raw.map((entry) => to_record(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
  const root = to_record(raw);
  if (!root) {
    return [];
  }
  if (get_string(root.keyword) || get_string(root.phrase) || get_string(root.query)) {
    return [root];
  }
  const collections = [
    root.data,
    root.output,
    root.result,
    root.payload,
    root.items,
    root.results,
    root.keywords,
    root.organic_keywords,
    root.organic,
    root.rows,
    root.records,
  ];
  for (const collection of collections) {
    if (typeof collection === 'string') {
      const parsed = parse_json_payload(collection);
      if (parsed) {
        const nested = extract_rows(parsed);
        if (nested.length) {
          return nested;
        }
      }
    }
    if (Array.isArray(collection)) {
      return collection
        .map((entry) => to_record(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
    const as_record = to_record(collection);
    if (as_record) {
      const nested = extract_rows(as_record);
      if (nested.length) {
        return nested;
      }
    }
  }
  return [];
};

const to_metric = (entry: Record<string, unknown>): SemrushKeywordMetric | null => {
  const keyword = get_string(entry.keyword) ?? get_string(entry.phrase) ?? get_string(entry.query);
  if (!keyword) {
    return null;
  }
  return {
    keyword,
    position: to_number(entry.position),
    traffic: to_number(entry.traffic),
    traffic_percent: to_percent_number(entry.traffic_percent ?? entry.trafficPercent),
    volume: to_number(entry.volume),
    keyword_difficulty: to_number(entry.keyword_difficulty ?? entry.keywordDifficulty),
    url: get_string(entry.url),
  };
};

const build_summary = (site_name: string, metrics: SemrushKeywordMetric[]): string => {
  if (!metrics.length) {
    return `No Ahrefs keyword metrics returned for ${site_name}.`;
  }
  const lines = metrics.slice(0, 3).map((item: any) => {
    const parts = [
      item.traffic_percent !== undefined ? `${item.traffic_percent.toFixed(2)}% share` : undefined,
      item.volume !== undefined ? `vol ${Math.round(item.volume)}` : undefined,
      item.keyword_difficulty !== undefined ? `kd ${Math.round(item.keyword_difficulty)}` : undefined,
    ].filter((part): part is string => Boolean(part));
    return `${item.keyword}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  });
  return `Top keywords sorted by traffic share: ${lines.join('; ')}`;
};

const fetch_metrics = async (params: {
  ahrefs_url: string;
  site_name: string;
  site_url?: string;
  seed_keyword?: string;
}): Promise<SemrushKeywordMetric[]> => {
  let domain: string | undefined = undefined;
  if (params.site_url) {
    try {
      domain = new URL(params.site_url).hostname.replace(/^www\./, '');
    } catch {
      domain = undefined;
    }
  } else if (is_probable_domain(params.site_name)) {
    domain = params.site_name.trim().replace(/^www\./, '');
  }
  if (!domain) {
    return [];
  }

  const ahrefs_url = new URL(params.ahrefs_url);
  ahrefs_url.searchParams.set('domain', domain);
  ahrefs_url.searchParams.set('target', domain);
  ahrefs_url.searchParams.set('mode', 'domain');
  ahrefs_url.searchParams.set('site_name', params.site_name);
  if (params.site_url) {
    ahrefs_url.searchParams.set('site_url', params.site_url);
    ahrefs_url.searchParams.set('url', params.site_url);
  }
  if (params.seed_keyword) {
    ahrefs_url.searchParams.set('query', params.seed_keyword);
    ahrefs_url.searchParams.set('keyword', params.seed_keyword);
  }

  const response = await fetch(ahrefs_url.toString(), { method: 'GET' });
  if (!response.ok) {
    return [];
  }

  const raw_text = await response.text();
  let raw: unknown = null;
  try {
    raw = JSON.parse(raw_text) as unknown;
  } catch {
    return [];
  }

  return extract_rows(raw)
    .map((entry) => to_metric(entry))
    .filter((entry): entry is SemrushKeywordMetric => Boolean(entry))
    .sort((a, b) => {
      const traffic_share = (b.traffic_percent ?? 0) - (a.traffic_percent ?? 0);
      if (traffic_share !== 0) {
        return traffic_share;
      }
      const traffic = (b.traffic ?? 0) - (a.traffic ?? 0);
      if (traffic !== 0) {
        return traffic;
      }
      return (b.volume ?? 0) - (a.volume ?? 0);
    });
};

export const fetch_ahrefs_site_insights = async (params: {
  ahrefs_url: string;
  sites: SemrushSiteInput[];
  latest_prompt?: string;
}): Promise<SemrushSiteInsightResult[]> => {
  const unique_sites = params.sites
    .map((item: any) => {
      if (item.site_url) {
        try {
          return {
            ...item,
            normalized_site: new URL(item.site_url).hostname.replace(/^www\./, ''),
          };
        } catch {
          return {
            ...item,
            normalized_site: item.site_name,
          };
        }
      }
      return {
        ...item,
        normalized_site: item.site_name,
      };
    })
    .reduce<Array<{ site_name: string; site_url?: string; normalized_site: string }>>((acc, item) => {
      if (acc.some((existing) => normalize_key(existing.normalized_site) === normalize_key(item.normalized_site))) {
        return acc;
      }
      acc.push(item);
      return acc;
    }, [])
    .slice(0, 10);

  const site_results = await Promise.all(
    unique_sites.map(async (site) => {
      const metrics = await fetch_metrics({
        ahrefs_url: params.ahrefs_url,
        site_name: site.site_name,
        site_url: site.site_url,
        seed_keyword: params.latest_prompt,
      });
      const ranking_keywords = metrics.slice(0, 12).map((metric) => metric.keyword);
      const average_traffic_share =
        metrics.length > 0
          ? metrics.reduce((sum, metric) => sum + (metric.traffic_percent ?? 0), 0) / metrics.length
          : 0;
      const confidence_score = Math.min(0.95, Math.max(0.25, average_traffic_share / 100));

      return {
        source: 'ahrefs',
        site_name: site.site_name,
        site_url: site.site_url ?? metrics.find((metric) => metric.url)?.url,
        ranking_keywords,
        confidence_score,
        summary: build_summary(site.site_name, metrics),
        keyword_metrics: metrics.slice(0, 15),
      } satisfies SemrushSiteInsightResult;
    }),
  );

  return site_results.filter((item) => item.ranking_keywords.length > 0 || item.keyword_metrics.length > 0);
};
// --- Merged from queue/workers/ahrefs.worker.ts ---


export const ahrefs_worker = new Worker<AhrefsInsightsJobPayload, SemrushSiteInsightResult[]>(
  'ahrefs_fetch_queue',
  async (job) => {
    const insights = await fetch_ahrefs_site_insights({
      ahrefs_url: job.data.ahrefs_url,
      sites: job.data.sites,
      latest_prompt: job.data.latest_prompt,
    });
    return insights;
  },
  {
    connection: queue_connection,
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 1000,
    },
  },
);

ahrefs_worker.on('completed', (job) => {
  logger.info(`[queue] ahrefs job completed: ${job.id}`);
});

ahrefs_worker.on('failed', (job, error) => {
  logger.error(`[queue] ahrefs job failed: ${job?.id ?? 'unknown'}`, error);
});
// --- Merged from queue/workers/semrush.client.ts ---

// Cleaned up duplicate block: // --- Duplicate normalize_key skipped ---
// Cleaned up duplicate block: // --- Duplicate is_probable_domain skipped ---
// Cleaned up duplicate block: // --- Duplicate get_string skipped ---
// Cleaned up duplicate block: // --- Duplicate to_record skipped ---
// Cleaned up duplicate block: // --- Duplicate parse_json_payload skipped ---
// Cleaned up duplicate block: // --- Duplicate to_number skipped ---
// Cleaned up duplicate block: // --- Duplicate to_percent_number skipped ---
const extract_semrush_rows = (raw: unknown): Record<string, unknown>[] => {
  if (Array.isArray(raw)) {
    return raw.map((entry) => to_record(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
  const root = to_record(raw);
  if (!root) {
    return [];
  }
  if (get_string(root.keyword) || get_string(root.phrase) || get_string(root.query)) {
    return [root];
  }
  const collections = [
    root.data,
    root.output,
    root.result,
    root.payload,
    root.items,
    root.results,
    root.keywords,
    root.organic_keywords,
    root.organic,
    root.rows,
    root.records,
  ];
  for (const collection of collections) {
    if (typeof collection === 'string') {
      const parsed = parse_json_payload(collection);
      if (parsed) {
        const nested = extract_semrush_rows(parsed);
        if (nested.length) {
          return nested;
        }
      }
    }
    if (Array.isArray(collection)) {
      return collection
        .map((entry) => to_record(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
    const as_record = to_record(collection);
    if (as_record) {
      const nested = extract_semrush_rows(as_record);
      if (nested.length) {
        return nested;
      }
    }
  }
  return [];
};

const to_semrush_metric = (entry: Record<string, unknown>): SemrushKeywordMetric | null => {
  const keyword = get_string(entry.keyword) ?? get_string(entry.phrase) ?? get_string(entry.query);
  if (!keyword) {
    return null;
  }
  return {
    keyword,
    position: to_number(entry.position),
    traffic: to_number(entry.traffic),
    traffic_percent: to_percent_number(entry.traffic_percent ?? entry.trafficPercent),
    volume: to_number(entry.volume),
    keyword_difficulty: to_number(entry.keyword_difficulty ?? entry.keywordDifficulty),
    url: get_string(entry.url),
  };
};

const build_semrush_summary = (site_name: string, metrics: SemrushKeywordMetric[]): string => {
  if (!metrics.length) {
    return `No SEMrush keyword metrics returned for ${site_name}.`;
  }
  const lines = metrics.slice(0, 3).map((item: any) => {
    const parts = [
      item.traffic_percent !== undefined ? `${item.traffic_percent.toFixed(2)}% share` : undefined,
      item.volume !== undefined ? `vol ${Math.round(item.volume)}` : undefined,
      item.keyword_difficulty !== undefined ? `kd ${Math.round(item.keyword_difficulty)}` : undefined,
    ].filter((part): part is string => Boolean(part));
    return `${item.keyword}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  });
  return `Top keywords sorted by traffic share: ${lines.join('; ')}`;
};

const fetch_semrush_metrics_for_site = async (params: {
  semrush_url: string;
  site_name: string;
  site_url?: string;
  seed_keyword?: string;
}): Promise<SemrushKeywordMetric[]> => {
  let domain: string | undefined = undefined;
  if (params.site_url) {
    try {
      domain = new URL(params.site_url).hostname.replace(/^www\./, '');
    } catch {
      domain = undefined;
    }
  } else if (is_probable_domain(params.site_name)) {
    domain = params.site_name.trim().replace(/^www\./, '');
  }

  const semrush_url = new URL(params.semrush_url);
  if (domain) {
    semrush_url.searchParams.set('domain', domain);
  }
  if (params.seed_keyword) {
    semrush_url.searchParams.set('query', params.seed_keyword);
    semrush_url.searchParams.set('keyword', params.seed_keyword);
  }
  semrush_url.searchParams.set('site_name', params.site_name);
  if (params.site_url) {
    semrush_url.searchParams.set('site_url', params.site_url);
    semrush_url.searchParams.set('url', params.site_url);
  }

  const response = await fetch(semrush_url.toString(), {
    method: 'GET',
  });

  if (!response.ok) {
    return [];
  }

  const raw_text = await response.text();
  let raw: unknown = null;
  try {
    raw = JSON.parse(raw_text) as unknown;
  } catch {
    return [];
  }

  return extract_semrush_rows(raw)
    .map((entry) => to_semrush_metric(entry))
    .filter((entry): entry is SemrushKeywordMetric => Boolean(entry))
    .sort((a, b) => {
      const traffic_share = (b.traffic_percent ?? 0) - (a.traffic_percent ?? 0);
      if (traffic_share !== 0) {
        return traffic_share;
      }
      const traffic = (b.traffic ?? 0) - (a.traffic ?? 0);
      if (traffic !== 0) {
        return traffic;
      }
      return (b.volume ?? 0) - (a.volume ?? 0);
    });
};

export const fetch_semrush_site_insights = async (params: {
  semrush_url: string;
  sites: SemrushSiteInput[];
  latest_prompt?: string;
}): Promise<SemrushSiteInsightResult[]> => {
  const unique_sites = params.sites
    .map((item: any) => {
      if (item.site_url) {
        try {
          return {
            ...item,
            normalized_site: new URL(item.site_url).hostname.replace(/^www\./, ''),
          };
        } catch {
          return {
            ...item,
            normalized_site: item.site_name,
          };
        }
      }
      return {
        ...item,
        normalized_site: item.site_name,
      };
    })
    .reduce<Array<{ site_name: string; site_url?: string; normalized_site: string }>>((acc, item) => {
      if (acc.some((existing) => normalize_key(existing.normalized_site) === normalize_key(item.normalized_site))) {
        return acc;
      }
      acc.push(item);
      return acc;
    }, [])
    .slice(0, 10);

  const site_results = await Promise.all(
    unique_sites.map(async (site) => {
      const metrics = await fetch_semrush_metrics_for_site({
        semrush_url: params.semrush_url,
        site_name: site.site_name,
        site_url: site.site_url,
        seed_keyword: params.latest_prompt,
      });
      const ranking_keywords = metrics.slice(0, 12).map((metric) => metric.keyword);
      const average_traffic_share =
        metrics.length > 0
          ? metrics.reduce((sum, metric) => sum + (metric.traffic_percent ?? 0), 0) / metrics.length
          : 0;
      const confidence_score = Math.min(0.95, Math.max(0.25, average_traffic_share / 100));

      return {
        source: 'semrush',
        site_name: site.site_name,
        site_url: site.site_url ?? metrics.find((metric) => metric.url)?.url,
        ranking_keywords,
        confidence_score,
        summary: build_semrush_summary(site.site_name, metrics),
        keyword_metrics: metrics.slice(0, 15),
      } satisfies SemrushSiteInsightResult;
    }),
  );

  return site_results.filter((item) => item.ranking_keywords.length > 0 || item.keyword_metrics.length > 0);
};
// --- Merged from queue/workers/semrush.worker.ts ---


export const semrush_worker = new Worker<SemrushInsightsJobPayload, SemrushSiteInsightResult[]>(
  'semrush_fetch_queue',
  async (job) => {
    const insights = await fetch_semrush_site_insights({
      semrush_url: job.data.semrush_url,
      sites: job.data.sites,
      latest_prompt: job.data.latest_prompt,
    });
    return insights;
  },
  {
    connection: queue_connection,
    concurrency: 2,
    limiter: {
      max: 6,
      duration: 1000,
    },
  },
);

semrush_worker.on('completed', (job) => {
  logger.info(`[queue] semrush job completed: ${job.id}`);
});

semrush_worker.on('failed', (job, error) => {
  logger.error(`[queue] semrush job failed: ${job?.id ?? 'unknown'}`, error);
});
// --- Merged from server.ts ---

const MIN_JWT_SECRET_LENGTH = 32;

const startServer = async () => {
  // ── JWT entropy sanity check ─────────────────────────────────────────────
  if (config.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    logger.warn(
      `[security] JWT_SECRET is too short (${config.JWT_SECRET.length} chars). ` +
      `Use at least ${MIN_JWT_SECRET_LENGTH} random characters in production.`,
    );
  }

  try {
    const app = await loaders();
    init_queue_workers();

    app.listen(config.PORT, () => {
      logger.info(`🚀 Server running on port ${config.PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

void startServer();

// --- Merged from types/cors.d.ts ---
declare module 'cors';
// --- Merged from types/express.d.ts ---

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    tenant_id: string;
    tenant_role?: string;
    app_role?: string;
    needs_password?: boolean;
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      tenant_id: string;
      tenant_role?: string;
      app_role?: string;
      needs_password?: boolean;
    };
  }
}

// --- Merged from utils/bcrypt.ts ---

const SALT_ROUNDS = 10;

export const hashPassword = async (plain: string): Promise<string> => {
  return bcrypt.hash(plain, SALT_ROUNDS);
};

export const comparePassword = async (plain: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(plain, hash);
};


// --- Merged from utils/logger.ts ---
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// Cleaned up duplicate block: // --- Duplicate IS_PRODUCTION skipped ---
// Cleaned up duplicate block: // --- Duplicate PII_KEYS skipped ---
function scrubPIIMeta(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj instanceof Error) {
    return { name: obj.name, message: obj.message, stack: obj.stack };
  }
  const scrubbed = { ...obj as Record<string, unknown> };
  for (const [key, value] of Object.entries(scrubbed)) {
    if (PII_KEYS.some(pii => key.toLowerCase().includes(pii))) {
      scrubbed[key] = '[SCRUBBED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      scrubbed[key] = scrubPIIMeta(value);
    }
  }
  return scrubbed;
}

const log = (level: LogLevel, message: string, meta?: unknown): void => {
  const ts = new Date().toISOString();
  const safeMeta = meta !== undefined ? scrubPIIMeta(meta) : undefined;

  if (IS_PRODUCTION) {
    // Newline-delimited JSON — suitable for log aggregators (Datadog, CloudWatch, etc.)
    const entry: Record<string, unknown> = { level, ts, message };
    if (safeMeta !== undefined) {
      entry['meta'] = safeMeta;
    }
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](JSON.stringify(entry));
    return;
  }

  // Development: human-readable pretty output
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (safeMeta !== undefined) {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, message, safeMeta);
  } else {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, message);
  }
};

export const logger = {
  info: (message: string, meta?: unknown): void => log('info', message, meta),
  warn: (message: string, meta?: unknown): void => log('warn', message, meta),
  error: (message: string, meta?: unknown): void => log('error', message, meta),
  debug: (message: string, meta?: unknown): void => log('debug', message, meta),
};


// --- Merged from utils/prisma.ts ---

export const prisma = new PrismaClient();

const shutdown = async () => {
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);


// --- Merged from utils/telemetry.ts ---
/**
 * Telemetry — thin typed event wrapper around the logger.
 *
 * Keep event names stable. All consumers should import the EVENT_* constants
 * rather than inlining raw strings, so renames stay in one place.
 */

// ─── Stable event name constants ────────────────────────────────────────────

/** Prompt suggestion pipeline */
export const EVENT_PROMPT_RUN_STARTED = 'prompt.run.started';
export const EVENT_PROMPT_RUN_COMPLETED = 'prompt.run.completed';
export const EVENT_PROMPT_RUN_FAILED = 'prompt.run.failed';

/** SEMrush webhook fetch */
export const EVENT_SEMRUSH_FETCH_STARTED = 'semrush.fetch.started';
export const EVENT_SEMRUSH_FETCH_COMPLETED = 'semrush.fetch.completed';
export const EVENT_SEMRUSH_FETCH_FAILED = 'semrush.fetch.failed';

/** OpenAI API call */
export const EVENT_OPENAI_REQUEST_STARTED = 'openai.request.started';
export const EVENT_OPENAI_REQUEST_COMPLETED = 'openai.request.completed';
export const EVENT_OPENAI_REQUEST_FAILED = 'openai.request.failed';

/** Capture session / turn ingestion */
export const EVENT_INGEST_TURN_RECEIVED = 'ingest.turn.received';
export const EVENT_INGEST_TURN_STORED = 'ingest.turn.stored';

// ─── Payload shapes ──────────────────────────────────────────────────────────

export interface TrackMeta {
    event: string;
    project_id?: string;
    user_id?: string;
    provider?: string;
    model?: string;
    duration_ms?: number;
    status_code?: number;
    error_code?: string;
    error_message?: string;
    [key: string]: unknown;
}

// ─── track() helper ──────────────────────────────────────────────────────────

/**
 * Emit a structured telemetry event through the logger.
 * Uses `logger.info` for success events, `logger.warn` for failures.
 */
export const track = (meta: TrackMeta): void => {
    const { event, error_code, error_message, ...rest } = meta;
    const is_error = Boolean(error_code ?? error_message);

    const payload: Record<string, unknown> = {
        telemetry: true,
        event,
        ...rest,
    };

    if (error_code) payload['error_code'] = error_code;
    if (error_message) payload['error_message'] = error_message;

    if (is_error) {
        logger.warn(`[telemetry] ${event}`, payload);
    } else {
        logger.info(`[telemetry] ${event}`, payload);
    }
};

// ─── Timer utility ───────────────────────────────────────────────────────────

/** Returns a function that, when called, gives elapsed ms since `startTimer()`. */
export const startTimer = (): (() => number) => {
    const t = Date.now();
    return () => Date.now() - t;
};
// --- Merged from utils/tokens.ts ---

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('hex');

export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');