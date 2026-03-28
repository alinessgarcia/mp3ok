const os = require('node:os');
const path = require('node:path');

const DEFAULT_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_BATCH_FILES = 100;

const mediaConfig = {
  maxUploadBytes: Math.max(1_000_000, Number(process.env.MEDIA_MAX_UPLOAD_BYTES || DEFAULT_UPLOAD_BYTES)),
  maxBatchFiles: Math.max(1, Number(process.env.MEDIA_MAX_BATCH_FILES || DEFAULT_MAX_BATCH_FILES)),
  queueConcurrency: Math.max(1, Number(process.env.MEDIA_QUEUE_CONCURRENCY || 1)),
  defaultSegmentMinutes: Math.max(1, Number(process.env.MEDIA_DEFAULT_SEGMENT_MINUTES || 20)),
  fileTtlMs: Math.max(60_000, Number(process.env.MEDIA_FILE_TTL_MS || DEFAULT_TTL_MS)),
  stateFile: process.env.MEDIA_QUEUE_STATE_FILE || path.join(os.tmpdir(), 'mp3ok-media-queue.json'),
  uploadDir: process.env.MEDIA_UPLOAD_DIR || path.join(os.tmpdir(), 'mp3ok-media-uploads'),
  outputDir: process.env.MEDIA_OUTPUT_DIR || path.join(os.tmpdir(), 'mp3ok-media-outputs'),
};

module.exports = {
  mediaConfig,
};
