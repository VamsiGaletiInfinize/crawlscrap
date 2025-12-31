/**
 * V2 JOBS API - Job Status and Results
 *
 * Endpoints:
 * - GET /api/v2/jobs - List all jobs
 * - GET /api/v2/jobs/:id - Get job status and progress
 * - GET /api/v2/jobs/:id/results - Get paginated results
 * - DELETE /api/v2/jobs/:id - Cancel or delete job
 */

import { Request, Response } from 'express';
import {
  getJob,
  getAllJobs,
  getPaginatedCrawlResults,
  getPaginatedScrapeResults,
  cancelJob,
  deleteJob,
  getJobStats,
  getJobDuration,
  JobStatus,
} from '../../jobs/jobManager.js';
import { formatOutput, OutputFormat } from '../../services/formatter.js';

/**
 * GET /api/v2/jobs - List all jobs
 */
export async function listJobs(req: Request, res: Response): Promise<void> {
  const status = req.query.status as JobStatus | undefined;

  const jobs = getAllJobs(status);
  const stats = getJobStats();

  res.json({
    success: true,
    stats,
    jobs: jobs.map(job => {
      const duration = getJobDuration(job.id);
      return {
        id: job.id,
        seedUrl: job.config.seedUrl,
        universityName: job.config.universityName || null,
        operationMode: job.config.operationMode,
        status: job.status,
        progress: job.progress.overall,
        phase: job.progress.phase,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        duration: duration?.durationFormatted || null,
      };
    }),
  });
}

/**
 * GET /api/v2/jobs/:id - Get job status and details
 */
export async function getJobStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const job = getJob(id);
  if (!job) {
    res.status(404).json({
      success: false,
      error: 'Job not found',
    });
    return;
  }

  // Get duration information
  const duration = getJobDuration(id);

  // Build response based on job status
  const response: Record<string, unknown> = {
    success: true,
    job: {
      id: job.id,
      config: job.config,
      status: job.status,
      progress: job.progress,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    },
    // Include duration for all job states
    timing: {
      startedAt: duration?.startedAt || null,
      completedAt: duration?.completedAt || null,
      durationMs: duration?.durationMs || 0,
      durationFormatted: duration?.durationFormatted || 'Not started',
    },
  };

  // Include summary if completed
  if (job.status === 'COMPLETED') {
    response.summary = {
      universityName: job.config.universityName || null,
      urlsDiscovered: job.results.crawlOutput?.discoveredUrls.length ?? 0,
      pagesScraped: job.results.scrapeOutput?.length ?? 0,
      validation: job.results.validation ? {
        totalCrawled: job.results.validation.totalCrawled,
        totalScraped: job.results.validation.totalScraped,
        successRate: job.results.validation.successRate,
        completenessRate: job.results.validation.completenessRate,
      } : null,
    };
    response.links = {
      crawlResults: `/api/v2/jobs/${id}/results?type=crawl`,
      scrapeResults: `/api/v2/jobs/${id}/results?type=scrape`,
      exportResults: `/api/v2/jobs/${id}/export`,
    };
  }

  res.json(response);
}

/**
 * GET /api/v2/jobs/:id/results - Get paginated results
 */
export async function getJobResults(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const type = (req.query.type as string) || 'scrape'; // 'crawl' or 'scrape'
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500); // Max 500
  const format = (req.query.format as OutputFormat) || 'JSON';

  const job = getJob(id);
  if (!job) {
    res.status(404).json({
      success: false,
      error: 'Job not found',
    });
    return;
  }

  if (job.status !== 'COMPLETED' && job.status !== 'RUNNING') {
    res.status(400).json({
      success: false,
      error: `Job is ${job.status}. Results not available.`,
    });
    return;
  }

  if (type === 'crawl') {
    const results = getPaginatedCrawlResults(id, page, limit);
    if (!results) {
      res.status(404).json({
        success: false,
        error: 'Crawl results not available',
      });
      return;
    }

    res.json({
      success: true,
      type: 'crawl',
      ...results,
    });

  } else {
    // Scrape results
    const results = getPaginatedScrapeResults(id, page, limit);
    if (!results) {
      res.status(404).json({
        success: false,
        error: 'Scrape results not available',
      });
      return;
    }

    // Apply formatting if requested
    if (format !== 'JSON' && results.data.length > 0) {
      const formatted = formatOutput(results.data, format);
      res.json({
        success: true,
        type: 'scrape',
        format,
        pagination: results.pagination,
        data: formatted,
      });
    } else {
      res.json({
        success: true,
        type: 'scrape',
        ...results,
      });
    }
  }
}

/**
 * GET /api/v2/jobs/:id/validation - Get validation report
 */
export async function getJobValidation(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const job = getJob(id);
  if (!job) {
    res.status(404).json({
      success: false,
      error: 'Job not found',
    });
    return;
  }

  if (!job.results.validation) {
    res.status(404).json({
      success: false,
      error: 'Validation results not available',
    });
    return;
  }

  res.json({
    success: true,
    jobId: id,
    validation: job.results.validation,
  });
}

/**
 * DELETE /api/v2/jobs/:id - Cancel or delete job
 */
export async function deleteOrCancelJob(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const action = req.query.action as string; // 'cancel' or 'delete'

  const job = getJob(id);
  if (!job) {
    res.status(404).json({
      success: false,
      error: 'Job not found',
    });
    return;
  }

  if (action === 'delete' || job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
    // Delete the job
    deleteJob(id);
    res.json({
      success: true,
      message: `Job ${id} deleted`,
    });
  } else {
    // Try to cancel
    const cancelled = cancelJob(id);
    if (cancelled) {
      res.json({
        success: true,
        message: `Job ${id} cancelled`,
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Cannot cancel job in current state',
      });
    }
  }
}

/**
 * GET /api/v2/jobs/stats - Get job statistics
 */
export async function getStats(req: Request, res: Response): Promise<void> {
  const stats = getJobStats();
  res.json({
    success: true,
    stats,
  });
}

export default {
  listJobs,
  getJobStatus,
  getJobResults,
  getJobValidation,
  deleteOrCancelJob,
  getStats,
};