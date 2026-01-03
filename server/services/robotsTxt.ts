/**
 * ROBOTS.TXT SERVICE
 *
 * Parses and caches robots.txt files for polite crawling.
 * Extracts crawl-delay and disallow rules for the crawler user agent.
 */

import { getRateLimitConfig } from '../config/rateLimit.js';

/**
 * Parsed robots.txt rules for a domain
 */
export interface RobotsTxtRules {
  domain: string;
  crawlDelay: number | null;      // Crawl-delay in seconds (null if not specified)
  disallowedPaths: string[];      // Paths that are disallowed
  allowedPaths: string[];         // Explicitly allowed paths
  sitemaps: string[];             // Sitemap URLs
  fetchedAt: string;              // When the rules were fetched
  expiresAt: number;              // Timestamp when cache expires
}

/**
 * Cache for robots.txt rules by domain
 */
const robotsCache = new Map<string, RobotsTxtRules>();

/**
 * Extract domain from URL
 */
export function getDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return '';
  }
}

/**
 * Get robots.txt URL for a domain
 */
function getRobotsTxtUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.hostname}/robots.txt`;
  } catch {
    return '';
  }
}

/**
 * Parse robots.txt content
 */
function parseRobotsTxt(content: string, domain: string): RobotsTxtRules {
  const config = getRateLimitConfig();
  const lines = content.split('\n');

  const rules: RobotsTxtRules = {
    domain,
    crawlDelay: null,
    disallowedPaths: [],
    allowedPaths: [],
    sitemaps: [],
    fetchedAt: new Date().toISOString(),
    expiresAt: Date.now() + config.robotsTxtCacheTtl,
  };

  let currentUserAgent = '';
  let isRelevantSection = false;
  const userAgentLower = config.userAgent.toLowerCase();

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    // Split into directive and value
    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) continue;

    const directive = trimmedLine.substring(0, colonIndex).trim().toLowerCase();
    const value = trimmedLine.substring(colonIndex + 1).trim();

    // Handle User-agent directive
    if (directive === 'user-agent') {
      currentUserAgent = value.toLowerCase();
      // Check if this section applies to us (our user agent or *)
      isRelevantSection =
        currentUserAgent === '*' ||
        userAgentLower.includes(currentUserAgent) ||
        currentUserAgent.includes('crawlscrap');
      continue;
    }

    // Only process directives if we're in a relevant section
    if (!isRelevantSection) {
      // Still capture sitemaps as they're global
      if (directive === 'sitemap') {
        rules.sitemaps.push(value);
      }
      continue;
    }

    switch (directive) {
      case 'disallow':
        if (value) {
          rules.disallowedPaths.push(value);
        }
        break;

      case 'allow':
        if (value) {
          rules.allowedPaths.push(value);
        }
        break;

      case 'crawl-delay':
        const delay = parseFloat(value);
        if (!isNaN(delay) && delay > 0) {
          // Convert to seconds if not already
          rules.crawlDelay = delay;
        }
        break;

      case 'sitemap':
        rules.sitemaps.push(value);
        break;
    }
  }

  return rules;
}

/**
 * Fetch and parse robots.txt for a URL
 */
export async function fetchRobotsTxt(url: string): Promise<RobotsTxtRules> {
  const config = getRateLimitConfig();
  const domain = getDomain(url);
  const robotsUrl = getRobotsTxtUrl(url);

  // Check cache first
  const cached = robotsCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  // Default rules if fetch fails
  const defaultRules: RobotsTxtRules = {
    domain,
    crawlDelay: null,
    disallowedPaths: [],
    allowedPaths: [],
    sitemaps: [],
    fetchedAt: new Date().toISOString(),
    expiresAt: Date.now() + config.robotsTxtCacheTtl,
  };

  if (!robotsUrl) {
    robotsCache.set(domain, defaultRules);
    return defaultRules;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.robotsTxtTimeout);

    const response = await fetch(robotsUrl, {
      headers: {
        'User-Agent': config.userAgent,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // No robots.txt or error - allow everything
      console.log(`[ROBOTS.TXT] No robots.txt for ${domain} (status ${response.status})`);
      robotsCache.set(domain, defaultRules);
      return defaultRules;
    }

    const content = await response.text();
    const rules = parseRobotsTxt(content, domain);

    console.log(`[ROBOTS.TXT] Parsed ${domain}: crawl-delay=${rules.crawlDelay}s, ${rules.disallowedPaths.length} disallowed paths`);

    robotsCache.set(domain, rules);
    return rules;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[ROBOTS.TXT] Failed to fetch for ${domain}: ${errorMessage}`);
    robotsCache.set(domain, defaultRules);
    return defaultRules;
  }
}

/**
 * Check if a URL is allowed by robots.txt
 */
export async function isUrlAllowed(url: string): Promise<boolean> {
  const config = getRateLimitConfig();

  if (!config.respectRobotsTxt) {
    return true;
  }

  const rules = await fetchRobotsTxt(url);

  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname + urlObj.search;

    // Check allow rules first (they take precedence in most implementations)
    for (const allowedPath of rules.allowedPaths) {
      if (pathMatches(path, allowedPath)) {
        return true;
      }
    }

    // Check disallow rules
    for (const disallowedPath of rules.disallowedPaths) {
      if (pathMatches(path, disallowedPath)) {
        return false;
      }
    }

    return true;
  } catch {
    return true;
  }
}

/**
 * Check if a path matches a robots.txt pattern
 */
function pathMatches(path: string, pattern: string): boolean {
  if (!pattern) return false;

  // Handle wildcard patterns
  if (pattern.includes('*')) {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\$/g, '$') + (pattern.endsWith('$') ? '' : '.*')
    );
    return regex.test(path);
  }

  // Simple prefix match
  return path.startsWith(pattern);
}

/**
 * Get crawl delay for a domain (in milliseconds)
 */
export async function getCrawlDelay(url: string): Promise<number> {
  const config = getRateLimitConfig();
  const rules = await fetchRobotsTxt(url);

  // Get delay from robots.txt (convert seconds to ms)
  let delayMs = rules.crawlDelay !== null
    ? rules.crawlDelay * 1000
    : config.defaultDelayMs;

  // Apply min/max bounds
  delayMs = Math.max(config.minDelayMs, delayMs);
  delayMs = Math.min(config.maxDelayMs, delayMs);

  return delayMs;
}

/**
 * Get cached robots.txt rules for a domain
 */
export function getCachedRules(domain: string): RobotsTxtRules | null {
  return robotsCache.get(domain) || null;
}

/**
 * Clear the robots.txt cache
 */
export function clearRobotsTxtCache(): void {
  robotsCache.clear();
  console.log('[ROBOTS.TXT] Cache cleared');
}

/**
 * Get cache statistics
 */
export function getRobotsTxtCacheStats(): {
  size: number;
  domains: string[];
} {
  return {
    size: robotsCache.size,
    domains: Array.from(robotsCache.keys()),
  };
}

export default {
  fetchRobotsTxt,
  isUrlAllowed,
  getCrawlDelay,
  getCachedRules,
  clearRobotsTxtCache,
  getRobotsTxtCacheStats,
  getDomain,
};
