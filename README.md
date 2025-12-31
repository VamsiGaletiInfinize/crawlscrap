# CrawlScrap Demo

A license-safe, self-hosted crawler + scraper demo for enterprise systems (UKA).
**Firecrawl-like evaluation tool** with clear crawl vs scrape distinction.

## License Compliance

All dependencies are **Apache 2.0** or **MIT** licensed. **No AGPL/GPL usage.**

| Package    | License     |
|------------|-------------|
| crawlee    | Apache 2.0  |
| playwright | Apache 2.0  |
| express    | MIT         |
| typescript | Apache 2.0  |
| tsx        | MIT         |
| uuid       | MIT         |

## Quick Start

```bash
# Install dependencies
npm install

# Install Playwright browsers (first time only)
npx playwright install chromium

# Run in development mode
npm run dev
```

Open **http://localhost:3000** in your browser.

## Features

### Operation Modes

| Mode | Description |
|------|-------------|
| **Crawl Only** | URL discovery without content extraction |
| **Scrape Only** | Content extraction from single URL |
| **Crawl + Scrape** | URL discovery followed by content extraction |

### Output Formats

| Format | Description | File Extension |
|--------|-------------|----------------|
| **JSON** | Structured data (default) | `.json` |
| **Markdown** | Human-readable format | `.md` |
| **Summary** | AI-ready excerpts (first 500 chars) | `.json` |
| **Links Only** | Just extracted URLs | `.json` |
| **HTML** | Cleaned semantic structure | `.html` |

### Controls

- **Include Subpages**: Toggle to crawl internal links within same domain
- **Max Depth**: Control how deep to crawl (0-5)
- **Output Format**: Select desired format for scrape results

## Architecture

```
Admin UI (localhost:3000)
    ↓
POST /api/process
    ↓
Processing Engine
   ├── Crawl Phase (optional)
   ├── Scrape Phase (optional)
   └── Output Formatter
    ↓
File-based Storage
   ├── crawl-output.json
   └── scrape-output.{json|md|html}
```

## API

### POST /api/process

**Request:**
```json
{
  "seedUrl": "https://example.com",
  "includeSubpages": true,
  "depth": 2,
  "operationMode": "CRAWL_AND_SCRAPE",
  "outputFormat": "JSON"
}
```

**Operation Modes:** `CRAWL_ONLY`, `SCRAPE_ONLY`, `CRAWL_AND_SCRAPE`

**Output Formats:** `JSON`, `MARKDOWN`, `SUMMARY`, `LINKS_ONLY`, `HTML`

**Response:**
```json
{
  "success": true,
  "operationMode": "CRAWL_AND_SCRAPE",
  "outputFormat": "JSON",
  "crawlOutput": {
    "filename": "crawl-output.json",
    "urlsDiscovered": 5,
    "urls": [
      { "url": "https://example.com", "depth": 0 },
      { "url": "https://example.com/about", "depth": 1 }
    ]
  },
  "scrapeOutput": {
    "filename": "scrape-output.json",
    "pagesScraped": 5,
    "format": "JSON",
    "results": [...]
  }
}
```

### POST /api/crawl (Legacy)

Original endpoint for backwards compatibility.

## Output Files

### Crawl Output (`data/crawl-output.json`)

```json
{
  "seedUrl": "https://example.com",
  "includeSubpages": true,
  "discoveredUrls": [
    { "url": "https://example.com", "depth": 0 },
    { "url": "https://example.com/about", "depth": 1 }
  ],
  "summary": {
    "totalUrls": 5,
    "startedAt": "2025-12-18T10:00:00Z",
    "completedAt": "2025-12-18T10:00:10Z"
  }
}
```

### Scrape Output (varies by format)

**JSON Format:**
```json
{
  "formatType": "JSON",
  "generatedAt": "2025-12-18T10:00:00Z",
  "totalPages": 5,
  "results": [
    {
      "url": "https://example.com",
      "title": "Example Site",
      "headings": ["Welcome", "About Us"],
      "content": "Cleaned text content...",
      "links": ["https://example.com/about"],
      "metadata": {
        "crawledAt": "2025-12-18T10:00:01Z",
        "depth": 0
      }
    }
  ]
}
```

## Project Structure

```
crawlscrap/
├── src/
│   ├── index.ts              # Express server entry
│   ├── api/
│   │   ├── process.ts        # /api/process endpoint (new)
│   │   └── crawl.ts          # /api/crawl endpoint (legacy)
│   ├── crawler/
│   │   ├── crawler.ts        # URL discovery (CRAWLING)
│   │   ├── scraper.ts        # Content extraction (SCRAPING)
│   │   └── formatter.ts      # Output format conversion
│   └── public/
│       └── index.html        # Admin UI
├── data/                     # Output files
│   ├── crawl-output.json
│   └── scrape-output.{json|md|html}
├── package.json
├── tsconfig.json
└── README.md
```

## Crawl vs Scrape

| Aspect | Crawling | Scraping |
|--------|----------|----------|
| **Purpose** | URL discovery | Content extraction |
| **Action** | Follow links | Parse HTML |
| **Output** | List of URLs | Structured content |
| **Module** | `crawler.ts` | `scraper.ts` |

## Production Build

```bash
npm run build
npm start
```

## Configuration Limits

| Parameter | Default | Max |
|-----------|---------|-----|
| Max Depth | 1 | 5 |
| Max Pages/Crawl | 50 | 50 |
| Concurrency | 2 | 2 |

## Notes

- Crawling is restricted to the **same domain** as the seed URL
- Results are **AI-ready** structured output
- No database required - **file-based storage only**
- **Self-hosted** - no external dependencies
