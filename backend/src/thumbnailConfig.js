const os = require('node:os');
const path = require('node:path');

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const thumbnailConfig = {
  maxUploadBytes: Math.max(1_000_000, Number(process.env.THUMB_MAX_UPLOAD_BYTES || 8 * GB)),
  maxBatchFiles: Math.max(1, Number(process.env.THUMB_MAX_BATCH_FILES || 100)),
  queueConcurrency: Math.max(1, Number(process.env.THUMB_QUEUE_CONCURRENCY || 1)),
  fileTtlMs: Math.max(60_000, Number(process.env.THUMB_FILE_TTL_MS || 30 * 60 * 1000)),
  remoteMaxBytes: Math.max(1 * MB, Number(process.env.THUMB_REMOTE_MAX_BYTES || 300 * MB)),
  remoteTimeoutMs: Math.max(5_000, Number(process.env.THUMB_REMOTE_TIMEOUT_MS || 30_000)),
  stateFile: process.env.THUMB_QUEUE_STATE_FILE || path.join(os.tmpdir(), 'mp3ok-thumb-queue.json'),
  uploadDir: process.env.THUMB_UPLOAD_DIR || path.join(os.tmpdir(), 'mp3ok-thumb-uploads'),
  outputDir: process.env.THUMB_OUTPUT_DIR || path.join(os.tmpdir(), 'mp3ok-thumb-outputs'),
};

module.exports = {
  thumbnailConfig,
};

