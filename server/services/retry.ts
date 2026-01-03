/**
 * RETRY SERVICE
 *
 * Provides retry logic with exponential backoff for failed requests.
 * Includes error classification to determine if errors are retryable.
 */

import { getRetryConfig, type RetryConfig } from '../config/retry.js';

/**
 * Error classification result
 */
export interface ErrorClassification {
  isRetryable: boolean;
  errorType: 'transient' | 'permanent' | 'unknown';
  reason: string;
}

/**
 * Retry result
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  attempts: number;
  totalDurationMs: number;
  lastError?: Error;
}

/**
 * Retry statistics
 */
interface RetryStats {
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  permanentFailures: number;
  totalDelayMs: number;
  errorsByType: Map<string, number>;
}

// Global retry statistics
const stats: RetryStats = {
  totalAttempts: 0,
  successfulRetries: 0,
  failedRetries: 0,
  permanentFailures: 0,
  totalDelayMs: 0,
  errorsByType: new Map(),
};

/**
 * Classify an error to determine if it's retryable
 */
export function classifyError(error: Error | string, statusCode?: number): ErrorClassification {
  const config = getRetryConfig();
  const errorMessage = typeof error === 'string' ? error : error.message;
  const lowerMessage = errorMessage.toLowerCase();

  // Check HTTP status code
  if (statusCode !== undefined) {
    if (config.retryableStatusCodes.includes(statusCode)) {
      return {
        isRetryable: true,
        errorType: 'transient',
        reason: `HTTP ${statusCode} is retryable`,
      };
    }

    // 4xx errors (except 408, 429) are usually permanent
    if (statusCode >= 400 && statusCode < 500) {
      return {
        isRetryable: false,
        errorType: 'permanent',
        reason: `HTTP ${statusCode} is a client error`,
      };
    }
  }

  // Check error message patterns
  for (const pattern of config.transientErrorPatterns) {
    if (lowerMessage.includes(pattern.toLowerCase())) {
      return {
        isRetryable: true,
        errorType: 'transient',
        reason: `Error matches transient pattern: ${pattern}`,
      };
    }
  }

  // Check for specific permanent error types
  const permanentPatterns = [
    'not found',
    '404',
    'forbidden',
    '403',
    'unauthorized',
    '401',
    'invalid url',
    'malformed',
    'robots.txt',
    'blocked',
  ];

  for (const pattern of permanentPatterns) {
    if (lowerMessage.includes(pattern)) {
      return {
        isRetryable: false,
        errorType: 'permanent',
        reason: `Error matches permanent pattern: ${pattern}`,
      };
    }
  }

  // Default: unknown errors are retryable (be optimistic)
  return {
    isRetryable: true,
    errorType: 'unknown',
    reason: 'Unknown error type, assuming retryable',
  };
}

/**
 * Calculate delay for a retry attempt using exponential backoff with jitter
 */
export function calculateRetryDelay(attempt: number, config?: RetryConfig): number {
  const cfg = config || getRetryConfig();

  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  let delay = cfg.initialDelayMs * Math.pow(cfg.backoffMultiplier, attempt);

  // Cap at max delay
  delay = Math.min(delay, cfg.maxDelayMs);

  // Add jitter (random variation)
  if (cfg.jitter > 0) {
    const jitterRange = delay * cfg.jitter;
    const jitterOffset = (Math.random() * 2 - 1) * jitterRange;
    delay = Math.max(0, delay + jitterOffset);
  }

  return Math.round(delay);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an async operation with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    operationName?: string;
    config?: RetryConfig;
    onRetry?: (attempt: number, error: Error, delay: number) => void;
  } = {}
): Promise<RetryResult<T>> {
  const config = options.config || getRetryConfig();
  const operationName = options.operationName || 'operation';

  const startTime = Date.now();
  let lastError: Error | undefined;
  let attempts = 0;
  let totalDelay = 0;

  while (attempts <= config.maxRetries) {
    attempts++;
    stats.totalAttempts++;

    try {
      const result = await operation();

      // Success
      if (attempts > 1) {
        stats.successfulRetries++;
        console.log(`[RETRY] ${operationName} succeeded on attempt ${attempts}`);
      }

      return {
        success: true,
        result,
        attempts,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Track error type
      const errorType = lastError.name || 'UnknownError';
      stats.errorsByType.set(errorType, (stats.errorsByType.get(errorType) || 0) + 1);

      // Classify the error
      const classification = classifyError(lastError);

      // If not retryable, fail immediately
      if (!classification.isRetryable) {
        stats.permanentFailures++;
        console.log(`[RETRY] ${operationName} failed permanently: ${classification.reason}`);

        return {
          success: false,
          error: lastError.message,
          attempts,
          totalDurationMs: Date.now() - startTime,
          lastError,
        };
      }

      // Check if we have more retries
      if (attempts > config.maxRetries) {
        stats.failedRetries++;
        console.log(`[RETRY] ${operationName} failed after ${attempts} attempts`);
        break;
      }

      // Calculate delay and wait
      const delay = calculateRetryDelay(attempts - 1, config);
      totalDelay += delay;
      stats.totalDelayMs += delay;

      console.log(
        `[RETRY] ${operationName} attempt ${attempts} failed: ${lastError.message}. ` +
        `Retrying in ${delay}ms (${classification.reason})`
      );

      // Notify callback
      if (options.onRetry) {
        options.onRetry(attempts, lastError, delay);
      }

      await sleep(delay);
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    attempts,
    totalDurationMs: Date.now() - startTime,
    lastError,
  };
}

/**
 * Check if an HTTP status code is retryable
 */
export function isRetryableStatusCode(statusCode: number): boolean {
  const config = getRetryConfig();
  return config.retryableStatusCodes.includes(statusCode);
}

/**
 * Get retry statistics
 */
export function getRetryStats(): {
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  permanentFailures: number;
  totalDelayMs: number;
  averageDelayMs: number;
  errorsByType: Record<string, number>;
} {
  const totalRetries = stats.successfulRetries + stats.failedRetries;
  const averageDelayMs = totalRetries > 0 ? Math.round(stats.totalDelayMs / totalRetries) : 0;

  return {
    totalAttempts: stats.totalAttempts,
    successfulRetries: stats.successfulRetries,
    failedRetries: stats.failedRetries,
    permanentFailures: stats.permanentFailures,
    totalDelayMs: stats.totalDelayMs,
    averageDelayMs,
    errorsByType: Object.fromEntries(stats.errorsByType),
  };
}

/**
 * Reset retry statistics
 */
export function resetRetryStats(): void {
  stats.totalAttempts = 0;
  stats.successfulRetries = 0;
  stats.failedRetries = 0;
  stats.permanentFailures = 0;
  stats.totalDelayMs = 0;
  stats.errorsByType.clear();
}

export default {
  classifyError,
  calculateRetryDelay,
  withRetry,
  isRetryableStatusCode,
  getRetryStats,
  resetRetryStats,
};
