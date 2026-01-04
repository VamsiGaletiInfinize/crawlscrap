/**
 * RATE LIMIT CONFIGURATION
 *
 * Configuration for polite crawling with rate limiting.
 * Supports robots.txt compliance and per-domain throttling.
 */

export interface RateLimitConfig {
  // Default delay between requests to the same domain (ms)
  defaultDelayMs: number;

  // Minimum delay (overrides robots.txt if lower)
  minDelayMs: number;

  // Maximum delay (caps robots.txt if higher)
  maxDelayMs: number;

  // Whether to respect robots.txt
  respectRobotsTxt: boolean;

  // Default user agent for crawling
  userAgent: string;

  // Cache TTL for robots.txt (ms)
  robotsTxtCacheTtl: number;

  // Maximum concurrent requests per domain
  maxConcurrentPerDomain: number;

  // Request timeout for fetching robots.txt (ms)
  robotsTxtTimeout: number;
}

/**
 * Default rate limit configuration
 * OPTIMIZED FOR STABILITY - Conservative pacing for heavy JS sites
 *
 * University websites often have:
 * - Heavy JavaScript rendering
 * - Rate limiting / DDoS protection
 * - Complex single-page applications
 *
 * Conservative pacing prevents triggering rate limits and ensures
 * pages have time to fully render before extraction.
 */
export const rateLimitConfig: RateLimitConfig = {
  defaultDelayMs: 200,            // 200ms between requests (polite)
  minDelayMs: 100,                // 100ms minimum delay
  maxDelayMs: 2000,               // Maximum 2 second delay
  respectRobotsTxt: true,         // Respect robots.txt
  userAgent: 'CrawlScrap/1.0 (+https://github.com/crawlscrap)',
  robotsTxtCacheTtl: 3600000,     // Cache robots.txt for 1 hour
  maxConcurrentPerDomain: 5,      // 5 concurrent per domain (reduced from 20)
  robotsTxtTimeout: 5000,         // 5 second timeout for robots.txt
};

/**
 * Get rate limit configuration with environment variable overrides
 */
export function getRateLimitConfig(): RateLimitConfig {
  return {
    defaultDelayMs: parseInt(process.env.CRAWL_DELAY_MS || String(rateLimitConfig.defaultDelayMs), 10),
    minDelayMs: parseInt(process.env.CRAWL_MIN_DELAY_MS || String(rateLimitConfig.minDelayMs), 10),
    maxDelayMs: parseInt(process.env.CRAWL_MAX_DELAY_MS || String(rateLimitConfig.maxDelayMs), 10),
    respectRobotsTxt: process.env.RESPECT_ROBOTS_TXT !== 'false',
    userAgent: process.env.CRAWL_USER_AGENT || rateLimitConfig.userAgent,
    robotsTxtCacheTtl: parseInt(
      process.env.ROBOTS_TXT_CACHE_TTL || String(rateLimitConfig.robotsTxtCacheTtl),
      10
    ),
    maxConcurrentPerDomain: parseInt(
      process.env.MAX_CONCURRENT_PER_DOMAIN || String(rateLimitConfig.maxConcurrentPerDomain),
      10
    ),
    robotsTxtTimeout: parseInt(
      process.env.ROBOTS_TXT_TIMEOUT || String(rateLimitConfig.robotsTxtTimeout),
      10
    ),
  };
}

export default { rateLimitConfig, getRateLimitConfig };
