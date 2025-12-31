# CrawlScrap Roadmap

## Vision

Transform CrawlScrap into a **university-scale web crawler** capable of crawling 50,000 - 150,000 pages per institution, designed specifically for **US Higher Education** systems.

---

## Current State (v1.0)

| Metric | Value |
|--------|-------|
| Max pages per crawl | 500 |
| Concurrent workers | 1 |
| Storage | JSON files |
| Job model | Synchronous (blocking) |
| Resume capability | None |
| Rate limiting | None |

**Limitations:**
- Cannot handle university-scale websites (50k+ pages)
- No persistence - crash loses all progress
- Single-threaded crawling is slow
- No politeness controls (may get IP blocked)

---

## Target State (v2.0)

| Metric | Value |
|--------|-------|
| Max pages per crawl | **Unlimited** |
| Concurrent workers | **5-50 (configurable)** |
| Storage | **PostgreSQL + Redis** |
| Job model | **Async (non-blocking)** |
| Resume capability | **Yes** |
| Rate limiting | **Built-in** |

**Capabilities:**
- Crawl entire university websites (100k+ pages)
- Resume from failures
- Real-time progress tracking
- Respect robots.txt
- Configurable politeness delays

---

## Architecture Comparison

### v1.0 (Current)
```
Client Request
      ↓
  [Express API]
      ↓
  [Single Crawler]  ←── Blocks until complete
      ↓
  [JSON Files]
      ↓
  Response (all data)
```

### v2.0 (Target - Firecrawl-style)
```
Client Request
      ↓
  [Express API] ──→ Returns job_id immediately
      ↓
  [Redis Queue]
      ↓
  ┌─────┼─────┐
  ↓     ↓     ↓
[W1]  [W2]  [W3]  ←── Parallel workers
  ↓     ↓     ↓
  └─────┼─────┘
        ↓
  [PostgreSQL]
        ↓
  GET /jobs/:id ──→ Paginated results
```

---

## Implementation Phases

### Phase 1: Async Job System
**Goal:** Non-blocking API with job tracking

- [ ] Create job management module
- [ ] Implement async `/api/v2/crawl` endpoint
- [ ] Add job status tracking
- [ ] Create `/api/v2/jobs/:id` status endpoint
- [ ] In-memory job store (upgrade to Redis later)

**API Changes:**
```
POST /api/v2/crawl
  → { jobId: "uuid", status: "queued" }

GET /api/v2/jobs/:id
  → { jobId, status, progress, results (paginated) }

DELETE /api/v2/jobs/:id
  → Cancel job
```

---

### Phase 2: Worker Pool
**Goal:** Parallel crawling with configurable workers

- [ ] Create worker pool manager
- [ ] Implement configurable worker count (default: 5)
- [ ] Each worker = independent Playwright instance
- [ ] Worker lifecycle management (spawn, kill, restart)
- [ ] Progress aggregation from workers

**Configuration:**
```typescript
{
  workers: 5,           // Number of parallel workers
  pagesPerWorker: 100,  // Batch size per worker
}
```

---

### Phase 3: Queue System (Redis + BullMQ)
**Goal:** Persistent, distributed job queue

- [ ] Add Redis dependency
- [ ] Implement BullMQ queues:
  - `crawl-jobs` - Main job queue
  - `url-queue` - URLs to process
- [ ] Job persistence (survive restarts)
- [ ] Queue monitoring dashboard

**New Dependencies:**
```json
{
  "ioredis": "^5.x",
  "bullmq": "^5.x"
}
```

---

### Phase 4: Database Storage (PostgreSQL)
**Goal:** Persistent, queryable storage

- [ ] Add PostgreSQL dependency
- [ ] Create database schema:
  - `jobs` - Crawl job metadata
  - `domains` - Domain information
  - `pages` - Discovered URLs
  - `content` - Scraped content
- [ ] Batch insert for performance
- [ ] Full-text search on content

**Schema:**
```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  seed_url TEXT NOT NULL,
  status VARCHAR(20),
  created_at TIMESTAMP,
  completed_at TIMESTAMP,
  pages_discovered INT,
  pages_scraped INT
);

CREATE TABLE pages (
  id SERIAL PRIMARY KEY,
  job_id UUID REFERENCES jobs(id),
  url TEXT NOT NULL,
  status VARCHAR(20),
  depth INT,
  scraped_at TIMESTAMP
);

CREATE TABLE content (
  id SERIAL PRIMARY KEY,
  page_id INT REFERENCES pages(id),
  title TEXT,
  text_content TEXT,
  html TEXT,
  word_count INT,
  content_hash VARCHAR(64)
);
```

---

### Phase 5: Rate Limiting & Politeness
**Goal:** Avoid getting blocked, respect website policies

- [ ] Parse and respect robots.txt
- [ ] Configurable request delays
- [ ] Per-domain rate limiting
- [ ] Auto-throttle on 429 responses
- [ ] User-Agent rotation

**Configuration:**
```typescript
{
  delayBetweenRequests: 1000,  // ms between requests
  respectRobotsTxt: true,
  maxRequestsPerDomain: 100,   // per minute
}
```

---

### Phase 6: Resume & Checkpointing
**Goal:** Recover from failures without losing progress

- [ ] Save checkpoint every N pages (default: 100)
- [ ] Store checkpoint in database
- [ ] Resume endpoint: `POST /api/v2/jobs/:id/resume`
- [ ] Automatic retry for failed pages (max 3 attempts)

---

### Phase 7: Export & Pagination
**Goal:** Handle large result sets efficiently

- [ ] Paginated results API
- [ ] Streaming export endpoint
- [ ] Export formats: JSON, CSV, JSONL
- [ ] Background export jobs for large datasets

**API:**
```
GET /api/v2/jobs/:id/pages?page=1&limit=100
GET /api/v2/jobs/:id/export?format=jsonl
```

---

## Performance Targets

| Phase | Workers | Pages/Hour | 100k Pages Time |
|-------|---------|------------|-----------------|
| v1.0 (current) | 1 | ~400 | Not possible |
| Phase 2 | 5 | ~9,000 | ~11 hours |
| Phase 3+ | 15 | ~36,000 | ~3 hours |
| Optimized | 25 | ~60,000 | ~1.5 hours |

---

## Infrastructure Requirements

### Development (Phases 1-2)
- Node.js 20+
- No external services needed
- In-memory storage

### Production (Phases 3+)
- Redis server (or Docker container)
- PostgreSQL database (or Docker container)
- Recommended: 4+ CPU cores, 8GB+ RAM

### Docker Compose (Production)
```yaml
services:
  crawler:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - redis
      - postgres

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: crawlscrap
      POSTGRES_USER: crawler
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
```

---

## Milestones

| Milestone | Phases | Capability |
|-----------|--------|------------|
| **M1: Async** | 1 | Non-blocking crawls, job tracking |
| **M2: Parallel** | 1-2 | 5x faster with worker pool |
| **M3: Persistent** | 1-3 | Resume from failures |
| **M4: Scalable** | 1-4 | 100k+ pages, queryable storage |
| **M5: Production** | 1-7 | Full Firecrawl-style system |

---

## Success Criteria

- [ ] Crawl a full university website (50k+ pages) without failure
- [ ] Resume from any point after crash/restart
- [ ] Complete 100k pages in under 4 hours
- [ ] No IP blocks due to rate limiting
- [ ] Query results without loading entire dataset

---

## License Compliance

All new dependencies must maintain **Apache 2.0** or **MIT** licensing:

| Package | License | Purpose |
|---------|---------|---------|
| ioredis | MIT | Redis client |
| bullmq | MIT | Job queue |
| pg | MIT | PostgreSQL client |
| prisma | Apache 2.0 | ORM (optional) |

---

## Next Steps

1. **Immediate:** Create GitHub issues for each phase
2. **Phase 1:** Start with async job system (no new infrastructure)
3. **Validate:** Test with medium-sized university site (5k-10k pages)
4. **Scale:** Add Redis/PostgreSQL for full scale

---

*Last updated: December 30, 2024*