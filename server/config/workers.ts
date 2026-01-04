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
 * Default worker pool configuration - OPTIMIZED FOR STABILITY
 *
 * MEMORY-SAFE CONFIGURATION:
 * - 4 workers: 4 parallel browser instances (~2GB RAM)
 * - 5 concurrent pages: 5 tabs per browser
 * - Total parallelism: 4 × 5 = 20 simultaneous page loads
 * - 30 batch size: Smaller batches for memory efficiency
 * - 45s timeout: Allow slow JS-heavy pages to load
 *
 * This configuration prevents memory overload on 8GB systems
 * while still providing significant parallelism.
 */
export const workerConfig: WorkerPoolConfig = {
  workers: 4,              // Reduced from 8 for memory safety
  batchSize: 30,           // Reduced from 50 for memory efficiency
  headless: true,
  timeout: 45000,
  minUrlsForParallel: 5,
  concurrentPages: 5,      // Reduced from 10 for memory safety
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