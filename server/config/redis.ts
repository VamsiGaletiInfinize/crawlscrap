/**
 * REDIS CONFIGURATION
 *
 * Configuration for Redis connection and BullMQ queues.
 * Supports graceful fallback to in-memory mode when Redis is unavailable.
 */

export interface RedisConfig {
  // Redis server host
  host: string;

  // Redis server port
  port: number;

  // Redis password (optional)
  password?: string;

  // Redis database number
  db: number;

  // Maximum connection retries before fallback
  maxRetries: number;

  // Whether Redis is required (fail if unavailable)
  required: boolean;
}

export interface QueueConfig {
  // Number of concurrent jobs to process
  concurrency: number;

  // Maximum retry attempts for failed jobs
  maxRetries: number;

  // Backoff delay in ms for retries
  backoffDelay: number;

  // Remove completed jobs after this many ms (0 = keep forever)
  removeOnComplete: number;

  // Remove failed jobs after this many ms (0 = keep forever)
  removeOnFail: number;
}

/**
 * Default Redis configuration
 */
export const redisConfig: RedisConfig = {
  host: 'localhost',
  port: 6379,
  password: undefined,
  db: 0,
  maxRetries: 3,
  required: false,
};

/**
 * Default queue configuration
 */
export const queueConfig: QueueConfig = {
  concurrency: 2,
  maxRetries: 3,
  backoffDelay: 1000,
  removeOnComplete: 3600000, // 1 hour
  removeOnFail: 86400000, // 24 hours
};

/**
 * Get Redis configuration with environment variable overrides
 */
export function getRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST || redisConfig.host,
    port: parseInt(process.env.REDIS_PORT || String(redisConfig.port), 10),
    password: process.env.REDIS_PASSWORD || redisConfig.password,
    db: parseInt(process.env.REDIS_DB || String(redisConfig.db), 10),
    maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || String(redisConfig.maxRetries), 10),
    required: process.env.REDIS_REQUIRED === 'true',
  };
}

/**
 * Get queue configuration with environment variable overrides
 */
export function getQueueConfig(): QueueConfig {
  return {
    concurrency: parseInt(process.env.BULL_CONCURRENCY || String(queueConfig.concurrency), 10),
    maxRetries: parseInt(process.env.BULL_MAX_RETRIES || String(queueConfig.maxRetries), 10),
    backoffDelay: parseInt(process.env.BULL_BACKOFF_DELAY || String(queueConfig.backoffDelay), 10),
    removeOnComplete: parseInt(
      process.env.BULL_REMOVE_COMPLETED || String(queueConfig.removeOnComplete),
      10
    ),
    removeOnFail: parseInt(process.env.BULL_REMOVE_FAILED || String(queueConfig.removeOnFail), 10),
  };
}

/**
 * Redis key prefix for all CrawlScrap keys
 */
export const REDIS_PREFIX = 'crawlscrap';

/**
 * Redis key patterns
 */
export const REDIS_KEYS = {
  job: (jobId: string) => `${REDIS_PREFIX}:job:${jobId}`,
  jobProgress: (jobId: string) => `${REDIS_PREFIX}:job:${jobId}:progress`,
  jobResults: (jobId: string) => `${REDIS_PREFIX}:job:${jobId}:results`,
  jobsIndex: `${REDIS_PREFIX}:jobs:index`,
  jobsByStatus: (status: string) => `${REDIS_PREFIX}:jobs:by-status:${status}`,
} as const;

/**
 * Queue names
 */
export const QUEUE_NAMES = {
  CRAWL_JOBS: 'crawl-jobs',
  URL_BATCH: 'url-batch',
} as const;

export default { redisConfig, queueConfig, getRedisConfig, getQueueConfig };
