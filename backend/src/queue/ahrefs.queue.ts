import { createHash } from 'crypto';

import { Job, JobsOptions, Queue, QueueEvents } from 'bullmq';

import { queue_connection } from './connection';
import { AhrefsInsightsJobPayload, SemrushSiteInsightResult } from './semrush.types';

const ahrefs_queue_name = 'ahrefs_fetch_queue';

const default_job_options: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2500,
  },
  removeOnComplete: 200,
  removeOnFail: 200,
};

export const ahrefs_fetch_queue = new Queue<AhrefsInsightsJobPayload, SemrushSiteInsightResult[]>(ahrefs_queue_name, {
  connection: queue_connection,
  defaultJobOptions: default_job_options,
});

export const ahrefs_queue_events = new QueueEvents(ahrefs_queue_name, {
  connection: queue_connection,
});

const build_job_id = (payload: AhrefsInsightsJobPayload): string => {
  const hash_input = JSON.stringify({
    tenant_id: payload.tenant_id,
    project_id: payload.project_id,
    generation_run_id: payload.generation_run_id,
    ahrefs_url: payload.ahrefs_url,
    latest_prompt: payload.latest_prompt ?? '',
    sites: payload.sites,
  });
  const digest = createHash('sha256').update(hash_input).digest('hex').slice(0, 24);
  return `ahrefs:${payload.tenant_id}:${payload.project_id}:${digest}`;
};

export const enqueue_ahrefs_job = async (payload: AhrefsInsightsJobPayload): Promise<Job> => {
  const job_id = build_job_id(payload);
  const existing = await ahrefs_fetch_queue.getJob(job_id);
  if (existing) {
    return existing as Job;
  }
  return ahrefs_fetch_queue.add('ahrefs_fetch_insights', payload, { jobId: job_id }) as Promise<Job>;
};

export const wait_for_ahrefs_job = async (job: Job): Promise<SemrushSiteInsightResult[]> => {
  await ahrefs_queue_events.waitUntilReady();
  const result = await job.waitUntilFinished(ahrefs_queue_events, 90_000) as unknown;
  return Array.isArray(result) ? (result as SemrushSiteInsightResult[]) : [];
};
