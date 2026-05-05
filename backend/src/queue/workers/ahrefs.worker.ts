import { Worker } from 'bullmq';

import { logger } from '../../utils/logger';
import { queue_connection } from '../connection';
import { AhrefsInsightsJobPayload, SemrushSiteInsightResult } from '../semrush.types';
import { fetch_ahrefs_site_insights } from './ahrefs.client';

export const ahrefs_worker = new Worker<AhrefsInsightsJobPayload, SemrushSiteInsightResult[]>(
  'ahrefs_fetch_queue',
  async (job) => {
    const insights = await fetch_ahrefs_site_insights({
      ahrefs_url: job.data.ahrefs_url,
      sites: job.data.sites,
      latest_prompt: job.data.latest_prompt,
    });
    return insights;
  },
  {
    connection: queue_connection,
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 1000,
    },
  },
);

ahrefs_worker.on('completed', (job) => {
  logger.info(`[queue] ahrefs job completed: ${job.id}`);
});

ahrefs_worker.on('failed', (job, error) => {
  logger.error(`[queue] ahrefs job failed: ${job?.id ?? 'unknown'}`, error);
});
