/**
 * DOMAIN FILTER SERVICE
 *
 * Filters URLs based on university domain patterns and configuration.
 * Provides URL validation, domain classification, and filtering statistics.
 */

import { getDomainConfig, type DomainConfig } from '../config/domains.js';

/**
 * URL filter result
 */
export interface FilterResult {
  allowed: boolean;
  reason?: string;
  domain?: string;
  isUniversity?: boolean;
}

/**
 * Domain classification
 */
export interface DomainClassification {
  domain: string;
  isUniversity: boolean;
  matchedPattern: string | null;
  isWhitelisted: boolean;
  isBlacklisted: boolean;
}

/**
 * Filter statistics
 */
export interface FilterStats {
  totalChecked: number;
  allowed: number;
  blocked: number;
  blockedByDomain: number;
  blockedByPath: number;
  blockedByExtension: number;
  blockedByLength: number;
  universityDomains: number;
  nonUniversityDomains: number;
  uniqueDomains: Set<string>;
}

// Statistics tracking
const stats: FilterStats = {
  totalChecked: 0,
  allowed: 0,
  blocked: 0,
  blockedByDomain: 0,
  blockedByPath: 0,
  blockedByExtension: 0,
  blockedByLength: 0,
  universityDomains: 0,
  nonUniversityDomains: 0,
  uniqueDomains: new Set(),
};

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Extract path from URL
 */
export function extractPath(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Check if a domain matches university patterns
 */
export function isUniversityDomain(domain: string, config?: DomainConfig): boolean {
  const cfg = config || getDomainConfig();
  const lowerDomain = domain.toLowerCase();

  for (const pattern of cfg.universityPatterns) {
    if (lowerDomain.endsWith(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a domain is in the allowed list
 */
export function isAllowedDomain(domain: string, config?: DomainConfig): boolean {
  const cfg = config || getDomainConfig();
  const lowerDomain = domain.toLowerCase();

  for (const allowed of cfg.allowedDomains) {
    const lowerAllowed = allowed.toLowerCase();

    if (lowerDomain === lowerAllowed) {
      return true;
    }

    // Check subdomain match if enabled
    if (cfg.allowSubdomains && lowerDomain.endsWith('.' + lowerAllowed)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a domain is in the blocked list
 */
export function isBlockedDomain(domain: string, config?: DomainConfig): boolean {
  const cfg = config || getDomainConfig();
  const lowerDomain = domain.toLowerCase();

  for (const blocked of cfg.blockedDomains) {
    const lowerBlocked = blocked.toLowerCase();

    if (lowerDomain === lowerBlocked) {
      return true;
    }

    // Check subdomain match
    if (lowerDomain.endsWith('.' + lowerBlocked)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a path is blocked
 */
export function isBlockedPath(path: string, config?: DomainConfig): boolean {
  const cfg = config || getDomainConfig();
  const lowerPath = path.toLowerCase();

  for (const blocked of cfg.blockedPaths) {
    if (lowerPath.startsWith(blocked.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Check if URL has a blocked file extension
 */
export function hasBlockedExtension(url: string, config?: DomainConfig): boolean {
  const cfg = config || getDomainConfig();

  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname.toLowerCase();

    for (const ext of cfg.skipExtensions) {
      if (path.endsWith(ext.toLowerCase())) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Classify a domain
 */
export function classifyDomain(domain: string, config?: DomainConfig): DomainClassification {
  const cfg = config || getDomainConfig();

  return {
    domain,
    isUniversity: isUniversityDomain(domain, cfg),
    matchedPattern: findMatchingPattern(domain, cfg),
    isWhitelisted: isAllowedDomain(domain, cfg),
    isBlacklisted: isBlockedDomain(domain, cfg),
  };
}

/**
 * Find the matching university pattern for a domain
 */
function findMatchingPattern(domain: string, config: DomainConfig): string | null {
  const lowerDomain = domain.toLowerCase();

  for (const pattern of config.universityPatterns) {
    if (lowerDomain.endsWith(pattern)) {
      return pattern;
    }
  }

  return null;
}

/**
 * Filter a URL - main filtering function
 */
export function filterUrl(url: string, seedDomain?: string, config?: DomainConfig): FilterResult {
  const cfg = config || getDomainConfig();
  stats.totalChecked++;

  // Check URL length
  if (url.length > cfg.maxUrlLength) {
    stats.blocked++;
    stats.blockedByLength++;
    return {
      allowed: false,
      reason: `URL too long (${url.length} > ${cfg.maxUrlLength})`,
    };
  }

  // Extract domain
  const domain = extractDomain(url);
  if (!domain) {
    stats.blocked++;
    return {
      allowed: false,
      reason: 'Invalid URL',
    };
  }

  stats.uniqueDomains.add(domain);

  // Check if blocked domain (highest priority)
  if (isBlockedDomain(domain, cfg)) {
    stats.blocked++;
    stats.blockedByDomain++;
    return {
      allowed: false,
      reason: 'Domain is blacklisted',
      domain,
      isUniversity: false,
    };
  }

  // Check file extension
  if (hasBlockedExtension(url, cfg)) {
    stats.blocked++;
    stats.blockedByExtension++;
    return {
      allowed: false,
      reason: 'Blocked file extension',
      domain,
    };
  }

  // Check blocked paths
  const path = extractPath(url);
  if (path && isBlockedPath(path, cfg)) {
    stats.blocked++;
    stats.blockedByPath++;
    return {
      allowed: false,
      reason: 'Blocked path pattern',
      domain,
    };
  }

  // Check if whitelisted (bypasses university check)
  if (isAllowedDomain(domain, cfg)) {
    stats.allowed++;
    return {
      allowed: true,
      domain,
      isUniversity: isUniversityDomain(domain, cfg),
    };
  }

  // Check same-domain (if seed domain provided)
  if (seedDomain) {
    const lowerSeedDomain = seedDomain.toLowerCase();
    const lowerDomain = domain.toLowerCase();

    // Allow same domain
    if (lowerDomain === lowerSeedDomain) {
      stats.allowed++;
      const isUni = isUniversityDomain(domain, cfg);
      if (isUni) stats.universityDomains++;
      else stats.nonUniversityDomains++;
      return {
        allowed: true,
        domain,
        isUniversity: isUni,
      };
    }

    // Allow subdomains if enabled
    if (cfg.allowSubdomains) {
      if (lowerDomain.endsWith('.' + lowerSeedDomain) ||
          lowerSeedDomain.endsWith('.' + lowerDomain)) {
        stats.allowed++;
        const isUni = isUniversityDomain(domain, cfg);
        if (isUni) stats.universityDomains++;
        else stats.nonUniversityDomains++;
        return {
          allowed: true,
          domain,
          isUniversity: isUni,
        };
      }
    }
  }

  // Strict university mode - only allow university domains
  if (cfg.strictUniversityMode) {
    const isUni = isUniversityDomain(domain, cfg);
    if (!isUni) {
      stats.blocked++;
      stats.blockedByDomain++;
      stats.nonUniversityDomains++;
      return {
        allowed: false,
        reason: 'Not a university domain (strict mode)',
        domain,
        isUniversity: false,
      };
    }

    stats.allowed++;
    stats.universityDomains++;
    return {
      allowed: true,
      domain,
      isUniversity: true,
    };
  }

  // Default: allow the URL
  stats.allowed++;
  const isUni = isUniversityDomain(domain, cfg);
  if (isUni) stats.universityDomains++;
  else stats.nonUniversityDomains++;

  return {
    allowed: true,
    domain,
    isUniversity: isUni,
  };
}

/**
 * Filter multiple URLs
 */
export function filterUrls(
  urls: string[],
  seedDomain?: string,
  config?: DomainConfig
): { allowed: string[]; blocked: Array<{ url: string; reason: string }> } {
  const allowed: string[] = [];
  const blocked: Array<{ url: string; reason: string }> = [];

  for (const url of urls) {
    const result = filterUrl(url, seedDomain, config);
    if (result.allowed) {
      allowed.push(url);
    } else {
      blocked.push({ url, reason: result.reason || 'Unknown' });
    }
  }

  return { allowed, blocked };
}

/**
 * Get filter statistics
 */
export function getFilterStats(): {
  totalChecked: number;
  allowed: number;
  blocked: number;
  blockedByDomain: number;
  blockedByPath: number;
  blockedByExtension: number;
  blockedByLength: number;
  universityDomains: number;
  nonUniversityDomains: number;
  uniqueDomainsCount: number;
} {
  return {
    totalChecked: stats.totalChecked,
    allowed: stats.allowed,
    blocked: stats.blocked,
    blockedByDomain: stats.blockedByDomain,
    blockedByPath: stats.blockedByPath,
    blockedByExtension: stats.blockedByExtension,
    blockedByLength: stats.blockedByLength,
    universityDomains: stats.universityDomains,
    nonUniversityDomains: stats.nonUniversityDomains,
    uniqueDomainsCount: stats.uniqueDomains.size,
  };
}

/**
 * Reset filter statistics
 */
export function resetFilterStats(): void {
  stats.totalChecked = 0;
  stats.allowed = 0;
  stats.blocked = 0;
  stats.blockedByDomain = 0;
  stats.blockedByPath = 0;
  stats.blockedByExtension = 0;
  stats.blockedByLength = 0;
  stats.universityDomains = 0;
  stats.nonUniversityDomains = 0;
  stats.uniqueDomains.clear();
}

/**
 * Get list of unique domains seen
 */
export function getUniqueDomains(): string[] {
  return Array.from(stats.uniqueDomains);
}

/**
 * Validate a seed URL for crawling
 */
export function validateSeedUrl(url: string, config?: DomainConfig): FilterResult {
  const cfg = config || getDomainConfig();

  // Basic URL validation
  const domain = extractDomain(url);
  if (!domain) {
    return {
      allowed: false,
      reason: 'Invalid URL format',
    };
  }

  // Check if blocked
  if (isBlockedDomain(domain, cfg)) {
    return {
      allowed: false,
      reason: 'Domain is blacklisted',
      domain,
      isUniversity: false,
    };
  }

  // In strict mode, must be a university domain
  if (cfg.strictUniversityMode && !isUniversityDomain(domain, cfg) && !isAllowedDomain(domain, cfg)) {
    return {
      allowed: false,
      reason: 'Seed URL must be a university domain in strict mode',
      domain,
      isUniversity: false,
    };
  }

  return {
    allowed: true,
    domain,
    isUniversity: isUniversityDomain(domain, cfg),
  };
}

export default {
  filterUrl,
  filterUrls,
  validateSeedUrl,
  isUniversityDomain,
  isAllowedDomain,
  isBlockedDomain,
  isBlockedPath,
  hasBlockedExtension,
  classifyDomain,
  extractDomain,
  extractPath,
  getFilterStats,
  resetFilterStats,
  getUniqueDomains,
};
