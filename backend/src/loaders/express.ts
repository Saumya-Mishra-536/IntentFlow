import cors from 'cors';
import express, { Application } from 'express';
import helmet from 'helmet';

import config from '../config';
import authRoutes from '../modules/auth/auth.routes';
import exampleRoutes from '../modules/example/example.routes';
import onboardingRoutes from '../modules/onboarding/onboarding.routes';
import { campaignRouter } from '../modules/campaign/campaign.routes';
import { workspaceWorkflowRouter } from '../modules/campaign/workspace.routes';
import { analyticsRouter } from '../modules/analytics/analytics.controller';
import { rolesRouter } from '../modules/auth/roles.controller';
import accountRoutes from '../modules/account/account.routes';
import domainRoutes from '../modules/domain/domain.routes';
import userRoutes from '../modules/user/user.routes';
import { errorMiddleware } from '../middlewares/error.middleware';
import { requestLoggerMiddleware } from '../middlewares/request-logger.middleware';
import { logger } from '../utils/logger';

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
  app.use('/api/auth', authRoutes);
  app.use('/api/onboarding', onboardingRoutes);
  app.use('/api/example', exampleRoutes);
  app.use('/api/campaigns', campaignRouter);
  app.use('/api/workspaces', workspaceWorkflowRouter);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/domains', domainRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/admin/users', rolesRouter);
  app.use('/api/analytics', analyticsRouter);

  // Error middleware must be registered last
  app.use(errorMiddleware);
};

export default expressLoader;
