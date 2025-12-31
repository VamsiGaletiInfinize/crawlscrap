/**
 * V2 EXPORT API - University-Specific Output File Generation
 *
 * This module handles exporting crawl/scrape results to files organized by university name.
 * Output files are saved to: ./data/universities/{university-name}/
 *
 * Endpoints:
 * - GET /api/v2/jobs/:id/export - Export job results to university-specific files
 */

import { Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import {
  getJob,
  getJobDuration,
} from '../../jobs/jobManager.js';
import { formatOutput } from '../../services/formatter.js';

/**
 * Sanitize university name for use as directory name
 */
function sanitizeDirectoryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '')     // Remove leading/trailing hyphens
    .substring(0, 50);           // Limit length
}

/**
 * Generate timestamp string for filenames
 */
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
}

/**
 * Export result interface
 */
interface ExportResult {
  success: boolean;
  universityName: string;
  outputDirectory: string;
  files: {
    crawlResults?: string;
    scrapeResults?: string;
    validationReport?: string;
    summary?: string;
  };
  timing: {
    durationFormatted: string;
    startedAt: string | null;
    completedAt: string | null;
  };
}

/**
 * GET /api/v2/jobs/:id/export - Export job results to university-specific files
 */
export async function exportJobResults(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const format = (req.query.format as string) || 'JSON';

  const job = getJob(id);
  if (!job) {
    res.status(404).json({
      success: false,
      error: 'Job not found',
    });
    return;
  }

  if (job.status !== 'COMPLETED') {
    res.status(400).json({
      success: false,
      error: `Job is ${job.status}. Export only available for completed jobs.`,
    });
    return;
  }

  // Determine university name (use provided name or extract from URL)
  const universityName = job.config.universityName || extractUniversityFromUrl(job.config.seedUrl);
  const sanitizedName = sanitizeDirectoryName(universityName);
  const timestamp = getTimestamp();

  // Create output directory
  const baseDir = path.join(process.cwd(), 'data', 'universities', sanitizedName);
  const outputDir = path.join(baseDir, timestamp);

  try {
    await fs.mkdir(outputDir, { recursive: true });

    const files: ExportResult['files'] = {};
    const duration = getJobDuration(id);

    // Export crawl results
    if (job.results.crawlOutput) {
      const crawlFile = path.join(outputDir, 'crawl-results.json');
      await fs.writeFile(crawlFile, JSON.stringify(job.results.crawlOutput, null, 2));
      files.crawlResults = crawlFile;
      console.log(`[EXPORT] Saved crawl results to: ${crawlFile}`);
    }

    // Export scrape results
    if (job.results.scrapeOutput) {
      let scrapeData: unknown;
      let extension = 'json';

      if (format === 'JSON') {
        scrapeData = job.results.scrapeOutput;
      } else {
        scrapeData = formatOutput(job.results.scrapeOutput, format as 'MARKDOWN' | 'SUMMARY' | 'LINKS_ONLY' | 'HTML');
        extension = format === 'MARKDOWN' ? 'md' : format === 'HTML' ? 'html' : 'txt';
      }

      const scrapeFile = path.join(outputDir, `scrape-results.${extension}`);
      const content = typeof scrapeData === 'string' ? scrapeData : JSON.stringify(scrapeData, null, 2);
      await fs.writeFile(scrapeFile, content);
      files.scrapeResults = scrapeFile;
      console.log(`[EXPORT] Saved scrape results to: ${scrapeFile}`);
    }

    // Export validation report
    if (job.results.validation) {
      const validationFile = path.join(outputDir, 'validation-report.json');
      await fs.writeFile(validationFile, JSON.stringify(job.results.validation, null, 2));
      files.validationReport = validationFile;
      console.log(`[EXPORT] Saved validation report to: ${validationFile}`);
    }

    // Generate and export summary
    const summary = generateSummary(job, universityName, duration);
    const summaryFile = path.join(outputDir, 'summary.txt');
    await fs.writeFile(summaryFile, summary);
    files.summary = summaryFile;
    console.log(`[EXPORT] Saved summary to: ${summaryFile}`);

    const result: ExportResult = {
      success: true,
      universityName,
      outputDirectory: outputDir,
      files,
      timing: {
        durationFormatted: duration?.durationFormatted || 'Unknown',
        startedAt: duration?.startedAt || null,
        completedAt: duration?.completedAt || null,
      },
    };

    res.json(result);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[EXPORT] Failed to export job ${id}:`, errorMessage);
    res.status(500).json({
      success: false,
      error: `Failed to export results: ${errorMessage}`,
    });
  }
}

/**
 * Extract university name from URL
 */
function extractUniversityFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Remove www. prefix
    const domain = hostname.replace(/^www\./, '');

    // Extract main part (e.g., "odu" from "odu.edu")
    const parts = domain.split('.');
    if (parts.length >= 2) {
      // For .edu domains, use the part before .edu
      if (parts[parts.length - 1] === 'edu') {
        return parts[parts.length - 2];
      }
      // Otherwise use the first part
      return parts[0];
    }

    return domain;
  } catch {
    return 'unknown-university';
  }
}

/**
 * Generate human-readable summary
 */
function generateSummary(
  job: ReturnType<typeof getJob>,
  universityName: string,
  duration: ReturnType<typeof getJobDuration>
): string {
  if (!job) return 'Job not found';

  const lines: string[] = [
    '═'.repeat(60),
    `CRAWL SUMMARY: ${universityName.toUpperCase()}`,
    '═'.repeat(60),
    '',
    'JOB INFORMATION:',
    `  Job ID:           ${job.id}`,
    `  Seed URL:         ${job.config.seedUrl}`,
    `  Operation Mode:   ${job.config.operationMode}`,
    `  Max Depth:        ${job.config.maxDepth}`,
    `  Include Subpages: ${job.config.includeSubpages}`,
    '',
    'TIMING:',
    `  Started At:       ${duration?.startedAt || 'N/A'}`,
    `  Completed At:     ${duration?.completedAt || 'N/A'}`,
    `  Total Duration:   ${duration?.durationFormatted || 'N/A'}`,
    '',
    'RESULTS:',
  ];

  // Crawl results
  if (job.results.crawlOutput) {
    lines.push(`  URLs Discovered:  ${job.results.crawlOutput.discoveredUrls.length}`);
  }

  // Scrape results
  if (job.results.scrapeOutput) {
    const successful = job.results.scrapeOutput.filter(r => r.metadata.status === 'SUCCESS').length;
    const failed = job.results.scrapeOutput.filter(r => r.metadata.status === 'FAILED').length;
    lines.push(`  Pages Scraped:    ${job.results.scrapeOutput.length}`);
    lines.push(`    - Successful:   ${successful}`);
    lines.push(`    - Failed:       ${failed}`);
  }

  // Validation results
  if (job.results.validation) {
    lines.push('');
    lines.push('VALIDATION:');
    lines.push(`  Total Crawled:    ${job.results.validation.totalCrawled}`);
    lines.push(`  Total Scraped:    ${job.results.validation.totalScraped}`);
    lines.push(`  Success Rate:     ${job.results.validation.successRate}`);
    lines.push(`  Completeness:     ${job.results.validation.completenessRate}`);

    if (job.results.validation.failedScrapes.length > 0) {
      lines.push('');
      lines.push('FAILED URLS (first 10):');
      job.results.validation.failedScrapes.slice(0, 10).forEach(failed => {
        lines.push(`  - ${failed.url}`);
        lines.push(`    Error: ${failed.error}`);
      });
      if (job.results.validation.failedScrapes.length > 10) {
        lines.push(`  ... and ${job.results.validation.failedScrapes.length - 10} more`);
      }
    }
  }

  lines.push('');
  lines.push('═'.repeat(60));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('═'.repeat(60));

  return lines.join('\n');
}

export default { exportJobResults };