/**
 * CRAWL WORKER - Individual worker for parallel scraping
 *
 * Each worker:
 * - Processes a batch of URLs
 * - Runs its own Playwright browser instance
 * - Scrapes content from assigned URLs
 * - Returns results to the pool
 *
 * Features:
 * - Rate limiting with robots.txt respect
 * - Circuit breaker for failing domains
 * - Retry logic with exponential backoff
 *
 * Workers are managed by the WorkerPool for parallel processing.
 */

import { chromium, Browser, Page } from 'playwright';
import { ScrapedContent } from '../services/scraper.js';
import { acquireSlot, releaseSlot } from '../services/rateLimiter.js';
import { checkCircuit, recordSuccess, recordFailure } from '../services/circuitBreaker.js';
import { withRetry, classifyError } from '../services/retry.js';
import { getRetryConfig } from '../config/retry.js';
import crypto from 'crypto';

/**
 * Worker configuration
 */
export interface WorkerConfig {
  workerId: number;
  headless: boolean;
  timeout: number; // Page load timeout in ms
  concurrentPages: number; // Number of concurrent pages per worker
}

/**
 * URL to be processed by worker
 */
export interface WorkerTask {
  url: string;
  depth: number;
  parentUrl: string | null;
}

/**
 * Worker result for a single URL
 */
export interface WorkerResult {
  url: string;
  success: boolean;
  content?: ScrapedContent;
  error?: string;
  durationMs: number;
  attempts?: number;        // Number of retry attempts
  circuitState?: string;    // Circuit breaker state
  retryable?: boolean;      // Whether error was retryable
}

/**
 * Default worker configuration
 */
const DEFAULT_CONFIG: WorkerConfig = {
  workerId: 0,
  headless: true,
  timeout: 30000,
  concurrentPages: 10, // Process 10 pages concurrently per worker
};

/**
 * Clean HTML by removing scripts, styles, and other non-content elements
 */
function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(header|footer|nav|aside)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .trim();
}

/**
 * Extract text content from HTML
 */
function extractText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate content hash for deduplication
 */
function generateContentHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex').substring(0, 16);
}

/**
 * Detect language from content (simple heuristic)
 */
function detectLanguage(text: string): string {
  // Simple detection based on common words
  const lowerText = text.toLowerCase();
  if (/\b(the|and|is|are|was|were|have|has|been)\b/.test(lowerText)) {
    return 'en';
  }
  return 'unknown';
}

/**
 * CrawlWorker class - processes URLs in parallel
 */
export class CrawlWorker {
  private config: WorkerConfig;
  private browser: Browser | null = null;
  private isRunning = false;

  constructor(config: Partial<WorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the worker (launch browser)
   */
  async initialize(): Promise<void> {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: this.config.headless,
    });

    console.log(`[WORKER ${this.config.workerId}] Initialized`);
  }

  /**
   * Shutdown the worker (close browser)
   */
  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    console.log(`[WORKER ${this.config.workerId}] Shutdown`);
  }

  /**
   * Process a single URL with circuit breaker and retry logic
   */
  async processUrl(task: WorkerTask): Promise<WorkerResult> {
    const startTime = Date.now();

    if (!this.browser) {
      return {
        url: task.url,
        success: false,
        error: 'Worker not initialized',
        durationMs: Date.now() - startTime,
      };
    }

    // Check circuit breaker first
    const circuitCheck = checkCircuit(task.url);
    if (!circuitCheck.allowed) {
      console.log(`[WORKER ${this.config.workerId}] Circuit OPEN for ${task.url}: ${circuitCheck.reason}`);
      return {
        url: task.url,
        success: false,
        error: circuitCheck.reason || 'Circuit breaker open',
        durationMs: Date.now() - startTime,
        circuitState: circuitCheck.state,
      };
    }

    // Acquire rate limit slot (waits if needed, checks robots.txt)
    const allowed = await acquireSlot(task.url);
    if (!allowed) {
      return {
        url: task.url,
        success: false,
        error: 'Blocked by robots.txt',
        durationMs: Date.now() - startTime,
        circuitState: circuitCheck.state,
      };
    }

    // Use retry wrapper for the actual page processing
    const retryConfig = getRetryConfig();
    const retryResult = await withRetry(
      () => this.scrapePageContent(task),
      {
        operationName: `scrape:${task.url.substring(0, 50)}`,
        config: retryConfig,
        onRetry: (attempt, error, delay) => {
          console.log(
            `[WORKER ${this.config.workerId}] Retry ${attempt} for ${task.url} ` +
            `(waiting ${delay}ms): ${error.message}`
          );
        },
      }
    );

    // Record success/failure for circuit breaker
    if (retryResult.success) {
      recordSuccess(task.url);
      return {
        url: task.url,
        success: true,
        content: retryResult.result,
        durationMs: retryResult.totalDurationMs,
        attempts: retryResult.attempts,
        circuitState: circuitCheck.state,
      };
    } else {
      recordFailure(task.url);
      const classification = retryResult.lastError
        ? classifyError(retryResult.lastError)
        : { isRetryable: false };

      return {
        url: task.url,
        success: false,
        error: retryResult.error,
        durationMs: retryResult.totalDurationMs,
        attempts: retryResult.attempts,
        circuitState: circuitCheck.state,
        retryable: classification.isRetryable,
      };
    }
  }

  /**
   * Scrape page content (internal method called by retry wrapper)
   */
  private async scrapePageContent(task: WorkerTask): Promise<ScrapedContent> {
    let page: Page | null = null;

    try {
      page = await this.browser!.newPage();
      await page.setDefaultTimeout(this.config.timeout);

      // Navigate to URL
      const response = await page.goto(task.url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout,
      });

      const statusCode = response?.status() ?? 200;
      const contentType = response?.headers()?.['content-type'] ?? 'text/html';

      // Check for error status codes that should trigger retry
      if (statusCode >= 500) {
        throw new Error(`HTTP ${statusCode} server error`);
      }

      // Extract content
      const title = await page.title();
      const html = await page.content();

      // Extract headings
      const headings = await page.$$eval('h1, h2, h3', (els) =>
        els.map((el) => el.textContent?.trim() || '').filter(Boolean)
      );

      // Extract links
      const links = await page.$$eval('a[href]', (els) =>
        els
          .map((el) => el.getAttribute('href'))
          .filter((href): href is string => href !== null && href.startsWith('http'))
      );

      // Clean and process content
      const cleanedHtml = cleanHtml(html);
      const textContent = extractText(cleanedHtml);
      const wordCount = textContent.split(/\s+/).filter(Boolean).length;

      const scrapedAt = new Date().toISOString();

      return {
        url: task.url,
        title,
        headings,
        content: textContent.substring(0, 5000), // Limit content size
        links: links.slice(0, 100), // Limit links
        cleanedHtml: cleanedHtml.substring(0, 10000), // Limit HTML size
        metadata: {
          crawledAt: scrapedAt,
          scrapedAt,
          scrapeDurationMs: 0, // Will be set by caller
          depth: task.depth,
          parentUrl: task.parentUrl,
          statusCode,
          contentType: contentType.split(';')[0].trim(),
          wordCount,
          language: detectLanguage(textContent),
          contentHash: generateContentHash(textContent),
          status: 'SUCCESS',
        },
      };
    } finally {
      // Release rate limit slot
      await releaseSlot(task.url);

      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Process a batch of URLs IN PARALLEL
   * Uses concurrentPages limit to control parallelism within each worker
   */
  async processBatch(tasks: WorkerTask[]): Promise<WorkerResult[]> {
    this.isRunning = true;
    const allResults: WorkerResult[] = [];
    const concurrency = this.config.concurrentPages;

    // Process in parallel chunks
    for (let i = 0; i < tasks.length; i += concurrency) {
      if (!this.isRunning) break;

      const chunk = tasks.slice(i, i + concurrency);

      // Process all URLs in this chunk concurrently
      const chunkPromises = chunk.map(task => this.processUrl(task));
      const chunkResults = await Promise.allSettled(chunkPromises);

      // Extract results
      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          allResults.push(result.value);
        } else {
          // Handle rejected promises
          allResults.push({
            url: 'unknown',
            success: false,
            error: result.reason?.message || 'Unknown error',
            durationMs: 0,
          });
        }
      }
    }

    this.isRunning = false;
    return allResults;
  }

  /**
   * Stop processing (graceful shutdown)
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Get worker ID
   */
  getWorkerId(): number {
    return this.config.workerId;
  }
}

export default CrawlWorker;