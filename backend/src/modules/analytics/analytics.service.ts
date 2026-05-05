import { prisma } from '../../utils/prisma';
import { AnalyticsEventDto } from './dto/analytics.dto';

const PII_KEYS = ['email', 'password', 'token', 'authorization', 'secret', 'phone', 'ssn', 'address'];

function scrubPII(obj: Record<string, any>): Record<string, any> {
    if (!obj || typeof obj !== 'object') return obj;
    const scrubbed = { ...obj };
    for (const [key, value] of Object.entries(scrubbed)) {
        if (PII_KEYS.some(pii => key.toLowerCase().includes(pii))) {
            scrubbed[key] = '[SCRUBBED]';
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            scrubbed[key] = scrubPII(value);
        }
    }
    return scrubbed;
}

export class AnalyticsService {
    async trackEvent(tenant_id: string, user_id: string, event: AnalyticsEventDto) {
        const safeProperties = scrubPII(event.properties);
        console.log(`[Analytics] Tracked Event: ${event.event_name} by user: ${user_id}`);

        return prisma.analyticsEvent.create({
            data: {
                tenant_id,
                user_id,
                campaign_id: event.campaign_id,
                session_id: event.session_id,
                event_name: event.event_name,
                properties: safeProperties as any,
            },
        });
    }

    async deleteOldEvents(days: number = 90) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        console.log(`[Analytics] Deleting events older than ${cutoffDate.toISOString()}`);

        const result = await prisma.analyticsEvent.deleteMany({
            where: {
                created_at: {
                    lt: cutoffDate,
                },
            },
        });

        console.log(`[Analytics] Deleted ${result.count} old events.`);
        return { count: result.count, cutoff: cutoffDate };
    }

    /** Admin-only: aggregate summary stats */
    async getAdminStats() {
        const [userCount, eventCount, signalCount, campaignCount] = await Promise.all([
            prisma.user.count(),
            prisma.analyticsEvent.count(),
            prisma.leadSignal.count(),
            prisma.campaign.count(),
        ]);
        return { user_count: userCount, event_count: eventCount, signal_count: signalCount, campaign_count: campaignCount };
    }

    /** Admin-only: list all users with lead score + signal count */
    async listUsers(opts: { search?: string; segment?: string; limit?: number; offset?: number }) {
        const { search, segment, limit = 50, offset = 0 } = opts;
        const where: any = {};
        if (search) where.OR = [{ email: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }];
        if (segment) where.lead_segment = segment;

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true, email: true, name: true, app_role: true,
                    created_at: true,
                    lead_score_current: true, lead_segment: true, lead_score_updated_at: true, scoring_model_version: true,
                    company_name: true, company_domain: true, linkedin_url: true, job_role: true,
                    _count: { select: { leadSignals: true } }
                },
                orderBy: { created_at: 'desc' },
                take: limit, skip: offset,
            }),
            prisma.user.count({ where }),
        ]);
        return { users, total };
    }

    /** Admin-only: list analytics events with filters */
    async listEvents(opts: { event_name?: string; user_id?: string; limit?: number; offset?: number }) {
        const { event_name, user_id, limit = 50, offset = 0 } = opts;
        const where: any = {};
        if (event_name) where.event_name = { contains: event_name, mode: 'insensitive' };
        if (user_id) where.user_id = user_id;

        const [events, total] = await Promise.all([
            prisma.analyticsEvent.findMany({
                where,
                include: { user: { select: { email: true, name: true } } },
                orderBy: { created_at: 'desc' },
                take: limit, skip: offset,
            }),
            prisma.analyticsEvent.count({ where }),
        ]);
        return { events, total };
    }

    /** Admin-only: list lead signals */
    async listLeadSignals(opts: { signal_type?: string; user_id?: string; limit?: number; offset?: number }) {
        const { signal_type, user_id, limit = 50, offset = 0 } = opts;
        const where: any = {};
        if (signal_type) where.signal_type = { contains: signal_type, mode: 'insensitive' };
        if (user_id) where.user_id = user_id;

        const [signals, total] = await Promise.all([
            prisma.leadSignal.findMany({
                where,
                include: { user: { select: { email: true, name: true } } },
                orderBy: { created_at: 'desc' },
                take: limit, skip: offset,
            }),
            prisma.leadSignal.count({ where }),
        ]);
        return { signals, total };
    }
}

export const analyticsService = new AnalyticsService();
