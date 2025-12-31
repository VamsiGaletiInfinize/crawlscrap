# CrawlScrap Demo Presentation

## License-Safe Web Crawler & Scraper for Enterprise

**Demo for:** UKA Internal Evaluation
**Date:** December 2025
**Status:** Working Demo (Not Production)

---

## 1. Project Introduction

### What is CrawlScrap?

A **self-hosted, license-safe** web crawler and scraper built for enterprise use cases.

| Attribute | Value |
|-----------|-------|
| **Purpose** | Web content extraction for AI/ML pipelines |
| **Deployment** | Self-hosted (on-premise or private cloud) |
| **License** | All dependencies Apache 2.0 / MIT |
| **Output** | AI-ready structured data |

> **Speaker Note:** Emphasize that this is a custom-built solution specifically designed to avoid license risks while providing Firecrawl-like functionality.

---

## 2. Problem Statement

### Why We Built This

**Enterprise Challenge:**
- Need to extract web content for AI training, knowledge bases, and analysis
- Existing tools like Firecrawl use **AGPL license** (viral, requires source disclosure)
- Cannot use AGPL in enterprise proprietary systems
- Need **full control** over data processing pipeline

**Our Requirements:**
- No AGPL / GPL dependencies
- Self-hosted (no data leaves our infrastructure)
- Clear separation of crawling vs scraping
- Multiple output formats for different use cases

> **Speaker Note:** This addresses a real compliance gap. AGPL means if we modify the code, we must release our modifications. That's a non-starter for proprietary enterprise systems.

---

## 3. Solution Overview

### What We Built

```
┌─────────────────────────────────────────────────────────────┐
│                    CrawlScrap Demo                          │
├─────────────────────────────────────────────────────────────┤
│  Admin UI        →  Simple web interface                   │
│  REST API        →  /api/process endpoint                  │
│  Crawler Engine  →  URL discovery (Crawlee + Playwright)   │
│  Scraper Engine  →  Content extraction                     │
│  Output Formats  →  JSON, Markdown, Summary, Links, HTML   │
│  Storage         →  File-based JSON (no database needed)   │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack (All License-Safe)

| Component | Technology | License |
|-----------|------------|---------|
| Crawler | Crawlee | Apache 2.0 |
| Browser | Playwright | Apache 2.0 |
| Server | Express.js | MIT |
| Language | TypeScript | Apache 2.0 |

> **Speaker Note:** Every dependency has been verified. Zero AGPL/GPL usage. This is production-safe from a licensing perspective.

---

## 4. Architecture

### System Flow

```
┌──────────────┐
│   Admin UI   │  (Browser - localhost:3000)
└──────┬───────┘
       │ HTTP POST
       ▼
┌──────────────┐
│  Express API │  /api/process
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│         Processing Engine            │
│  ┌─────────────┐   ┌─────────────┐  │
│  │   CRAWL     │ → │   SCRAPE    │  │
│  │ (discover)  │   │ (extract)   │  │
│  └─────────────┘   └─────────────┘  │
│              ↓                       │
│  ┌───────────────────────────────┐  │
│  │      Output Formatter         │  │
│  │  JSON | MD | Summary | HTML   │  │
│  └───────────────────────────────┘  │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│  /data/      │
│  ├── crawl-output.json
│  └── scrape-output.{json|md|html}
└──────────────┘
```

> **Speaker Note:** Point out the clear separation between crawling (URL discovery) and scraping (content extraction). This modularity is intentional for clarity and testing.

---

## 5. Feature Walkthrough

### A. Operation Modes

| Mode | What It Does | Use Case |
|------|--------------|----------|
| **Crawl Only** | Discovers URLs without extracting content | Site mapping, link analysis |
| **Scrape Only** | Extracts content from a single URL | Quick content grab |
| **Crawl + Scrape** | Discovers URLs then extracts content from all | Full site extraction |

> **Speaker Note:** The separation of modes allows users to understand exactly what's happening. "Crawl Only" proves URL discovery works. "Scrape Only" proves content extraction works. "Crawl + Scrape" combines both.

### B. Output Formats

| Format | Description | Best For |
|--------|-------------|----------|
| **JSON** | Structured data with all fields | API integration, AI pipelines |
| **Markdown** | Human-readable with headers | Documentation, reading |
| **Summary** | First 500 chars per page | Quick overview, AI context |
| **Links Only** | Just extracted URLs | Link analysis |
| **HTML** | Cleaned semantic HTML | Structure preservation |

> **Speaker Note:** Demonstrate at least JSON and Markdown formats. Show how the same content looks different in each format.

### C. Control Options

| Control | Description |
|---------|-------------|
| **Include Subpages** | Toggle crawling of internal links |
| **Max Depth** | How many levels deep to crawl (0-5) |
| **Output Format** | Select desired format for scrape results |

---

## 6. Live Demo Walkthrough

### Demo Setup
```bash
# Terminal 1: Start the server
npm run dev

# Open browser
http://localhost:3000
```

---

### Demo Scenario 1: Crawl Only

**Goal:** Show URL discovery without content extraction

**Steps:**
1. Enter URL: `https://books.toscrape.com`
2. Select: **Crawl Only**
3. Check: **Include Subpages** ✓
4. Set Depth: **1**
5. Click: **Start Processing**

**Expected Output:**
- `crawl-output.json` with discovered URLs
- UI shows list of URLs with depth indicators

> **Speaker Note:** "Notice we're only discovering URLs here. No content is being extracted. This is useful for understanding the site structure first."

---

### Demo Scenario 2: Scrape Only

**Goal:** Show content extraction from single URL

**Steps:**
1. Enter URL: `https://books.toscrape.com`
2. Select: **Scrape Only**
3. Select Format: **Markdown**
4. Click: **Start Processing**

**Expected Output:**
- `scrape-output.md` with page content
- UI shows title, headings, content preview

> **Speaker Note:** "This extracts content from just the seed URL. No link following. Good for grabbing a specific page quickly."

---

### Demo Scenario 3: Crawl + Scrape (Full Pipeline)

**Goal:** Show complete crawl-to-scrape pipeline

**Steps:**
1. Enter URL: `https://books.toscrape.com`
2. Select: **Crawl + Scrape**
3. Check: **Include Subpages** ✓
4. Set Depth: **1**
5. Select Format: **JSON**
6. Click: **Start Processing**

**Expected Output:**
- `crawl-output.json` with discovered URLs
- `scrape-output.json` with all page content
- UI shows both crawl and scrape results

> **Speaker Note:** "This is the full pipeline. First we discover URLs, then we extract content from each. Both outputs are saved separately for transparency."

---

### Demo Scenario 4: Different Output Formats

**Goal:** Show format flexibility

**Steps:**
1. Run Scrape Only with **JSON** → Show structured data
2. Run Scrape Only with **Markdown** → Show readable format
3. Run Scrape Only with **Summary** → Show AI-ready excerpts
4. Open the output files in the `/data` folder

> **Speaker Note:** "Same content, different formats. JSON for APIs, Markdown for humans, Summary for AI context windows."

---

## 7. What's Completed

### Implemented Features

| Feature | Status |
|---------|--------|
| Admin UI with all controls | ✅ Complete |
| REST API `/api/process` | ✅ Complete |
| Crawl-only mode | ✅ Complete |
| Scrape-only mode | ✅ Complete |
| Crawl + Scrape mode | ✅ Complete |
| JSON output format | ✅ Complete |
| Markdown output format | ✅ Complete |
| Summary output format | ✅ Complete |
| Links-only output format | ✅ Complete |
| HTML output format | ✅ Complete |
| Same-domain restriction | ✅ Complete |
| Depth control | ✅ Complete |
| Subpage toggle | ✅ Complete |
| Separate output files | ✅ Complete |

### Code Quality

| Aspect | Implementation |
|--------|----------------|
| **Separation of concerns** | Crawler, Scraper, Formatter are separate modules |
| **Clear comments** | Each module explains crawl vs scrape distinction |
| **Type safety** | Full TypeScript with interfaces |
| **Error handling** | Try-catch with user-friendly messages |

---

## 8. Current Limitations

### This is a Demo, Not Production

| Limitation | Details |
|------------|---------|
| **No authentication** | API is open, no auth required |
| **No rate limiting** | Could overload target sites |
| **Max 50 pages** | Hard limit per crawl operation |
| **No caching** | Re-crawls same pages each time |
| **No queue management** | Synchronous processing only |
| **No distributed crawling** | Single-node only |
| **Limited error recovery** | Failed pages are skipped |

> **Speaker Note:** "These are intentional simplifications for the demo. Production would need authentication, rate limiting, and distributed processing."

---

## 9. Roadmap / Next Steps

### Potential Enhancements

| Priority | Feature | Description |
|----------|---------|-------------|
| **High** | Authentication | API key or OAuth for access control |
| **High** | Rate limiting | Respect robots.txt, add delays |
| **Medium** | Caching | Store pages to avoid re-crawling |
| **Medium** | Job queue | Async processing with status polling |
| **Medium** | Custom selectors | User-defined CSS selectors for extraction |
| **Low** | Distributed crawling | Multi-node for scale |
| **Low** | Scheduling | Cron-based recurring crawls |
| **Low** | Webhooks | Notify on completion |

### If Approved for Production

1. Add authentication layer
2. Implement rate limiting
3. Add proper logging and monitoring
4. Set up CI/CD pipeline
5. Write comprehensive tests
6. Create deployment documentation

---

## 10. Summary

### Key Takeaways

| Point | Detail |
|-------|--------|
| **License-Safe** | Zero AGPL/GPL - all Apache 2.0 or MIT |
| **Self-Hosted** | No data leaves your infrastructure |
| **Clear Architecture** | Crawl and scrape are visibly separate |
| **Flexible Output** | 5 formats for different use cases |
| **Working Demo** | Fully functional, ready to test |

### Value Proposition

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   "A Firecrawl-like tool we can actually use in           │
│    enterprise without license compliance concerns."        │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Demo Access

```
URL:     http://localhost:3000
API:     http://localhost:3000/api/process
Docs:    README.md
Source:  All TypeScript in /src
Output:  JSON files in /data
```

---

## Appendix: Quick Reference

### API Request Format

```json
POST /api/process
{
  "seedUrl": "https://example.com",
  "includeSubpages": true,
  "depth": 2,
  "operationMode": "CRAWL_AND_SCRAPE",
  "outputFormat": "JSON"
}
```

### Operation Modes
- `CRAWL_ONLY`
- `SCRAPE_ONLY`
- `CRAWL_AND_SCRAPE`

### Output Formats
- `JSON`
- `MARKDOWN`
- `SUMMARY`
- `LINKS_ONLY`
- `HTML`

### File Outputs
- `/data/crawl-output.json` - Discovered URLs
- `/data/scrape-output.{json|md|html}` - Extracted content

---

**End of Presentation**

*Questions?*
