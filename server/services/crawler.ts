/**
 * CRAWLER - URL Discovery Logic
 *
 * This module handles the "crawling" part of crawl+scrape:
 * - Discovers URLs by following links from the seed URL
 * - Uses Crawlee's PlaywrightCrawler for browser-based crawling
 * - Restricts crawling to the same domain
 * - Respects max depth limits
 * - Captures detailed metadata for each discovered URL
 *
 * CRAWLING vs SCRAPING:
 * - Crawling = URL discovery, navigating links (this module)
 * - Scraping = content extraction from pages (see scraper.ts)
 *
 * This module now supports two modes:
 * - crawlUrls(): CRAWL ONLY - just discover URLs, no content extraction
 * - runCrawler(): CRAWL + SCRAPE - discover URLs and extract content
 */

import { PlaywrightCrawler, Configuration } from 'crawlee';
import { scrapeContent, ScrapedContent } from './scraper.js';
import {
  initProgress,
  startCrawlPhase,
  updateCrawlProgress,
  startScrapePhase,
  updateScrapeProgress,
  completeProgress,
} from './progress.js';
import { isUrlAllowed, fetchRobotsTxt } from './robotsTxt.js';
import { getRateLimitConfig } from '../config/rateLimit.js';
import { filterUrl, validateSeedUrl, isUniversityDomain, extractDomain } from './domainFilter.js';
import { getDomainConfig } from '../config/domains.js';
import { getCrawlerConfig } from '../config/crawler.js';

/**
 * Options for crawl operations
 */
export interface CrawlOptions {
  seedUrl: string;
  maxDepth: number;
  includeSubpages: boolean;
  processId?: string;  // For progress tracking
}

/**
 * Link type classification
 */
export type LinkType = 'internal' | 'external';

/**
 * Discovered URL with comprehensive metadata
 */
export interface DiscoveredUrl {
  url: string;
  depth: number;
  // Navigation context
  parentUrl: string | null;
  // HTTP metadata
  statusCode: number;
  contentType: string;
  // Timing
  discoveredAt: string;
  crawlDurationMs: number;
  // Classification
  linkType: LinkType;
  // Skip reason if URL was skipped
  skippedReason?: string;
}

/**
 * Result of CRAWL ONLY operation - just URL discovery
 */
export interface CrawlOnlyResult {
  seedUrl: string;
  includeSubpages: boolean;
  discoveredUrls: DiscoveredUrl[];
  summary: {
    totalUrls: number;
    internalUrls: number;
    externalUrls: number;
    averageCrawlTimeMs: number;
    startedAt: string;
    completedAt: string;
    totalDurationMs: number;
  };
}

/**
 * Result of CRAWL + SCRAPE operation
 */
export interface CrawlResult {
  crawlId: string;
  seedUrl: string;
  crawledAt: string;
  results: ScrapedContent[];
}

/**
 * Determine if a URL is internal or external relative to the seed domain
 */
function determineLinkType(url: string, seedDomain: string): LinkType {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === seedDomain ? 'internal' : 'external';
  } catch {
    return 'external';
  }
}

/**
 * CRAWL ONLY - URL Discovery without content extraction
 *
 * This function performs URL discovery only. It does NOT extract content.
 * Use this for CRAWL_ONLY operation mode.
 *
 * @param options - Crawl configuration
 * @param crawlId - Unique identifier for this crawl
 * @returns List of discovered URLs with metadata
 */
export async function crawlUrls(
  options: CrawlOptions,
  crawlId: string
): Promise<CrawlOnlyResult> {
  const { seedUrl, maxDepth, includeSubpages, processId } = options;
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Initialize progress tracking
  if (processId) {
    initProgress(processId);
    startCrawlPhase(processId);
  }

  console.log('\n' + '='.repeat(50));
  console.log('[CRAWLER] Starting URL discovery (CRAWL ONLY mode)');
  console.log(`[CRAWLER] Seed URL: ${seedUrl}`);
  console.log(`[CRAWLER] Include Subpages: ${includeSubpages}`);
  console.log(`[CRAWLER] Max Depth: ${includeSubpages ? maxDepth : 0}`);
  console.log('='.repeat(50) + '\n');

  // Parse seed URL to extract domain for same-domain restriction
  const seedUrlObj = new URL(seedUrl);
  const allowedDomain = seedUrlObj.hostname;

  // Pre-fetch robots.txt for the domain
  const rateLimitConfig = getRateLimitConfig();
  if (rateLimitConfig.respectRobotsTxt) {
    console.log(`[CRAWLER] Fetching robots.txt for ${allowedDomain}...`);
    await fetchRobotsTxt(seedUrl);
  }

  // Check if this is a university domain
  const domainConfig = getDomainConfig();
  const isUniDomain = isUniversityDomain(allowedDomain, domainConfig);
  console.log(`[CRAWLER] University domain: ${isUniDomain ? 'Yes' : 'No'}`);

  // Validate seed URL against domain filter
  const seedValidation = validateSeedUrl(seedUrl, domainConfig);
  if (!seedValidation.allowed) {
    console.error(`[CRAWLER] Seed URL blocked: ${seedValidation.reason}`);
    throw new Error(`Seed URL not allowed: ${seedValidation.reason}`);
  }

  // If subpages are not included, just return the seed URL
  if (!includeSubpages) {
    console.log('[CRAWLER] Subpages disabled - returning seed URL only');
    const singleUrl: DiscoveredUrl = {
      url: seedUrl,
      depth: 0,
      parentUrl: null,
      statusCode: 200,
      contentType: 'text/html',
      discoveredAt: new Date().toISOString(),
      crawlDurationMs: Date.now() - startTime,
      linkType: 'internal',
    };

    if (processId) {
      updateCrawlProgress(processId, 1, 1);
    }

    return {
      seedUrl,
      includeSubpages: false,
      discoveredUrls: [singleUrl],
      summary: {
        totalUrls: 1,
        internalUrls: 1,
        externalUrls: 0,
        averageCrawlTimeMs: Date.now() - startTime,
        startedAt,
        completedAt: new Date().toISOString(),
        totalDurationMs: Date.now() - startTime,
      },
    };
  }

  // Store discovered URLs with metadata
  const discoveredUrls: DiscoveredUrl[] = [];

  // Track visited URLs to avoid duplicates
  const visitedUrls = new Set<string>();

  // Track URL count for progress
  let urlCount = 0;
  let estimatedTotal = 10; // Initial estimate

  // Configure Crawlee storage
  const config = new Configuration({
    storageClientOptions: {
      localDataDirectory: `./storage/${crawlId}`,
    },
  });

  // Get crawler configuration for LARGE-SCALE crawling
  const crawlerCfg = getCrawlerConfig();
  console.log(`[CRAWLER] Config: maxRequests=${crawlerCfg.maxRequestsPerCrawl}, concurrency=${crawlerCfg.maxConcurrency}, maxDepth=${crawlerCfg.maxDepth}`);

  // Create PlaywrightCrawler for URL discovery - OPTIMIZED FOR 50k-150k PAGES
  const crawler = new PlaywrightCrawler(
    {
      maxConcurrency: crawlerCfg.maxConcurrency,                 // 20 parallel pages
      maxRequestsPerCrawl: crawlerCfg.maxRequestsPerCrawl,       // 200k URL limit
      navigationTimeoutSecs: crawlerCfg.navigationTimeoutSecs,   // 30 second timeout
      requestHandlerTimeoutSecs: crawlerCfg.requestHandlerTimeoutSecs,
      maxRequestRetries: crawlerCfg.maxRequestRetries,
      launchContext: {
        launchOptions: { headless: crawlerCfg.headless },
      },

      // Request handler - discovers URLs and captures metadata
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

        // Capture HTTP metadata
        const statusCode = response?.status() ?? 200;
        const contentType = response?.headers()?.['content-type'] ?? 'text/html';

        log.info(`[CRAWL] Discovered [depth=${depth}] [${statusCode}]: ${currentUrl}`);

        // Create discovered URL entry with full metadata
        const discoveredUrl: DiscoveredUrl = {
          url: currentUrl,
          depth,
          parentUrl,
          statusCode,
          contentType: contentType.split(';')[0].trim(), // Remove charset
          discoveredAt: new Date().toISOString(),
          crawlDurationMs: 0, // Will be updated after processing
          linkType: determineLinkType(currentUrl, allowedDomain),
        };

        // Wait for page to load
        await page.waitForLoadState('domcontentloaded');

        // Update timing
        discoveredUrl.crawlDurationMs = Date.now() - pageStartTime;

        // Add to discovered URLs list
        discoveredUrls.push(discoveredUrl);
        urlCount++;

        // Update progress
        if (processId) {
          // Estimate total based on current depth and links found
          estimatedTotal = Math.max(estimatedTotal, urlCount + 5);
          updateCrawlProgress(processId, urlCount, estimatedTotal);
        }

        // CRAWL: Discover more URLs if under max depth
        if (depth < maxDepth) {
          await enqueueLinks({
            globs: [`https://${allowedDomain}/**`, `http://${allowedDomain}/**`],
            userData: {
              depth: depth + 1,
              parentUrl: currentUrl, // Track parent for metadata
            },
            transformRequestFunction(req) {
              // Use domain filter to validate URL
              const filterResult = filterUrl(req.url, allowedDomain);
              if (!filterResult.allowed) {
                return false;
              }

              // Also ensure same domain (crawler should stay on seed domain)
              try {
                const url = new URL(req.url);
                if (url.hostname !== allowedDomain) {
                  return false;
                }
              } catch {
                return false;
              }
              return req;
            },
          });
        }
      },

      failedRequestHandler({ request, log }) {
        const currentUrl = request.url;
        const depth = request.userData.depth ?? 0;
        const parentUrl = request.userData.parentUrl ?? null;

        log.error(`[CRAWL] Failed: ${currentUrl}`);

        // Add failed URL with error metadata
        discoveredUrls.push({
          url: currentUrl,
          depth,
          parentUrl,
          statusCode: 0,
          contentType: 'unknown',
          discoveredAt: new Date().toISOString(),
          crawlDurationMs: 0,
          linkType: determineLinkType(currentUrl, allowedDomain),
          skippedReason: 'Request failed',
        });
      },
    },
    config
  );

  // Start crawl
  await crawler.run([{
    url: seedUrl,
    userData: { depth: 0, parentUrl: null }
  }]);

  const completedAt = new Date().toISOString();
  const totalDurationMs = Date.now() - startTime;

  // Calculate summary statistics
  const internalUrls = discoveredUrls.filter(u => u.linkType === 'internal').length;
  const externalUrls = discoveredUrls.filter(u => u.linkType === 'external').length;
  const totalCrawlTime = discoveredUrls.reduce((sum, u) => sum + u.crawlDurationMs, 0);
  const averageCrawlTimeMs = discoveredUrls.length > 0
    ? Math.round(totalCrawlTime / discoveredUrls.length)
    : 0;

  // Finalize progress
  if (processId) {
    updateCrawlProgress(processId, discoveredUrls.length, discoveredUrls.length);
  }

  console.log('\n' + '='.repeat(50));
  console.log('[CRAWLER] URL discovery complete');
  console.log(`[CRAWLER] Total URLs discovered: ${discoveredUrls.length}`);
  console.log(`[CRAWLER] Internal: ${internalUrls}, External: ${externalUrls}`);
  console.log(`[CRAWLER] Average crawl time: ${averageCrawlTimeMs}ms`);
  console.log('='.repeat(50) + '\n');

  return {
    seedUrl,
    includeSubpages,
    discoveredUrls,
    summary: {
      totalUrls: discoveredUrls.length,
      internalUrls,
      externalUrls,
      averageCrawlTimeMs,
      startedAt,
      completedAt,
      totalDurationMs,
    },
  };
}

/**
 * CRAWL + SCRAPE - URL Discovery with content extraction
 *
 * This function performs both crawling and scraping in a single pass.
 * It discovers URLs AND extracts content from each page.
 *
 * @param options - Crawl configuration
 * @param crawlId - Unique identifier for this crawl
 * @returns Crawl results with scraped content
 */
export async function runCrawler(
  options: CrawlOptions,
  crawlId: string
): Promise<CrawlResult> {
  const { seedUrl, maxDepth, includeSubpages, processId } = options;

  // Initialize progress tracking
  if (processId) {
    initProgress(processId);
    startCrawlPhase(processId);
  }

  console.log('\n' + '='.repeat(50));
  console.log('[CRAWLER] Starting CRAWL + SCRAPE operation');
  console.log(`[CRAWLER] Seed URL: ${seedUrl}`);
  console.log(`[CRAWLER] Include Subpages: ${includeSubpages}`);
  console.log(`[CRAWLER] Max Depth: ${includeSubpages ? maxDepth : 0}`);
  console.log('='.repeat(50) + '\n');

  // Parse seed URL for domain restriction
  const seedUrlObj = new URL(seedUrl);
  const allowedDomain = seedUrlObj.hostname;

  // Check if this is a university domain and validate seed URL
  const domainCfg = getDomainConfig();
  const isUniDomain = isUniversityDomain(allowedDomain, domainCfg);
  console.log(`[CRAWLER] University domain: ${isUniDomain ? 'Yes' : 'No'}`);

  const seedValidation = validateSeedUrl(seedUrl, domainCfg);
  if (!seedValidation.allowed) {
    console.error(`[CRAWLER] Seed URL blocked: ${seedValidation.reason}`);
    throw new Error(`Seed URL not allowed: ${seedValidation.reason}`);
  }

  // Store scraped results
  const results: ScrapedContent[] = [];

  // Track visited URLs
  const visitedUrls = new Set<string>();

  // Track counts for progress
  let processedCount = 0;
  let estimatedTotal = 10;

  // Configure Crawlee storage
  const config = new Configuration({
    storageClientOptions: {
      localDataDirectory: `./storage/${crawlId}`,
    },
  });

  // Get crawler configuration for LARGE-SCALE crawling
  const crawlerCfg = getCrawlerConfig();
  console.log(`[CRAWLER] Config: maxRequests=${crawlerCfg.maxRequestsPerCrawl}, concurrency=${crawlerCfg.maxConcurrency}, maxDepth=${crawlerCfg.maxDepth}`);

  // Effective max depth based on includeSubpages setting
  const effectiveMaxDepth = includeSubpages ? maxDepth : 0;

  // Create PlaywrightCrawler - OPTIMIZED FOR 50k-150k PAGES
  const crawler = new PlaywrightCrawler(
    {
      maxConcurrency: crawlerCfg.maxConcurrency,                 // 20 parallel pages
      maxRequestsPerCrawl: crawlerCfg.maxRequestsPerCrawl,       // 200k URL limit
      navigationTimeoutSecs: crawlerCfg.navigationTimeoutSecs,   // 30 second timeout
      requestHandlerTimeoutSecs: crawlerCfg.requestHandlerTimeoutSecs,
      maxRequestRetries: crawlerCfg.maxRequestRetries,
      launchContext: {
        launchOptions: { headless: crawlerCfg.headless },
      },

      async requestHandler({ request, page, enqueueLinks, log, response }) {
        const currentUrl = request.loadedUrl || request.url;
        const depth = request.userData.depth ?? 0;
        const parentUrl = request.userData.parentUrl ?? null;

        // Skip duplicates
        if (visitedUrls.has(currentUrl)) {
          return;
        }
        visitedUrls.add(currentUrl);

        // Capture HTTP metadata
        const statusCode = response?.status() ?? 200;
        const contentType = response?.headers()?.['content-type'] ?? 'text/html';

        log.info(`[CRAWL] [depth=${depth}] [${statusCode}]: ${currentUrl}`);

        await page.waitForLoadState('domcontentloaded');

        // SCRAPE: Extract content with metadata
        log.info(`[SCRAPE] Extracting: ${currentUrl}`);
        const content = await scrapeContent(page, currentUrl, depth, {
          parentUrl,
          statusCode,
          contentType: contentType.split(';')[0].trim(),
        });
        results.push(content);

        processedCount++;

        // Update progress
        if (processId) {
          estimatedTotal = Math.max(estimatedTotal, processedCount + 3);
          updateCrawlProgress(processId, processedCount, estimatedTotal);
        }

        // CRAWL: Discover more URLs if subpages enabled and under max depth
        if (depth < effectiveMaxDepth) {
          await enqueueLinks({
            globs: [`https://${allowedDomain}/**`, `http://${allowedDomain}/**`],
            userData: {
              depth: depth + 1,
              parentUrl: currentUrl,
            },
            transformRequestFunction(req) {
              // Use domain filter to validate URL
              const filterResult = filterUrl(req.url, allowedDomain);
              if (!filterResult.allowed) {
                return false;
              }

              // Also ensure same domain
              try {
                const url = new URL(req.url);
                if (url.hostname !== allowedDomain) {
                  return false;
                }
              } catch {
                return false;
              }
              return req;
            },
          });
        }
      },

      failedRequestHandler({ request, log }) {
        log.error(`[CRAWL] Failed: ${request.url}`);
      },
    },
    config
  );

  // Start crawl
  await crawler.run([{
    url: seedUrl,
    userData: { depth: 0, parentUrl: null }
  }]);

  // Finalize progress
  if (processId) {
    updateCrawlProgress(processId, results.length, results.length);
  }

  console.log('\n' + '='.repeat(50));
  console.log('[CRAWLER] CRAWL + SCRAPE complete');
  console.log(`[CRAWLER] Pages processed: ${results.length}`);
  console.log('='.repeat(50) + '\n');

  return {
    crawlId,
    seedUrl,
    crawledAt: new Date().toISOString(),
    results,
  };
}
