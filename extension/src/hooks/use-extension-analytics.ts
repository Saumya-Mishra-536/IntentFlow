import { useEffect, useRef } from 'react';
import { analytics_api } from '../lib/api';
import { extension_auth } from '../lib/auth';

export function useExtensionAnalytics() {
    const sessionStartTime = useRef<number>(Date.now());
    const isFocused = useRef<boolean>(document.hasFocus());

    useEffect(() => {
        // Determine active status on mount
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
                if (duration > 0 && extension_auth.get_auth_status()) {
                    analytics_api.track_event({
                        event_name: 'extension_session_duration',
                        properties: { duration_seconds: duration }
                    }).catch(err => console.debug('[AI-SEO] Failed to track session duration:', err));
                }
            }
        };

        window.addEventListener('focus', handleFocus);
        window.addEventListener('blur', handleBlur);
        // Track unload as blur equivalent
        window.addEventListener('beforeunload', handleBlur);

        return () => {
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('beforeunload', handleBlur);
        };
    }, []);
}
