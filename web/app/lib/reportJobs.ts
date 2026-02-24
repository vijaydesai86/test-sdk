import crypto from 'crypto';

export type ReportJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ReportJob {
  id: string;
  type: 'sector';
  status: ReportJobStatus;
  createdAt: number;
  updatedAt: number;
  filename?: string;
  downloadUrl?: string;
  error?: string;
}

const jobs = new Map<string, ReportJob>();
const JOB_TTL_MS = 30 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

export function createReportJob(type: ReportJob['type']): ReportJob {
  cleanup();
  const id = crypto.randomUUID();
  const job: ReportJob = {
    id,
    type,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

export function updateReportJob(id: string, updates: Partial<ReportJob>): ReportJob | null {
  const job = jobs.get(id);
  if (!job) return null;
  const next = { ...job, ...updates, updatedAt: Date.now() };
  jobs.set(id, next);
  return next;
}

export function getReportJob(id: string): ReportJob | null {
  cleanup();
  return jobs.get(id) || null;
}
