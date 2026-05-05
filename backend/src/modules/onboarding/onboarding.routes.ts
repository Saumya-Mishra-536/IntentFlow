import { Router } from 'express';

import { authMiddleware } from '../../middlewares/auth.middleware';
import { onboardingController } from './onboarding.controller';

const router = Router();

router.get('/context', authMiddleware, onboardingController.getContext);
router.post('/bootstrap', authMiddleware, onboardingController.bootstrap);

export default router;
