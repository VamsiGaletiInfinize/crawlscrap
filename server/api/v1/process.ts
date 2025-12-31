/**
 * API Endpoint - /api/process
 *
 * Unified processing endpoint that handles all operation modes:
 * - CRAWL_ONLY: URL discovery without content extraction
 * - SCRAPE_ONLY: Content extraction from provided URL(s)
 * - CRAWL_AND_SCRAPE: URL discovery followed by content extraction
 *
 * Features:
 * - Real-time progress tracking via processId
 * - Validation of crawl vs scrape results
 * - Comprehensive metadata for all outputs
 *
 * Output is saved to separate files:
 * - crawl-output.json: URL discovery results
 * - scrape-output.{json|md|html}: Scraped content in selected format
 * - validation-report.json: Crawl vs scrape validation
 */

import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Import crawler functions
import {
  crawlUrls,
  runCrawler,
  CrawlOnlyResult,
  CrawlResult,
  DiscoveredUrl,
} from '../../services/crawler.js';

// Import scraper functions
import { scrapeUrls, ScrapedContent } from '../../services/scraper.js';

// Import formatter
import {
  formatOutput,
  getFileExtension,
  OutputFormat,
  FormattedOutput,
} from '../../services/formatter.js';

// Import progress tracking
import {
  initProgress,
  startCrawlPhase,
  updateCrawlProgress,
  startScrapePhase,
  updateScrapeProgress,
  startValidationPhase,
  completeProgress,
  errorProgress,
} from '../../services/progress.js';

// Import validation
import {
  validateCrawlVsScrape,
  saveValidationReport,
  generateValidationSummary,
  ValidationReport,
} from '../../services/validator.js';

const router = Router();

// Data directory for output
const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * Operation modes
 */
type OperationMode = 'CRAWL_ONLY' | 'SCRAPE_ONLY' | 'CRAWL_AND_SCRAPE';

/**
 * Request body for /api/process
 */
interface ProcessRequest {
  seedUrl: string;
  includeSubpages?: boolean;
  depth?: number;
  operationMode: OperationMode;
  outputFormat?: OutputFormat;
  processId?: string;  // Optional: frontend can provide for early progress tracking
}

/**
 * Response structure
 */
interface ProcessResponse {
  success: boolean;
  processId: string;
  operationMode: OperationMode;
  outputFormat?: OutputFormat;
  crawlOutput?: {
    filename: string;
    urlsDiscovered: number;
    urls: DiscoveredUrl[];
  };
  scrapeOutput?: {
    filename: string;
    pagesScraped: number;
    format: OutputFormat;
    results: ScrapedContent[];
  };
  validation?: {
    filename: string;
    report: ValidationReport;
    summary: string;
  };
  error?: string;
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
 * Save crawl output to file
 */
async function saveCrawlOutput(result: CrawlOnlyResult): Promise<string> {
  await ensureDataDir();
  const filename = 'crawl-output.json';
  const filepath = path.join(DATA_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(result, null, 2), 'utf-8');
  return filename;
}

/**
 * Save scrape output to file
 */
async function saveScrapeOutput(
  formatted: FormattedOutput
): Promise<string> {
  await ensureDataDir();
  const filename = `scrape-output.${formatted.extension}`;
  const filepath = path.join(DATA_DIR, filename);
  await fs.writeFile(filepath, formatted.content, 'utf-8');
  return filename;
}

/**
 * POST /api/process
 *
 * Main processing endpoint that handles all operation modes.
 *
 * Request body:
 * {
 *   "seedUrl": "https://example.com",
 *   "includeSubpages": true,
 *   "depth": 2,
 *   "operationMode": "CRAWL_AND_SCRAPE",
 *   "outputFormat": "JSON"
 * }
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      seedUrl,
      includeSubpages = true,
      depth = 1,
      operationMode,
      outputFormat = 'JSON',
      processId: providedProcessId,
    } = req.body as ProcessRequest;

    // ========================================
    // VALIDATION
    // ========================================

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

    // Validate operationMode
    const validModes: OperationMode[] = ['CRAWL_ONLY', 'SCRAPE_ONLY', 'CRAWL_AND_SCRAPE'];
    if (!operationMode || !validModes.includes(operationMode)) {
      res.status(400).json({
        success: false,
        error: `Invalid operationMode. Must be one of: ${validModes.join(', ')}`,
      });
      return;
    }

    // Validate outputFormat
    const validFormats: OutputFormat[] = ['JSON', 'MARKDOWN', 'SUMMARY', 'LINKS_ONLY', 'HTML'];
    if (!validFormats.includes(outputFormat)) {
      res.status(400).json({
        success: false,
        error: `Invalid outputFormat. Must be one of: ${validFormats.join(', ')}`,
      });
      return;
    }

    // Validate depth
    const maxDepth = Math.min(Math.max(0, Number(depth)), 5);

    // Use provided processId or generate a new one
    const processId = providedProcessId || uuidv4();

    console.log('\n' + '='.repeat(60));
    console.log('PROCESSING REQUEST');
    console.log('='.repeat(60));
    console.log(`Process ID: ${processId}`);
    console.log(`Seed URL: ${seedUrl}`);
    console.log(`Operation Mode: ${operationMode}`);
    console.log(`Include Subpages: ${includeSubpages}`);
    console.log(`Max Depth: ${maxDepth}`);
    console.log(`Output Format: ${outputFormat}`);
    console.log('='.repeat(60) + '\n');

    // ========================================
    // PROCESSING LOGIC
    // ========================================

    // Initialize progress tracking
    initProgress(processId);

    const response: ProcessResponse = {
      success: true,
      processId,
      operationMode,
      outputFormat: operationMode === 'CRAWL_ONLY' ? undefined : outputFormat,
    };

    // ------------------------------------------
    // MODE: CRAWL_ONLY
    // ------------------------------------------
    if (operationMode === 'CRAWL_ONLY') {
      console.log('[MODE] CRAWL_ONLY - URL Discovery without content extraction');
      startCrawlPhase(processId);

      // Perform URL discovery
      const crawlResult = await crawlUrls(
        { seedUrl, maxDepth, includeSubpages, processId },
        processId
      );

      // Save crawl output
      const crawlFilename = await saveCrawlOutput(crawlResult);

      response.crawlOutput = {
        filename: crawlFilename,
        urlsDiscovered: crawlResult.discoveredUrls.length,
        urls: crawlResult.discoveredUrls,
      };

      console.log(`[COMPLETE] Crawl output saved to: data/${crawlFilename}`);
    }

    // ------------------------------------------
    // MODE: SCRAPE_ONLY
    // ------------------------------------------
    else if (operationMode === 'SCRAPE_ONLY') {
      console.log('[MODE] SCRAPE_ONLY - Content extraction without URL discovery');
      startScrapePhase(processId, 1);

      // Scrape only the seed URL (no crawling)
      const scrapeResults = await scrapeUrls([{ url: seedUrl, depth: 0 }], {
        processId,
        onProgress: (completed, total) => {
          updateScrapeProgress(processId, completed, total);
        },
      });

      // Format output
      const formatted = formatOutput(scrapeResults, outputFormat);

      // Save scrape output
      const scrapeFilename = await saveScrapeOutput(formatted);

      response.scrapeOutput = {
        filename: scrapeFilename,
        pagesScraped: scrapeResults.length,
        format: outputFormat,
        results: scrapeResults,
      };

      console.log(`[COMPLETE] Scrape output saved to: data/${scrapeFilename}`);
    }

    // ------------------------------------------
    // MODE: CRAWL_AND_SCRAPE
    // ------------------------------------------
    else if (operationMode === 'CRAWL_AND_SCRAPE') {
      console.log('[MODE] CRAWL_AND_SCRAPE - URL Discovery + Content extraction');

      // PHASE 1: Crawl (URL Discovery)
      console.log('\n[PHASE 1] Starting URL discovery...');
      startCrawlPhase(processId);

      const crawlResult = await crawlUrls(
        { seedUrl, maxDepth, includeSubpages, processId },
        processId
      );

      // Save crawl output
      const crawlFilename = await saveCrawlOutput(crawlResult);

      response.crawlOutput = {
        filename: crawlFilename,
        urlsDiscovered: crawlResult.discoveredUrls.length,
        urls: crawlResult.discoveredUrls,
      };

      console.log(`[PHASE 1 COMPLETE] Crawl output saved to: data/${crawlFilename}`);

      // PHASE 2: Scrape (Content Extraction)
      console.log('\n[PHASE 2] Starting content extraction...');
      startScrapePhase(processId, crawlResult.discoveredUrls.length);

      const scrapeResults = await scrapeUrls(crawlResult.discoveredUrls, {
        processId,
        onProgress: (completed, total) => {
          updateScrapeProgress(processId, completed, total);
        },
      });

      // Format output
      const formatted = formatOutput(scrapeResults, outputFormat);

      // Save scrape output
      const scrapeFilename = await saveScrapeOutput(formatted);

      response.scrapeOutput = {
        filename: scrapeFilename,
        pagesScraped: scrapeResults.length,
        format: outputFormat,
        results: scrapeResults,
      };

      console.log(`[PHASE 2 COMPLETE] Scrape output saved to: data/${scrapeFilename}`);

      // PHASE 3: Validation
      console.log('\n[PHASE 3] Validating crawl vs scrape...');
      startValidationPhase(processId);

      const validationReport = validateCrawlVsScrape(
        crawlResult.discoveredUrls,
        scrapeResults
      );

      // Save validation report
      const validationFilename = await saveValidationReport(validationReport, DATA_DIR);

      // Generate human-readable summary
      const validationSummary = generateValidationSummary(validationReport);
      console.log(validationSummary);

      response.validation = {
        filename: validationFilename,
        report: validationReport,
        summary: validationSummary,
      };

      console.log(`[PHASE 3 COMPLETE] Validation report saved to: data/${validationFilename}`);
    }

    // Mark progress as complete
    completeProgress(processId);

    console.log('\n' + '='.repeat(60));
    console.log('PROCESSING COMPLETE');
    console.log('='.repeat(60) + '\n');

    res.json(response);
  } catch (error) {
    console.error('Processing error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    // Mark progress as errored (if processId exists)
    if (typeof error === 'object' && error !== null) {
      // Try to extract processId from context if available
      try {
        const reqBody = req.body as ProcessRequest;
        if (reqBody) {
          // Log error for debugging
          console.error(`[ERROR] Process failed: ${errorMessage}`);
        }
      } catch {
        // Ignore extraction errors
      }
    }

    res.status(500).json({
      success: false,
      processId: '', // Will be empty on early errors
      error: errorMessage,
    });
  }
});

export default router;
