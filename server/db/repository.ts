/**
 * DATABASE REPOSITORY
 *
 * CRUD operations for jobs, pages, and content.
 * Uses batch inserts for performance with large datasets.
 */

import { query, getClient, isDatabaseConnected } from '../services/database.js';
import type { DiscoveredUrl } from '../services/crawler.js';
import type { ScrapedContent } from '../services/scraper.js';

// Job types (inline to avoid circular dependencies)
export type JobStatus = 'QUEUED' | 'RUNNING' | 'CRAWLING' | 'SCRAPING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface JobConfig {
  seedUrl: string;
  maxDepth: number;
  operationMode: string;
  outputFormat: string;
  universityName?: string;
}

// ============================================================================
// JOB OPERATIONS
// ============================================================================

/**
 * Insert a new job into the database
 */
export async function insertJob(
  jobId: string,
  config: JobConfig,
  status: JobStatus = 'QUEUED'
): Promise<void> {
  if (!isDatabaseConnected()) return;

  const sql = `
    INSERT INTO jobs (id, seed_url, status, operation_mode, max_depth, output_format, university_name, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (id) DO NOTHING
  `;

  try {
    await query(sql, [
      jobId,
      config.seedUrl,
      status,
      config.operationMode,
      config.maxDepth,
      config.outputFormat,
      config.universityName || null,
    ]);
  } catch (error) {
    console.error('[DB REPO] Failed to insert job:', error);
  }
}

/**
 * Update job status
 */
export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  error?: string
): Promise<void> {
  if (!isDatabaseConnected()) return;

  let sql: string;
  let params: unknown[];

  if (status === 'RUNNING') {
    sql = `UPDATE jobs SET status = $1, started_at = NOW() WHERE id = $2`;
    params = [status, jobId];
  } else if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
    sql = `UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`;
    params = [status, error || null, jobId];
  } else {
    sql = `UPDATE jobs SET status = $1 WHERE id = $2`;
    params = [status, jobId];
  }

  try {
    await query(sql, params);
  } catch (err) {
    console.error('[DB REPO] Failed to update job status:', err);
  }
}

/**
 * Update job page counts
 */
export async function updateJobCounts(
  jobId: string,
  pagesDiscovered: number,
  pagesScraped: number
): Promise<void> {
  if (!isDatabaseConnected()) return;

  const sql = `
    UPDATE jobs SET pages_discovered = $1, pages_scraped = $2 WHERE id = $3
  `;

  try {
    await query(sql, [pagesDiscovered, pagesScraped, jobId]);
  } catch (error) {
    console.error('[DB REPO] Failed to update job counts:', error);
  }
}

/**
 * Delete a job (cascades to pages and content)
 */
export async function deleteJob(jobId: string): Promise<void> {
  if (!isDatabaseConnected()) return;

  try {
    await query('DELETE FROM jobs WHERE id = $1', [jobId]);
  } catch (error) {
    console.error('[DB REPO] Failed to delete job:', error);
  }
}

// ============================================================================
// PAGE OPERATIONS
// ============================================================================

/**
 * Batch insert discovered pages
 * Uses UNNEST for efficient bulk insert
 */
export async function batchInsertPages(
  jobId: string,
  pages: DiscoveredUrl[]
): Promise<void> {
  if (!isDatabaseConnected() || pages.length === 0) return;

  // Prepare arrays for UNNEST
  const urls: string[] = [];
  const depths: number[] = [];
  const parentUrls: (string | null)[] = [];

  for (const page of pages) {
    urls.push(page.url);
    depths.push(page.depth);
    parentUrls.push(page.parentUrl || null);
  }

  const sql = `
    INSERT INTO pages (job_id, url, depth, parent_url, status)
    SELECT $1, unnest($2::text[]), unnest($3::int[]), unnest($4::text[]), 'PENDING'
    ON CONFLICT (job_id, url) DO NOTHING
  `;

  try {
    await query(sql, [jobId, urls, depths, parentUrls]);
    console.log(`[DB REPO] Inserted ${pages.length} pages for job ${jobId}`);
  } catch (error) {
    console.error('[DB REPO] Failed to batch insert pages:', error);
  }
}

/**
 * Update page status after scraping
 */
export async function updatePageStatus(
  jobId: string,
  url: string,
  status: string,
  error?: string
): Promise<number | null> {
  if (!isDatabaseConnected()) return null;

  const sql = `
    UPDATE pages
    SET status = $1, scraped_at = NOW(), error = $2
    WHERE job_id = $3 AND url = $4
    RETURNING id
  `;

  try {
    const result = await query<{ id: number }>(sql, [status, error || null, jobId, url]);
    return result.rows[0]?.id || null;
  } catch (err) {
    console.error('[DB REPO] Failed to update page status:', err);
    return null;
  }
}

/**
 * Get page ID by job and URL
 */
export async function getPageId(jobId: string, url: string): Promise<number | null> {
  if (!isDatabaseConnected()) return null;

  const sql = `SELECT id FROM pages WHERE job_id = $1 AND url = $2`;

  try {
    const result = await query<{ id: number }>(sql, [jobId, url]);
    return result.rows[0]?.id || null;
  } catch (error) {
    console.error('[DB REPO] Failed to get page ID:', error);
    return null;
  }
}

// ============================================================================
// CONTENT OPERATIONS
// ============================================================================

/**
 * Insert scraped content for a page
 */
export async function insertContent(
  pageId: number,
  content: ScrapedContent
): Promise<void> {
  if (!isDatabaseConnected()) return;

  const sql = `
    INSERT INTO content (page_id, title, text_content, headings, links, word_count, language, content_hash, scraped_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT DO NOTHING
  `;

  try {
    await query(sql, [
      pageId,
      content.title || null,
      content.content || null,
      JSON.stringify(content.headings || []),
      JSON.stringify(content.links || []),
      content.metadata?.wordCount || 0,
      content.metadata?.language || null,
      content.metadata?.contentHash || null,
    ]);
  } catch (error) {
    console.error('[DB REPO] Failed to insert content:', error);
  }
}

/**
 * Batch insert scraped content
 * Requires page IDs to be resolved first
 */
export async function batchInsertContent(
  jobId: string,
  contents: ScrapedContent[]
): Promise<void> {
  if (!isDatabaseConnected() || contents.length === 0) return;

  const client = await getClient();

  try {
    await client.query('BEGIN');

    let insertedCount = 0;

    for (const content of contents) {
      // Get page ID for this URL
      const pageResult = await client.query<{ id: number }>(
        'SELECT id FROM pages WHERE job_id = $1 AND url = $2',
        [jobId, content.url]
      );

      const pageId = pageResult.rows[0]?.id;
      if (!pageId) continue;

      // Update page status
      const status = content.metadata?.status === 'FAILED' ? 'FAILED' : 'SCRAPED';
      await client.query(
        `UPDATE pages SET status = $1, scraped_at = NOW(), error = $2 WHERE id = $3`,
        [status, content.metadata?.errorMessage || null, pageId]
      );

      // Skip content insertion for failed pages
      if (status === 'FAILED') continue;

      // Insert content
      await client.query(
        `INSERT INTO content (page_id, title, text_content, headings, links, word_count, language, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          pageId,
          content.title || null,
          content.content || null,
          JSON.stringify(content.headings || []),
          JSON.stringify(content.links || []),
          content.metadata?.wordCount || 0,
          content.metadata?.language || null,
          content.metadata?.contentHash || null,
        ]
      );

      insertedCount++;
    }

    await client.query('COMMIT');
    console.log(`[DB REPO] Inserted content for ${insertedCount} pages (job ${jobId})`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB REPO] Failed to batch insert content:', error);
  } finally {
    client.release();
  }
}

// ============================================================================
// QUERY OPERATIONS
// ============================================================================

/**
 * Get job statistics from database
 */
export async function getJobStats(): Promise<{
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
} | null> {
  if (!isDatabaseConnected()) return null;

  const sql = `
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'QUEUED') as queued,
      COUNT(*) FILTER (WHERE status = 'RUNNING') as running,
      COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
      COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
      COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled
    FROM jobs
  `;

  try {
    const result = await query(sql);
    const row = result.rows[0];
    return {
      total: parseInt(row.total, 10),
      queued: parseInt(row.queued, 10),
      running: parseInt(row.running, 10),
      completed: parseInt(row.completed, 10),
      failed: parseInt(row.failed, 10),
      cancelled: parseInt(row.cancelled, 10),
    };
  } catch (error) {
    console.error('[DB REPO] Failed to get job stats:', error);
    return null;
  }
}

export default {
  // Job operations
  insertJob,
  updateJobStatus,
  updateJobCounts,
  deleteJob,
  // Page operations
  batchInsertPages,
  updatePageStatus,
  getPageId,
  // Content operations
  insertContent,
  batchInsertContent,
  // Query operations
  getJobStats,
};
