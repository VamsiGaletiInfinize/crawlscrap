/**
 * STREAMING RESULTS WRITER
 *
 * Writes crawl/scrape results to disk as they're processed
 * instead of accumulating in memory.
 *
 * Benefits:
 * - Constant memory usage regardless of crawl size
 * - Results available immediately for downstream processing
 * - Crash recovery - partial results are saved
 * - Supports multiple output formats
 */

import * as fs from 'fs';
import * as path from 'path';
import { ScrapedContent } from './scraper.js';

export interface StreamingWriterConfig {
  outputDir: string;
  jobId: string;
  format: 'jsonl' | 'json' | 'csv';
  flushInterval: number;  // Flush to disk every N results
  maxBufferSize: number;  // Max results in memory before forced flush
}

const defaultConfig: Partial<StreamingWriterConfig> = {
  format: 'jsonl',
  flushInterval: 100,
  maxBufferSize: 500,
};

/**
 * Streaming writer that writes results incrementally to disk
 */
export class StreamingWriter {
  private config: StreamingWriterConfig;
  private buffer: ScrapedContent[] = [];
  private writeStream: fs.WriteStream | null = null;
  private resultCount: number = 0;
  private isFirstWrite: boolean = true;
  private outputPath: string;
  private metaPath: string;

  constructor(config: StreamingWriterConfig) {
    this.config = { ...defaultConfig, ...config } as StreamingWriterConfig;

    // Ensure output directory exists
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }

    // Set output file path
    const ext = this.config.format === 'csv' ? 'csv' : 'json';
    this.outputPath = path.join(
      this.config.outputDir,
      `${this.config.jobId}-results.${ext}`
    );
    this.metaPath = path.join(
      this.config.outputDir,
      `${this.config.jobId}-meta.json`
    );

    this.initializeStream();
  }

  /**
   * Initialize the write stream based on format
   */
  private initializeStream(): void {
    this.writeStream = fs.createWriteStream(this.outputPath, {
      flags: 'w',
      encoding: 'utf8',
    });

    // Write format-specific header
    if (this.config.format === 'json') {
      this.writeStream.write('[\n');
    } else if (this.config.format === 'csv') {
      this.writeStream.write('url,title,depth,wordCount,language,scrapedAt\n');
    }
  }

  /**
   * Add a result to the buffer (will be flushed automatically)
   */
  write(result: ScrapedContent): void {
    this.buffer.push(result);
    this.resultCount++;

    // Auto-flush when buffer is full
    if (this.buffer.length >= this.config.flushInterval ||
        this.buffer.length >= this.config.maxBufferSize) {
      this.flush();
    }
  }

  /**
   * Write multiple results at once
   */
  writeBatch(results: ScrapedContent[]): void {
    for (const result of results) {
      this.write(result);
    }
  }

  /**
   * Flush buffer to disk
   */
  flush(): void {
    if (this.buffer.length === 0 || !this.writeStream) {
      return;
    }

    for (const result of this.buffer) {
      this.writeResult(result);
    }

    this.buffer = [];
  }

  /**
   * Write a single result to disk based on format
   */
  private writeResult(result: ScrapedContent): void {
    if (!this.writeStream) return;

    switch (this.config.format) {
      case 'jsonl':
        // JSON Lines format - one JSON object per line
        this.writeStream.write(JSON.stringify(result) + '\n');
        break;

      case 'json':
        // JSON array format
        const prefix = this.isFirstWrite ? '' : ',\n';
        this.writeStream.write(prefix + JSON.stringify(result, null, 2));
        this.isFirstWrite = false;
        break;

      case 'csv':
        // CSV format (simplified)
        const row = [
          this.escapeCSV(result.url),
          this.escapeCSV(result.title),
          result.metadata?.depth || 0,
          result.metadata?.wordCount || 0,
          result.metadata?.language || '',
          result.metadata?.scrapedAt || '',
        ].join(',');
        this.writeStream.write(row + '\n');
        break;
    }
  }

  /**
   * Escape CSV field
   */
  private escapeCSV(value: string): string {
    if (!value) return '""';
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  /**
   * Finalize and close the stream
   */
  async close(): Promise<{ path: string; count: number }> {
    // Flush remaining buffer
    this.flush();

    // Write format-specific footer
    if (this.writeStream) {
      if (this.config.format === 'json') {
        this.writeStream.write('\n]');
      }

      // Close the stream
      await new Promise<void>((resolve, reject) => {
        this.writeStream!.end((err: Error | null | undefined) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Write metadata file
    const meta = {
      jobId: this.config.jobId,
      outputPath: this.outputPath,
      format: this.config.format,
      totalResults: this.resultCount,
      completedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2));

    return {
      path: this.outputPath,
      count: this.resultCount,
    };
  }

  /**
   * Get current result count
   */
  getCount(): number {
    return this.resultCount;
  }

  /**
   * Get output file path
   */
  getOutputPath(): string {
    return this.outputPath;
  }
}

/**
 * Create a streaming writer for a job
 */
export function createStreamingWriter(
  jobId: string,
  outputDir: string = './data/results',
  format: 'jsonl' | 'json' | 'csv' = 'jsonl'
): StreamingWriter {
  return new StreamingWriter({
    outputDir,
    jobId,
    format,
    flushInterval: 100,
    maxBufferSize: 500,
  });
}

export default StreamingWriter;
