import { createHash } from 'crypto';

import { Job, JobsOptions, Queue, QueueEvents } from 'bullmq';

import { queue_connection } from './connection';
import { SemrushInsightsJobPayload, SemrushSiteInsightResult } from './semrush.types';

const semrush_queue_name = 'semrush_fetch_queue';

const default_job_options: JobsOptions = {
  attempts: 4,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: 200,
  removeOnFail: 200,
};

export const semrush_fetch_queue = new Queue<SemrushInsightsJobPayload, SemrushSiteInsightResult[]>(semrush_queue_name, {
  connection: queue_connection,
  defaultJobOptions: default_job_options,
});

export const semrush_queue_events = new QueueEvents(semrush_queue_name, {
  connection: queue_connection,
});

const build_job_id = (payload: SemrushInsightsJobPayload): string => {
  const hash_input = JSON.stringify({
    tenant_id: payload.tenant_id,
    project_id: payload.project_id,
    generation_run_id: payload.generation_run_id,
    semrush_url: payload.semrush_url,
    latest_prompt: payload.latest_prompt ?? '',
    sites: payload.sites,
  });
  const digest = createHash('sha256').update(hash_input).digest('hex').slice(0, 24);
  return `semrush:${payload.tenant_id}:${payload.project_id}:${digest}`;
};

export const enqueue_semrush_job = async (payload: SemrushInsightsJobPayload): Promise<Job> => {
  const job_id = build_job_id(payload);
  const existing = await semrush_fetch_queue.getJob(job_id);
  if (existing) {
    return existing as Job;
  }
  return semrush_fetch_queue.add('semrush_fetch_insights', payload, { jobId: job_id }) as Promise<Job>;
};

export const wait_for_semrush_job = async (job: Job): Promise<SemrushSiteInsightResult[]> => {
  await semrush_queue_events.waitUntilReady();
  const result = await job.waitUntilFinished(semrush_queue_events, 90_000) as unknown;
  return Array.isArray(result) ? (result as SemrushSiteInsightResult[]) : [];
};
