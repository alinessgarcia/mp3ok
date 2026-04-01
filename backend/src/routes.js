const express = require('express');
const fs = require('node:fs');
const multer = require('multer');
const { getInfo, downloadMedia, subscribeProgress } = require('./downloader');
const { refreshNews, listNews, getNewsStatus } = require('./newsService');
const { mediaConfig } = require('./mediaConfig');
const { MediaQueue } = require('./mediaQueue');
const { OPERATION_SET, PRESET_SET } = require('./mediaProcessor');
const { thumbnailConfig } = require('./thumbnailConfig');
const {
  THUMB_OPERATION_SET,
  THUMB_PRESET_SET,
  processThumbnailJob,
} = require('./thumbnailProcessor');

const router = express.Router();

fs.mkdirSync(mediaConfig.uploadDir, { recursive: true });
fs.mkdirSync(mediaConfig.outputDir, { recursive: true });
fs.mkdirSync(thumbnailConfig.uploadDir, { recursive: true });
fs.mkdirSync(thumbnailConfig.outputDir, { recursive: true });

const upload = multer({
  dest: mediaConfig.uploadDir,
  limits: {
    fileSize: mediaConfig.maxUploadBytes,
    files: mediaConfig.maxBatchFiles,
  },
});
const mediaUpload = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: mediaConfig.maxBatchFiles },
]);
const thumbnailUpload = multer({
  dest: thumbnailConfig.uploadDir,
  limits: {
    fileSize: thumbnailConfig.maxUploadBytes,
    files: thumbnailConfig.maxBatchFiles,
  },
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: thumbnailConfig.maxBatchFiles },
]);

const mediaQueue = new MediaQueue({
  concurrency: mediaConfig.queueConcurrency,
  fileTtlMs: mediaConfig.fileTtlMs,
  stateFile: mediaConfig.stateFile,
  outputDir: mediaConfig.outputDir,
});
const thumbnailQueue = new MediaQueue({
  concurrency: thumbnailConfig.queueConcurrency,
  fileTtlMs: thumbnailConfig.fileTtlMs,
  stateFile: thumbnailConfig.stateFile,
  outputDir: thumbnailConfig.outputDir,
  processor: processThumbnailJob,
});

function toSafeContentDisposition(filename) {
  const raw = String(filename || 'download');
  const clean = raw.replace(/[\r\n"]/g, '_');
  const asciiFallback = clean.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(clean);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function normalizeUploadName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return 'media';
  }

  // Try to recover UTF-8 names that arrived mojibake encoded as latin1.
  if (/[ÃÂ]/.test(name)) {
    try {
      const decoded = Buffer.from(name, 'latin1').toString('utf8');
      if (!decoded.includes('�')) {
        return decoded;
      }
    } catch {
      // fall through to original name
    }
  }

  return name;
}

function parseIds(body) {
  if (!Array.isArray(body?.ids)) {
    return [];
  }
  return body.ids.filter((id) => typeof id === 'string' && id.trim().length > 0);
}

function parseUrls(body) {
  if (Array.isArray(body?.urls)) {
    return body.urls
      .filter((url) => typeof url === 'string')
      .map((url) => url.trim())
      .filter(Boolean);
  }

  if (typeof body?.urls === 'string') {
    return body.urls
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean);
  }

  return [];
}

function inputNameFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const base = parsed.pathname.split('/').filter(Boolean).pop();
    if (base) {
      return decodeURIComponent(base);
    }
    return parsed.hostname;
  } catch {
    return 'remote-media';
  }
}

function getUploadedFiles(req) {
  const filesMap = req.files && typeof req.files === 'object' ? req.files : {};
  const single = Array.isArray(filesMap.file) ? filesMap.file : [];
  const batch = Array.isArray(filesMap.files) ? filesMap.files : [];
  return [...single, ...batch].filter(Boolean);
}

async function cleanupUploads(files) {
  await Promise.all(
    (files || []).map(async (file) => {
      if (!file?.path) {
        return;
      }
      try {
        await fs.promises.rm(file.path, { force: true });
      } catch {
        // ignore temporary file cleanup failures
      }
    }),
  );
}

// GET /api/info?url={url}
router.get('/info', async (req, res, next) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'URL parameter is required.' });
        }
        const info = await getInfo(url);
        res.json(info);
    } catch (error) {
        next(error);
    }
});

// GET /api/download?url={url}&format={audio|video}&quality={best|1080|720}&id={taskId}
router.get('/download', (req, res, next) => {
    try {
        const { url, format, quality, id, title } = req.query;
        if (!url || !format || !id) {
            return res.status(400).json({ error: 'Missing required parameters.' });
        }

        downloadMedia(req, res, { url, format, quality, id, title });
    } catch (error) {
        next(error);
    }
});

// GET /api/health
router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mp3ok-backend', now: new Date().toISOString() });
});

// GET /api/news?limit=20&refresh=1
router.get('/news', async (req, res, next) => {
  try {
    const limit = Number(req.query?.limit || 20);
    const shouldRefresh = String(req.query?.refresh || '') === '1';
    if (shouldRefresh) {
      await refreshNews({ force: true });
    }
    const items = await listNews(limit);
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

// POST /api/news/refresh
router.post('/news/refresh', async (req, res, next) => {
  try {
    const headerToken = String(req.headers['x-news-token'] || '');
    const bodyToken = String(req.body?.token || '');
    const authToken = headerToken || bodyToken;
    const expectedToken = String(process.env.NEWS_REFRESH_TOKEN || '').trim();
    const allowUnauthenticatedRefresh = String(process.env.ALLOW_UNAUTH_NEWS_REFRESH || '').trim() === 'true';
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

    if (isProd && !expectedToken && !allowUnauthenticatedRefresh) {
      return res.status(503).json({
        error:
          'NEWS_REFRESH_TOKEN não configurado no backend em produção. Defina o token ou use ALLOW_UNAUTH_NEWS_REFRESH=true.',
      });
    }

    if (expectedToken && authToken !== expectedToken) {
      return res.status(401).json({ error: 'Token invalido para refresh de noticias.' });
    }

    const report = await refreshNews({ force: true });
    return res.json({ ok: true, report });
  } catch (error) {
    next(error);
  }
});

// GET /api/news/health
router.get('/news/health', async (req, res, next) => {
  try {
    const status = await getNewsStatus();
    res.json({ status });
  } catch (error) {
    next(error);
  }
});

// GET /api/progress?id={taskId}
router.get('/progress', (req, res) => {
    const { id } = req.query;
    if (!id) {
        return res.status(400).json({ error: 'Task ID is required for SSE.' });
    }
    subscribeProgress(id, req, res);
});

// POST /api/media/jobs (multipart upload single or batch)
router.post('/media/jobs', mediaUpload, async (req, res) => {
  const files = getUploadedFiles(req);
  if (files.length === 0) {
    return res.status(400).json({ error: 'Arquivo obrigatorio.' });
  }

  if (files.length > mediaConfig.maxBatchFiles) {
    await cleanupUploads(files);
    return res.status(400).json({
      error: `Quantidade maxima de arquivos por lote: ${mediaConfig.maxBatchFiles}.`,
    });
  }

  const operation = String(req.body?.operation || '');
  const preset = String(req.body?.preset || 'balanced');
  const advanced = req.body?.advanced || null;

  if (!OPERATION_SET.has(operation)) {
    await cleanupUploads(files);
    return res.status(400).json({ error: 'Operacao invalida.' });
  }

  if (!PRESET_SET.has(preset)) {
    await cleanupUploads(files);
    return res.status(400).json({ error: 'Preset invalido.' });
  }

  const jobs = files.map((file) =>
    mediaQueue.createJob({
      inputPath: file.path,
      inputName: normalizeUploadName(file.originalname),
      operation,
      preset,
      advanced,
    }),
  );

  if (jobs.length === 1) {
    return res.status(201).json(jobs[0]);
  }

  return res.status(201).json({
    added: jobs.length,
    jobs,
  });
});

// GET /api/media/jobs
router.get('/media/jobs', (_req, res) => {
  res.json({ jobs: mediaQueue.list() });
});

// GET /api/media/jobs/:id/progress
router.get('/media/jobs/:id/progress', (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Job id obrigatorio.' });
  }

  const job = mediaQueue.getRaw(id);
  if (!job) {
    return res.status(404).json({ error: 'Job nao encontrado.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const push = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  push(mediaQueue.serialize(job));
  const unsubscribe = mediaQueue.subscribe(id, push);

  req.on('close', () => {
    unsubscribe();
  });
});

// GET /api/media/jobs/:id/download
router.get('/media/jobs/:id/download', async (req, res) => {
  const { id } = req.params;
  const job = mediaQueue.getRaw(id);
  if (!job) {
    return res.status(404).json({ error: 'Job nao encontrado.' });
  }

  if (job.status !== 'completed' || !job.outputPath) {
    return res.status(409).json({ error: 'Job nao concluido.' });
  }

  if (!fs.existsSync(job.outputPath)) {
    return res.status(410).json({ error: 'Arquivo expirado.' });
  }

  res.setHeader('Content-Disposition', toSafeContentDisposition(job.outputName));
  res.setHeader('Content-Type', 'application/octet-stream');

  const stream = fs.createReadStream(job.outputPath);
  stream.on('error', () => {
    res.status(500).end();
  });

  stream.pipe(res);
});

// DELETE /api/media/jobs/:id
router.delete('/media/jobs/:id', async (req, res) => {
  const result = await mediaQueue.removeByIds([req.params.id]);
  res.json(result);
});

// POST /api/media/jobs/delete
router.post('/media/jobs/delete', async (req, res) => {
  const ids = parseIds(req.body);
  if (ids.length === 0) {
    return res.status(400).json({ error: 'ids obrigatorio.' });
  }

  const result = await mediaQueue.removeByIds(ids);
  res.json(result);
});

// DELETE /api/media/jobs
router.delete('/media/jobs', async (_req, res) => {
  const result = await mediaQueue.clearAll();
  res.json(result);
});

// POST /api/thumbnails/jobs (multipart upload single or batch)
router.post('/thumbnails/jobs', thumbnailUpload, async (req, res) => {
  const files = getUploadedFiles(req);
  if (files.length === 0) {
    return res.status(400).json({ error: 'Arquivo obrigatorio.' });
  }

  if (files.length > thumbnailConfig.maxBatchFiles) {
    await cleanupUploads(files);
    return res.status(400).json({
      error: `Quantidade maxima de arquivos por lote: ${thumbnailConfig.maxBatchFiles}.`,
    });
  }

  const operation = String(req.body?.operation || 'thumbnail');
  const preset = String(req.body?.preset || '16x9');

  if (!THUMB_OPERATION_SET.has(operation)) {
    await cleanupUploads(files);
    return res.status(400).json({ error: 'Operacao de thumbnail invalida.' });
  }

  if (!THUMB_PRESET_SET.has(preset)) {
    await cleanupUploads(files);
    return res.status(400).json({ error: 'Preset de thumbnail invalido.' });
  }

  const jobs = files.map((file) =>
    thumbnailQueue.createJob({
      inputPath: file.path,
      inputName: normalizeUploadName(file.originalname),
      operation,
      preset,
      advanced: null,
    }),
  );

  if (jobs.length === 1) {
    return res.status(201).json(jobs[0]);
  }

  return res.status(201).json({
    added: jobs.length,
    jobs,
  });
});

// POST /api/thumbnails/jobs/url
router.post('/thumbnails/jobs/url', async (req, res) => {
  const urls = parseUrls(req.body);
  if (urls.length === 0) {
    return res.status(400).json({ error: 'urls obrigatorio.' });
  }

  if (urls.length > thumbnailConfig.maxBatchFiles) {
    return res.status(400).json({
      error: `Quantidade maxima de URLs por lote: ${thumbnailConfig.maxBatchFiles}.`,
    });
  }

  const operation = String(req.body?.operation || 'thumbnail');
  const preset = String(req.body?.preset || '16x9');

  if (!THUMB_OPERATION_SET.has(operation)) {
    return res.status(400).json({ error: 'Operacao de thumbnail invalida.' });
  }

  if (!THUMB_PRESET_SET.has(preset)) {
    return res.status(400).json({ error: 'Preset de thumbnail invalido.' });
  }

  const jobs = urls.map((sourceUrl) =>
    thumbnailQueue.createJob({
      inputPath: null,
      sourceUrl,
      inputName: inputNameFromUrl(sourceUrl),
      operation,
      preset,
      advanced: null,
    }),
  );

  if (jobs.length === 1) {
    return res.status(201).json(jobs[0]);
  }

  return res.status(201).json({
    added: jobs.length,
    jobs,
  });
});

// GET /api/thumbnails/jobs
router.get('/thumbnails/jobs', (_req, res) => {
  res.json({ jobs: thumbnailQueue.list() });
});

// GET /api/thumbnails/jobs/:id/progress
router.get('/thumbnails/jobs/:id/progress', (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Job id obrigatorio.' });
  }

  const job = thumbnailQueue.getRaw(id);
  if (!job) {
    return res.status(404).json({ error: 'Job nao encontrado.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const push = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  push(thumbnailQueue.serialize(job));
  const unsubscribe = thumbnailQueue.subscribe(id, push);

  req.on('close', () => {
    unsubscribe();
  });
});

// GET /api/thumbnails/jobs/:id/download
router.get('/thumbnails/jobs/:id/download', async (req, res) => {
  const { id } = req.params;
  const job = thumbnailQueue.getRaw(id);
  if (!job) {
    return res.status(404).json({ error: 'Job nao encontrado.' });
  }

  if (job.status !== 'completed' || !job.outputPath) {
    return res.status(409).json({ error: 'Job nao concluido.' });
  }

  if (!fs.existsSync(job.outputPath)) {
    return res.status(410).json({ error: 'Arquivo expirado.' });
  }

  res.setHeader('Content-Disposition', toSafeContentDisposition(job.outputName));
  res.setHeader('Content-Type', 'image/jpeg');

  const stream = fs.createReadStream(job.outputPath);
  stream.on('error', () => {
    res.status(500).end();
  });

  stream.pipe(res);
});

// DELETE /api/thumbnails/jobs/:id
router.delete('/thumbnails/jobs/:id', async (req, res) => {
  const result = await thumbnailQueue.removeByIds([req.params.id]);
  res.json(result);
});

// POST /api/thumbnails/jobs/delete
router.post('/thumbnails/jobs/delete', async (req, res) => {
  const ids = parseIds(req.body);
  if (ids.length === 0) {
    return res.status(400).json({ error: 'ids obrigatorio.' });
  }

  const result = await thumbnailQueue.removeByIds(ids);
  res.json(result);
});

// DELETE /api/thumbnails/jobs
router.delete('/thumbnails/jobs', async (_req, res) => {
  const result = await thumbnailQueue.clearAll();
  res.json(result);
});

module.exports = router;

