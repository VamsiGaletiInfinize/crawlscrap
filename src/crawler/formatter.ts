/**
 * OUTPUT FORMATTER - Content Format Conversion
 *
 * This module handles converting scraped content into different output formats:
 * - JSON: Structured data format (default)
 * - MARKDOWN: Human-readable markdown format
 * - SUMMARY: Short AI-ready summary of content
 * - LINKS_ONLY: Just the extracted links
 * - HTML: Cleaned HTML content
 *
 * Each format is designed for different use cases:
 * - JSON/Summary → AI ingestion
 * - Markdown → Human reading
 * - Links Only → Link analysis
 * - HTML → Preservation of structure
 */

import type { ScrapedContent } from './scraper.js';

/**
 * Supported output formats
 */
export type OutputFormat = 'JSON' | 'MARKDOWN' | 'SUMMARY' | 'LINKS_ONLY' | 'HTML';

/**
 * Result of formatting operation
 */
export interface FormattedOutput {
  format: OutputFormat;
  extension: string;
  content: string;
  mimeType: string;
}

/**
 * Format scraped content according to the specified output format
 *
 * @param results - Array of scraped content
 * @param format - Desired output format
 * @returns Formatted output with content string and metadata
 */
export function formatOutput(
  results: ScrapedContent[],
  format: OutputFormat
): FormattedOutput {
  switch (format) {
    case 'JSON':
      return formatAsJson(results);
    case 'MARKDOWN':
      return formatAsMarkdown(results);
    case 'SUMMARY':
      return formatAsSummary(results);
    case 'LINKS_ONLY':
      return formatAsLinksOnly(results);
    case 'HTML':
      return formatAsHtml(results);
    default:
      return formatAsJson(results);
  }
}

/**
 * Calculate aggregate statistics for results
 */
function calculateStatistics(results: ScrapedContent[]) {
  const successCount = results.filter(r => r.metadata.status === 'SUCCESS').length;
  const failedCount = results.filter(r => r.metadata.status === 'FAILED').length;
  const totalWords = results.reduce((sum, r) => sum + r.metadata.wordCount, 0);
  const totalLinks = results.reduce((sum, r) => sum + r.links.length, 0);
  const avgScrapeTime = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.metadata.scrapeDurationMs, 0) / results.length)
    : 0;

  // Language breakdown
  const languageCounts: Record<string, number> = {};
  for (const r of results) {
    const lang = r.metadata.language || 'unknown';
    languageCounts[lang] = (languageCounts[lang] || 0) + 1;
  }

  return {
    totalPages: results.length,
    successCount,
    failedCount,
    successRate: results.length > 0 ? `${((successCount / results.length) * 100).toFixed(1)}%` : '0%',
    totalWords,
    averageWordsPerPage: results.length > 0 ? Math.round(totalWords / results.length) : 0,
    totalLinks,
    averageScrapeTimeMs: avgScrapeTime,
    languageBreakdown: languageCounts,
  };
}

/**
 * FORMAT: JSON
 * Full structured data format - preserves all extracted information
 */
function formatAsJson(results: ScrapedContent[]): FormattedOutput {
  const statistics = calculateStatistics(results);

  const output = {
    formatType: 'JSON',
    generatedAt: new Date().toISOString(),
    statistics,
    results: results.map(r => ({
      url: r.url,
      title: r.title,
      headings: r.headings,
      content: r.content,
      links: r.links,
      metadata: r.metadata,
    })),
  };

  return {
    format: 'JSON',
    extension: 'json',
    content: JSON.stringify(output, null, 2),
    mimeType: 'application/json',
  };
}

/**
 * FORMAT: MARKDOWN
 * Human-readable markdown format with organized sections:
 * - Metadata as table
 * - Page Structure (headings)
 * - Content
 * - Links (ALL links, no truncation)
 */
function formatAsMarkdown(results: ScrapedContent[]): FormattedOutput {
  const statistics = calculateStatistics(results);

  const sections = results.map(r => {
    const parts: string[] = [];
    const statusEmoji = r.metadata.status === 'SUCCESS' ? '✓' : '✗';

    // Page title as H1
    parts.push(`# ${statusEmoji} ${r.title || 'Untitled Page'}`);
    parts.push('');

    // Metadata as organized table
    parts.push('## Metadata');
    parts.push('');
    parts.push('| Field | Value |');
    parts.push('|-------|-------|');
    parts.push(`| URL | ${r.url} |`);
    parts.push(`| Status | ${r.metadata.status} |`);
    parts.push(`| HTTP Status | ${r.metadata.statusCode} |`);
    parts.push(`| Content Type | ${r.metadata.contentType} |`);
    parts.push(`| Words | ${r.metadata.wordCount} |`);
    parts.push(`| Language | ${r.metadata.language} |`);
    parts.push(`| Content Hash | ${r.metadata.contentHash || 'N/A'} |`);
    parts.push(`| Scraped At | ${r.metadata.scrapedAt} |`);
    parts.push(`| Duration | ${r.metadata.scrapeDurationMs}ms |`);
    parts.push(`| Depth | ${r.metadata.depth} |`);
    if (r.metadata.parentUrl) {
      parts.push(`| Parent URL | ${r.metadata.parentUrl} |`);
    }
    parts.push('');

    // Show error if failed
    if (r.metadata.status === 'FAILED' && r.metadata.errorMessage) {
      parts.push('---');
      parts.push('## Error');
      parts.push(`\`\`\`\n${r.metadata.errorMessage}\n\`\`\``);
      parts.push('');
      return parts.join('\n');
    }

    // Page Structure - show ALL headings
    if (r.headings.length > 0) {
      parts.push('---');
      parts.push('## Page Structure');
      r.headings.forEach(h => {
        parts.push(`- ${h}`);
      });
      parts.push('');
    }

    // Main content
    parts.push('---');
    parts.push('## Content');
    parts.push('');
    parts.push(r.content);
    parts.push('');

    // Links - show ALL links (no truncation)
    if (r.links && r.links.length > 0) {
      parts.push('---');
      parts.push(`## Links (${r.links.length} total)`);
      r.links.forEach(link => {
        parts.push(`- ${link}`);
      });
      parts.push('');
    }

    return parts.join('\n');
  });

  const header = [
    '# Scraped Content',
    '',
    `**Generated:** ${new Date().toISOString()}`,
    '',
    '## Statistics',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Pages | ${statistics.totalPages} |`,
    `| Successful | ${statistics.successCount} |`,
    `| Failed | ${statistics.failedCount} |`,
    `| Success Rate | ${statistics.successRate} |`,
    `| Total Words | ${statistics.totalWords} |`,
    `| Avg Words/Page | ${statistics.averageWordsPerPage} |`,
    `| Avg Scrape Time | ${statistics.averageScrapeTimeMs}ms |`,
    '',
    '---',
    '',
  ].join('\n');

  return {
    format: 'MARKDOWN',
    extension: 'md',
    content: header + sections.join('\n---\n\n'),
    mimeType: 'text/markdown',
  };
}

/**
 * FORMAT: SUMMARY
 * Short AI-ready summary - first 500 characters of content per page
 * Includes key metadata for AI processing
 */
function formatAsSummary(results: ScrapedContent[]): FormattedOutput {
  const statistics = calculateStatistics(results);

  const output = {
    formatType: 'SUMMARY',
    generatedAt: new Date().toISOString(),
    statistics,
    results: results.map(r => ({
      url: r.url,
      title: r.title,
      summary: truncateToSummary(r.content, 500),
      status: r.metadata.status,
      errorMessage: r.metadata.errorMessage,
      analysis: {
        wordCount: r.metadata.wordCount,
        language: r.metadata.language,
        contentHash: r.metadata.contentHash,
      },
      timing: {
        scrapedAt: r.metadata.scrapedAt,
        scrapeDurationMs: r.metadata.scrapeDurationMs,
        depth: r.metadata.depth,
      },
    })),
  };

  return {
    format: 'SUMMARY',
    extension: 'json',
    content: JSON.stringify(output, null, 2),
    mimeType: 'application/json',
  };
}

/**
 * FORMAT: LINKS_ONLY
 * Just the extracted links from each page
 */
function formatAsLinksOnly(results: ScrapedContent[]): FormattedOutput {
  const output = {
    formatType: 'LINKS_ONLY',
    generatedAt: new Date().toISOString(),
    totalPages: results.length,
    totalLinks: results.reduce((acc, r) => acc + (r.links?.length || 0), 0),
    results: results.map(r => ({
      url: r.url,
      title: r.title,
      linkCount: r.links?.length || 0,
      links: r.links || [],
    })),
  };

  return {
    format: 'LINKS_ONLY',
    extension: 'json',
    content: JSON.stringify(output, null, 2),
    mimeType: 'application/json',
  };
}

/**
 * FORMAT: HTML
 * Cleaned HTML with semantic structure preserved
 */
function formatAsHtml(results: ScrapedContent[]): FormattedOutput {
  const statistics = calculateStatistics(results);

  const articles = results.map(r => {
    const statusClass = r.metadata.status === 'SUCCESS' ? 'success' : 'failed';
    const statusBadge = r.metadata.status === 'SUCCESS'
      ? '<span class="badge success">SUCCESS</span>'
      : '<span class="badge failed">FAILED</span>';

    const headingsHtml = r.headings.length > 0
      ? `<ul class="headings">${r.headings.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
      : '';

    const linksHtml = r.links && r.links.length > 0
      ? `<ul class="links">${r.links.slice(0, 20).map(l => `<li><a href="${escapeHtml(l)}">${escapeHtml(l)}</a></li>`).join('')}${r.links.length > 20 ? `<li class="more">... and ${r.links.length - 20} more links</li>` : ''}</ul>`
      : '';

    const errorHtml = r.metadata.status === 'FAILED' && r.metadata.errorMessage
      ? `<section class="error"><h2>Error</h2><pre>${escapeHtml(r.metadata.errorMessage)}</pre></section>`
      : '';

    return `
<article class="${statusClass}" data-url="${escapeHtml(r.url)}" data-depth="${r.metadata.depth}" data-status="${r.metadata.status}">
  <header>
    <div class="title-row">
      <h1>${escapeHtml(r.title || 'Untitled')}</h1>
      ${statusBadge}
    </div>
    <p class="source">Source: <a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></p>
    <div class="meta-grid">
      <span><strong>Status:</strong> ${r.metadata.statusCode}</span>
      <span><strong>Words:</strong> ${r.metadata.wordCount}</span>
      <span><strong>Language:</strong> ${r.metadata.language}</span>
      <span><strong>Duration:</strong> ${r.metadata.scrapeDurationMs}ms</span>
      <span><strong>Depth:</strong> ${r.metadata.depth}</span>
      <span><strong>Content Type:</strong> ${r.metadata.contentType}</span>
    </div>
    ${r.metadata.parentUrl ? `<p class="parent">Parent: <a href="${escapeHtml(r.metadata.parentUrl)}">${escapeHtml(r.metadata.parentUrl)}</a></p>` : ''}
  </header>
  ${errorHtml}
  ${headingsHtml ? `<section class="structure"><h2>Page Structure</h2>${headingsHtml}</section>` : ''}
  ${r.content ? `<section class="content"><h2>Content</h2><div class="text">${escapeHtml(r.content).replace(/\n/g, '<br>')}</div></section>` : ''}
  ${linksHtml ? `<section class="extracted-links"><h2>Links (${r.links.length})</h2>${linksHtml}</section>` : ''}
  <footer class="hash">Content Hash: <code>${r.metadata.contentHash || 'N/A'}</code></footer>
</article>`;
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scraped Content</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .stats { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-top: 15px; }
    .stat { background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; }
    .stat-value { font-size: 1.5rem; font-weight: bold; color: #333; }
    .stat-label { font-size: 0.85rem; color: #666; margin-top: 5px; }
    article { background: white; border: 1px solid #ddd; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    article.failed { border-left: 4px solid #dc3545; }
    article.success { border-left: 4px solid #28a745; }
    header { border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 15px; }
    .title-row { display: flex; justify-content: space-between; align-items: center; }
    h1 { margin: 0 0 10px 0; color: #333; font-size: 1.4rem; }
    h2 { color: #666; font-size: 1.1rem; }
    .badge { padding: 4px 12px; border-radius: 12px; font-size: 0.75rem; font-weight: bold; }
    .badge.success { background: #d4edda; color: #155724; }
    .badge.failed { background: #f8d7da; color: #721c24; }
    .source, .parent { font-size: 0.9rem; color: #666; margin: 5px 0; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; font-size: 0.85rem; color: #666; }
    .error { background: #fff3cd; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .error pre { margin: 10px 0 0 0; white-space: pre-wrap; color: #856404; }
    .text { line-height: 1.6; }
    .headings li, .links li { margin: 5px 0; }
    .more { color: #666; font-style: italic; }
    a { color: #0066cc; }
    footer.hash { margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; font-size: 0.8rem; color: #999; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Scraped Content</h1>
  <div class="stats">
    <h2>Statistics</h2>
    <div class="stats-grid">
      <div class="stat"><div class="stat-value">${statistics.totalPages}</div><div class="stat-label">Total Pages</div></div>
      <div class="stat"><div class="stat-value">${statistics.successCount}</div><div class="stat-label">Successful</div></div>
      <div class="stat"><div class="stat-value">${statistics.failedCount}</div><div class="stat-label">Failed</div></div>
      <div class="stat"><div class="stat-value">${statistics.successRate}</div><div class="stat-label">Success Rate</div></div>
      <div class="stat"><div class="stat-value">${statistics.totalWords}</div><div class="stat-label">Total Words</div></div>
      <div class="stat"><div class="stat-value">${statistics.averageScrapeTimeMs}ms</div><div class="stat-label">Avg Scrape Time</div></div>
    </div>
  </div>
  <p>Generated: ${new Date().toISOString()}</p>
  ${articles.join('\n')}
</body>
</html>`;

  return {
    format: 'HTML',
    extension: 'html',
    content: html,
    mimeType: 'text/html',
  };
}

/**
 * Helper: Truncate content to a summary
 */
function truncateToSummary(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }

  // Find the last complete sentence within the limit
  const truncated = content.substring(0, maxLength);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('! '),
    truncated.lastIndexOf('? ')
  );

  if (lastSentenceEnd > maxLength * 0.5) {
    return truncated.substring(0, lastSentenceEnd + 1);
  }

  // Otherwise just truncate at word boundary
  const lastSpace = truncated.lastIndexOf(' ');
  return truncated.substring(0, lastSpace) + '...';
}

/**
 * Helper: Count words in content
 */
function countWords(content: string): number {
  return content.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Helper: Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Get file extension for a given format
 */
export function getFileExtension(format: OutputFormat): string {
  const extensions: Record<OutputFormat, string> = {
    JSON: 'json',
    MARKDOWN: 'md',
    SUMMARY: 'json',
    LINKS_ONLY: 'json',
    HTML: 'html',
  };
  return extensions[format];
}
