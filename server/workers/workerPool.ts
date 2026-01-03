/**
 * WORKER POOL - Manages multiple crawler instances for parallel processing
 *
 * The pool:
 * - Creates and manages a configurable number of workers
 * - Distributes URLs across workers in batches
 * - Aggregates results from all workers
 * - Handles worker lifecycle (init, process, shutdown)
 *
 * This enables 5x faster crawling through parallelization.
 */

import { CrawlWorker, WorkerTask, WorkerResult } from './crawlWorker.js';
import { ScrapedContent } from '../services/scraper.js';
import { DiscoveredUrl } from '../services/crawler.js';

/**
 * Pool configuration
 */
export interface PoolConfig {
  workers: number;           // Number of parallel workers (browser instances)
  batchSize: number;         // URLs per batch per worker
  headless: boolean;         // Run browsers headlessly
  timeout: number;           // Page load timeout in ms
  concurrentPages: number;   // Concurrent pages per worker (tabs per browser)
}

/**
 * Default pool configuration - OPTIMIZED FOR MAXIMUM PARALLELISM
 *
 * With 8 workers × 10 concurrent pages = 80 parallel page loads!
 */
export const DEFAULT_POOL_CONFIG: PoolConfig = {
  workers: 8,              // 8 parallel browser instances
  batchSize: 50,           // 50 URLs per batch
  headless: true,
  timeout: 45000,          // 45 second timeout
  concurrentPages: 10,     // 10 concurrent pages per browser
};

/**
 * Pool progress callback
 */
export type ProgressCallback = (completed: number, total: number, workerId: number) => void;

/**
 * Pool statistics
 */
export interface PoolStats {
  totalUrls: number;
  completedUrls: number;
  successfulUrls: number;
  failedUrls: number;
  totalDurationMs: number;
  avgDurationPerUrl: number;
  workersUsed: number;
}

/**
 * WorkerPool class - coordinates multiple workers for parallel scraping
 */
export class WorkerPool {
  private config: PoolConfig;
  private workers: CrawlWorker[] = [];
  private isInitialized = false;
  private isProcessing = false;

  constructor(config: Partial<PoolConfig> = {}) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  /**
   * Initialize all workers in the pool
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log(`[POOL] Initializing ${this.config.workers} workers...`);

    // Create workers with full config
    for (let i = 0; i < this.config.workers; i++) {
      const worker = new CrawlWorker({
        workerId: i + 1,
        headless: this.config.headless,
        timeout: this.config.timeout,
        concurrentPages: this.config.concurrentPages,
      });
      this.workers.push(worker);
    }

    // Initialize all workers in parallel
    await Promise.all(this.workers.map((w) => w.initialize()));

    this.isInitialized = true;
    console.log(`[POOL] All ${this.config.workers} workers initialized`);
  }

  /**
   * Shutdown all workers in the pool
   */
  async shutdown(): Promise<void> {
    console.log('[POOL] Shutting down workers...');

    // Stop all workers
    this.workers.forEach((w) => w.stop());

    // Shutdown all workers in parallel
    await Promise.all(this.workers.map((w) => w.shutdown()));

    this.workers = [];
    this.isInitialized = false;
    this.isProcessing = false;

    console.log('[POOL] All workers shut down');
  }

  /**
   * Convert discovered URLs to worker tasks
   */
  private urlsToTasks(urls: DiscoveredUrl[]): WorkerTask[] {
    return urls.map((u) => ({
      url: u.url,
      depth: u.depth,
      parentUrl: u.parentUrl,
    }));
  }

  /**
   * Distribute tasks across workers
   */
  private distributeTasks(tasks: WorkerTask[]): WorkerTask[][] {
    const distributed: WorkerTask[][] = Array.from(
      { length: this.config.workers },
      () => []
    );

    // Round-robin distribution
    tasks.forEach((task, index) => {
      const workerIndex = index % this.config.workers;
      distributed[workerIndex].push(task);
    });

    return distributed;
  }

  /**
   * Process URLs in parallel using all workers
   */
  async processUrls(
    urls: DiscoveredUrl[],
    onProgress?: ProgressCallback
  ): Promise<ScrapedContent[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isProcessing) {
      throw new Error('Pool is already processing');
    }

    this.isProcessing = true;
    const startTime = Date.now();

    console.log(`[POOL] Processing ${urls.length} URLs with ${this.config.workers} workers`);

    // Convert URLs to tasks
    const tasks = this.urlsToTasks(urls);

    // Distribute tasks across workers
    const distributedTasks = this.distributeTasks(tasks);

    // Track progress
    let completedCount = 0;
    const totalCount = tasks.length;
    const allResults: WorkerResult[] = [];

    // Process with all workers in parallel
    const workerPromises = this.workers.map(async (worker, index) => {
      const workerTasks = distributedTasks[index];
      if (workerTasks.length === 0) return [];

      console.log(`[POOL] Worker ${index + 1} processing ${workerTasks.length} URLs`);

      const results: WorkerResult[] = [];

      // Process in batches
      for (let i = 0; i < workerTasks.length; i += this.config.batchSize) {
        const batch = workerTasks.slice(i, i + this.config.batchSize);
        const batchResults = await worker.processBatch(batch);

        results.push(...batchResults);
        completedCount += batchResults.length;

        // Report progress
        if (onProgress) {
          onProgress(completedCount, totalCount, worker.getWorkerId());
        }
      }

      return results;
    });

    // Wait for all workers to complete
    const workerResults = await Promise.all(workerPromises);

    // Flatten results
    workerResults.forEach((results) => allResults.push(...results));

    // Extract successful scraped content
    const scrapedContent: ScrapedContent[] = allResults
      .filter((r) => r.success && r.content)
      .map((r) => r.content!);

    const totalDuration = Date.now() - startTime;
    const successCount = allResults.filter((r) => r.success).length;
    const failCount = allResults.filter((r) => !r.success).length;

    console.log(`[POOL] Processing complete:`);
    console.log(`  - Total URLs: ${totalCount}`);
    console.log(`  - Successful: ${successCount}`);
    console.log(`  - Failed: ${failCount}`);
    console.log(`  - Duration: ${totalDuration}ms`);
    console.log(`  - Avg per URL: ${Math.round(totalDuration / totalCount)}ms`);

    this.isProcessing = false;

    return scrapedContent;
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    workers: number;
    batchSize: number;
    isInitialized: boolean;
    isProcessing: boolean;
  } {
    return {
      workers: this.config.workers,
      batchSize: this.config.batchSize,
      isInitialized: this.isInitialized,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): PoolConfig {
    return { ...this.config };
  }
}

/**
 * Singleton pool instance for reuse
 */
let globalPool: WorkerPool | null = null;

/**
 * Get or create the global worker pool
 */
export function getWorkerPool(config?: Partial<PoolConfig>): WorkerPool {
  if (!globalPool) {
    globalPool = new WorkerPool(config);
  }
  return globalPool;
}

/**
 * Shutdown the global pool
 */
export async function shutdownGlobalPool(): Promise<void> {
  if (globalPool) {
    await globalPool.shutdown();
    globalPool = null;
  }
}

export default WorkerPool;