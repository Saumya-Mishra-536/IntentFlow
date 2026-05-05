/**
 * Telemetry — thin typed event wrapper around the logger.
 *
 * Keep event names stable. All consumers should import the EVENT_* constants
 * rather than inlining raw strings, so renames stay in one place.
 */
import { logger } from './logger';

// ─── Stable event name constants ────────────────────────────────────────────

/** Prompt suggestion pipeline */
export const EVENT_PROMPT_RUN_STARTED = 'prompt.run.started';
export const EVENT_PROMPT_RUN_COMPLETED = 'prompt.run.completed';
export const EVENT_PROMPT_RUN_FAILED = 'prompt.run.failed';

/** SEMrush webhook fetch */
export const EVENT_SEMRUSH_FETCH_STARTED = 'semrush.fetch.started';
export const EVENT_SEMRUSH_FETCH_COMPLETED = 'semrush.fetch.completed';
export const EVENT_SEMRUSH_FETCH_FAILED = 'semrush.fetch.failed';

/** OpenAI API call */
export const EVENT_OPENAI_REQUEST_STARTED = 'openai.request.started';
export const EVENT_OPENAI_REQUEST_COMPLETED = 'openai.request.completed';
export const EVENT_OPENAI_REQUEST_FAILED = 'openai.request.failed';

/** Capture session / turn ingestion */
export const EVENT_INGEST_TURN_RECEIVED = 'ingest.turn.received';
export const EVENT_INGEST_TURN_STORED = 'ingest.turn.stored';

// ─── Payload shapes ──────────────────────────────────────────────────────────

export interface TrackMeta {
    event: string;
    project_id?: string;
    user_id?: string;
    provider?: string;
    model?: string;
    duration_ms?: number;
    status_code?: number;
    error_code?: string;
    error_message?: string;
    [key: string]: unknown;
}

// ─── track() helper ──────────────────────────────────────────────────────────

/**
 * Emit a structured telemetry event through the logger.
 * Uses `logger.info` for success events, `logger.warn` for failures.
 */
export const track = (meta: TrackMeta): void => {
    const { event, error_code, error_message, ...rest } = meta;
    const is_error = Boolean(error_code ?? error_message);

    const payload: Record<string, unknown> = {
        telemetry: true,
        event,
        ...rest,
    };

    if (error_code) payload['error_code'] = error_code;
    if (error_message) payload['error_message'] = error_message;

    if (is_error) {
        logger.warn(`[telemetry] ${event}`, payload);
    } else {
        logger.info(`[telemetry] ${event}`, payload);
    }
};

// ─── Timer utility ───────────────────────────────────────────────────────────

/** Returns a function that, when called, gives elapsed ms since `startTimer()`. */
export const startTimer = (): (() => number) => {
    const t = Date.now();
    return () => Date.now() - t;
};
