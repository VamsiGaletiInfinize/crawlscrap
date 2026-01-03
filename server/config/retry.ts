/**
 * RETRY CONFIGURATION
 *
 * Configuration for retry logic and error handling.
 * Includes exponential backoff and circuit breaker settings.
 */

export interface RetryConfig {
  // Maximum number of retry attempts
  maxRetries: number;

  // Initial delay before first retry (ms)
  initialDelayMs: number;

  // Maximum delay between retries (ms)
  maxDelayMs: number;

  // Backoff multiplier (exponential backoff)
  backoffMultiplier: number;

  // Add random jitter to delays (0-1, percentage of delay)
  jitter: number;

  // Timeout for individual requests (ms)
  requestTimeout: number;

  // HTTP status codes that should trigger a retry
  retryableStatusCodes: number[];

  // Error message patterns that indicate transient errors
  transientErrorPatterns: string[];
}

export interface CircuitBreakerConfig {
  // Enable circuit breaker
  enabled: boolean;

  // Number of failures before opening circuit
  failureThreshold: number;

  // Time window for counting failures (ms)
  failureWindowMs: number;

  // Time to wait before attempting to close circuit (ms)
  resetTimeoutMs: number;

  // Number of successful requests needed to close circuit
  successThreshold: number;
}

/**
 * HTTP status codes that typically indicate transient errors
 */
export const RETRYABLE_STATUS_CODES: number[] = [
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  520, // Cloudflare: Unknown Error
  521, // Cloudflare: Web Server Is Down
  522, // Cloudflare: Connection Timed Out
  523, // Cloudflare: Origin Is Unreachable
  524, // Cloudflare: A Timeout Occurred
];

/**
 * Error message patterns that indicate transient/retryable errors
 */
export const TRANSIENT_ERROR_PATTERNS: string[] = [
  'timeout',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'socket hang up',
  'network error',
  'net::ERR_',
  'Navigation timeout',
  'Timeout exceeded',
  'Target closed',
  'Protocol error',
  'Connection closed',
  'read ECONNRESET',
];

/**
 * Default retry configuration - OPTIMIZED FOR RELIABILITY
 */
export const retryConfig: RetryConfig = {
  maxRetries: 2,              // Fewer retries but faster overall
  initialDelayMs: 500,        // Start with shorter delay
  maxDelayMs: 10000,          // Cap at 10 seconds
  backoffMultiplier: 2,
  jitter: 0.3,                // More jitter to spread requests
  requestTimeout: 45000,      // 45 second timeout
  retryableStatusCodes: RETRYABLE_STATUS_CODES,
  transientErrorPatterns: TRANSIENT_ERROR_PATTERNS,
};

/**
 * Default circuit breaker configuration - MORE TOLERANT
 */
export const circuitBreakerConfig: CircuitBreakerConfig = {
  enabled: true,
  failureThreshold: 10,       // More tolerant (was 5)
  failureWindowMs: 120000,    // 2 minute window (was 1)
  resetTimeoutMs: 15000,      // Faster recovery (was 30s)
  successThreshold: 1,        // Quick to close (was 2)
};

/**
 * Get retry configuration with environment variable overrides
 */
export function getRetryConfig(): RetryConfig {
  return {
    maxRetries: parseInt(process.env.MAX_RETRIES || String(retryConfig.maxRetries), 10),
    initialDelayMs: parseInt(process.env.RETRY_INITIAL_DELAY_MS || String(retryConfig.initialDelayMs), 10),
    maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS || String(retryConfig.maxDelayMs), 10),
    backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || String(retryConfig.backoffMultiplier)),
    jitter: parseFloat(process.env.RETRY_JITTER || String(retryConfig.jitter)),
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || String(retryConfig.requestTimeout), 10),
    retryableStatusCodes: retryConfig.retryableStatusCodes,
    transientErrorPatterns: retryConfig.transientErrorPatterns,
  };
}

/**
 * Get circuit breaker configuration with environment variable overrides
 */
export function getCircuitBreakerConfig(): CircuitBreakerConfig {
  return {
    enabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
    failureThreshold: parseInt(
      process.env.CIRCUIT_BREAKER_THRESHOLD || String(circuitBreakerConfig.failureThreshold),
      10
    ),
    failureWindowMs: parseInt(
      process.env.CIRCUIT_BREAKER_WINDOW_MS || String(circuitBreakerConfig.failureWindowMs),
      10
    ),
    resetTimeoutMs: parseInt(
      process.env.CIRCUIT_BREAKER_RESET_MS || String(circuitBreakerConfig.resetTimeoutMs),
      10
    ),
    successThreshold: parseInt(
      process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || String(circuitBreakerConfig.successThreshold),
      10
    ),
  };
}

export default {
  retryConfig,
  circuitBreakerConfig,
  getRetryConfig,
  getCircuitBreakerConfig,
  RETRYABLE_STATUS_CODES,
  TRANSIENT_ERROR_PATTERNS,
};
