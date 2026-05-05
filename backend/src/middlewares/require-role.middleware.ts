import { Request, Response, NextFunction } from 'express';
import { AppRole } from '@prisma/client';
import { AuthenticatedRequest } from '../types/express';

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
