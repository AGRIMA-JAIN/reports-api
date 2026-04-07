// src/jobs/jobQueue.ts

import { v4 as uuidv4 } from 'uuid';
import { store } from '../models/store';
import { Job, JobType } from '../types';
import { logger } from '../utils/logger';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000; 

// ── Job handlers 

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const handlers: Record<JobType, Handler> = {
  'report.created.notify': async (payload) => {
    // Simulate sending an email notification to the author
    logger.info('job:notify', {
      message: `[NOTIFY] Report "${payload.slug}" created by author ${payload.authorId}. Email would be sent here.`,
      reportId: payload.reportId,
    });
  
  },

  'report.created.index': async (payload) => {
    // Simulate pushing the report to a search index (e.g. Elasticsearch)
    logger.info('job:index', {
      message: `[INDEX] Indexing report "${payload.slug}" into search layer.`,
      reportId: payload.reportId,
    });
  },
};

// ── Public API

export function enqueue(type: JobType, payload: Record<string, unknown>): Job {
  const job: Job = {
    id: uuidv4(),
    type,
    payload,
    status: 'queued',
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextRunAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.enqueueJob(job);
  logger.info('job:enqueued', { jobId: job.id, type });
  return job;
}

// ── Worker loop 

async function processJob(job: Job): Promise<void> {
  const handler = handlers[job.type];
  if (!handler) {
    logger.error('job:unknown_type', { jobId: job.id, type: job.type });
    job.status = 'dead';
    job.updatedAt = new Date().toISOString();
    store.updateJob(job);
    return;
  }

  job.status = 'processing';
  job.attempts += 1;
  job.updatedAt = new Date().toISOString();
  store.updateJob(job);

  try {
    await handler(job.payload);
    job.status = 'done';
    logger.info('job:done', { jobId: job.id, type: job.type, attempts: job.attempts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.lastError = msg;
    logger.warn('job:failed', { jobId: job.id, type: job.type, attempt: job.attempts, error: msg });

    if (job.attempts >= job.maxAttempts) {
      // Dead-letter: mark for manual inspection / compensating action
      job.status = 'dead';
      logger.error('job:dead_letter', { jobId: job.id, type: job.type, payload: job.payload });
    
    } else {
      // Exponential back-off: 1s, 2s, 4s, 8s, 16s
      const delayMs = BASE_DELAY_MS * Math.pow(2, job.attempts - 1);
      job.status = 'queued';
      job.nextRunAt = new Date(Date.now() + delayMs).toISOString();
      logger.info('job:retry_scheduled', { jobId: job.id, delayMs, nextRunAt: job.nextRunAt });
    }
  }

  job.updatedAt = new Date().toISOString();
  store.updateJob(job);
}

export function startWorker(intervalMs = 2_000): NodeJS.Timeout {
  logger.info('job:worker_started', { intervalMs });
  return setInterval(async () => {
    const pending = store.getPendingJobs();
    for (const job of pending) {
      await processJob(job);
    }
  }, intervalMs);
}

export let workerHandle: NodeJS.Timeout | null = null;

export function startWorkerTracked(intervalMs = 2_000): NodeJS.Timeout {
  workerHandle = startWorker(intervalMs);
  return workerHandle;
}
