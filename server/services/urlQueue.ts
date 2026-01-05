/**
 * URL QUEUE - Streaming URL Pipeline
 *
 * High-performance URL queue that enables pipeline processing:
 * - URLs are added as they're discovered (streaming)
 * - Workers consume URLs immediately without waiting for crawl to complete
 * - Domain-aware batching for optimized rate limiting
 * - Deduplication built-in
 */

import { EventEmitter } from 'events';

export interface QueuedUrl {
  url: string;
  depth: number;
  parentUrl: string | null;
  domain: string;
  priority: number;  // Lower = higher priority
  addedAt: number;
}

export interface UrlQueueConfig {
  maxSize: number;           // Maximum URLs in queue
  batchSize: number;         // URLs per batch to workers
  domainBatchSize: number;   // Max URLs per domain per batch
  priorityBoost: number;     // Priority boost for same-domain URLs
}

const defaultConfig: UrlQueueConfig = {
  maxSize: 500000,
  batchSize: 50,
  domainBatchSize: 10,
  priorityBoost: 5,
};

/**
 * High-performance streaming URL queue with domain-aware batching
 */
export class UrlQueue extends EventEmitter {
  private queue: Map<string, QueuedUrl> = new Map();  // URL -> QueuedUrl (dedup)
  private domainQueues: Map<string, string[]> = new Map();  // domain -> URLs
  private config: UrlQueueConfig;
  private processed: Set<string> = new Set();
  private inProgress: Set<string> = new Set();
  private _isComplete: boolean = false;
  private stats = {
    added: 0,
    duplicates: 0,
    processed: 0,
    failed: 0,
  };

  constructor(config: Partial<UrlQueueConfig> = {}) {
    super();
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Extract domain from URL
   */
  private getDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Add URL to queue (streaming - called as URLs are discovered)
   */
  add(url: string, depth: number, parentUrl: string | null, priority: number = depth): boolean {
    // Skip if already processed or in queue
    if (this.processed.has(url) || this.queue.has(url) || this.inProgress.has(url)) {
      this.stats.duplicates++;
      return false;
    }

    // Check queue size limit
    if (this.queue.size >= this.config.maxSize) {
      this.emit('overflow', url);
      return false;
    }

    const domain = this.getDomain(url);
    const queuedUrl: QueuedUrl = {
      url,
      depth,
      parentUrl,
      domain,
      priority,
      addedAt: Date.now(),
    };

    // Add to main queue
    this.queue.set(url, queuedUrl);

    // Add to domain queue
    if (!this.domainQueues.has(domain)) {
      this.domainQueues.set(domain, []);
    }
    this.domainQueues.get(domain)!.push(url);

    this.stats.added++;
    this.emit('url-added', queuedUrl);

    return true;
  }

  /**
   * Add multiple URLs at once (batch operation)
   */
  addBatch(urls: Array<{ url: string; depth: number; parentUrl: string | null }>): number {
    let added = 0;
    for (const { url, depth, parentUrl } of urls) {
      if (this.add(url, depth, parentUrl)) {
        added++;
      }
    }
    return added;
  }

  /**
   * Get next batch of URLs for processing
   * Uses domain-aware batching to optimize rate limiting
   */
  getBatch(): QueuedUrl[] {
    if (this.queue.size === 0) {
      return [];
    }

    const batch: QueuedUrl[] = [];
    const domainsInBatch: Map<string, number> = new Map();

    // Sort URLs by priority (lower = higher priority)
    const sortedUrls = Array.from(this.queue.values())
      .sort((a, b) => a.priority - b.priority);

    for (const queuedUrl of sortedUrls) {
      if (batch.length >= this.config.batchSize) {
        break;
      }

      // Check domain limit in this batch
      const domainCount = domainsInBatch.get(queuedUrl.domain) || 0;
      if (domainCount >= this.config.domainBatchSize) {
        continue;  // Skip this URL, too many from same domain
      }

      // Add to batch
      batch.push(queuedUrl);
      domainsInBatch.set(queuedUrl.domain, domainCount + 1);

      // Move from queue to in-progress
      this.queue.delete(queuedUrl.url);
      this.inProgress.add(queuedUrl.url);
    }

    return batch;
  }

  /**
   * Mark URL as successfully processed
   */
  complete(url: string): void {
    this.inProgress.delete(url);
    this.processed.add(url);
    this.stats.processed++;
    this.emit('url-complete', url);
  }

  /**
   * Mark URL as failed (can be retried)
   */
  fail(url: string, retry: boolean = false): void {
    this.inProgress.delete(url);
    this.stats.failed++;

    if (retry) {
      // Re-add to queue with lower priority
      const domain = this.getDomain(url);
      this.queue.set(url, {
        url,
        depth: 0,
        parentUrl: null,
        domain,
        priority: 100,  // Low priority for retries
        addedAt: Date.now(),
      });
    }

    this.emit('url-failed', url, retry);
  }

  /**
   * Mark crawl discovery as complete
   * Workers should continue until queue is empty
   */
  markDiscoveryComplete(): void {
    this._isComplete = true;
    this.emit('discovery-complete');
  }

  /**
   * Check if queue is empty and discovery is complete
   */
  isFinished(): boolean {
    return this._isComplete && this.queue.size === 0 && this.inProgress.size === 0;
  }

  /**
   * Check if there are URLs available to process
   */
  hasWork(): boolean {
    return this.queue.size > 0;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      queued: this.queue.size,
      inProgress: this.inProgress.size,
      totalProcessed: this.processed.size,
      domains: this.domainQueues.size,
      isComplete: this._isComplete,
    };
  }

  /**
   * Get all domains in queue
   */
  getDomains(): string[] {
    return Array.from(this.domainQueues.keys());
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue.clear();
    this.domainQueues.clear();
    this.processed.clear();
    this.inProgress.clear();
    this._isComplete = false;
    this.stats = { added: 0, duplicates: 0, processed: 0, failed: 0 };
  }
}

// Singleton instance for shared queue
let sharedQueue: UrlQueue | null = null;

export function getSharedQueue(config?: Partial<UrlQueueConfig>): UrlQueue {
  if (!sharedQueue) {
    sharedQueue = new UrlQueue(config);
  }
  return sharedQueue;
}

export function resetSharedQueue(): void {
  if (sharedQueue) {
    sharedQueue.clear();
  }
  sharedQueue = null;
}

export default UrlQueue;
