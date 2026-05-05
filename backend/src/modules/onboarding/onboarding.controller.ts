import { Response } from 'express';

import { ApiResponse } from '../../core/api-response';
import { BaseController } from '../../core/controller';
import { HttpException } from '../../core/http-exception';
import { AuthenticatedRequest } from '../../types/express';
import { bootstrapOnboardingSchema } from './dto/bootstrap-onboarding.dto';
import { OnboardingService, onboardingService } from './onboarding.service';

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
