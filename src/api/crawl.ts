/**
 * API Endpoint - /api/crawl
 *
 * Handles crawl requests from the Admin UI:
 * - Accepts seedUrl and depth parameters
 * - Triggers the crawler
 * - Saves results to JSON file
 * - Returns results to the client
 */

import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { runCrawler, CrawlResult } from '../crawler/crawler.js';

const router = Router();

// Data directory for JSON output
const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * Request body for /api/crawl
 */
interface CrawlRequest {
  seedUrl: string;
  depth?: number;
}

/**
 * Validate URL format
 */
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Ensure data directory exists
 */
async function ensureDataDir(): Promise<void> {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

/**
 * Save crawl results to JSON file
 */
async function saveResults(result: CrawlResult): Promise<string> {
  await ensureDataDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `crawl-${timestamp}.json`;
  const filepath = path.join(DATA_DIR, filename);

  await fs.writeFile(filepath, JSON.stringify(result, null, 2), 'utf-8');

  return filename;
}

/**
 * POST /api/crawl
 *
 * Starts a crawl operation and returns the results.
 *
 * Request body:
 * {
 *   "seedUrl": "https://example.com",
 *   "depth": 2  // optional, defaults to 1
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "filename": "crawl-2025-12-18T10-00-00-000Z.json",
 *   "crawlId": "uuid",
 *   "pagesScraped": 5,
 *   "results": [...]
 * }
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { seedUrl, depth = 1 } = req.body as CrawlRequest;

    // Validate seedUrl
    if (!seedUrl) {
      res.status(400).json({
        success: false,
        error: 'seedUrl is required',
      });
      return;
    }

    if (!isValidUrl(seedUrl)) {
      res.status(400).json({
        success: false,
        error: 'Invalid URL format. Must be http:// or https://',
      });
      return;
    }

    // Validate depth
    const maxDepth = Math.min(Math.max(0, Number(depth)), 5); // Limit depth 0-5

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Starting crawl: ${seedUrl}`);
    console.log(`Max depth: ${maxDepth}`);
    console.log(`${'='.repeat(50)}\n`);

    // Generate unique crawl ID
    const crawlId = uuidv4();

    // Run the crawler (synchronous - waits for completion)
    const result = await runCrawler({ seedUrl, maxDepth, includeSubpages: true }, crawlId);

    // Save results to JSON file
    const filename = await saveResults(result);

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Crawl complete!`);
    console.log(`Pages scraped: ${result.results.length}`);
    console.log(`Saved to: data/${filename}`);
    console.log(`${'='.repeat(50)}\n`);

    // Return results to client
    res.json({
      success: true,
      filename,
      crawlId: result.crawlId,
      pagesScraped: result.results.length,
      results: result.results,
    });
  } catch (error) {
    console.error('Crawl error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

export default router;
