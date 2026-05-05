import dotenv from 'dotenv';

dotenv.config();

const getEnv = (key: string, defaultValue?: string): string => {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
};

export const PORT = parseInt(getEnv('PORT', '4000'), 10);
export const NODE_ENV = getEnv('NODE_ENV', 'development');
export const DATABASE_URL = getEnv('DATABASE_URL', '');
export const JWT_SECRET = getEnv('JWT_SECRET', 'changeme');
export const JWT_ACCESS_TTL = getEnv('JWT_ACCESS_TTL', '1h');
export const JWT_REFRESH_TTL_DAYS = parseInt(getEnv('JWT_REFRESH_TTL_DAYS', '30'), 10);
export const GOOGLE_CLIENT_ID = getEnv('GOOGLE_CLIENT_ID', '');
export const GOOGLE_CLIENT_SECRET = getEnv('GOOGLE_CLIENT_SECRET', '');
export const GOOGLE_REDIRECT_URI = getEnv('GOOGLE_REDIRECT_URI', '');
export const OAUTH_DEFAULT_EXTENSION_REDIRECT_URI = getEnv('OAUTH_DEFAULT_EXTENSION_REDIRECT_URI', '');
export const CORS_ALLOWED_ORIGINS = getEnv(
  'CORS_ALLOWED_ORIGINS',
  'http://localhost:5173,https://ai-seo-monorepo.vercel.app',
);
export const REQUEST_BODY_LIMIT = getEnv('REQUEST_BODY_LIMIT', '2mb');
export const OPENAI_API_KEY = getEnv('OPENAI_API_KEY', '');
export const OPENAI_MODEL = getEnv('OPENAI_MODEL', 'gpt-4o-mini');
export const SEMRUSH_URL = getEnv('SEMRUSH_URL', '');
export const SEMRUSH_LOG_FULL_RESPONSE = getEnv('SEMRUSH_LOG_FULL_RESPONSE', 'false');
export const AHREFS_URL = getEnv('AHREFS_URL', '');
export const REDIS_URL = getEnv('REDIS_URL', 'redis://127.0.0.1:6379');
