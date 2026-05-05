import { logger } from '../utils/logger';

let queue_workers_initialized = false;

export const init_queue_workers = () => {
  if (queue_workers_initialized) {
    return;
  }
  queue_workers_initialized = true;
  logger.info('[queue] workers disabled (Redis not available)');
  // Workers are skipped — Redis is not running locally.
};
