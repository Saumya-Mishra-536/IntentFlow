import config from './config';
import loaders from './loaders';
import { init_queue_workers } from './queue';
import { logger } from './utils/logger';

const MIN_JWT_SECRET_LENGTH = 32;

const startServer = async () => {
  // ── JWT entropy sanity check ─────────────────────────────────────────────
  if (config.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    logger.warn(
      `[security] JWT_SECRET is too short (${config.JWT_SECRET.length} chars). ` +
      `Use at least ${MIN_JWT_SECRET_LENGTH} random characters in production.`,
    );
  }

  try {
    const app = await loaders();
    init_queue_workers();

    app.listen(config.PORT, () => {
      logger.info(`🚀 Server running on port ${config.PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

void startServer();

