/**
 * JOB MANAGER - In-memory job store for async crawl operations
 *
 * This module manages crawl jobs with:
 * - Job creation and tracking
 * - Status updates (QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED)
 * - Progress tracking
 * - Result storage with pagination support
 * - Automatic cleanup of old jobs
 *
 * Phase 1: In-memory storage (will be upgraded to Redis in Phase 3)
 */

import { v4 as uuidv4 } from 'uuid';
import { CrawlOnlyResult, DiscoveredUrl } from '../services/crawler.js';
import { ScrapedContent } from '../services/scraper.js';
import { ValidationReport } from '../services/validator.js';

/**
 * Job status enum
 */
export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * Job phase for progress tracking
 */
export type JobPhase = 'IDLE' | 'CRAWLING' | 'SCRAPING' | 'VALIDATING' | 'COMPLETED' | 'ERROR';

/**
 * Operation mode (matching existing types)
 */
export type OperationMode = 'CRAWL_ONLY' | 'SCRAPE_ONLY' | 'CRAWL_AND_SCRAPE';

/**
 * Output format (matching existing types)
 */
export type OutputFormat = 'JSON' | 'MARKDOWN' | 'SUMMARY' | 'LINKS_ONLY' | 'HTML';

/**
 * Job configuration
 */
export interface JobConfig {
  seedUrl: string;
  includeSubpages: boolean;
  maxDepth: number;
  operationMode: OperationMode;
  outputFormat: OutputFormat;
  universityName?: string; // Optional university name for organized output
}

/**
 * Job progress information
 */
export interface JobProgress {
  phase: JobPhase;
  crawl: {
    completed: number;
    total: number;
    percent: number;
  };
  scrape: {
    completed: number;
    total: number;
    percent: number;
  };
  overall: number;
  eta: number | null; // seconds remaining
  startedAt: string | null;
  updatedAt: string;
}

/**
 * Job results
 */
export interface JobResults {
  crawlOutput: CrawlOnlyResult | null;
  scrapeOutput: ScrapedContent[] | null;
  validation: ValidationReport | null;
}

/**
 * Complete job record
 */
export interface Job {
  id: string;
  config: JobConfig;
  status: JobStatus;
  progress: JobProgress;
  results: JobResults;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Paginated results response
 */
export interface PaginatedResults<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * In-memory job store
 */
const jobStore = new Map<string, Job>();

/**
 * Job cleanup interval (1 hour)
 */
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Create a new job
 */
export function createJob(config: JobConfig): Job {
  const jobId = uuidv4();
  const now = new Date().toISOString();

  const job: Job = {
    id: jobId,
    config,
    status: 'QUEUED',
    progress: {
      phase: 'IDLE',
      crawl: { completed: 0, total: 0, percent: 0 },
      scrape: { completed: 0, total: 0, percent: 0 },
      overall: 0,
      eta: null,
      startedAt: null,
      updatedAt: now,
    },
    results: {
      crawlOutput: null,
      scrapeOutput: null,
      validation: null,
    },
    error: null,
    createdAt: now,
    completedAt: null,
  };

  jobStore.set(jobId, job);
  console.log(`[JOB MANAGER] Created job ${jobId} for ${config.seedUrl}`);

  return job;
}

/**
 * Get a job by ID
 */
export function getJob(jobId: string): Job | null {
  return jobStore.get(jobId) || null;
}

/**
 * Get all jobs (with optional filtering)
 */
export function getAllJobs(status?: JobStatus): Job[] {
  const jobs = Array.from(jobStore.values());
  if (status) {
    return jobs.filter(job => job.status === status);
  }
  return jobs.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Update job status
 */
export function updateJobStatus(jobId: string, status: JobStatus, error?: string): void {
  const job = jobStore.get(jobId);
  if (!job) {
    console.error(`[JOB MANAGER] Job ${jobId} not found`);
    return;
  }

  job.status = status;
  job.progress.updatedAt = new Date().toISOString();

  if (status === 'RUNNING' && !job.progress.startedAt) {
    job.progress.startedAt = new Date().toISOString();
  }

  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
    job.completedAt = new Date().toISOString();
  }

  if (error) {
    job.error = error;
    job.progress.phase = 'ERROR';
  }

  console.log(`[JOB MANAGER] Job ${jobId} status: ${status}`);
}

/**
 * Update job phase
 */
export function updateJobPhase(jobId: string, phase: JobPhase): void {
  const job = jobStore.get(jobId);
  if (!job) return;

  job.progress.phase = phase;
  job.progress.updatedAt = new Date().toISOString();
  console.log(`[JOB MANAGER] Job ${jobId} phase: ${phase}`);
}

/**
 * Update crawl progress
 */
export function updateCrawlProgress(
  jobId: string,
  completed: number,
  total: number
): void {
  const job = jobStore.get(jobId);
  if (!job) return;

  job.progress.crawl = {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
  job.progress.updatedAt = new Date().toISOString();
  updateOverallProgress(job);
}

/**
 * Update scrape progress
 */
export function updateScrapeProgress(
  jobId: string,
  completed: number,
  total: number
): void {
  const job = jobStore.get(jobId);
  if (!job) return;

  job.progress.scrape = {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
  job.progress.updatedAt = new Date().toISOString();
  updateOverallProgress(job);
}

/**
 * Calculate overall progress and ETA
 */
function updateOverallProgress(job: Job): void {
  const { crawl, scrape, startedAt } = job.progress;
  const mode = job.config.operationMode;

  let overall = 0;

  if (mode === 'CRAWL_ONLY') {
    overall = crawl.percent;
  } else if (mode === 'SCRAPE_ONLY') {
    overall = scrape.percent;
  } else {
    // CRAWL_AND_SCRAPE: 40% crawl, 60% scrape
    overall = Math.round(crawl.percent * 0.4 + scrape.percent * 0.6);
  }

  job.progress.overall = overall;

  // Calculate ETA
  if (startedAt && overall > 0 && overall < 100) {
    const elapsedMs = Date.now() - new Date(startedAt).getTime();
    const estimatedTotalMs = (elapsedMs / overall) * 100;
    const remainingMs = estimatedTotalMs - elapsedMs;
    job.progress.eta = Math.round(remainingMs / 1000);
  } else {
    job.progress.eta = null;
  }
}

/**
 * Set crawl results
 */
export function setCrawlResults(jobId: string, results: CrawlOnlyResult): void {
  const job = jobStore.get(jobId);
  if (!job) return;

  job.results.crawlOutput = results;
  job.progress.updatedAt = new Date().toISOString();
  console.log(`[JOB MANAGER] Job ${jobId} crawl results: ${results.discoveredUrls.length} URLs`);
}

/**
 * Set scrape results
 */
export function setScrapeResults(jobId: string, results: ScrapedContent[]): void {
  const job = jobStore.get(jobId);
  if (!job) return;

  job.results.scrapeOutput = results;
  job.progress.updatedAt = new Date().toISOString();
  console.log(`[JOB MANAGER] Job ${jobId} scrape results: ${results.length} pages`);
}

/**
 * Set validation results
 */
export function setValidationResults(jobId: string, results: ValidationReport): void {
  const job = jobStore.get(jobId);
  if (!job) return;

  job.results.validation = results;
  job.progress.updatedAt = new Date().toISOString();
}

/**
 * Get paginated crawl results
 */
export function getPaginatedCrawlResults(
  jobId: string,
  page: number = 1,
  limit: number = 100
): PaginatedResults<DiscoveredUrl> | null {
  const job = jobStore.get(jobId);
  if (!job || !job.results.crawlOutput) return null;

  const urls = job.results.crawlOutput.discoveredUrls;
  return paginate(urls, page, limit);
}

/**
 * Get paginated scrape results
 */
export function getPaginatedScrapeResults(
  jobId: string,
  page: number = 1,
  limit: number = 100
): PaginatedResults<ScrapedContent> | null {
  const job = jobStore.get(jobId);
  if (!job || !job.results.scrapeOutput) return null;

  return paginate(job.results.scrapeOutput, page, limit);
}

/**
 * Generic pagination helper
 */
function paginate<T>(items: T[], page: number, limit: number): PaginatedResults<T> {
  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const data = items.slice(offset, offset + limit);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Cancel a job
 */
export function cancelJob(jobId: string): boolean {
  const job = jobStore.get(jobId);
  if (!job) return false;

  if (job.status === 'QUEUED' || job.status === 'RUNNING') {
    updateJobStatus(jobId, 'CANCELLED');
    return true;
  }

  return false;
}

/**
 * Delete a job
 */
export function deleteJob(jobId: string): boolean {
  return jobStore.delete(jobId);
}

/**
 * Cleanup old completed jobs (older than TTL)
 */
export function cleanupOldJobs(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [jobId, job] of jobStore.entries()) {
    if (job.completedAt) {
      const completedTime = new Date(job.completedAt).getTime();
      if (now - completedTime > JOB_TTL_MS) {
        jobStore.delete(jobId);
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    console.log(`[JOB MANAGER] Cleaned up ${cleaned} old jobs`);
  }

  return cleaned;
}

/**
 * Get job store stats
 */
export function getJobStats(): {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
} {
  const jobs = Array.from(jobStore.values());
  return {
    total: jobs.length,
    queued: jobs.filter(j => j.status === 'QUEUED').length,
    running: jobs.filter(j => j.status === 'RUNNING').length,
    completed: jobs.filter(j => j.status === 'COMPLETED').length,
    failed: jobs.filter(j => j.status === 'FAILED').length,
    cancelled: jobs.filter(j => j.status === 'CANCELLED').length,
  };
}

/**
 * Job duration information
 */
export interface JobDuration {
  durationMs: number;
  durationFormatted: string;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${seconds}s`;
}

/**
 * Get job duration information
 */
export function getJobDuration(jobId: string): JobDuration | null {
  const job = jobStore.get(jobId);
  if (!job) return null;

  const startedAt = job.progress.startedAt;
  const completedAt = job.completedAt;

  let durationMs = 0;

  if (startedAt) {
    const startTime = new Date(startedAt).getTime();
    const endTime = completedAt ? new Date(completedAt).getTime() : Date.now();
    durationMs = endTime - startTime;
  }

  return {
    durationMs,
    durationFormatted: formatDuration(durationMs),
    startedAt,
    completedAt,
  };
}

// Start cleanup interval
setInterval(cleanupOldJobs, 5 * 60 * 1000); // Every 5 minutes

export default {
  createJob,
  getJob,
  getAllJobs,
  updateJobStatus,
  updateJobPhase,
  updateCrawlProgress,
  updateScrapeProgress,
  setCrawlResults,
  setScrapeResults,
  setValidationResults,
  getPaginatedCrawlResults,
  getPaginatedScrapeResults,
  cancelJob,
  deleteJob,
  cleanupOldJobs,
  getJobStats,
  getJobDuration,
  formatDuration,
};