import { Response } from 'express';

import { ApiResponse } from '../../core/api-response';
import { HttpException } from '../../core/http-exception';
import { AuthenticatedRequest } from '../../types/express';
import { createJoinRequestSchema } from './dto/create-join-request.dto';
import { accountService, AccountService } from './account.service';

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
