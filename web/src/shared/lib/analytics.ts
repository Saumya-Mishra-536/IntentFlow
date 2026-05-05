import { auth_storage } from './auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://ai-seo-monorepo.onrender.com';

export const analytics_api = {
    track_event: async (payload: { event_name: string; properties: Record<string, unknown> }) => {
        const token = auth_storage.get_access_token();
        if (!token) return;

        try {
            await fetch(`${API_BASE_URL}/api/analytics/events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            console.debug('[AI-SEO] analytics tracking failed', err);
        }
    }
};
