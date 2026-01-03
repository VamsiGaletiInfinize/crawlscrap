/**
 * DATABASE CONFIGURATION
 *
 * Configuration for PostgreSQL database connection.
 * Supports graceful fallback when database is unavailable.
 */

export interface DatabaseConfig {
  // Connection string (takes precedence if set)
  connectionString?: string;

  // Individual connection parameters
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;

  // Pool settings
  poolMin: number;
  poolMax: number;

  // Connection timeout in ms
  connectionTimeout: number;

  // Whether database is required (fail if unavailable)
  required: boolean;
}

/**
 * Default database configuration
 */
export const databaseConfig: DatabaseConfig = {
  connectionString: undefined,
  host: 'localhost',
  port: 5432,
  database: 'crawlscrap',
  user: 'crawler',
  password: 'crawlscrap123',
  poolMin: 2,
  poolMax: 10,
  connectionTimeout: 5000,
  required: false,
};

/**
 * Get database configuration with environment variable overrides
 */
export function getDatabaseConfig(): DatabaseConfig {
  return {
    connectionString: process.env.DATABASE_URL || databaseConfig.connectionString,
    host: process.env.PG_HOST || databaseConfig.host,
    port: parseInt(process.env.PG_PORT || String(databaseConfig.port), 10),
    database: process.env.PG_DATABASE || databaseConfig.database,
    user: process.env.PG_USER || databaseConfig.user,
    password: process.env.PG_PASSWORD || databaseConfig.password,
    poolMin: parseInt(process.env.PG_POOL_MIN || String(databaseConfig.poolMin), 10),
    poolMax: parseInt(process.env.PG_POOL_MAX || String(databaseConfig.poolMax), 10),
    connectionTimeout: parseInt(
      process.env.PG_CONNECTION_TIMEOUT || String(databaseConfig.connectionTimeout),
      10
    ),
    required: process.env.DATABASE_REQUIRED === 'true',
  };
}

export default { databaseConfig, getDatabaseConfig };
