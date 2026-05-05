import { Worker } from 'bullmq';

import { logger } from '../../utils/logger';
import { queue_connection } from '../connection';
import { SemrushInsightsJobPayload, SemrushSiteInsightResult } from '../semrush.types';
import { fetch_semrush_site_insights } from './semrush.client';

export const semrush_worker = new Worker<SemrushInsightsJobPayload, SemrushSiteInsightResult[]>(
  'semrush_fetch_queue',
  async (job) => {
    const insights = await fetch_semrush_site_insights({
      semrush_url: job.data.semrush_url,
      sites: job.data.sites,
      latest_prompt: job.data.latest_prompt,
    });
    return insights;
  },
  {
    connection: queue_connection,
    concurrency: 2,
    limiter: {
      max: 6,
      duration: 1000,
    },
  },
);

semrush_worker.on('completed', (job) => {
  logger.info(`[queue] semrush job completed: ${job.id}`);
});

semrush_worker.on('failed', (job, error) => {
  logger.error(`[queue] semrush job failed: ${job?.id ?? 'unknown'}`, error);
});
