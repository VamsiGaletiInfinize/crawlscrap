/**
 * QUEUE SERVICE
 *
 * Manages Redis connection and BullMQ queues.
 * Supports graceful fallback to in-memory mode when Redis is unavailable.
 */

import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  getRedisConfig,
  getQueueConfig,
  QUEUE_NAMES,
  REDIS_KEYS,
  REDIS_PREFIX,
  type RedisConfig,
  type QueueConfig,
} from '../config/redis.js';

// Connection state
let redisConnection: Redis | null = null;
let isRedisConnected = false;
let connectionAttempted = false;

// Queues
let crawlJobsQueue: Queue | null = null;
let crawlJobsEvents: QueueEvents | null = null;

// Workers (will be set up by jobProcessor)
const workers: Worker[] = [];

/**
 * Initialize Redis connection
 * Returns true if connected, false if fallback mode
 */
export async function initializeRedis(): Promise<boolean> {
  if (connectionAttempted) {
    return isRedisConnected;
  }

  connectionAttempted = true;
  const config = getRedisConfig();

  console.log(`[QUEUE] Connecting to Redis at ${config.host}:${config.port}...`);

  try {
    redisConnection = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      maxRetriesPerRequest: null,  // Required for BullMQ
      retryStrategy: (times: number) => {
        if (times > config.maxRetries) {
          return null; // Stop retrying
        }
        return Math.min(times * 200, 2000); // Exponential backoff
      },
      lazyConnect: true,
    });

    // Attempt connection with timeout
    await Promise.race([
      redisConnection.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      ),
    ]);

    // Test connection
    await redisConnection.ping();

    isRedisConnected = true;
    console.log(`[QUEUE] Redis connected successfully`);

    // Initialize queues
    await initializeQueues();

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[QUEUE] Redis connection failed: ${errorMessage}`);

    if (config.required) {
      throw new Error(`Redis is required but unavailable: ${errorMessage}`);
    }

    console.log(`[QUEUE] Falling back to in-memory mode`);
    isRedisConnected = false;

    // Clean up failed connection
    if (redisConnection) {
      try {
        redisConnection.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      redisConnection = null;
    }

    return false;
  }
}

/**
 * Initialize BullMQ queues
 */
async function initializeQueues(): Promise<void> {
  if (!redisConnection) {
    throw new Error('Redis connection not established');
  }

  const queueConfig = getQueueConfig();

  // Create crawl-jobs queue
  crawlJobsQueue = new Queue(QUEUE_NAMES.CRAWL_JOBS, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: queueConfig.maxRetries,
      backoff: {
        type: 'exponential',
        delay: queueConfig.backoffDelay,
      },
      removeOnComplete: {
        age: queueConfig.removeOnComplete / 1000, // Convert to seconds
        count: 1000, // Keep last 1000 completed jobs
      },
      removeOnFail: {
        age: queueConfig.removeOnFail / 1000,
        count: 500,
      },
    },
  });

  // Create queue events listener
  crawlJobsEvents = new QueueEvents(QUEUE_NAMES.CRAWL_JOBS, {
    connection: redisConnection.duplicate(),
  });

  console.log(`[QUEUE] Queues initialized: ${QUEUE_NAMES.CRAWL_JOBS}`);
}

/**
 * Add a job to the crawl queue
 */
export async function addCrawlJob(
  jobId: string,
  data: {
    seedUrl: string;
    depth: number;
    operationMode: string;
    outputFormat: string;
  }
): Promise<Job | null> {
  if (!crawlJobsQueue) {
    console.log(`[QUEUE] Queue not available, job ${jobId} will use in-memory processing`);
    return null;
  }

  const job = await crawlJobsQueue.add(
    'crawl',
    {
      jobId,
      ...data,
    },
    {
      jobId, // Use our job ID as BullMQ job ID
    }
  );

  console.log(`[QUEUE] Job ${jobId} added to queue`);
  return job;
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  connected: boolean;
  queues: {
    name: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }[];
}> {
  if (!isRedisConnected || !crawlJobsQueue) {
    return {
      connected: false,
      queues: [],
    };
  }

  try {
    const counts = await crawlJobsQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed'
    );

    return {
      connected: true,
      queues: [
        {
          name: QUEUE_NAMES.CRAWL_JOBS,
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          completed: counts.completed || 0,
          failed: counts.failed || 0,
          delayed: counts.delayed || 0,
        },
      ],
    };
  } catch (error) {
    console.error('[QUEUE] Failed to get queue stats:', error);
    return {
      connected: false,
      queues: [],
    };
  }
}

/**
 * Get jobs from a queue by state
 */
export async function getQueueJobs(
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' = 'waiting',
  start = 0,
  end = 20
): Promise<{
  jobs: Array<{
    id: string;
    data: unknown;
    progress: number | object;
    state: string;
    timestamp: number;
    failedReason?: string;
  }>;
  total: number;
}> {
  if (!isRedisConnected || !crawlJobsQueue) {
    return { jobs: [], total: 0 };
  }

  try {
    const jobs = await crawlJobsQueue.getJobs([state], start, end);
    const counts = await crawlJobsQueue.getJobCounts(state);

    return {
      jobs: jobs.map((job) => ({
        id: job.id || 'unknown',
        data: job.data,
        progress: typeof job.progress === 'object' ? job.progress : { percent: job.progress },
        state,
        timestamp: job.timestamp,
        failedReason: job.failedReason,
      })),
      total: counts[state] || 0,
    };
  } catch (error) {
    console.error('[QUEUE] Failed to get queue jobs:', error);
    return { jobs: [], total: 0 };
  }
}

/**
 * Register a worker for the crawl queue
 */
export function registerWorker(worker: Worker): void {
  workers.push(worker);
}

/**
 * Get the crawl jobs queue (for processor setup)
 */
export function getCrawlJobsQueue(): Queue | null {
  return crawlJobsQueue;
}

/**
 * Get the queue events (for event listeners)
 */
export function getCrawlJobsEvents(): QueueEvents | null {
  return crawlJobsEvents;
}

/**
 * Get Redis connection (for direct operations)
 */
export function getRedisConnection(): Redis | null {
  return redisConnection;
}

/**
 * Check if Redis is connected
 */
export function isQueueAvailable(): boolean {
  return isRedisConnected;
}

/**
 * Store job data in Redis
 */
export async function setJobInRedis(
  jobId: string,
  data: Record<string, string | number | null>
): Promise<boolean> {
  if (!redisConnection) return false;

  try {
    const key = REDIS_KEYS.job(jobId);
    const hashData: Record<string, string> = {};

    for (const [k, v] of Object.entries(data)) {
      if (v !== null && v !== undefined) {
        hashData[k] = String(v);
      }
    }

    await redisConnection.hset(key, hashData);

    // Add to jobs index (sorted by created time)
    const createdAt = data.createdAt ? new Date(String(data.createdAt)).getTime() : Date.now();
    await redisConnection.zadd(REDIS_KEYS.jobsIndex, createdAt, jobId);

    // Add to status set
    if (data.status) {
      await redisConnection.sadd(REDIS_KEYS.jobsByStatus(String(data.status)), jobId);
    }

    return true;
  } catch (error) {
    console.error('[QUEUE] Failed to store job in Redis:', error);
    return false;
  }
}

/**
 * Get job data from Redis
 */
export async function getJobFromRedis(jobId: string): Promise<Record<string, string> | null> {
  if (!redisConnection) return null;

  try {
    const key = REDIS_KEYS.job(jobId);
    const data = await redisConnection.hgetall(key);

    if (Object.keys(data).length === 0) {
      return null;
    }

    return data;
  } catch (error) {
    console.error('[QUEUE] Failed to get job from Redis:', error);
    return null;
  }
}

/**
 * Update job status in Redis
 */
export async function updateJobStatusInRedis(
  jobId: string,
  oldStatus: string,
  newStatus: string
): Promise<boolean> {
  if (!redisConnection) return false;

  try {
    // Update hash
    await redisConnection.hset(REDIS_KEYS.job(jobId), 'status', newStatus);

    // Move between status sets
    await redisConnection.srem(REDIS_KEYS.jobsByStatus(oldStatus), jobId);
    await redisConnection.sadd(REDIS_KEYS.jobsByStatus(newStatus), jobId);

    return true;
  } catch (error) {
    console.error('[QUEUE] Failed to update job status in Redis:', error);
    return false;
  }
}

/**
 * Delete job from Redis
 */
export async function deleteJobFromRedis(jobId: string): Promise<boolean> {
  if (!redisConnection) return false;

  try {
    const jobData = await redisConnection.hgetall(REDIS_KEYS.job(jobId));
    const status = jobData.status;

    // Delete job hash
    await redisConnection.del(REDIS_KEYS.job(jobId));
    await redisConnection.del(REDIS_KEYS.jobProgress(jobId));
    await redisConnection.del(REDIS_KEYS.jobResults(jobId));

    // Remove from index
    await redisConnection.zrem(REDIS_KEYS.jobsIndex, jobId);

    // Remove from status set
    if (status) {
      await redisConnection.srem(REDIS_KEYS.jobsByStatus(status), jobId);
    }

    return true;
  } catch (error) {
    console.error('[QUEUE] Failed to delete job from Redis:', error);
    return false;
  }
}

/**
 * Graceful shutdown
 */
export async function shutdownQueues(): Promise<void> {
  console.log('[QUEUE] Shutting down...');

  // Close workers
  for (const worker of workers) {
    try {
      await worker.close();
    } catch (error) {
      console.error('[QUEUE] Error closing worker:', error);
    }
  }

  // Close queue events
  if (crawlJobsEvents) {
    try {
      await crawlJobsEvents.close();
    } catch (error) {
      console.error('[QUEUE] Error closing queue events:', error);
    }
  }

  // Close queue
  if (crawlJobsQueue) {
    try {
      await crawlJobsQueue.close();
    } catch (error) {
      console.error('[QUEUE] Error closing queue:', error);
    }
  }

  // Close Redis connection
  if (redisConnection) {
    try {
      redisConnection.disconnect();
    } catch (error) {
      console.error('[QUEUE] Error closing Redis connection:', error);
    }
  }

  console.log('[QUEUE] Shutdown complete');
}

export default {
  initializeRedis,
  addCrawlJob,
  getQueueStats,
  getQueueJobs,
  isQueueAvailable,
  shutdownQueues,
};
