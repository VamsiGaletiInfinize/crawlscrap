/**
 * CrawlScrap - University-Scale Web Crawler
 *
 * Express server that provides:
 * - Static file serving for the Admin UI
 * - REST API endpoints for crawl/scrape operations
 * - WorkerPool for parallel processing (8 workers)
 * - Redis queue + PostgreSQL storage
 *
 * API Endpoints:
 * - POST /api/process      - Unified crawl+scrape (with WorkerPool)
 * - GET  /api/progress/:id - Real-time progress tracking
 * - GET  /api/health       - System health + stats
 *
 * This is the main entry point for the application.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// API imports
import processRouter from './api/v1/process.js';

// Services
import { getProgress, formatEta, cleanupOldProgress } from './services/progress.js';
import { initializeRedis, shutdownQueues, isQueueAvailable } from './services/queue.js';
import { initializeDatabase, isDatabaseConnected, shutdownDatabase, getPoolStats } from './services/database.js';
import { getRateLimiterStats } from './services/rateLimiter.js';
import { getRobotsTxtCacheStats } from './services/robotsTxt.js';
import { getRateLimitConfig } from './config/rateLimit.js';
import { getFilterStats } from './services/domainFilter.js';
import { getDomainConfig } from './config/domains.js';
import { getRetryStats } from './services/retry.js';
import { getCircuitBreakerStats } from './services/circuitBreaker.js';
import { getRetryConfig, getCircuitBreakerConfig } from './config/retry.js';
import { getWorkerConfig } from './config/workers.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve static files from client directory (Admin UI)
app.use(express.static(path.join(__dirname, '..', 'client')));

// API routes
app.use('/api/process', processRouter);  // Unified crawl + scrape with WorkerPool

// Health check endpoint
app.get('/api/health', (_req, res) => {
  const poolStats = getPoolStats();
  const rateLimitConfig = getRateLimitConfig();
  const rateLimiterStats = getRateLimiterStats();
  const robotsTxtStats = getRobotsTxtCacheStats();
  const domainConfig = getDomainConfig();
  const filterStats = getFilterStats();
  const retryConfig = getRetryConfig();
  const retryStats = getRetryStats();
  const circuitBreakerConfig = getCircuitBreakerConfig();
  const circuitBreakerStats = getCircuitBreakerStats();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    redis: isQueueAvailable() ? 'connected' : 'disconnected',
    queueMode: isQueueAvailable() ? 'redis' : 'in-memory',
    database: isDatabaseConnected() ? 'connected' : 'disconnected',
    storageMode: isDatabaseConnected() ? 'postgresql' : 'file-based',
    dbPool: poolStats,
    rateLimit: {
      enabled: true,
      respectRobotsTxt: rateLimitConfig.respectRobotsTxt,
      defaultDelayMs: rateLimitConfig.defaultDelayMs,
      maxConcurrentPerDomain: rateLimitConfig.maxConcurrentPerDomain,
      stats: {
        domainsTracked: rateLimiterStats.domains,
        totalRequests: rateLimiterStats.totalRequests,
        blockedRequests: rateLimiterStats.blockedRequests,
        robotsTxtCached: robotsTxtStats.size,
      },
    },
    domainFilter: {
      strictUniversityMode: domainConfig.strictUniversityMode,
      universityPatternsCount: domainConfig.universityPatterns.length,
      allowedDomainsCount: domainConfig.allowedDomains.length,
      blockedDomainsCount: domainConfig.blockedDomains.length,
      stats: {
        totalChecked: filterStats.totalChecked,
        allowed: filterStats.allowed,
        blocked: filterStats.blocked,
        universityDomains: filterStats.universityDomains,
        nonUniversityDomains: filterStats.nonUniversityDomains,
        uniqueDomainsCount: filterStats.uniqueDomainsCount,
      },
    },
    retry: {
      maxRetries: retryConfig.maxRetries,
      initialDelayMs: retryConfig.initialDelayMs,
      maxDelayMs: retryConfig.maxDelayMs,
      backoffMultiplier: retryConfig.backoffMultiplier,
      stats: {
        totalAttempts: retryStats.totalAttempts,
        successfulRetries: retryStats.successfulRetries,
        failedRetries: retryStats.failedRetries,
        permanentFailures: retryStats.permanentFailures,
        averageDelayMs: retryStats.averageDelayMs,
        errorsByType: retryStats.errorsByType,
      },
    },
    circuitBreaker: {
      enabled: circuitBreakerConfig.enabled,
      failureThreshold: circuitBreakerConfig.failureThreshold,
      resetTimeoutMs: circuitBreakerConfig.resetTimeoutMs,
      stats: {
        totalCircuits: circuitBreakerStats.totalCircuits,
        openCircuits: circuitBreakerStats.openCircuits,
        halfOpenCircuits: circuitBreakerStats.halfOpenCircuits,
        closedCircuits: circuitBreakerStats.closedCircuits,
        totalBlocked: circuitBreakerStats.totalBlocked,
        circuits: circuitBreakerStats.circuits,
      },
    },
  });
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

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  console.log(`\n[SHUTDOWN] Received ${signal}, shutting down gracefully...`);

  try {
    // Shutdown queues and Redis connection
    await shutdownQueues();

    // Shutdown database connection pool
    await shutdownDatabase();

    console.log('[SHUTDOWN] Cleanup complete');
    process.exit(0);
  } catch (error) {
    console.error('[SHUTDOWN] Error during cleanup:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Initialize and start server
async function startServer() {
  console.log('[STARTUP] Initializing CrawlScrap server...');

  // Initialize Redis connection (optional - for caching)
  const redisConnected = await initializeRedis();

  // Initialize PostgreSQL database (optional - falls back to file-based)
  const dbConnected = await initializeDatabase();

  const workerConfig = getWorkerConfig();
  const totalConcurrency = workerConfig.workers * workerConfig.concurrentPages;
  const redisStatus = redisConnected ? '✓ Redis connected' : '○ In-memory mode';
  const dbStatus = dbConnected ? '✓ PostgreSQL connected' : '○ File-based mode';

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║   CrawlScrap - University-Scale Web Crawler                          ║
║                                                                      ║
║   Admin UI:  http://localhost:${PORT}                                   ║
║   Workers:   ${String(workerConfig.workers).padEnd(2)} browsers × ${String(workerConfig.concurrentPages).padEnd(2)} pages = ${String(totalConcurrency).padEnd(3)} parallel    ║
║   Database:  ${dbStatus.padEnd(44)}║
║   Cache:     ${redisStatus.padEnd(44)}║
║                                                                      ║
║   Optimized: Memory-safe concurrency, adaptive rendering             ║
║                                                                      ║
║   API Endpoints:                                                     ║
║   - POST /api/process      - Crawl + Scrape (with WorkerPool)        ║
║   - GET  /api/progress/:id - Real-time progress                      ║
║   - GET  /api/health       - System stats                            ║
║                                                                      ║
║   Modes: CRAWL_ONLY, SCRAPE_ONLY, CRAWL_AND_SCRAPE                   ║
║   Formats: JSON, MARKDOWN, SUMMARY, LINKS_ONLY, HTML                 ║
╚══════════════════════════════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(console.error);
