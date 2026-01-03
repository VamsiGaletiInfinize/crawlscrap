/**
 * UNIVERSITY DOMAIN CONFIGURATION
 *
 * Configuration for university domain filtering and validation.
 * Restricts crawling to educational institution domains.
 */

export interface DomainConfig {
  // Enable strict university domain filtering
  strictUniversityMode: boolean;

  // University domain patterns (TLDs and suffixes)
  universityPatterns: string[];

  // Additional allowed domains (whitelisted)
  allowedDomains: string[];

  // Blocked domains (blacklisted, takes precedence)
  blockedDomains: string[];

  // Blocked path patterns (common non-content paths)
  blockedPaths: string[];

  // Allow subdomains of matched domains
  allowSubdomains: boolean;

  // Maximum URL length to crawl
  maxUrlLength: number;

  // File extensions to skip
  skipExtensions: string[];
}

/**
 * Default university domain patterns
 * These are common educational institution TLDs and domain suffixes
 */
export const DEFAULT_UNIVERSITY_PATTERNS: string[] = [
  // Generic educational TLDs
  '.edu',
  '.edu.au',
  '.edu.cn',
  '.edu.in',
  '.edu.pk',
  '.edu.sg',
  '.edu.my',
  '.edu.ph',
  '.edu.br',
  '.edu.mx',
  '.edu.ar',
  '.edu.co',
  '.edu.pe',
  '.edu.ec',

  // UK academic domains
  '.ac.uk',
  '.ac.nz',
  '.ac.za',
  '.ac.jp',
  '.ac.kr',
  '.ac.in',
  '.ac.th',
  '.ac.id',

  // European educational domains
  '.edu.es',
  '.edu.pl',
  '.edu.tr',
  '.edu.gr',
  '.edu.pt',
  '.edu.it',

  // Canadian educational domains
  '.edu.ca',

  // Other patterns
  '.university',
  '.college',
  '.school',
];

/**
 * Common blocked paths that typically don't contain useful content
 */
export const DEFAULT_BLOCKED_PATHS: string[] = [
  '/wp-admin',
  '/wp-login',
  '/admin',
  '/login',
  '/logout',
  '/signin',
  '/signout',
  '/cart',
  '/checkout',
  '/api/',
  '/feed',
  '/rss',
  '/atom',
  '/xmlrpc',
  '/.well-known',
  '/cdn-cgi',
  '/print/',
  '/email-protection',
];

/**
 * File extensions to skip (non-HTML content)
 */
export const DEFAULT_SKIP_EXTENSIONS: string[] = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
  '.rar',
  '.tar',
  '.gz',
  '.7z',
  '.exe',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.iso',
  '.img',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.wav',
  '.ogg',
  '.webm',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.svg',
  '.ico',
  '.webp',
  '.tiff',
  '.css',
  '.js',
  '.json',
  '.xml',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
];

/**
 * Default domain configuration
 */
export const domainConfig: DomainConfig = {
  strictUniversityMode: false,
  universityPatterns: DEFAULT_UNIVERSITY_PATTERNS,
  allowedDomains: [],
  blockedDomains: [],
  blockedPaths: DEFAULT_BLOCKED_PATHS,
  allowSubdomains: true,
  maxUrlLength: 2000,
  skipExtensions: DEFAULT_SKIP_EXTENSIONS,
};

/**
 * Get domain configuration with environment variable overrides
 */
export function getDomainConfig(): DomainConfig {
  const config = { ...domainConfig };

  // Parse environment variables
  if (process.env.STRICT_UNIVERSITY_MODE === 'true') {
    config.strictUniversityMode = true;
  }

  if (process.env.ALLOWED_DOMAINS) {
    config.allowedDomains = process.env.ALLOWED_DOMAINS.split(',').map(d => d.trim());
  }

  if (process.env.BLOCKED_DOMAINS) {
    config.blockedDomains = process.env.BLOCKED_DOMAINS.split(',').map(d => d.trim());
  }

  if (process.env.MAX_URL_LENGTH) {
    config.maxUrlLength = parseInt(process.env.MAX_URL_LENGTH, 10);
  }

  if (process.env.ALLOW_SUBDOMAINS === 'false') {
    config.allowSubdomains = false;
  }

  return config;
}

export default { domainConfig, getDomainConfig, DEFAULT_UNIVERSITY_PATTERNS, DEFAULT_BLOCKED_PATHS, DEFAULT_SKIP_EXTENSIONS };
