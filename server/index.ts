/**
 * CrawlScrap Demo - Entry Point
 *
 * Express server that provides:
 * - Static file serving for the Admin UI
 * - REST API endpoints for crawl/scrape operations
 *
 * API Endpoints:
 * V1 (Synchronous):
 * - POST /api/process      - Unified processing endpoint (blocks until complete)
 * - GET  /api/progress/:id - Real-time progress tracking
 * - POST /api/crawl        - Legacy endpoint (backwards compatibility)
 * - GET  /api/health       - Health check
 *
 * V2 (Asynchronous - Recommended for large crawls):
 * - POST /api/v2/crawl           - Start async crawl job (returns jobId immediately)
 * - GET  /api/v2/jobs            - List all jobs
 * - GET  /api/v2/jobs/:id        - Get job status and progress
 * - GET  /api/v2/jobs/:id/results - Get paginated results
 * - DELETE /api/v2/jobs/:id      - Cancel or delete job
 *
 * This is the main entry point for the application.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// V1 API imports
import processRouter from './api/v1/process.js';
import crawlRouter from './api/v1/crawl.js';

// Services
import { getProgress, formatEta, cleanupOldProgress } from './services/progress.js';

// V2 API imports
import { startCrawlJob } from './api/v2/crawl.js';
import {
  listJobs,
  getJobStatus,
  getJobResults,
  getJobValidation,
  deleteOrCancelJob,
  getStats,
} from './api/v2/jobs.js';
import { exportJobResults } from './api/v2/export.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve static files from client directory (Admin UI)
app.use(express.static(path.join(__dirname, '..', 'client')));

// API routes (V1 - Synchronous)
app.use('/api/process', processRouter);  // Unified processing endpoint
app.use('/api/crawl', crawlRouter);      // Legacy: Backwards compatibility

// API routes (V2 - Asynchronous)
app.post('/api/v2/crawl', startCrawlJob);           // Start async crawl job
app.get('/api/v2/jobs', listJobs);                  // List all jobs
app.get('/api/v2/jobs/stats', getStats);            // Get job statistics
app.get('/api/v2/jobs/:id', getJobStatus);          // Get job status
app.get('/api/v2/jobs/:id/results', getJobResults); // Get paginated results
app.get('/api/v2/jobs/:id/validation', getJobValidation); // Get validation report
app.get('/api/v2/jobs/:id/export', exportJobResults);     // Export to university-specific files
app.delete('/api/v2/jobs/:id', deleteOrCancelJob);  // Cancel or delete job

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Progress tracking endpoint
app.get('/api/progress/:id', (req, res) => {
  const processId = req.params.id;
  const progress = getProgress(processId);

  if (!progress) {
    res.status(404).json({
      error: 'Process not found',
      processId,
    });
    return;
  }

  // Add formatted ETA for display
  res.json({
    ...progress,
    etaFormatted: formatEta(progress.etaSeconds),
  });
});

// Cleanup old progress entries periodically (every 30 minutes)
setInterval(() => {
  cleanupOldProgress();
}, 30 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   CrawlScrap Server - University-Scale Web Crawler                   ║
║                                                                      ║
║   Admin UI:  http://localhost:${PORT}                                   ║
║                                                                      ║
║   V1 API (Synchronous - blocks until complete):                      ║
║   - POST /api/process           - Unified processing                 ║
║   - GET  /api/progress/:id      - Progress tracking                  ║
║   - POST /api/crawl             - Legacy endpoint                    ║
║                                                                      ║
║   V2 API (Async - recommended for large crawls):                     ║
║   - POST   /api/v2/crawl        - Start job (returns jobId)          ║
║   - GET    /api/v2/jobs         - List all jobs                      ║
║   - GET    /api/v2/jobs/:id     - Get job status + timing            ║
║   - GET    /api/v2/jobs/:id/results - Paginated results              ║
║   - GET    /api/v2/jobs/:id/export  - Export to university files     ║
║   - DELETE /api/v2/jobs/:id     - Cancel/delete job                  ║
║                                                                      ║
║   NEW: Include "universityName" in request for organized output      ║
║   Operation Modes: CRAWL_ONLY, SCRAPE_ONLY, CRAWL_AND_SCRAPE         ║
║   Output Formats:  JSON, MARKDOWN, SUMMARY, LINKS_ONLY, HTML         ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
  `);
});
