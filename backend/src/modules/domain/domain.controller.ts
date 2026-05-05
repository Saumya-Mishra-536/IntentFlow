import { Response } from 'express';

import { ApiResponse } from '../../core/api-response';
import { HttpException } from '../../core/http-exception';
import { AuthenticatedRequest } from '../../types/express';
import { createDomainSchema } from './dto/create-domain.dto';
import { domainService, DomainService } from './domain.service';

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
