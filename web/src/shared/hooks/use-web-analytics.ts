import { useEffect, useRef } from 'react';
import { analytics_api } from '../lib/analytics';
import { auth_storage } from '../lib/auth';

export function useWebAnalytics() {
    const sessionStartTime = useRef<number>(Date.now());
    const isFocused = useRef<boolean>(document.hasFocus());

    useEffect(() => {
        const handleFocus = () => {
            if (!isFocused.current) {
                isFocused.current = true;
                sessionStartTime.current = Date.now();
            }
        };

        const handleBlur = () => {
            if (isFocused.current) {
                isFocused.current = false;
                const duration = Math.round((Date.now() - sessionStartTime.current) / 1000); // seconds
                if (duration > 0 && auth_storage.get_access_token()) {
                    analytics_api.track_event({
                        event_name: 'web_session_duration',
                        properties: { duration_seconds: duration }
                    }).catch(err => console.debug('[AI-SEO] Failed to track web session duration:', err));
                }
            }
        };

        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const anchor = target.closest('a');
            if (anchor && anchor.href && anchor.href.startsWith('http') && !anchor.href.startsWith(window.location.origin)) {
                if (auth_storage.get_access_token()) {
                    analytics_api.track_event({
                        event_name: 'click_through_link',
                        properties: { url: anchor.href }
                    }).catch(() => { });
                }
            }
        };

        window.addEventListener('focus', handleFocus);
        window.addEventListener('blur', handleBlur);
        window.addEventListener('beforeunload', handleBlur);
        document.addEventListener('click', handleClick);

        return () => {
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('beforeunload', handleBlur);
            document.removeEventListener('click', handleClick);
        };
    }, []);
}
