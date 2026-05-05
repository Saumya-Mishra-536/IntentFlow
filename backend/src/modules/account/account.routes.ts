import { Router } from 'express';

import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireAccountRole } from '../../middlewares/require-account-role.middleware';
import { accountController } from './account.controller';

const router = Router();

router.get('/memberships', authMiddleware, accountController.listMemberships);
router.post('/join-requests', authMiddleware, accountController.createJoinRequest);
router.get('/join-requests', authMiddleware, requireAccountRole(['owner', 'admin']), accountController.listJoinRequests);
router.post('/join-requests/:request_id/approve', authMiddleware, requireAccountRole(['owner', 'admin']), accountController.approveJoinRequest);
router.post('/join-requests/:request_id/reject', authMiddleware, requireAccountRole(['owner', 'admin']), accountController.rejectJoinRequest);

export default router;
