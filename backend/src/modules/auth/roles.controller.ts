import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { prisma } from '../../utils/prisma';
import { AppRole } from '@prisma/client';

const router = Router();

router.post('/:userId/role', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId } = req.params;
        const { role } = req.body;

        if (!role || !['admin', 'user'].includes(role)) {
            res.status(400).json({ error: 'Invalid role provided. Must be admin or user.' });
            return;
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { app_role: role as AppRole },
        });

        res.json({ message: 'Role updated successfully', user: { id: updatedUser.id, role: updatedUser.app_role } });
    } catch (error) {
        console.error('[RolesController] Update role error:', error);
        res.status(500).json({ error: 'Internal server error resolving role assignment' });
    }
});

export const rolesRouter = router;
