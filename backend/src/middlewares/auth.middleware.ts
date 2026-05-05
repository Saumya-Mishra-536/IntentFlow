import { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';

import config from '../config';
import { HttpException } from '../core/http-exception';
import { AuthenticatedRequest } from '../types/express';
import { logger } from '../utils/logger';

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
