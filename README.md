# OpenDownloader Local

Aplicativo local para:
- Download por URL (`YouTube`, `Vimeo`, `TikTok`, `Twitter/X`) via `yt-dlp`
- Conversão/otimização de mídia local
- Geração de thumbnails em lote (upload e URL)

## Stack

- Frontend: Next.js + Tailwind
- Backend: Node.js + Express
- Download por URL: yt-dlp
- Conversão: FFmpeg
- Otimização imagem: Sharp
- Otimização GIF: gifsicle

## Estrutura

```text
mp3ok/
  backend/
    src/
      downloader.js
      index.js
      mediaConfig.js
      mediaProcessor.js
      mediaQueue.js
      routes.js
      thumbnailConfig.js
      thumbnailProcessor.js
  frontend/
    src/app/
      globals.css
      layout.tsx
      page.tsx
  scripts/
```

## Como rodar

### 1 clique

- Duplo clique em `Iniciar OpenDownloader.bat`
- O script inicia backend + frontend e abre `http://localhost:3000`
- Para parar tudo: `Parar OpenDownloader.bat`

### Terminal

```powershell
cd C:\Users\carli\mp3ok
npm install
npm install --prefix backend
npm install --prefix frontend
npm run dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

## Dependências externas obrigatórias

```powershell
yt-dlp --version
ffmpeg -version
```

Se algum comando falhar, instale a ferramenta e reinicie o terminal.

## API de Conversão/Otimização (`/api/media/jobs*`)

- `POST /api/media/jobs` (multipart com `file` ou `files`)
- `GET /api/media/jobs`
- `GET /api/media/jobs/:id/progress` (SSE)
- `GET /api/media/jobs/:id/download`
- `DELETE /api/media/jobs/:id`
- `POST /api/media/jobs/delete` com `{ "ids": ["..."] }`
- `DELETE /api/media/jobs`

Operações:
- `optimize-gif`
- `optimize-png`
- `optimize-jpeg`
- `mp4-to-gif`
- `gif-to-mp4`
- `optimize-mp4`

Presets:
- `light`
- `balanced`
- `aggressive`

## API de Thumbnail Studio (`/api/thumbnails/jobs*`)

- `POST /api/thumbnails/jobs` (multipart com `file` ou `files`)
- `POST /api/thumbnails/jobs/url` com `{ "urls": ["..."] }`
- `GET /api/thumbnails/jobs`
- `GET /api/thumbnails/jobs/:id/progress` (SSE)
- `GET /api/thumbnails/jobs/:id/download`
- `DELETE /api/thumbnails/jobs/:id`
- `POST /api/thumbnails/jobs/delete` com `{ "ids": ["..."] }`
- `DELETE /api/thumbnails/jobs`

Regras do MVP:
- Entrada por upload local ou URL HTTP/HTTPS
- Suporte a link de arquivo do Drive (`/file/d/...` ou `/uc?id=...`)
- Link de pasta do Drive retorna erro explícito
- Presets:
  - `16x9` => `1280x720`
  - `1x1` => `1080x1080`
  - `9x16` => `1080x1920`
- Saída padrão: JPG (`quality=85`)

## Comportamento de fila

- Processamento assíncrono com concorrência configurável
- Estado da fila reidratado após refresh/reabertura
- Download automático ao concluir (com botão manual disponível)
- Remoção individual, em lote e limpeza total
- TTL para limpeza automática de arquivos temporários

## Variáveis de ambiente

### Conversão/Otimização

- `MEDIA_MAX_UPLOAD_BYTES` (default: `8GB`)
- `MEDIA_MAX_BATCH_FILES` (default: `100`)
- `MEDIA_QUEUE_CONCURRENCY` (default: `1`)
- `MEDIA_FILE_TTL_MS` (default: `1800000`)
- `MEDIA_QUEUE_STATE_FILE`
- `MEDIA_UPLOAD_DIR`
- `MEDIA_OUTPUT_DIR`

### Thumbnail Studio

- `THUMB_MAX_UPLOAD_BYTES` (default: `8GB`)
- `THUMB_MAX_BATCH_FILES` (default: `100`)
- `THUMB_QUEUE_CONCURRENCY` (default: `1`)
- `THUMB_FILE_TTL_MS` (default: `1800000`)
- `THUMB_REMOTE_MAX_BYTES` (default: `314572800`)
- `THUMB_REMOTE_TIMEOUT_MS` (default: `30000`)
- `THUMB_QUEUE_STATE_FILE`
- `THUMB_UPLOAD_DIR`
- `THUMB_OUTPUT_DIR`

### Rate limit API

- `ENABLE_API_RATE_LIMIT`
  - default: ativo só em `NODE_ENV=production`
- `API_RATE_LIMIT_WINDOW_MS` (default: `900000`)
- `API_RATE_LIMIT_MAX` (default: `5000`)

## Observações

- Os arquivos são temporários (TTL + remoção manual).
- Para links privados do Google Drive é necessário acesso público no MVP atual.
- Os contratos existentes de `/api/info`, `/api/download`, `/api/progress` e `/api/media/jobs*` foram mantidos.
