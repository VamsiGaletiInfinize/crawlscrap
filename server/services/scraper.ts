/**
 * SCRAPER - Content Extraction Logic
 *
 * This module handles the "scraping" part of crawl+scrape:
 * - Extracts structured content from rendered HTML pages
 * - Uses Playwright's page.evaluate() for DOM access
 * - Cleans unwanted elements (nav, footer, ads, scripts)
 * - Returns AI-ready structured data
 * - Captures comprehensive metadata for analysis
 *
 * SCRAPING vs CRAWLING:
 * - Crawling = discovering URLs, navigating links (see crawler.ts)
 * - Scraping = extracting content from pages (this module)
 *
 * METADATA CAPTURED:
 * - Word count, language detection, content hash
 * - Scrape timing and status tracking
 * - HTTP metadata from crawl phase
 */

import { chromium, type Page, type Browser } from 'playwright';
import crypto from 'crypto';

/**
 * Scrape status type
 */
export type ScrapeStatus = 'SUCCESS' | 'FAILED' | 'PARTIAL';

/**
 * HTTP metadata passed from crawler
 */
export interface HttpMetadata {
  parentUrl: string | null;
  statusCode: number;
  contentType: string;
}

/**
 * Represents the scraped content from a single page
 */
export interface ScrapedContent {
  url: string;
  title: string;
  headings: string[];
  content: string;
  links: string[];        // Extracted links for LINKS_ONLY format
  cleanedHtml: string;    // Cleaned HTML for HTML format
  metadata: {
    // Timing metadata
    crawledAt: string;
    scrapedAt: string;
    scrapeDurationMs: number;
    depth: number;
    // HTTP metadata (from crawler)
    parentUrl: string | null;
    statusCode: number;
    contentType: string;
    // Content analysis
    wordCount: number;
    language: string;
    contentHash: string;
    // Status tracking
    status: ScrapeStatus;
    errorMessage?: string;
  };
}

/**
 * Selectors for elements to remove before extraction
 */
const UNWANTED_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'nav',
  'footer',
  'header',
  'aside',
  '.advertisement',
  '.ads',
  '.sidebar',
  '.cookie-banner',
  '.popup',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
];

/**
 * Calculate word count from content
 */
function calculateWordCount(content: string): number {
  if (!content || content.trim().length === 0) {
    return 0;
  }
  return content
    .split(/\s+/)
    .filter(word => word.length > 0)
    .length;
}

/**
 * Simple language detection based on common word patterns
 * Returns ISO 639-1 language code
 */
function detectLanguage(text: string): string {
  if (!text || text.trim().length === 0) {
    return 'unknown';
  }

  const lowerText = text.toLowerCase();

  // Common word patterns for different languages
  const languagePatterns: Record<string, string[]> = {
    en: ['the', 'is', 'are', 'was', 'were', 'have', 'has', 'been', 'will', 'would', 'could', 'should', 'and', 'but', 'or', 'for', 'with'],
    es: ['el', 'la', 'los', 'las', 'es', 'son', 'está', 'están', 'tiene', 'tienen', 'y', 'pero', 'para', 'con', 'que', 'de'],
    fr: ['le', 'la', 'les', 'est', 'sont', 'avoir', 'été', 'pour', 'avec', 'que', 'dans', 'sur', 'ce', 'cette', 'et'],
    de: ['der', 'die', 'das', 'ist', 'sind', 'haben', 'wurde', 'werden', 'und', 'aber', 'für', 'mit', 'auf', 'bei'],
    pt: ['o', 'a', 'os', 'as', 'é', 'são', 'tem', 'para', 'com', 'que', 'de', 'em', 'por', 'uma', 'um'],
    it: ['il', 'la', 'i', 'le', 'è', 'sono', 'ha', 'per', 'con', 'che', 'di', 'in', 'una', 'un'],
  };

  // Count matches for each language
  const scores: Record<string, number> = {};
  for (const [lang, words] of Object.entries(languagePatterns)) {
    scores[lang] = 0;
    for (const word of words) {
      // Use word boundary regex for accurate matching
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = lowerText.match(regex);
      if (matches) {
        scores[lang] += matches.length;
      }
    }
  }

  // Find language with highest score
  let maxScore = 0;
  let detectedLang = 'en'; // Default to English

  for (const [lang, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedLang = lang;
    }
  }

  // If no significant matches, return 'en' as default
  return maxScore > 0 ? detectedLang : 'en';
}

/**
 * Generate content hash (SHA256, first 16 characters)
 */
function generateContentHash(content: string): string {
  if (!content || content.trim().length === 0) {
    return '';
  }
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Default HTTP metadata when not provided by crawler
 */
const DEFAULT_HTTP_METADATA: HttpMetadata = {
  parentUrl: null,
  statusCode: 200,
  contentType: 'text/html',
};

/**
 * Extracts clean, structured content from a page
 *
 * @param page - Playwright Page object
 * @param url - Current page URL
 * @param depth - Crawl depth level (0 = seed URL)
 * @param httpMetadata - Optional HTTP metadata from crawler
 * @returns Structured scraped content with comprehensive metadata
 */
export async function scrapeContent(
  page: Page,
  url: string,
  depth: number,
  httpMetadata?: Partial<HttpMetadata>
): Promise<ScrapedContent> {
  const scrapeStartTime = Date.now();
  const crawledAt = new Date().toISOString();

  // Merge with defaults
  const metadata: HttpMetadata = {
    ...DEFAULT_HTTP_METADATA,
    ...httpMetadata,
  };

  try {
    // Use page.evaluate to run extraction logic in the browser context
    const extracted = await page.evaluate((unwantedSelectors) => {
      // Clone the document to avoid modifying the actual page
      // (in case we need to continue crawling)
      const docClone = document.cloneNode(true) as Document;

      // Remove unwanted elements before extraction
      unwantedSelectors.forEach(selector => {
        docClone.querySelectorAll(selector).forEach(el => el.remove());
      });

      // Extract page title
      const title = document.title || '';

      // Extract all headings (h1-h6)
      const headings: string[] = [];
      docClone.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
        const text = heading.textContent?.trim();
        if (text) headings.push(text);
      });

      // Extract all links from the page (before removing elements)
      const links: string[] = [];
      document.querySelectorAll('a[href]').forEach(anchor => {
        const href = (anchor as HTMLAnchorElement).href;
        if (href && href.startsWith('http')) {
          links.push(href);
        }
      });

      // Extract main content area
      const mainElement =
        docClone.querySelector('main') ||
        docClone.querySelector('article') ||
        docClone.querySelector('[role="main"]') ||
        docClone.querySelector('.content') ||
        docClone.querySelector('#content') ||
        docClone.body;

      // Get clean text content
      let content = mainElement?.textContent || '';
      content = content
        .replace(/\s+/g, ' ')  // Collapse whitespace
        .replace(/\n\s*\n/g, '\n\n')  // Normalize line breaks
        .trim();

      // Get cleaned HTML (inner HTML of main content)
      const cleanedHtml = mainElement?.innerHTML || '';

      return { title, headings, content, links, cleanedHtml };
    }, UNWANTED_SELECTORS);

    const scrapeDurationMs = Date.now() - scrapeStartTime;
    const scrapedAt = new Date().toISOString();

    // Calculate content analysis metrics
    const wordCount = calculateWordCount(extracted.content);
    const language = detectLanguage(extracted.content);
    const contentHash = generateContentHash(extracted.content);

    return {
      url,
      title: extracted.title,
      headings: extracted.headings,
      content: extracted.content,
      links: [...new Set(extracted.links)], // Deduplicate links
      cleanedHtml: extracted.cleanedHtml,
      metadata: {
        // Timing
        crawledAt,
        scrapedAt,
        scrapeDurationMs,
        depth,
        // HTTP metadata
        parentUrl: metadata.parentUrl,
        statusCode: metadata.statusCode,
        contentType: metadata.contentType,
        // Content analysis
        wordCount,
        language,
        contentHash,
        // Status
        status: 'SUCCESS',
      },
    };
  } catch (error) {
    const scrapeDurationMs = Date.now() - scrapeStartTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown scrape error';

    // Return failed scrape with error details
    return {
      url,
      title: '',
      headings: [],
      content: '',
      links: [],
      cleanedHtml: '',
      metadata: {
        crawledAt,
        scrapedAt: new Date().toISOString(),
        scrapeDurationMs,
        depth,
        parentUrl: metadata.parentUrl,
        statusCode: metadata.statusCode,
        contentType: metadata.contentType,
        wordCount: 0,
        language: 'unknown',
        contentHash: '',
        status: 'FAILED',
        errorMessage,
      },
    };
  }
}

/**
 * Options for standalone scraping
 */
export interface ScrapeUrlsOptions {
  processId?: string;
  onProgress?: (completed: number, total: number) => void;
}

/**
 * STANDALONE SCRAPING - Scrape a list of URLs without crawling
 *
 * This function is used for SCRAPE_ONLY mode where we don't discover
 * new URLs, just extract content from the provided URL list.
 *
 * @param urls - Array of URLs to scrape (can include depth info)
 * @param options - Optional configuration including progress tracking
 * @returns Array of scraped content with comprehensive metadata
 */
export async function scrapeUrls(
  urls: Array<{ url: string; depth: number }>,
  options?: ScrapeUrlsOptions
): Promise<ScrapedContent[]> {
  console.log(`\n[SCRAPER] Starting standalone scrape of ${urls.length} URLs`);

  const results: ScrapedContent[] = [];
  let browser: Browser | null = null;
  let completedCount = 0;

  try {
    // Launch browser for scraping
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    for (const { url, depth } of urls) {
      const scrapeStartTime = Date.now();

      try {
        console.log(`[SCRAPER] Scraping: ${url}`);

        const page = await context.newPage();

        // Navigate to the URL and capture response
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        // Capture HTTP metadata from response
        const httpMetadata: HttpMetadata = {
          parentUrl: null,
          statusCode: response?.status() ?? 200,
          contentType: (response?.headers()?.['content-type'] ?? 'text/html').split(';')[0].trim(),
        };

        // Extract content with HTTP metadata
        const content = await scrapeContent(page, url, depth, httpMetadata);
        results.push(content);

        await page.close();

        completedCount++;
        if (options?.onProgress) {
          options.onProgress(completedCount, urls.length);
        }

        console.log(`[SCRAPER] ✓ Scraped: ${content.title || url} (${content.metadata.wordCount} words)`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[SCRAPER] ✗ Failed to scrape ${url}:`, errorMessage);

        // Add failed result with error details
        results.push({
          url,
          title: '',
          headings: [],
          content: '',
          links: [],
          cleanedHtml: '',
          metadata: {
            crawledAt: new Date().toISOString(),
            scrapedAt: new Date().toISOString(),
            scrapeDurationMs: Date.now() - scrapeStartTime,
            depth,
            parentUrl: null,
            statusCode: 0,
            contentType: 'unknown',
            wordCount: 0,
            language: 'unknown',
            contentHash: '',
            status: 'FAILED',
            errorMessage,
          },
        });

        completedCount++;
        if (options?.onProgress) {
          options.onProgress(completedCount, urls.length);
        }
      }
    }

    await context.close();
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const successCount = results.filter(r => r.metadata.status === 'SUCCESS').length;
  const failCount = results.filter(r => r.metadata.status === 'FAILED').length;

  console.log(`[SCRAPER] Completed: ${successCount} success, ${failCount} failed out of ${urls.length} URLs\n`);
  return results;
}

/**
 * SINGLE URL SCRAPING - Convenience function for scraping a single URL
 *
 * @param url - URL to scrape
 * @returns Scraped content
 */
export async function scrapeSingleUrl(url: string): Promise<ScrapedContent> {
  const results = await scrapeUrls([{ url, depth: 0 }]);
  if (results.length === 0) {
    throw new Error(`Failed to scrape URL: ${url}`);
  }
  return results[0];
}
