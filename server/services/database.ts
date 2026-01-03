/**
 * DATABASE SERVICE
 *
 * Manages PostgreSQL connection pool and schema initialization.
 * Supports graceful fallback when database is unavailable.
 */

import pg from 'pg';
import { getDatabaseConfig, type DatabaseConfig } from '../config/database.js';

const { Pool } = pg;

// Connection state
let pool: pg.Pool | null = null;
let isConnected = false;
let connectionAttempted = false;

/**
 * SQL Schema for auto-initialization
 */
const SCHEMA_SQL = `
-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  seed_url TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  operation_mode VARCHAR(20) NOT NULL,
  max_depth INT NOT NULL DEFAULT 2,
  output_format VARCHAR(20) NOT NULL DEFAULT 'JSON',
  university_name TEXT,
  pages_discovered INT DEFAULT 0,
  pages_scraped INT DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Pages table (discovered URLs)
CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  depth INT NOT NULL DEFAULT 0,
  parent_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  scraped_at TIMESTAMPTZ,
  error TEXT,
  UNIQUE(job_id, url)
);

-- Content table (scraped data)
CREATE TABLE IF NOT EXISTS content (
  id SERIAL PRIMARY KEY,
  page_id INT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title TEXT,
  text_content TEXT,
  headings JSONB,
  links JSONB,
  word_count INT DEFAULT 0,
  language VARCHAR(10),
  content_hash VARCHAR(64),
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pages_job_id ON pages(job_id);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
CREATE INDEX IF NOT EXISTS idx_content_page_id ON content(page_id);
CREATE INDEX IF NOT EXISTS idx_content_hash ON content(content_hash);
`;

/**
 * Initialize database connection pool
 * Returns true if connected, false if fallback mode
 */
export async function initializeDatabase(): Promise<boolean> {
  if (connectionAttempted) {
    return isConnected;
  }

  connectionAttempted = true;
  const config = getDatabaseConfig();

  console.log(`[DATABASE] Connecting to PostgreSQL at ${config.host}:${config.port}/${config.database}...`);

  try {
    // Create pool configuration
    const poolConfig: pg.PoolConfig = config.connectionString
      ? {
          connectionString: config.connectionString,
          min: config.poolMin,
          max: config.poolMax,
          connectionTimeoutMillis: config.connectionTimeout,
        }
      : {
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          password: config.password,
          min: config.poolMin,
          max: config.poolMax,
          connectionTimeoutMillis: config.connectionTimeout,
        };

    pool = new Pool(poolConfig);

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    isConnected = true;
    console.log(`[DATABASE] PostgreSQL connected successfully`);

    // Initialize schema
    await initializeSchema();

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[DATABASE] PostgreSQL connection failed: ${errorMessage}`);

    if (config.required) {
      throw new Error(`Database is required but unavailable: ${errorMessage}`);
    }

    console.log(`[DATABASE] Falling back to file-based storage`);
    isConnected = false;

    // Clean up failed pool
    if (pool) {
      try {
        await pool.end();
      } catch {
        // Ignore cleanup errors
      }
      pool = null;
    }

    return false;
  }
}

/**
 * Initialize database schema
 */
async function initializeSchema(): Promise<void> {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }

  console.log(`[DATABASE] Initializing schema...`);

  try {
    await pool.query(SCHEMA_SQL);
    console.log(`[DATABASE] Schema initialized successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[DATABASE] Schema initialization failed: ${errorMessage}`);
    throw error;
  }
}

/**
 * Execute a query
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  if (!pool) {
    throw new Error('Database not connected');
  }

  return pool.query<T>(text, params);
}

/**
 * Get a client from the pool (for transactions)
 */
export async function getClient(): Promise<pg.PoolClient> {
  if (!pool) {
    throw new Error('Database not connected');
  }

  return pool.connect();
}

/**
 * Check if database is connected
 */
export function isDatabaseConnected(): boolean {
  return isConnected;
}

/**
 * Get pool statistics
 */
export function getPoolStats(): {
  total: number;
  idle: number;
  waiting: number;
} | null {
  if (!pool) {
    return null;
  }

  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

/**
 * Graceful shutdown
 */
export async function shutdownDatabase(): Promise<void> {
  console.log('[DATABASE] Shutting down...');

  if (pool) {
    try {
      await pool.end();
      console.log('[DATABASE] Pool closed');
    } catch (error) {
      console.error('[DATABASE] Error closing pool:', error);
    }
    pool = null;
  }

  isConnected = false;
  console.log('[DATABASE] Shutdown complete');
}

export default {
  initializeDatabase,
  query,
  getClient,
  isDatabaseConnected,
  getPoolStats,
  shutdownDatabase,
};
