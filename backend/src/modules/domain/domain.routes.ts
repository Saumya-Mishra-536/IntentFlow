import { Router } from 'express';

import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAccountRole } from '../../middlewares/require-account-role.middleware';
import { domainController } from './domain.controller';

const router = Router();

router.get('/', authMiddleware, domainController.listDomains);
router.post('/', authMiddleware, requireAccountRole(['owner', 'admin']), domainController.createDomain);
router.get('/:domain_id/context', authMiddleware, domainController.getDomainContext);
router.post('/:domain_id/rescrape', authMiddleware, requireAccountRole(['owner', 'admin']), domainController.rescrapeDomain);

export default router;
