/**
 * CRAWLER CONFIGURATION
 *
 * Configuration for the URL discovery crawler (PlaywrightCrawler).
 * Optimized for LARGE-SCALE crawling: 50k-150k pages.
 *
 * The crawler handles URL DISCOVERY - finding all links on a website.
 * This is separate from the worker pool which handles SCRAPING.
 */

/**
 * Rendering mode for page loading
 * - 'fast': Uses domcontentloaded (faster, may miss JS-rendered content)
 * - 'complete': Uses networkidle (slower, waits for all JS to finish)
 * - 'adaptive': Tries fast first, falls back to complete if content is minimal
 */
export type RenderingMode = 'fast' | 'complete' | 'adaptive';

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

  // Rendering mode for page loading
  renderingMode: RenderingMode;

  // Minimum content length (chars) to consider page loaded
  // Used in adaptive mode to determine if JS rendering is needed
  minContentLength: number;
}

/**
 * Default crawler configuration - OPTIMIZED FOR STABILITY & PERFORMANCE
 *
 * Target: 50,000 - 150,000 pages per crawl session
 *
 * OPTIMIZED FOR:
 * - Heavy JavaScript websites (university sites)
 * - Memory-safe operation (stays under 8GB)
 * - Timeout resilience (45s for slow-loading pages)
 * - Fast failure (1 retry to avoid queue buildup)
 *
 * Memory estimate:
 * - 10 concurrent pages × ~100MB = ~1GB for URL discovery
 * - Plus worker pool memory for scraping
 */
export const crawlerConfig: CrawlerConfig = {
  maxRequestsPerCrawl: 200000,     // 200k URL limit (supports 150k target)
  maxConcurrency: 10,              // 10 parallel pages (reduced from 20 for memory)
  navigationTimeoutSecs: 45,       // 45 second timeout (increased for JS-heavy sites)
  requestHandlerTimeoutSecs: 60,   // 60 second handler timeout
  maxDepth: 5,                     // Depth 5 for comprehensive crawling
  headless: true,
  maxRequestRetries: 1,            // Fast fail - 1 retry only (reduced from 2)
  minConcurrencyDelayMs: 50,       // 50ms minimum delay between requests
  maxConcurrencyDelayMs: 200,      // 200ms max delay for pacing
  renderingMode: 'adaptive',       // Adaptive: fast first, complete if minimal content
  minContentLength: 500,           // Min 500 chars to consider page loaded
};

/**
 * Get crawler configuration with environment variable overrides
 */
export function getCrawlerConfig(): CrawlerConfig {
  const renderingModeEnv = process.env.CRAWLER_RENDERING_MODE as RenderingMode | undefined;
  const validModes: RenderingMode[] = ['fast', 'complete', 'adaptive'];
  const renderingMode = renderingModeEnv && validModes.includes(renderingModeEnv)
    ? renderingModeEnv
    : crawlerConfig.renderingMode;

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
    renderingMode,
    minContentLength: parseInt(
      process.env.CRAWLER_MIN_CONTENT_LENGTH || String(crawlerConfig.minContentLength),
      10
    ),
  };
}

/**
 * Presets for different crawl scales
 * All optimized for stability with JS-heavy sites
 */
export const CRAWLER_PRESETS = {
  // Small site: up to 1,000 pages
  SMALL: {
    maxRequestsPerCrawl: 1000,
    maxConcurrency: 3,
    maxDepth: 2,
    maxRequestRetries: 1,
  },

  // Medium site: up to 10,000 pages
  MEDIUM: {
    maxRequestsPerCrawl: 10000,
    maxConcurrency: 5,
    maxDepth: 3,
    maxRequestRetries: 1,
  },

  // Large site: up to 50,000 pages
  LARGE: {
    maxRequestsPerCrawl: 50000,
    maxConcurrency: 8,
    maxDepth: 4,
    maxRequestRetries: 1,
  },

  // University-scale: up to 200,000 pages (memory-optimized)
  UNIVERSITY: {
    maxRequestsPerCrawl: 200000,
    maxConcurrency: 10,
    maxDepth: 5,
    maxRequestRetries: 1,
    renderingMode: 'adaptive' as RenderingMode,
  },
} as const;

export default { crawlerConfig, getCrawlerConfig, CRAWLER_PRESETS };
