# MP3OK / OpenDownloader Local

Aplicativo web full-stack para download por URL, conversao/otimizacao de midia local, geracao de thumbnails em lote e feed de noticias retro de musica brasileira.

## 1) O que e este projeto

O MP3OK e um "canivete suico" de midia para uso local ou deploy em nuvem, com foco em:

- **Downloader por URL** (YouTube, Vimeo, TikTok, Twitter/X e similares via `yt-dlp`)
- **Conversor/Otimizador** de arquivos (video, audio, imagem e GIF)
- **Thumbnail Studio** (upload local ou URL)
- **Radar Retro BR** (coleta de noticias em RSS, com armazenamento no Supabase)
- **Autenticacao por login/senha** via Supabase Auth

O sistema foi desenhado para manter UX simples, mas com pipeline tecnico robusto por baixo.

## 2) O que ele faz hoje

### Downloader por URL

- Busca metadados da URL (`/api/info`)
- Suporta midia unica e playlist/mix
- Download em MP4 (video) ou MP3 (audio)
- Qualidade selecionavel
- Fila visual de progresso com SSE

### Conversor/Otimizador

Operacoes disponiveis:

- `optimize-gif`
- `optimize-png`
- `optimize-jpeg`
- `mp4-to-gif`
- `gif-to-mp4`
- `optimize-mp4`
- `mp4-to-mp3-segmented`
- `ogg-to-mp3` (audio do WhatsApp)

Recursos:

- Presets: `light`, `balanced`, `aggressive`
- Modo avancado (CRF, FPS, width, quality, etc.)
- Segmentacao de MP3 por minutos (gera partes e zip quando houver multiplas)
- Fila assincrona com progresso em tempo real

### Thumbnail Studio

- Entrada por upload (`file`/`files`) ou URL (`/api/thumbnails/jobs/url`)
- Aceita URL direta HTTP/HTTPS
- Aceita arquivo do Google Drive (`/file/d/...` ou `/uc?id=...`)
- Presets:
  - `16x9` -> `1280x720`
  - `1x1` -> `1080x1080`
  - `9x16` -> `1080x1920`
- Saida JPG (quality 85)

### Radar Retro BR

- Coleta noticias em RSS
- Filtra por palavras-chave de musica brasileira retro
- Salva no Supabase (`music_news`)
- Mantem heartbeat de saude do coletor (`collector_heartbeat`)

## 3) Diferenca para outras ferramentas

O diferencial do MP3OK nao e apenas "converter arquivo":

1. **Tudo no mesmo painel**
- URL downloader + conversao + thumbnails + feed

2. **Arquitetura de fila real**
- Jobs assincronos
- SSE para progresso ao vivo
- Persistencia de estado da fila para reidratacao

3. **Sem dependencia de storage permanente**
- Arquivos de trabalho em temporario
- TTL automatico + remocao manual

4. **Pode rodar local e tambem em nuvem**
- Local (Windows)
- Frontend no Netlify
- Backend no Render
- Auth e dados no Supabase

5. **Autenticacao no backend de verdade**
- Nao e apenas "esconder tela"
- API valida token Supabase em cada request protegida

## 4) Arquitetura

- **Frontend**: Next.js + Tailwind
- **Backend**: Node.js + Express
- **Extracao de URL**: yt-dlp
- **Transcodificacao**: FFmpeg/ffprobe
- **Imagem**: Sharp
- **GIF**: gifsicle (com fallback seguro)
- **Auth e dados**: Supabase

Estrutura principal:

```text
mp3ok/
  backend/
    src/
      auth.js
      downloader.js
      index.js
      mediaConfig.js
      mediaProcessor.js
      mediaQueue.js
      newsService.js
      routes.js
      thumbnailConfig.js
      thumbnailProcessor.js
  frontend/
    src/app/
      layout.tsx
      page.tsx
      globals.css
  scripts/
    supabase-news-schema.sql
```

## 5) Como ele funciona (por baixo do tapete)

### 5.1 Login

Quando voce abre o app:

1. Frontend inicializa cliente Supabase (`@supabase/supabase-js`)
2. Tenta recuperar sessao existente
3. Se nao houver sessao, mostra tela de login
4. Ao logar com email/senha, recebe JWT
5. Requests da API passam a incluir token:
- `Authorization: Bearer <token>` para `fetch`
- `access_token` na query para `EventSource` e links de download

No backend:

1. Middleware `authenticateApiRequest` roda em `/api`
2. Valida JWT usando `supabase.auth.getUser(token)` com `SUPABASE_SERVICE_ROLE_KEY`
3. Se invalido/ausente -> `401`
4. Se valido -> segue para rota

Excecoes de auth:

- `/api/health`
- `/api/news/refresh` quando token interno (`NEWS_REFRESH_TOKEN`) for valido

### 5.2 Botao "Buscar midia"

Quando o usuario cola link e clica buscar:

1. Frontend chama `GET /api/info?url=...`
2. Backend executa `yt-dlp --dump-json --yes-playlist`
3. Backend parseia saida JSON linha a linha
4. Se playlist/mix, retorna `entries[]`
5. Frontend renderiza card e prepara fila de download

### 5.3 Botao "Download" (aba URL)

1. Frontend cria `taskId`
2. Abre SSE em `/api/progress?id=<taskId>`
3. Abre link `/api/download?...&id=<taskId>`
4. Backend executa `yt-dlp` em stream
5. Se formato audio, encadeia com FFmpeg para MP3
6. Progresso do `yt-dlp` e emitido no canal SSE
7. Browser recebe arquivo por streaming (sem salvar no servidor de forma definitiva)

### 5.4 Botao "Criar job" (conversao/otimizacao)

1. Upload via multipart para `POST /api/media/jobs`
2. Rota valida operacao/preset/limites
3. Job entra na `MediaQueue` com status `queued`
4. Worker processa conforme operacao:
- imagens com `sharp`
- video/audio com `ffmpeg`
- GIF com `gifsicle` (fallback FFmpeg)
5. UI acompanha por SSE em `/api/media/jobs/:id/progress`
6. Ao concluir, arquivo fica disponivel em `/api/media/jobs/:id/download`

### 5.5 Botao "Gerar thumbnails"

Upload:

1. `POST /api/thumbnails/jobs`
2. Job entra na fila de thumbs
3. Se imagem estatica -> `sharp` direto
4. Se GIF/video -> extrai frame central com FFmpeg, depois resize/crop com Sharp
5. Saida JPG

URL:

1. `POST /api/thumbnails/jobs/url`
2. Backend valida URL e bloqueia host/IP privado (mitiga SSRF)
3. Baixa remoto com limite de tamanho e timeout
4. Processa igual upload

### 5.6 Botao "Atualizar feed" (noticias)

1. Frontend chama `GET /api/news?refresh=1`
2. Backend coleta feeds RSS em sequencia
3. Filtra por keywords
4. Faz upsert no Supabase (`music_news`)
5. Atualiza heartbeat em `collector_heartbeat`
6. Frontend renderiza lista

## 6) Fila, estado e limpeza

### Fila

A classe `MediaQueue` (reutilizada para media e thumbnail):

- controla concorrencia (`queueConcurrency`)
- muda status: `queued -> processing -> completed/failed`
- emite progresso por evento
- persiste estado em arquivo JSON temporario

### Reidratacao

Se pagina recarregar ou backend reiniciar:

- fila pode ser reidratada do arquivo de estado
- jobs em `processing` voltam para `queued`

### Limpeza

- cada resultado recebe `expiresAt`
- rotina automatica remove arquivos expirados
- usuario pode remover item, em lote ou limpar fila

## 7) Variaveis de ambiente

## Frontend (Netlify / local frontend)

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_URL_INFO_TIMEOUT_MS` (opcional, default 180000)

## Backend (Render / local backend)

- `PORT`
- `AUTH_REQUIRED` (`true` recomendado)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (**nunca no frontend**)

### Downloader / yt-dlp

- `YTDLP_JS_RUNTIMES` (default `node`)
- `YTDLP_COOKIES_FILE` (opcional)
- `YTDLP_COOKIES_B64` (opcional)
- `YTDLP_USER_AGENT` (opcional)
- `YTDLP_RETRIES` (default `8`)
- `YTDLP_FRAGMENT_RETRIES` (default `8`)
- `YTDLP_RETRY_SLEEP` (default `http:2`)
- `YTDLP_INFO_TIMEOUT_MS` (default `180000`)

### Conversao/Otimizacao

- `MEDIA_MAX_UPLOAD_BYTES` (default `8GB`)
- `MEDIA_MAX_BATCH_FILES` (default `100`)
- `MEDIA_QUEUE_CONCURRENCY` (default `1`)
- `MEDIA_DEFAULT_SEGMENT_MINUTES` (default `20`)
- `MEDIA_FILE_TTL_MS` (default `1800000`)
- `MEDIA_QUEUE_STATE_FILE`
- `MEDIA_UPLOAD_DIR`
- `MEDIA_OUTPUT_DIR`

### Thumbnail Studio

- `THUMB_MAX_UPLOAD_BYTES` (default `8GB`)
- `THUMB_MAX_BATCH_FILES` (default `100`)
- `THUMB_QUEUE_CONCURRENCY` (default `1`)
- `THUMB_FILE_TTL_MS` (default `1800000`)
- `THUMB_REMOTE_MAX_BYTES` (default `314572800`)
- `THUMB_REMOTE_TIMEOUT_MS` (default `30000`)
- `THUMB_QUEUE_STATE_FILE`
- `THUMB_UPLOAD_DIR`
- `THUMB_OUTPUT_DIR`

### Noticias

- `NEWS_TABLE` (default `music_news`)
- `NEWS_HEARTBEAT_TABLE` (default `collector_heartbeat`)
- `NEWS_HEARTBEAT_KEY` (default `retro_news`)
- `NEWS_FEEDS` (CSV)
- `NEWS_KEYWORDS` (CSV)
- `NEWS_MAX_ITEMS_PER_FEED` (default `25`)
- `NEWS_FETCH_TIMEOUT_MS` (default `20000`)
- `NEWS_MIN_REFRESH_MS` (default `900000`)
- `NEWS_REFRESH_TOKEN` (recomendado em producao)
- `ALLOW_UNAUTH_NEWS_REFRESH` (evitar `true` em producao)

## Rate limit

- `ENABLE_API_RATE_LIMIT`
- `API_RATE_LIMIT_WINDOW_MS` (default `900000`)
- `API_RATE_LIMIT_MAX` (default `5000`)

## 8) Como rodar localmente

## Opcao 1 (1 clique)

- Duplo clique em `Iniciar OpenDownloader.bat`
- Para parar: `Parar OpenDownloader.bat`

## Opcao 2 (terminal)

```powershell
cd C:\Users\carli\mp3ok
npm install
npm install --prefix backend
npm install --prefix frontend
npm run dev
```

Acessos:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

Prerequisitos de sistema:

```powershell
yt-dlp --version
ffmpeg -version
```

## 9) Endpoints

### URL Downloader

- `GET /api/info?url={url}`
- `GET /api/download?url={url}&format={audio|video}&quality={best|1080|720}&id={taskId}`
- `GET /api/progress?id={taskId}`

### Conversao/Otimizacao

- `POST /api/media/jobs`
- `GET /api/media/jobs`
- `GET /api/media/jobs/:id/progress`
- `GET /api/media/jobs/:id/download`
- `DELETE /api/media/jobs/:id`
- `POST /api/media/jobs/delete`
- `DELETE /api/media/jobs`

### Thumbnails

- `POST /api/thumbnails/jobs`
- `POST /api/thumbnails/jobs/url`
- `GET /api/thumbnails/jobs`
- `GET /api/thumbnails/jobs/:id/progress`
- `GET /api/thumbnails/jobs/:id/download`
- `DELETE /api/thumbnails/jobs/:id`
- `POST /api/thumbnails/jobs/delete`
- `DELETE /api/thumbnails/jobs`

### Noticias

- `GET /api/news?limit=18`
- `POST /api/news/refresh`
- `GET /api/news/health`
- `GET /api/health`

## 10) Seguranca e governanca

- Autenticacao da API via Supabase JWT
- Service role apenas no backend
- RLS no Supabase para impedir escrita por usuarios comuns
- Protecao do refresh de noticias por token interno
- Validacao de URL remota e bloqueio de rede privada no Thumbnail Studio

## 11) Observacoes importantes

- O projeto nao substitui direitos autorais/licencas: o uso deve respeitar termos das plataformas e legislacao local.
- Links privados do Google Drive nao sao suportados no MVP de thumbnail.
- Em YouTube cloud, 429/bot checks podem exigir cookies e ajuste de runtime `yt-dlp`.

## 12) Em resumo

O MP3OK funciona porque combina ferramentas especializadas para cada camada:

- `yt-dlp` para extracao de conteudo por URL
- `ffmpeg` para transcodificacao pesada
- `sharp`/`gifsicle` para imagem e GIF
- filas assincronas para estabilidade
- SSE para feedback em tempo real
- Supabase para autenticacao e dados

Resultado: painel unico, autentico, escalavel no basico, e focado em produtividade para fluxos reais de midia.
