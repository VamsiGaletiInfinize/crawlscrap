/**
 * V2 CRAWL API - Async Job-Based Crawling
 *
 * This endpoint starts crawl jobs asynchronously:
 * - Returns job ID immediately (non-blocking)
 * - Job runs in background
 * - Client polls /api/v2/jobs/:id for status
 *
 * POST /api/v2/crawl
 *   Request: { seedUrl, includeSubpages, depth, operationMode, outputFormat }
 *   Response: { jobId, status: "QUEUED" }
 */

import { Request, Response } from 'express';
import {
  createJob,
  updateJobStatus,
  updateJobPhase,
  updateCrawlProgress as updateJobCrawlProgress,
  updateScrapeProgress as updateJobScrapeProgress,
  setCrawlResults,
  setScrapeResults,
  setValidationResults,
  JobConfig,
  OperationMode,
  OutputFormat,
} from '../../jobs/jobManager.js';
import { crawlUrls, CrawlOnlyResult } from '../../services/crawler.js';
import { scrapeContent, ScrapedContent } from '../../services/scraper.js';
import { validateCrawlVsScrape } from '../../services/validator.js';

/**
 * Request body for v2 crawl endpoint
 */
interface CrawlRequest {
  seedUrl: string;
  includeSubpages?: boolean;
  depth?: number;
  operationMode?: OperationMode;
  outputFormat?: OutputFormat;
  universityName?: string; // Optional university name for organized output
}

/**
 * Validate request body
 */
function validateRequest(body: CrawlRequest): { valid: boolean; error?: string } {
  if (!body.seedUrl) {
    return { valid: false, error: 'seedUrl is required' };
  }

  try {
    new URL(body.seedUrl);
  } catch {
    return { valid: false, error: 'Invalid seedUrl format' };
  }

  const validModes: OperationMode[] = ['CRAWL_ONLY', 'SCRAPE_ONLY', 'CRAWL_AND_SCRAPE'];
  if (body.operationMode && !validModes.includes(body.operationMode)) {
    return { valid: false, error: `Invalid operationMode. Must be one of: ${validModes.join(', ')}` };
  }

  const validFormats: OutputFormat[] = ['JSON', 'MARKDOWN', 'SUMMARY', 'LINKS_ONLY', 'HTML'];
  if (body.outputFormat && !validFormats.includes(body.outputFormat)) {
    return { valid: false, error: `Invalid outputFormat. Must be one of: ${validFormats.join(', ')}` };
  }

  if (body.depth !== undefined && (body.depth < 0 || body.depth > 10)) {
    return { valid: false, error: 'depth must be between 0 and 10' };
  }

  return { valid: true };
}

/**
 * Execute crawl job in background
 */
async function executeJob(jobId: string, config: JobConfig): Promise<void> {
  console.log(`[V2 CRAWL] Starting job ${jobId} for ${config.seedUrl}`);

  try {
    updateJobStatus(jobId, 'RUNNING');

    const { seedUrl, includeSubpages, maxDepth, operationMode } = config;

    if (operationMode === 'CRAWL_ONLY') {
      // CRAWL ONLY mode
      updateJobPhase(jobId, 'CRAWLING');

      const crawlResult = await crawlUrlsWithProgress(
        { seedUrl, maxDepth, includeSubpages, processId: jobId },
        jobId
      );

      setCrawlResults(jobId, crawlResult);
      updateJobPhase(jobId, 'COMPLETED');
      updateJobStatus(jobId, 'COMPLETED');

    } else if (operationMode === 'SCRAPE_ONLY') {
      // SCRAPE ONLY mode
      updateJobPhase(jobId, 'SCRAPING');

      const scrapeResults = await scrapeUrlWithProgress(seedUrl, jobId);

      setScrapeResults(jobId, scrapeResults);
      updateJobPhase(jobId, 'COMPLETED');
      updateJobStatus(jobId, 'COMPLETED');

    } else {
      // CRAWL_AND_SCRAPE mode
      // Phase 1: Crawl
      updateJobPhase(jobId, 'CRAWLING');

      const crawlResult = await crawlUrlsWithProgress(
        { seedUrl, maxDepth, includeSubpages, processId: jobId },
        jobId
      );

      setCrawlResults(jobId, crawlResult);

      // Phase 2: Scrape
      updateJobPhase(jobId, 'SCRAPING');

      const scrapeResults = await scrapeUrlsWithProgress(
        crawlResult.discoveredUrls.map(u => u.url),
        jobId
      );

      setScrapeResults(jobId, scrapeResults);

      // Phase 3: Validate
      updateJobPhase(jobId, 'VALIDATING');

      const validation = validateCrawlVsScrape(crawlResult.discoveredUrls, scrapeResults);
      setValidationResults(jobId, validation);

      updateJobPhase(jobId, 'COMPLETED');
      updateJobStatus(jobId, 'COMPLETED');
    }

    console.log(`[V2 CRAWL] Job ${jobId} completed successfully`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[V2 CRAWL] Job ${jobId} failed:`, errorMessage);
    updateJobStatus(jobId, 'FAILED', errorMessage);
  }
}

/**
 * Crawl URLs with progress updates
 */
async function crawlUrlsWithProgress(
  options: { seedUrl: string; maxDepth: number; includeSubpages: boolean; processId: string },
  jobId: string
): Promise<CrawlOnlyResult> {
  // Use existing crawlUrls function with progress tracking
  const result = await crawlUrls(options, jobId);

  // Update final progress
  updateJobCrawlProgress(jobId, result.discoveredUrls.length, result.discoveredUrls.length);

  return result;
}

/**
 * Scrape single URL (for SCRAPE_ONLY mode)
 */
async function scrapeUrlWithProgress(url: string, jobId: string): Promise<ScrapedContent[]> {
  const { chromium } = await import('playwright');

  updateJobScrapeProgress(jobId, 0, 1);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const content = await scrapeContent(page, url, 0, {
      parentUrl: null,
      statusCode: 200,
      contentType: 'text/html',
    });

    updateJobScrapeProgress(jobId, 1, 1);

    return [content];
  } finally {
    await browser.close();
  }
}

/**
 * Scrape multiple URLs with progress updates
 */
async function scrapeUrlsWithProgress(urls: string[], jobId: string): Promise<ScrapedContent[]> {
  const { chromium } = await import('playwright');
  const results: ScrapedContent[] = [];
  const total = urls.length;

  updateJobScrapeProgress(jobId, 0, total);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const page = await context.newPage();

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const content = await scrapeContent(page, url, 0, {
          parentUrl: null,
          statusCode: 200,
          contentType: 'text/html',
        });
        results.push(content);
      } catch (error) {
        console.error(`[V2 CRAWL] Failed to scrape ${url}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Add failed result
        results.push({
          url,
          title: '',
          headings: [],
          content: '',
          links: [],
          cleanedHtml: '',
          metadata: {
            crawledAt: new Date().toISOString(),
            scrapedAt: new Date().toISOString(),
            scrapeDurationMs: 0,
            depth: 0,
            parentUrl: null,
            statusCode: 0,
            contentType: 'unknown',
            wordCount: 0,
            language: 'unknown',
            contentHash: '',
            status: 'FAILED',
            errorMessage,
          },
        });
      } finally {
        await page.close();
      }

      // Update progress after each page
      updateJobScrapeProgress(jobId, i + 1, total);
    }

    return results;
  } finally {
    await browser.close();
  }
}

/**
 * POST /api/v2/crawl - Start async crawl job
 */
export async function startCrawlJob(req: Request, res: Response): Promise<void> {
  const body = req.body as CrawlRequest;

  // Validate request
  const validation = validateRequest(body);
  if (!validation.valid) {
    res.status(400).json({
      success: false,
      error: validation.error,
    });
    return;
  }

  // Create job config
  const config: JobConfig = {
    seedUrl: body.seedUrl,
    includeSubpages: body.includeSubpages ?? true,
    maxDepth: body.depth ?? 2,
    operationMode: body.operationMode ?? 'CRAWL_AND_SCRAPE',
    outputFormat: body.outputFormat ?? 'JSON',
    universityName: body.universityName, // Pass university name for organized output
  };

  // Create job
  const job = createJob(config);

  // Start job in background (don't await)
  executeJob(job.id, config).catch(error => {
    console.error(`[V2 CRAWL] Background job error:`, error);
  });

  // Return immediately with job ID
  res.status(202).json({
    success: true,
    jobId: job.id,
    status: job.status,
    message: 'Crawl job queued. Poll /api/v2/jobs/:id for status.',
    links: {
      status: `/api/v2/jobs/${job.id}`,
      results: `/api/v2/jobs/${job.id}/results`,
      cancel: `/api/v2/jobs/${job.id}`,
    },
  });
}

export default { startCrawlJob };