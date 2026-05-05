import { NextFunction, Response } from 'express';

import { HttpException } from '../core/http-exception';
import { AuthenticatedRequest } from '../types/express';

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
