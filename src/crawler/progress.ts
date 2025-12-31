/**
 * PROGRESS TRACKING MODULE
 *
 * Provides real-time progress tracking for crawl and scrape operations.
 * Uses in-memory storage (Map) to track progress state per process.
 * Includes ETA calculation based on average processing time.
 */

/**
 * Current processing phase
 */
export type ProcessPhase = 'IDLE' | 'CRAWLING' | 'SCRAPING' | 'VALIDATING' | 'COMPLETED' | 'ERROR';

/**
 * Progress state for a single process
 */
export interface ProgressState {
  processId: string;
  phase: ProcessPhase;
  crawl: {
    completed: number;
    total: number;
    percent: number;
  };
  scrape: {
    completed: number;
    total: number;
    percent: number;
  };
  overallPercent: number;
  etaSeconds: number;
  avgTimePerPage: number;
  startedAt: number;
  lastUpdated: number;
  error?: string;
}

/**
 * In-memory progress store
 * Key: processId, Value: ProgressState
 */
const progressStore = new Map<string, ProgressState>();

/**
 * Initialize progress tracking for a new process
 */
export function initProgress(processId: string): void {
  const now = Date.now();
  progressStore.set(processId, {
    processId,
    phase: 'IDLE',
    crawl: { completed: 0, total: 0, percent: 0 },
    scrape: { completed: 0, total: 0, percent: 0 },
    overallPercent: 0,
    etaSeconds: 0,
    avgTimePerPage: 0,
    startedAt: now,
    lastUpdated: now,
  });
  console.log(`[PROGRESS] Initialized tracking for process: ${processId}`);
}

/**
 * Start the crawling phase
 */
export function startCrawlPhase(processId: string): void {
  const state = progressStore.get(processId);
  if (state) {
    state.phase = 'CRAWLING';
    state.lastUpdated = Date.now();
    console.log(`[PROGRESS] Started CRAWLING phase for: ${processId}`);
  }
}

/**
 * Update crawl progress
 */
export function updateCrawlProgress(
  processId: string,
  completed: number,
  total: number
): void {
  const state = progressStore.get(processId);
  if (state) {
    state.crawl.completed = completed;
    state.crawl.total = Math.max(total, completed);
    state.crawl.percent = state.crawl.total > 0
      ? Math.round((completed / state.crawl.total) * 100)
      : 0;
    state.lastUpdated = Date.now();
    updateOverallProgress(state);
  }
}

/**
 * Start the scraping phase
 */
export function startScrapePhase(processId: string, totalUrls: number): void {
  const state = progressStore.get(processId);
  if (state) {
    state.phase = 'SCRAPING';
    state.scrape.total = totalUrls;
    state.lastUpdated = Date.now();
    console.log(`[PROGRESS] Started SCRAPING phase for: ${processId} (${totalUrls} URLs)`);
  }
}

/**
 * Update scrape progress
 */
export function updateScrapeProgress(
  processId: string,
  completed: number,
  total?: number
): void {
  const state = progressStore.get(processId);
  if (state) {
    state.scrape.completed = completed;
    if (total !== undefined) {
      state.scrape.total = total;
    }
    state.scrape.percent = state.scrape.total > 0
      ? Math.round((completed / state.scrape.total) * 100)
      : 0;
    state.lastUpdated = Date.now();
    updateOverallProgress(state);
  }
}

/**
 * Calculate and update overall progress and ETA
 */
function updateOverallProgress(state: ProgressState): void {
  const totalItems = state.crawl.total + state.scrape.total;
  const completedItems = state.crawl.completed + state.scrape.completed;

  // Calculate overall percentage
  if (totalItems > 0) {
    state.overallPercent = Math.round((completedItems / totalItems) * 100);
  }

  // Calculate ETA based on average time per page
  const elapsed = Date.now() - state.startedAt;
  if (completedItems > 0) {
    state.avgTimePerPage = elapsed / completedItems;
    const remainingItems = totalItems - completedItems;
    state.etaSeconds = Math.ceil((remainingItems * state.avgTimePerPage) / 1000);
  }
}

/**
 * Start validation phase
 */
export function startValidationPhase(processId: string): void {
  const state = progressStore.get(processId);
  if (state) {
    state.phase = 'VALIDATING';
    state.lastUpdated = Date.now();
    console.log(`[PROGRESS] Started VALIDATING phase for: ${processId}`);
  }
}

/**
 * Mark process as completed
 */
export function completeProgress(processId: string): void {
  const state = progressStore.get(processId);
  if (state) {
    state.phase = 'COMPLETED';
    state.overallPercent = 100;
    state.crawl.percent = 100;
    state.scrape.percent = state.scrape.total > 0 ? 100 : 0;
    state.etaSeconds = 0;
    state.lastUpdated = Date.now();

    const duration = (Date.now() - state.startedAt) / 1000;
    console.log(`[PROGRESS] COMPLETED process: ${processId} (took ${duration.toFixed(1)}s)`);
  }
}

/**
 * Mark process as errored
 */
export function errorProgress(processId: string, error: string): void {
  const state = progressStore.get(processId);
  if (state) {
    state.phase = 'ERROR';
    state.error = error;
    state.lastUpdated = Date.now();
    console.log(`[PROGRESS] ERROR in process: ${processId} - ${error}`);
  }
}

/**
 * Get current progress state for a process
 */
export function getProgress(processId: string): ProgressState | null {
  return progressStore.get(processId) || null;
}

/**
 * Clean up old progress entries (older than 1 hour)
 */
export function cleanupOldProgress(): void {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  for (const [id, state] of progressStore) {
    if (state.lastUpdated < oneHourAgo) {
      progressStore.delete(id);
      console.log(`[PROGRESS] Cleaned up old process: ${id}`);
    }
  }
}

/**
 * Format ETA for display
 */
export function formatEta(seconds: number): string {
  if (seconds <= 0) return '--';
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `~${minutes}m ${remainingSeconds}s`;
}
