/**
 * RATE LIMITER SERVICE
 *
 * Manages per-domain request throttling for polite crawling.
 * - Enforces delays between requests to the same domain
 * - Respects robots.txt crawl-delay directives
 * - Tracks concurrent requests per domain
 * - Provides wait functionality for rate-limited requests
 */

import { getRateLimitConfig, type RateLimitConfig } from '../config/rateLimit.js';
import { getCrawlDelay, getDomain, isUrlAllowed } from './robotsTxt.js';

/**
 * Per-domain rate limit state
 */
interface DomainState {
  domain: string;
  lastRequestTime: number;       // Timestamp of last request
  delayMs: number;               // Required delay between requests
  concurrentRequests: number;    // Current concurrent requests
  totalRequests: number;         // Total requests made
  blockedRequests: number;       // Requests blocked by robots.txt
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  waitMs: number;                // How long to wait before proceeding
  reason?: string;               // Reason if not allowed
}

/**
 * Rate limiter statistics
 */
export interface RateLimiterStats {
  domains: number;
  totalRequests: number;
  blockedRequests: number;
  averageDelayMs: number;
  domainStats: DomainState[];
}

/**
 * Per-domain state storage
 */
const domainStates = new Map<string, DomainState>();

/**
 * Get or create domain state
 */
async function getDomainState(url: string): Promise<DomainState> {
  const domain = getDomain(url);

  let state = domainStates.get(domain);
  if (!state) {
    // Fetch crawl delay from robots.txt
    const delayMs = await getCrawlDelay(url);

    state = {
      domain,
      lastRequestTime: 0,
      delayMs,
      concurrentRequests: 0,
      totalRequests: 0,
      blockedRequests: 0,
    };
    domainStates.set(domain, state);

    console.log(`[RATE LIMITER] Initialized ${domain} with ${delayMs}ms delay`);
  }

  return state;
}

/**
 * Check if a request is allowed and how long to wait
 */
export async function checkRateLimit(url: string): Promise<RateLimitResult> {
  const config = getRateLimitConfig();

  // Check robots.txt rules
  const allowed = await isUrlAllowed(url);
  if (!allowed) {
    const state = await getDomainState(url);
    state.blockedRequests++;

    return {
      allowed: false,
      waitMs: 0,
      reason: 'Blocked by robots.txt',
    };
  }

  const state = await getDomainState(url);
  const now = Date.now();
  const timeSinceLastRequest = now - state.lastRequestTime;

  // Check concurrent request limit
  if (state.concurrentRequests >= config.maxConcurrentPerDomain) {
    return {
      allowed: true,
      waitMs: state.delayMs,
      reason: 'Concurrent request limit reached',
    };
  }

  // Check if we need to wait
  if (timeSinceLastRequest < state.delayMs) {
    const waitMs = state.delayMs - timeSinceLastRequest;
    return {
      allowed: true,
      waitMs,
      reason: 'Rate limit delay',
    };
  }

  return {
    allowed: true,
    waitMs: 0,
  };
}

/**
 * Wait for rate limit if needed, then proceed
 */
export async function waitForRateLimit(url: string): Promise<boolean> {
  const result = await checkRateLimit(url);

  if (!result.allowed) {
    console.log(`[RATE LIMITER] Blocked: ${url} - ${result.reason}`);
    return false;
  }

  if (result.waitMs > 0) {
    console.log(`[RATE LIMITER] Waiting ${result.waitMs}ms for ${getDomain(url)}`);
    await sleep(result.waitMs);
  }

  return true;
}

/**
 * Record the start of a request (increment concurrent count)
 */
export async function recordRequestStart(url: string): Promise<void> {
  const state = await getDomainState(url);
  state.concurrentRequests++;
  state.totalRequests++;
  state.lastRequestTime = Date.now();
}

/**
 * Record the end of a request (decrement concurrent count)
 */
export async function recordRequestEnd(url: string): Promise<void> {
  const state = await getDomainState(url);
  state.concurrentRequests = Math.max(0, state.concurrentRequests - 1);
}

/**
 * Acquire rate limit slot (wait if needed, then record start)
 * Returns false if blocked by robots.txt
 */
export async function acquireSlot(url: string): Promise<boolean> {
  const allowed = await waitForRateLimit(url);
  if (!allowed) {
    return false;
  }

  await recordRequestStart(url);
  return true;
}

/**
 * Release rate limit slot (record end)
 */
export async function releaseSlot(url: string): Promise<void> {
  await recordRequestEnd(url);
}

/**
 * Helper to wrap an async operation with rate limiting
 */
export async function withRateLimit<T>(
  url: string,
  operation: () => Promise<T>
): Promise<{ success: boolean; result?: T; blockedByRobots?: boolean }> {
  const allowed = await acquireSlot(url);

  if (!allowed) {
    return { success: false, blockedByRobots: true };
  }

  try {
    const result = await operation();
    return { success: true, result };
  } finally {
    await releaseSlot(url);
  }
}

/**
 * Get rate limiter statistics
 */
export function getRateLimiterStats(): RateLimiterStats {
  const states = Array.from(domainStates.values());
  const totalRequests = states.reduce((sum, s) => sum + s.totalRequests, 0);
  const blockedRequests = states.reduce((sum, s) => sum + s.blockedRequests, 0);
  const totalDelay = states.reduce((sum, s) => sum + s.delayMs, 0);
  const averageDelayMs = states.length > 0 ? Math.round(totalDelay / states.length) : 0;

  return {
    domains: states.length,
    totalRequests,
    blockedRequests,
    averageDelayMs,
    domainStats: states,
  };
}

/**
 * Get stats for a specific domain
 */
export function getDomainStats(domain: string): DomainState | null {
  return domainStates.get(domain) || null;
}

/**
 * Clear rate limiter state
 */
export function clearRateLimiterState(): void {
  domainStates.clear();
  console.log('[RATE LIMITER] State cleared');
}

/**
 * Update delay for a domain (e.g., if we detect rate limiting from server)
 */
export function updateDomainDelay(domain: string, newDelayMs: number): void {
  const config = getRateLimitConfig();
  const state = domainStates.get(domain);

  if (state) {
    // Apply bounds
    const boundedDelay = Math.max(
      config.minDelayMs,
      Math.min(config.maxDelayMs, newDelayMs)
    );

    state.delayMs = boundedDelay;
    console.log(`[RATE LIMITER] Updated ${domain} delay to ${boundedDelay}ms`);
  }
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Batch URLs by domain for efficient rate-limited processing
 */
export function groupUrlsByDomain(urls: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const url of urls) {
    const domain = getDomain(url);
    if (!groups.has(domain)) {
      groups.set(domain, []);
    }
    groups.get(domain)!.push(url);
  }

  return groups;
}

export default {
  checkRateLimit,
  waitForRateLimit,
  recordRequestStart,
  recordRequestEnd,
  acquireSlot,
  releaseSlot,
  withRateLimit,
  getRateLimiterStats,
  getDomainStats,
  clearRateLimiterState,
  updateDomainDelay,
  groupUrlsByDomain,
};
