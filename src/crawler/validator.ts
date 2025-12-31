/**
 * VALIDATION MODULE
 *
 * Validates crawled URLs against scraped content to ensure completeness.
 * Generates a validation report showing:
 * - Total crawled vs scraped counts
 * - Missing scrapes (URLs discovered but not scraped)
 * - Failed scrapes (URLs that failed during scraping)
 * - Success rate percentage
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { DiscoveredUrl } from './crawler.js';
import type { ScrapedContent } from './scraper.js';

/**
 * Validation report structure
 */
export interface ValidationReport {
  totalCrawled: number;
  totalScraped: number;
  successfulScrapes: number;
  failedScrapes: Array<{
    url: string;
    error: string;
  }>;
  missingScrapes: string[];
  successRate: string;
  failureRate: string;
  completenessRate: string;
  generatedAt: string;
  summary: {
    crawlToScrapeMatch: boolean;
    allUrlsProcessed: boolean;
    hasFailures: boolean;
    hasMissing: boolean;
  };
}

/**
 * Normalize URL for comparison
 * Removes trailing slashes, fragments, and normalizes protocol
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove fragment
    parsed.hash = '';
    // Remove trailing slash from pathname (except for root)
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Validate crawled URLs against scraped results
 *
 * @param crawledUrls - Array of discovered URLs from crawl phase
 * @param scrapedResults - Array of scraped content from scrape phase
 * @returns ValidationReport with detailed comparison
 */
export function validateCrawlVsScrape(
  crawledUrls: DiscoveredUrl[],
  scrapedResults: ScrapedContent[]
): ValidationReport {
  console.log('[VALIDATOR] Starting crawl vs scrape validation...');

  // Normalize and create sets for comparison
  const crawledSet = new Set(crawledUrls.map(u => normalizeUrl(u.url)));
  const scrapedMap = new Map<string, ScrapedContent>();

  for (const result of scrapedResults) {
    scrapedMap.set(normalizeUrl(result.url), result);
  }

  // Find successful and failed scrapes
  const successfulScrapes: ScrapedContent[] = [];
  const failedScrapes: Array<{ url: string; error: string }> = [];

  for (const result of scrapedResults) {
    if (result.metadata.status === 'SUCCESS') {
      successfulScrapes.push(result);
    } else if (result.metadata.status === 'FAILED') {
      failedScrapes.push({
        url: result.url,
        error: result.metadata.errorMessage || 'Unknown error',
      });
    }
  }

  // Find missing scrapes (crawled but not scraped)
  const missingScrapes: string[] = [];
  for (const crawledUrl of crawledSet) {
    if (!scrapedMap.has(crawledUrl)) {
      missingScrapes.push(crawledUrl);
    }
  }

  // Calculate rates
  const totalCrawled = crawledUrls.length;
  const totalScraped = scrapedResults.length;
  const successCount = successfulScrapes.length;

  const successRate = totalScraped > 0
    ? ((successCount / totalScraped) * 100).toFixed(1)
    : '0.0';

  const failureRate = totalScraped > 0
    ? ((failedScrapes.length / totalScraped) * 100).toFixed(1)
    : '0.0';

  const completenessRate = totalCrawled > 0
    ? ((totalScraped / totalCrawled) * 100).toFixed(1)
    : '0.0';

  const report: ValidationReport = {
    totalCrawled,
    totalScraped,
    successfulScrapes: successCount,
    failedScrapes,
    missingScrapes,
    successRate: `${successRate}%`,
    failureRate: `${failureRate}%`,
    completenessRate: `${completenessRate}%`,
    generatedAt: new Date().toISOString(),
    summary: {
      crawlToScrapeMatch: totalCrawled === totalScraped,
      allUrlsProcessed: missingScrapes.length === 0,
      hasFailures: failedScrapes.length > 0,
      hasMissing: missingScrapes.length > 0,
    },
  };

  console.log('[VALIDATOR] Validation complete:');
  console.log(`  - Crawled: ${totalCrawled}`);
  console.log(`  - Scraped: ${totalScraped}`);
  console.log(`  - Success rate: ${successRate}%`);
  console.log(`  - Missing: ${missingScrapes.length}`);
  console.log(`  - Failed: ${failedScrapes.length}`);

  return report;
}

/**
 * Save validation report to file
 */
export async function saveValidationReport(
  report: ValidationReport,
  dataDir: string = './data'
): Promise<string> {
  // Ensure data directory exists
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }

  const filename = 'validation-report.json';
  const filepath = path.join(dataDir, filename);

  await fs.writeFile(filepath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[VALIDATOR] Report saved to: ${filepath}`);

  return filename;
}

/**
 * Generate a human-readable summary of the validation
 */
export function generateValidationSummary(report: ValidationReport): string {
  const lines: string[] = [
    '='.repeat(50),
    'VALIDATION REPORT',
    '='.repeat(50),
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'STATISTICS:',
    `  Total Crawled:      ${report.totalCrawled}`,
    `  Total Scraped:      ${report.totalScraped}`,
    `  Successful:         ${report.successfulScrapes}`,
    `  Failed:             ${report.failedScrapes.length}`,
    `  Missing:            ${report.missingScrapes.length}`,
    '',
    'RATES:',
    `  Success Rate:       ${report.successRate}`,
    `  Failure Rate:       ${report.failureRate}`,
    `  Completeness:       ${report.completenessRate}`,
    '',
  ];

  if (report.failedScrapes.length > 0) {
    lines.push('FAILED SCRAPES:');
    for (const failed of report.failedScrapes.slice(0, 10)) {
      lines.push(`  - ${failed.url}`);
      lines.push(`    Error: ${failed.error}`);
    }
    if (report.failedScrapes.length > 10) {
      lines.push(`  ... and ${report.failedScrapes.length - 10} more`);
    }
    lines.push('');
  }

  if (report.missingScrapes.length > 0) {
    lines.push('MISSING SCRAPES:');
    for (const missing of report.missingScrapes.slice(0, 10)) {
      lines.push(`  - ${missing}`);
    }
    if (report.missingScrapes.length > 10) {
      lines.push(`  ... and ${report.missingScrapes.length - 10} more`);
    }
    lines.push('');
  }

  lines.push('='.repeat(50));

  return lines.join('\n');
}
