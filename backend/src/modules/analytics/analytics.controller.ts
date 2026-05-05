import { Router, Request, Response, RequestHandler } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { AuthenticatedRequest } from '../../types/express';
import { analyticsService } from './analytics.service';
import { analyticsEventSchema } from './dto/analytics.dto';

const router = Router();

const trackEvent: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const user = authReq.user;
        if (!user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const parseResult = analyticsEventSchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({ error: 'Invalid event payload', details: parseResult.error.format() });
            return;
        }

        const result = await analyticsService.trackEvent(user.tenant_id, user.id, parseResult.data);
        res.status(201).json(result);
    } catch (error: any) {
        console.error('[AnalyticsController] trackEvent Error:', error);
        res.status(500).json({ error: 'Internal server error tracking event' });
    }
};

const cleanupOldEvents: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const days = Number(req.query.days) || 90;
        const result = await analyticsService.deleteOldEvents(days);
        res.status(200).json({ success: true, ...result });
    } catch (error: any) {
        console.error('[AnalyticsController] cleanupOldEvents Error:', error);
        res.status(500).json({ error: 'Internal server error cleaning up events' });
    }
};

// ── Admin-only aggregate endpoints ──────────────────────────────
const adminStats: RequestHandler = async (_req: Request, res: Response): Promise<void> => {
    const data = await analyticsService.getAdminStats();
    res.json({ success: true, data });
};

const adminListUsers: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const segment = typeof req.query.segment === 'string' ? req.query.segment : undefined;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const data = await analyticsService.listUsers({ search, segment, limit, offset });
    res.json({ success: true, data });
};

const adminListEvents: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    const event_name = typeof req.query.event_name === 'string' ? req.query.event_name : undefined;
    const user_id = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const data = await analyticsService.listEvents({ event_name, user_id, limit, offset });
    res.json({ success: true, data });
};

const adminListSignals: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    const signal_type = typeof req.query.signal_type === 'string' ? req.query.signal_type : undefined;
    const user_id = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const data = await analyticsService.listLeadSignals({ signal_type, user_id, limit, offset });
    res.json({ success: true, data });
};

router.post('/events', authMiddleware, trackEvent);
router.post('/cleanup', authMiddleware, requireRole('admin'), cleanupOldEvents);
router.get('/admin/stats', authMiddleware, requireRole('admin'), adminStats);
router.get('/admin/users', authMiddleware, requireRole('admin'), adminListUsers);
router.get('/admin/events', authMiddleware, requireRole('admin'), adminListEvents);
router.get('/admin/signals', authMiddleware, requireRole('admin'), adminListSignals);

export const analyticsRouter = router;
