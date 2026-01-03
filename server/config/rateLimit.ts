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
 * OPTIMIZED FOR MAXIMUM SPEED - Minimal delays, high concurrency
 */
export const rateLimitConfig: RateLimitConfig = {
  defaultDelayMs: 50,             // 50ms between requests (very fast)
  minDelayMs: 0,                  // No minimum delay
  maxDelayMs: 2000,               // Maximum 2 second delay
  respectRobotsTxt: true,         // Still respect robots.txt
  userAgent: 'CrawlScrap/1.0 (+https://github.com/crawlscrap)',
  robotsTxtCacheTtl: 3600000,     // Cache robots.txt for 1 hour
  maxConcurrentPerDomain: 20,     // Allow 20 concurrent requests per domain
  robotsTxtTimeout: 3000,         // 3 second timeout for robots.txt
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
