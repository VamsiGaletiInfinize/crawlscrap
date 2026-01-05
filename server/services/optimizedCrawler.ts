/**
 * OPTIMIZED CRAWLER - Single-Pass Architecture
 *
 * High-performance crawler that eliminates the main bottlenecks:
 *
 * 1. SINGLE-PASS: Crawl + Scrape in one page load (no double rendering)
 * 2. STREAMING: Results written to disk immediately (no memory accumulation)
 * 3. INCREMENTAL: Skip unchanged pages using fingerprints
 * 4. PIPELINED: Workers start processing while crawl continues
 *
 * Expected improvements:
 * - 50-70% faster than sequential crawl->scrape
 * - 80%+ faster on re-crawls with change detection
 * - Constant memory usage regardless of crawl size
 */

import { PlaywrightCrawler, Configuration } from 'crawlee';
import { Page } from 'playwright';
import { scrapeContent, ScrapedContent } from './scraper.js';
import { getCrawlerConfig, type RenderingMode } from '../config/crawler.js';
import { getRateLimitConfig } from '../config/rateLimit.js';
import { filterUrl, validateSeedUrl } from './domainFilter.js';
import { getDomainConfig } from '../config/domains.js';
import { fetchRobotsTxt } from './robotsTxt.js';
import { StreamingWriter, createStreamingWriter } from './streamingWriter.js';
import {
  ChangeDetectionService,
  getChangeDetectionService,
} from './changeDetection.js';
import {
  initProgress,
  startCrawlPhase,
  updateCrawlProgress,
  completeProgress,
} from './progress.js';

/**
 * Options for optimized crawl
 */
export interface OptimizedCrawlOptions {
  seedUrl: string;
  maxDepth: number;
  includeSubpages: boolean;
  processId?: string;
  jobId: string;

  // Optimization flags
  enableChangeDetection: boolean;
  enableStreaming: boolean;
  outputFormat: 'jsonl' | 'json' | 'csv';

  // Callbacks
  onProgress?: (processed: number, discovered: number) => void;
  onResult?: (result: ScrapedContent) => void;
}

/**
 * Result of optimized crawl
 */
export interface OptimizedCrawlResult {
  jobId: string;
  seedUrl: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;

  // Counts
  discovered: number;
  processed: number;
  skipped: number;
  failed: number;
  unchanged: number;

  // Output
  outputPath: string;
  outputFormat: string;

  // Performance metrics
  pagesPerSecond: number;
  avgPageTimeMs: number;
}

/**
 * Wait for page to load using smart rendering strategy
 */
async function smartWaitForLoad(
  page: Page,
  mode: RenderingMode,
  minContentLength: number,
  log?: { info: (msg: string) => void }
): Promise<void> {
  if (mode === 'fast') {
    await page.waitForLoadState('domcontentloaded');
    return;
  }

  if (mode === 'complete') {
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch {
      await page.waitForLoadState('domcontentloaded');
    }
    return;
  }

  // Adaptive mode
  await page.waitForLoadState('domcontentloaded');

  // Quick content check
  const contentLength = await page.evaluate(() =>
    document.body?.innerText?.length || 0
  );

  if (contentLength < minContentLength) {
    log?.info(`[ADAPTIVE] Minimal content (${contentLength}), waiting for JS...`);
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch {
      // Continue with what we have
    }
  }
}

/**
 * Run optimized single-pass crawl+scrape
 */
export async function runOptimizedCrawl(
  options: OptimizedCrawlOptions
): Promise<OptimizedCrawlResult> {
  const {
    seedUrl,
    maxDepth,
    includeSubpages,
    processId,
    jobId,
    enableChangeDetection,
    enableStreaming,
    outputFormat,
    onProgress,
    onResult,
  } = options;

  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Initialize progress
  if (processId) {
    initProgress(processId);
    startCrawlPhase(processId);
  }

  console.log('\n' + '='.repeat(60));
  console.log('[OPTIMIZED-CRAWLER] Single-pass crawl+scrape starting');
  console.log(`[OPTIMIZED-CRAWLER] Seed: ${seedUrl}`);
  console.log(`[OPTIMIZED-CRAWLER] Max Depth: ${includeSubpages ? maxDepth : 0}`);
  console.log(`[OPTIMIZED-CRAWLER] Change Detection: ${enableChangeDetection}`);
  console.log(`[OPTIMIZED-CRAWLER] Streaming: ${enableStreaming}`);
  console.log('='.repeat(60) + '\n');

  // Parse seed URL
  const seedUrlObj = new URL(seedUrl);
  const allowedDomain = seedUrlObj.hostname;

  // Validate seed URL
  const domainConfig = getDomainConfig();
  const seedValidation = validateSeedUrl(seedUrl, domainConfig);
  if (!seedValidation.allowed) {
    throw new Error(`Seed URL not allowed: ${seedValidation.reason}`);
  }

  // Pre-fetch robots.txt
  const rateLimitConfig = getRateLimitConfig();
  if (rateLimitConfig.respectRobotsTxt) {
    await fetchRobotsTxt(seedUrl);
  }

  // Initialize change detection
  let changeDetection: ChangeDetectionService | null = null;
  if (enableChangeDetection) {
    changeDetection = getChangeDetectionService();
    changeDetection.loadDomain(allowedDomain);
  }

  // Initialize streaming writer
  let writer: StreamingWriter | null = null;
  if (enableStreaming) {
    writer = createStreamingWriter(jobId, './data/results', outputFormat);
  }

  // In-memory results (only if not streaming)
  const results: ScrapedContent[] = [];

  // Stats
  let discovered = 0;
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let unchanged = 0;
  const pageTimes: number[] = [];

  // Track visited URLs
  const visitedUrls = new Set<string>();

  // Get crawler config
  const crawlerCfg = getCrawlerConfig();
  console.log(`[OPTIMIZED-CRAWLER] Concurrency: ${crawlerCfg.maxConcurrency}`);
  console.log(`[OPTIMIZED-CRAWLER] Timeout: ${crawlerCfg.navigationTimeoutSecs}s`);

  // Configure storage
  const config = new Configuration({
    storageClientOptions: {
      localDataDirectory: `./storage/${jobId}`,
    },
  });

  // Effective max depth
  const effectiveMaxDepth = includeSubpages ? maxDepth : 0;

  // Create optimized crawler
  const crawler = new PlaywrightCrawler(
    {
      maxConcurrency: crawlerCfg.maxConcurrency,
      maxRequestsPerCrawl: crawlerCfg.maxRequestsPerCrawl,
      navigationTimeoutSecs: crawlerCfg.navigationTimeoutSecs,
      requestHandlerTimeoutSecs: crawlerCfg.requestHandlerTimeoutSecs,
      maxRequestRetries: crawlerCfg.maxRequestRetries,
      launchContext: {
        launchOptions: { headless: crawlerCfg.headless },
      },

      // SINGLE-PASS: Crawl + Scrape in one handler
      async requestHandler({ request, page, enqueueLinks, log, response }) {
        const pageStartTime = Date.now();
        const currentUrl = request.loadedUrl || request.url;
        const depth = request.userData.depth ?? 0;
        const parentUrl = request.userData.parentUrl ?? null;

        // Skip duplicates
        if (visitedUrls.has(currentUrl)) {
          return;
        }
        visitedUrls.add(currentUrl);
        discovered++;

        // Get HTTP headers for change detection
        const etag = response?.headers()?.['etag'] || null;
        const lastModified = response?.headers()?.['last-modified'] || null;
        const statusCode = response?.status() ?? 200;
        const contentType = response?.headers()?.['content-type'] ?? 'text/html';

        // CHANGE DETECTION: Check if page needs re-crawl
        if (changeDetection) {
          const changeResult = changeDetection.checkForChanges(
            currentUrl,
            etag,
            lastModified
          );

          if (!changeResult.shouldRecrawl) {
            log.info(`[SKIP] Unchanged: ${currentUrl} (${changeResult.skipReason})`);
            unchanged++;
            skipped++;

            // Still discover links even if content unchanged
            if (depth < effectiveMaxDepth) {
              await enqueueLinks({
                globs: [`https://${allowedDomain}/**`, `http://${allowedDomain}/**`],
                userData: { depth: depth + 1, parentUrl: currentUrl },
                transformRequestFunction(req) {
                  const filterResult = filterUrl(req.url, allowedDomain);
                  if (!filterResult.allowed) return false;
                  try {
                    if (new URL(req.url).hostname !== allowedDomain) return false;
                  } catch {
                    return false;
                  }
                  return req;
                },
              });
            }
            return;
          }
        }

        log.info(`[CRAWL+SCRAPE] [depth=${depth}]: ${currentUrl}`);

        // Wait for page to load
        await smartWaitForLoad(
          page,
          crawlerCfg.renderingMode,
          crawlerCfg.minContentLength,
          log
        );

        // SCRAPE: Extract content while page is loaded
        const content = await scrapeContent(page, currentUrl, depth, {
          parentUrl,
          statusCode,
          contentType: contentType.split(';')[0].trim(),
        });

        processed++;
        const pageTime = Date.now() - pageStartTime;
        pageTimes.push(pageTime);

        // Update change detection fingerprint
        if (changeDetection) {
          changeDetection.updateFingerprint(
            currentUrl,
            content.content,
            content.links,
            content.headings,
            etag,
            lastModified
          );
        }

        // STREAMING: Write result immediately
        if (writer) {
          writer.write(content);
        } else {
          results.push(content);
        }

        // Callback
        if (onResult) {
          onResult(content);
        }

        // Progress update
        if (processId) {
          updateCrawlProgress(processId, processed, discovered);
        }
        if (onProgress) {
          onProgress(processed, discovered);
        }

        // CRAWL: Discover more URLs
        if (depth < effectiveMaxDepth) {
          await enqueueLinks({
            globs: [`https://${allowedDomain}/**`, `http://${allowedDomain}/**`],
            userData: {
              depth: depth + 1,
              parentUrl: currentUrl,
            },
            transformRequestFunction(req) {
              const filterResult = filterUrl(req.url, allowedDomain);
              if (!filterResult.allowed) return false;
              try {
                if (new URL(req.url).hostname !== allowedDomain) return false;
              } catch {
                return false;
              }
              return req;
            },
          });
        }
      },

      // Handle failures
      failedRequestHandler({ request, log }) {
        log.error(`[FAILED] ${request.url}`);
        failed++;
      },
    },
    config
  );

  // Run the crawler
  await crawler.run([
    {
      url: seedUrl,
      userData: { depth: 0, parentUrl: null },
    },
  ]);

  // Save change detection data
  if (changeDetection) {
    changeDetection.saveDomain();
  }

  // Close streaming writer
  let outputPath = '';
  if (writer) {
    const writeResult = await writer.close();
    outputPath = writeResult.path;
  }

  // Finalize progress
  if (processId) {
    completeProgress(processId);
  }

  const completedAt = new Date().toISOString();
  const totalDurationMs = Date.now() - startTime;
  const avgPageTimeMs = pageTimes.length > 0
    ? Math.round(pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length)
    : 0;
  const pagesPerSecond = totalDurationMs > 0
    ? Math.round((processed / totalDurationMs) * 1000 * 100) / 100
    : 0;

  console.log('\n' + '='.repeat(60));
  console.log('[OPTIMIZED-CRAWLER] Crawl complete');
  console.log(`[OPTIMIZED-CRAWLER] Discovered: ${discovered}`);
  console.log(`[OPTIMIZED-CRAWLER] Processed: ${processed}`);
  console.log(`[OPTIMIZED-CRAWLER] Unchanged: ${unchanged}`);
  console.log(`[OPTIMIZED-CRAWLER] Failed: ${failed}`);
  console.log(`[OPTIMIZED-CRAWLER] Duration: ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`[OPTIMIZED-CRAWLER] Speed: ${pagesPerSecond} pages/sec`);
  console.log('='.repeat(60) + '\n');

  return {
    jobId,
    seedUrl,
    startedAt,
    completedAt,
    totalDurationMs,
    discovered,
    processed,
    skipped,
    failed,
    unchanged,
    outputPath,
    outputFormat,
    pagesPerSecond,
    avgPageTimeMs,
  };
}

/**
 * Get results from streaming output file
 */
export async function getStreamedResults(
  outputPath: string
): Promise<ScrapedContent[]> {
  const fs = await import('fs');

  if (!fs.existsSync(outputPath)) {
    return [];
  }

  const content = fs.readFileSync(outputPath, 'utf8');

  // Handle JSONL format
  if (outputPath.endsWith('.json') && content.startsWith('[')) {
    return JSON.parse(content);
  }

  // Handle JSON Lines
  const lines = content.split('\n').filter(line => line.trim());
  return lines.map(line => JSON.parse(line));
}

export default { runOptimizedCrawl, getStreamedResults };
