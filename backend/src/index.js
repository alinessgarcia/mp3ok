const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');
const { mediaConfig } = require('./mediaConfig');
const { thumbnailConfig } = require('./thumbnailConfig');

const app = express();
const PORT = process.env.PORT || 4000;
const apiRateLimitWindowMs = Math.max(1_000, Number(process.env.API_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000));
const apiRateLimitMax = Math.max(10, Number(process.env.API_RATE_LIMIT_MAX || 5000));
const enableRateLimit =
  process.env.ENABLE_API_RATE_LIMIT != null
    ? process.env.ENABLE_API_RATE_LIMIT === 'true'
    : process.env.NODE_ENV === 'production';

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: apiRateLimitWindowMs,
  max: apiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});
if (enableRateLimit) {
  app.use('/api', limiter);
}

app.use('/api', routes);

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
