/**
 * WORKER CONFIGURATION
 *
 * Configuration for the parallel worker pool.
 * Adjust these values based on system resources.
 */

export interface WorkerPoolConfig {
  // Number of parallel workers (browser instances)
  workers: number;

  // URLs to process per batch per worker
  batchSize: number;

  // Run browsers in headless mode
  headless: boolean;

  // Page load timeout in milliseconds
  timeout: number;

  // Minimum URLs to trigger parallel processing
  // Below this threshold, use single-threaded processing
  minUrlsForParallel: number;

  // Concurrent pages per worker (tabs per browser)
  // With 8 workers × 10 pages = 80 parallel page loads
  concurrentPages: number;
}

/**
 * Default worker pool configuration - OPTIMIZED FOR MAXIMUM SPEED
 *
 * - 8 workers: 8 parallel browser instances (~4GB RAM)
 * - 10 concurrent pages: 10 tabs per browser
 * - Total parallelism: 8 × 10 = 80 simultaneous page loads!
 * - 50 batch size: Smaller batches for better progress tracking
 * - 45s timeout: Allow slow pages to load fully
 */
export const workerConfig: WorkerPoolConfig = {
  workers: 8,
  batchSize: 50,
  headless: true,
  timeout: 45000,
  minUrlsForParallel: 5,
  concurrentPages: 10,
};

/**
 * Environment variable overrides
 */
export function getWorkerConfig(): WorkerPoolConfig {
  return {
    workers: parseInt(process.env.CRAWLER_WORKERS || String(workerConfig.workers), 10),
    batchSize: parseInt(process.env.CRAWLER_BATCH_SIZE || String(workerConfig.batchSize), 10),
    headless: process.env.CRAWLER_HEADLESS !== 'false',
    timeout: parseInt(process.env.CRAWLER_TIMEOUT || String(workerConfig.timeout), 10),
    minUrlsForParallel: parseInt(
      process.env.CRAWLER_MIN_PARALLEL || String(workerConfig.minUrlsForParallel),
      10
    ),
    concurrentPages: parseInt(
      process.env.CRAWLER_CONCURRENT_PAGES || String(workerConfig.concurrentPages),
      10
    ),
  };
}

export default workerConfig;