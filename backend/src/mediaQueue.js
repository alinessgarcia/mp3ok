const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const EventEmitter = require('node:events');
const { processMediaJob } = require('./mediaProcessor');

class MediaQueue {
  constructor({ concurrency, fileTtlMs, stateFile, outputDir, processor }) {
    this.concurrency = concurrency;
    this.fileTtlMs = fileTtlMs;
    this.stateFile = stateFile;
    this.outputDir = outputDir;
    this.processor = typeof processor === 'function' ? processor : processMediaJob;
    this.jobTimeoutMs = Math.max(0, Number(process.env.MEDIA_JOB_TIMEOUT_MS || 60 * 60 * 1000));
    this.jobs = new Map();
    this.waiting = [];
    this.running = 0;
    this.events = new EventEmitter();

    this.restoreState();
    this.processNext();
    setInterval(() => this.cleanupExpired(), 30_000).unref();
  }

  createJob({ inputPath, inputName, operation, preset, advanced, sourceUrl }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const job = {
      id,
      inputPath,
      inputName,
      sourceUrl: sourceUrl || null,
      operation,
      preset,
      advanced: advanced || null,
      status: 'queued',
      progress: 0,
      progressLabel: 'Aguardando na fila',
      error: null,
      outputPath: null,
      outputName: null,
      sizeIn: null,
      sizeOut: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      discarded: false,
    };

    this.jobs.set(id, job);
    this.waiting.push(id);
    this.persistState();
    this.emitProgress(job);
    this.processNext();
    return this.serialize(job);
  }

  list() {
    return Array.from(this.jobs.values())
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((job) => this.serialize(job));
  }

  getRaw(id) {
    return this.jobs.get(id) || null;
  }

  subscribe(id, listener) {
    this.events.on(`progress:${id}`, listener);
    return () => this.events.off(`progress:${id}`, listener);
  }

  async removeByIds(ids) {
    const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
    if (uniqueIds.length === 0) {
      return { removed: 0 };
    }

    this.waiting = this.waiting.filter((id) => !uniqueIds.includes(id));
    let removed = 0;

    for (const id of uniqueIds) {
      const job = this.jobs.get(id);
      if (!job) {
        continue;
      }
      removed += 1;
      job.discarded = true;
      this.jobs.delete(id);

      if (job.status !== 'processing') {
        await this.cleanupJobFiles(job);
      }
    }

    this.persistState();
    return { removed };
  }

  async clearAll() {
    const ids = Array.from(this.jobs.keys());
    const result = await this.removeByIds(ids);
    return { cleared: result.removed };
  }

  async markDownloaded(id) {
    const job = this.jobs.get(id);
    if (!job) {
      return;
    }
    await this.cleanupJobFiles(job);
    this.jobs.delete(id);
    this.persistState();
  }

  serialize(job) {
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      progressLabel: job.progressLabel,
      operation: job.operation,
      preset: job.preset,
      inputName: job.inputName,
      outputName: job.outputName,
      sizeIn: job.sizeIn,
      sizeOut: job.sizeOut,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      expiresAt: job.expiresAt,
    };
  }

  async cleanupJobFiles(job) {
    await Promise.all([
      this.safeRemove(job.inputPath),
      this.safeRemove(job.outputPath),
    ]);
  }

  async processNext() {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const nextId = this.waiting.shift();
      const job = this.jobs.get(nextId);
      if (!job || job.status !== 'queued') {
        continue;
      }

      this.running += 1;
      job.status = 'processing';
      job.progress = 1;
      job.progressLabel = 'Iniciando processamento';
      job.updatedAt = new Date().toISOString();
      this.persistState();
      this.emitProgress(job);

      const controller = new AbortController();
      let timeout = null;
      let timedOut = false;
      const progressCb = (progress, label) => {
        if (timedOut || job.discarded || !this.jobs.has(job.id)) {
          return;
        }
        job.progress = progress;
        job.progressLabel = label;
        job.updatedAt = new Date().toISOString();
        this.persistState();
        this.emitProgress(job);
      };

      try {
        const processorPromise = this.processor(job, this.outputDir, progressCb, {
          signal: controller.signal,
        });

        const result = this.jobTimeoutMs > 0
          ? await Promise.race([
              processorPromise,
              new Promise((_, reject) => {
                timeout = setTimeout(() => {
                  timedOut = true;
                  controller.abort();
                  reject(new Error('Tempo limite de processamento excedido.'));
                }, this.jobTimeoutMs);
                if (typeof timeout.unref === 'function') {
                  timeout.unref();
                }
              }),
            ])
          : await processorPromise;

        if (job.discarded || !this.jobs.has(job.id)) {
          await this.safeRemove(result.outputPath);
          await this.safeRemove(job.inputPath);
        } else {
          job.status = 'completed';
          job.progress = 100;
          job.progressLabel = 'Concluido';
          job.outputPath = result.outputPath;
          job.outputName = result.outputName;
          job.sizeIn = result.sizeIn;
          job.sizeOut = result.sizeOut;
          job.error = null;
          job.expiresAt = new Date(Date.now() + this.fileTtlMs).toISOString();
          job.updatedAt = new Date().toISOString();
          this.persistState();
          this.emitProgress(job);
        }
      } catch (error) {
        if (timedOut || controller.signal.aborted) {
          job.status = 'failed';
          job.progress = 0;
          job.progressLabel = 'Falha';
          job.error = error.message || 'Tempo limite de processamento excedido.';
          job.updatedAt = new Date().toISOString();
          this.persistState();
          this.emitProgress(job);
        } else if (job.discarded || !this.jobs.has(job.id)) {
          await this.safeRemove(job.inputPath);
        } else {
          job.status = 'failed';
          job.progress = 0;
          job.progressLabel = 'Falha';
          job.error = error.message || 'Falha no processamento';
          job.updatedAt = new Date().toISOString();
          this.persistState();
          this.emitProgress(job);
        }
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
        this.running -= 1;
        this.processNext();
      }
    }
  }

  emitProgress(job) {
    this.events.emit(`progress:${job.id}`, this.serialize(job));
  }

  async cleanupExpired() {
    const now = Date.now();
    let changed = false;

    for (const [id, job] of this.jobs.entries()) {
      if (job.status !== 'completed' || !job.expiresAt) {
        continue;
      }
      if (new Date(job.expiresAt).getTime() <= now) {
        await this.cleanupJobFiles(job);
        this.jobs.delete(id);
        changed = true;
      }
    }

    if (changed) {
      this.persistState();
    }
  }

  restoreState() {
    if (!this.stateFile || !fs.existsSync(this.stateFile)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.stateFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const now = Date.now();

      for (const job of parsed) {
        if (!job || !job.id || !job.inputName || !job.operation) {
          continue;
        }

        if (job.status === 'completed') {
          const isValidOutput = job.outputPath && fs.existsSync(job.outputPath);
          const isNotExpired = job.expiresAt && new Date(job.expiresAt).getTime() > now;
          if (!isValidOutput || !isNotExpired) {
            continue;
          }
        }

        if (job.status === 'processing') {
          job.status = 'queued';
          job.progress = 0;
          job.progressLabel = 'Retomando fila';
        }

        job.discarded = false;
        this.jobs.set(job.id, job);
        if (job.status === 'queued') {
          this.waiting.push(job.id);
        }
      }
    } catch {
      // ignore corrupted state file
    }
  }

  persistState() {
    if (!this.stateFile) {
      return;
    }

    try {
      const dir = path.dirname(this.stateFile);
      fs.mkdirSync(dir, { recursive: true });
      const payload = Array.from(this.jobs.values()).map(({ discarded, ...job }) => job);
      fs.writeFileSync(this.stateFile, JSON.stringify(payload));
    } catch {
      // ignore persist failures in local mode
    }
  }

  async safeRemove(filePath) {
    if (!filePath) {
      return;
    }
    try {
      await fs.promises.rm(filePath, { force: true, recursive: false });
    } catch {
      // ignore
    }
  }
}

module.exports = {
  MediaQueue,
};
