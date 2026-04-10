const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const dotenv = require('dotenv');
const routes = require('./routes');
const { mediaConfig } = require('./mediaConfig');
const { thumbnailConfig } = require('./thumbnailConfig');
const { authenticateApiRequest } = require('./auth');

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 4000;
const apiRateLimitWindowMs = Math.max(1_000, Number(process.env.API_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000));
const apiRateLimitMax = Math.max(10, Number(process.env.API_RATE_LIMIT_MAX || 5000));
const enableRateLimit =
  process.env.ENABLE_API_RATE_LIMIT != null
    ? process.env.ENABLE_API_RATE_LIMIT === 'true'
    : process.env.NODE_ENV === 'production';

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Render health checks)
    if (!origin) return callback(null, true);
    // If no allowlist configured, allow everything (local dev)
    if (ALLOWED_ORIGINS.length === 0) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin not allowed: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());

const limiter = rateLimit({
  windowMs: apiRateLimitWindowMs,
  max: apiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (req.method !== 'GET') {
      return false;
    }

    const path = String(req.path || req.originalUrl || '');
    return (
      path.startsWith('/media/jobs') ||
      path.startsWith('/thumbnails/jobs') ||
      path.startsWith('/news') ||
      path.startsWith('/progress') ||
      path.startsWith('/api/media/jobs') ||
      path.startsWith('/api/thumbnails/jobs') ||
      path.startsWith('/api/news') ||
      path.startsWith('/api/progress')
    );
  },
});
if (enableRateLimit) {
  app.use('/api', limiter);
}

app.use('/api', authenticateApiRequest, routes);

app.use((err, req, res, next) => {
  console.error(err.stack || err);
  const isThumbRoute = String(req.originalUrl || '').startsWith('/api/thumbnails/');

  if (err && err.code === 'LIMIT_FILE_SIZE') {
    const maxBytes = isThumbRoute ? thumbnailConfig.maxUploadBytes : mediaConfig.maxUploadBytes;
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return res.status(413).json({ error: `Arquivo excede o tamanho maximo permitido (${maxMb} MB).` });
  }
  if (err && err.code === 'LIMIT_FILE_COUNT') {
    const maxBatch = isThumbRoute ? thumbnailConfig.maxBatchFiles : mediaConfig.maxBatchFiles;
    return res.status(400).json({ error: `Quantidade maxima de arquivos por lote: ${maxBatch}.` });
  }
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Campo de upload invalido. Use "file" ou "files".' });
  }

  return res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Video Downloader Backend running on http://localhost:${PORT}`);
});
