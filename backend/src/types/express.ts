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
