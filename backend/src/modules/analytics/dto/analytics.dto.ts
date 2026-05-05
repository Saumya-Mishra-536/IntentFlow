import { z } from 'zod';

export const analyticsEventSchema = z.object({
    event_name: z.enum([
        'extension_installed',
        'first_campaign_created',
        'click_through_link',
        'session_duration',
        'extension_session_duration',
        'web_session_duration',
        'tab_active_time',
        'focus_blur_events',
        // add more from taxonomy as needed
    ]),
    campaign_id: z.string().optional(),
    session_id: z.string().optional(),
    properties: z.record(z.any()).default({}),
});

export type AnalyticsEventDto = z.infer<typeof analyticsEventSchema>;
