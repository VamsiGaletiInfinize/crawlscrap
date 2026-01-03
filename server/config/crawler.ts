/**
 * CRAWLER CONFIGURATION
 *
 * Configuration for the URL discovery crawler (PlaywrightCrawler).
 * Optimized for LARGE-SCALE crawling: 50k-150k pages.
 *
 * The crawler handles URL DISCOVERY - finding all links on a website.
 * This is separate from the worker pool which handles SCRAPING.
 */

export interface CrawlerConfig {
  // Maximum total URLs to crawl per session
  // Set high for university-scale crawling
  maxRequestsPerCrawl: number;

  // Number of concurrent pages for URL discovery
  // Higher = faster discovery but more memory
  maxConcurrency: number;

  // Navigation timeout in seconds
  navigationTimeoutSecs: number;

  // Request handler timeout in seconds
  requestHandlerTimeoutSecs: number;

  // Maximum depth to crawl from seed URL
  // Depth 1 = seed + direct links
  // Depth 2 = seed + direct links + their links
  // Depth 3+ = deeper crawling for large sites
  maxDepth: number;

  // Run browser in headless mode
  headless: boolean;

  // Retry failed requests
  maxRequestRetries: number;

  // Minimum/maximum delay between requests (ms)
  // Helps with rate limiting and server politeness
  minConcurrencyDelayMs: number;
  maxConcurrencyDelayMs: number;
}

/**
 * Default crawler configuration - OPTIMIZED FOR LARGE-SCALE CRAWLING
 *
 * Target: 50,000 - 150,000 pages per crawl session
 *
 * Memory estimate:
 * - 20 concurrent pages × ~100MB = ~2GB for URL discovery
 * - Plus worker pool memory for scraping
 */
export const crawlerConfig: CrawlerConfig = {
  maxRequestsPerCrawl: 200000,     // 200k URL limit (supports 150k target)
  maxConcurrency: 20,              // 20 parallel pages for discovery
  navigationTimeoutSecs: 30,       // 30 second page load timeout
  requestHandlerTimeoutSecs: 60,   // 60 second handler timeout
  maxDepth: 5,                     // Depth 5 for comprehensive crawling
  headless: true,
  maxRequestRetries: 2,            // Retry failed requests twice
  minConcurrencyDelayMs: 0,        // No artificial delay
  maxConcurrencyDelayMs: 0,        // No artificial delay
};

/**
 * Get crawler configuration with environment variable overrides
 */
export function getCrawlerConfig(): CrawlerConfig {
  return {
    maxRequestsPerCrawl: parseInt(
      process.env.CRAWLER_MAX_REQUESTS || String(crawlerConfig.maxRequestsPerCrawl),
      10
    ),
    maxConcurrency: parseInt(
      process.env.CRAWLER_DISCOVERY_CONCURRENCY || String(crawlerConfig.maxConcurrency),
      10
    ),
    navigationTimeoutSecs: parseInt(
      process.env.CRAWLER_NAV_TIMEOUT_SECS || String(crawlerConfig.navigationTimeoutSecs),
      10
    ),
    requestHandlerTimeoutSecs: parseInt(
      process.env.CRAWLER_HANDLER_TIMEOUT_SECS || String(crawlerConfig.requestHandlerTimeoutSecs),
      10
    ),
    maxDepth: parseInt(
      process.env.CRAWLER_MAX_DEPTH || String(crawlerConfig.maxDepth),
      10
    ),
    headless: process.env.CRAWLER_HEADLESS !== 'false',
    maxRequestRetries: parseInt(
      process.env.CRAWLER_MAX_RETRIES || String(crawlerConfig.maxRequestRetries),
      10
    ),
    minConcurrencyDelayMs: parseInt(
      process.env.CRAWLER_MIN_DELAY_MS || String(crawlerConfig.minConcurrencyDelayMs),
      10
    ),
    maxConcurrencyDelayMs: parseInt(
      process.env.CRAWLER_MAX_DELAY_MS || String(crawlerConfig.maxConcurrencyDelayMs),
      10
    ),
  };
}

/**
 * Presets for different crawl scales
 */
export const CRAWLER_PRESETS = {
  // Small site: up to 1,000 pages
  SMALL: {
    maxRequestsPerCrawl: 1000,
    maxConcurrency: 5,
    maxDepth: 2,
  },

  // Medium site: up to 10,000 pages
  MEDIUM: {
    maxRequestsPerCrawl: 10000,
    maxConcurrency: 10,
    maxDepth: 3,
  },

  // Large site: up to 50,000 pages (default)
  LARGE: {
    maxRequestsPerCrawl: 50000,
    maxConcurrency: 15,
    maxDepth: 4,
  },

  // University-scale: up to 200,000 pages
  UNIVERSITY: {
    maxRequestsPerCrawl: 200000,
    maxConcurrency: 20,
    maxDepth: 5,
  },
} as const;

export default { crawlerConfig, getCrawlerConfig, CRAWLER_PRESETS };
