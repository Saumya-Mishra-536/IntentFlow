type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

const PII_KEYS = ['email', 'password', 'token', 'authorization', 'secret', 'phone', 'ssn', 'address'];

function scrubPIIMeta(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj instanceof Error) {
    return { name: obj.name, message: obj.message, stack: obj.stack };
  }
  const scrubbed = { ...obj as Record<string, unknown> };
  for (const [key, value] of Object.entries(scrubbed)) {
    if (PII_KEYS.some(pii => key.toLowerCase().includes(pii))) {
      scrubbed[key] = '[SCRUBBED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      scrubbed[key] = scrubPIIMeta(value);
    }
  }
  return scrubbed;
}

const log = (level: LogLevel, message: string, meta?: unknown): void => {
  const ts = new Date().toISOString();
  const safeMeta = meta !== undefined ? scrubPIIMeta(meta) : undefined;

  if (IS_PRODUCTION) {
    // Newline-delimited JSON — suitable for log aggregators (Datadog, CloudWatch, etc.)
    const entry: Record<string, unknown> = { level, ts, message };
    if (safeMeta !== undefined) {
      entry['meta'] = safeMeta;
    }
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](JSON.stringify(entry));
    return;
  }

  // Development: human-readable pretty output
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (safeMeta !== undefined) {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, message, safeMeta);
  } else {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](prefix, message);
  }
};

export const logger = {
  info: (message: string, meta?: unknown): void => log('info', message, meta),
  warn: (message: string, meta?: unknown): void => log('warn', message, meta),
  error: (message: string, meta?: unknown): void => log('error', message, meta),
  debug: (message: string, meta?: unknown): void => log('debug', message, meta),
};


