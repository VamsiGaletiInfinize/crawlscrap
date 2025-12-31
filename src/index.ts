/**
 * CrawlScrap Demo - Entry Point
 *
 * Express server that provides:
 * - Static file serving for the Admin UI
 * - REST API endpoints for crawl/scrape operations
 *
 * API Endpoints:
 * - POST /api/process      - Unified processing endpoint (recommended)
 * - GET  /api/progress/:id - Real-time progress tracking
 * - POST /api/crawl        - Legacy endpoint (backwards compatibility)
 * - GET  /api/health       - Health check
 *
 * This is the main entry point for the application.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import processRouter from './api/process.js';
import crawlRouter from './api/crawl.js';
import { getProgress, formatEta, cleanupOldProgress } from './crawler/progress.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve static files from public directory (Admin UI)
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/process', processRouter);  // NEW: Unified processing endpoint
app.use('/api/crawl', crawlRouter);      // Legacy: Backwards compatibility

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
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   CrawlScrap Demo Server - Firecrawl-like Evaluation Tool      ║
║                                                                ║
║   Admin UI:      http://localhost:${PORT}                         ║
║   API Process:   http://localhost:${PORT}/api/process             ║
║   API Progress:  http://localhost:${PORT}/api/progress/:id        ║
║   API Crawl:     http://localhost:${PORT}/api/crawl (legacy)      ║
║                                                                ║
║   Operation Modes:                                             ║
║   - CRAWL_ONLY      : URL discovery only                       ║
║   - SCRAPE_ONLY     : Content extraction only                  ║
║   - CRAWL_AND_SCRAPE: URL discovery + content extraction       ║
║                                                                ║
║   Features:                                                    ║
║   - Real-time progress tracking with ETA                       ║
║   - Crawl vs Scrape validation reports                         ║
║   - Comprehensive metadata (word count, language, hash)        ║
║                                                                ║
║   Output Formats:                                              ║
║   - JSON, MARKDOWN, SUMMARY, LINKS_ONLY, HTML                  ║
║                                                                ║
║   License-safe dependencies:                                   ║
║   - Crawlee (Apache 2.0)                                       ║
║   - Playwright (Apache 2.0)                                    ║
║   - Express (MIT)                                              ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
});
