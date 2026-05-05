import { Request } from 'express';

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

