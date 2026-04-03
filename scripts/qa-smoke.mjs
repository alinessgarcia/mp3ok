import fs from 'node:fs/promises';
import path from 'node:path';

const backendBase = process.env.QA_BACKEND_BASE_URL || 'http://127.0.0.1:4000';
const frontendBase = process.env.QA_FRONTEND_BASE_URL || 'http://127.0.0.1:3000';
const sampleUrl =
  process.env.QA_SAMPLE_MEDIA_URL || 'https://download.samplelib.com/mp4/sample-5s.mp4';
const sampleAudioUrl =
  process.env.QA_SAMPLE_AUDIO_URL || 'https://download.samplelib.com/mp3/sample-3s.mp3';
const playlistUrl = process.env.QA_PLAYLIST_URL || 'https://vimeo.com/channels/1038168';
const sampleFilePath =
  process.env.QA_SAMPLE_FILE_PATH || path.resolve(process.cwd(), 'tmp-ui-test.png');
const timeoutMs = Number(process.env.QA_TIMEOUT_MS || 60_000);

const results = [];

function row(scenario, command, result, status, actionSuggested) {
  results.push({ scenario, command, result, status, actionSuggested });
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  }
  if (contentType.startsWith('text/') || contentType.includes('xml') || contentType.includes('event-stream')) {
    return await response.text();
  }
  const buffer = await response.arrayBuffer();
  return { bytes: buffer.byteLength };
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const body = await readResponseBody(response);
  return { response, body };
}

function summarizeBody(body, max = 220) {
  if (body == null) return '';
  if (typeof body === 'string') return body.slice(0, max);
  if (typeof body === 'object') return JSON.stringify(body).slice(0, max);
  return String(body).slice(0, max);
}

async function ensureFile(filePath) {
  const file = await fs.readFile(filePath);
  return new File([file], path.basename(filePath), { type: 'image/png' });
}

async function waitForJob(kind, id, expectedState = 'completed') {
  const deadline = Date.now() + timeoutMs;
  const endpoint = kind === 'media' ? '/api/media/jobs' : '/api/thumbnails/jobs';

  while (Date.now() < deadline) {
    const { response, body } = await fetchJson(`${backendBase}${endpoint}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`${kind} jobs list failed: HTTP ${response.status}`);
    }

    const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
    const job = jobs.find((item) => item.id === id);
    if (job && job.status === expectedState) {
      return job;
    }
    if (job && job.status === 'failed') {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${kind} job ${id} did not reach ${expectedState} before timeout`);
}

async function run() {
  const rootCheck = await fetchJson(`${frontendBase}/`, { cache: 'no-store' });
  row(
    'Frontend root responds',
    `GET ${frontendBase}/`,
    `HTTP ${rootCheck.response.status}, content-type=${rootCheck.response.headers.get('content-type') || '-'}`,
    rootCheck.response.ok ? 'OK' : 'FALHA',
    rootCheck.response.ok ? 'Nenhuma' : 'Revisar Next.js/dev server e variaveis do frontend',
  );

  const notFoundCheck = await fetchJson(`${backendBase}/api/does-not-exist`, { cache: 'no-store' });
  row(
    'Backend 404',
    `GET ${backendBase}/api/does-not-exist`,
    `HTTP ${notFoundCheck.response.status}; ${summarizeBody(notFoundCheck.body)}`,
    notFoundCheck.response.status === 404 ? 'OK' : 'FALHA',
    notFoundCheck.response.status === 404 ? 'Nenhuma' : 'Checar fallback de rotas do Express',
  );

  const health = await fetchJson(`${backendBase}/api/health`, { cache: 'no-store' });
  row(
    '/api/health',
    `GET ${backendBase}/api/health`,
    `HTTP ${health.response.status}; ${summarizeBody(health.body)}`,
    health.response.ok && health.body?.ok === true ? 'OK' : 'FALHA',
    health.response.ok ? 'Nenhuma' : 'Checar boot do backend e variaveis basicas',
  );

  const info = await fetchJson(`${backendBase}/api/info?url=${encodeURIComponent(sampleUrl)}`, {
    cache: 'no-store',
  });
  row(
    '/api/info',
    `GET ${backendBase}/api/info?url=${encodeURIComponent(sampleUrl)}`,
    `HTTP ${info.response.status}; ${summarizeBody(info.body)}`,
    info.response.ok ? 'OK' : 'FALHA',
    info.response.ok ? 'Nenhuma' : 'Validar yt-dlp/rede ou ajustar URL de teste',
  );

  const playlistInfo = await fetchJson(`${backendBase}/api/info?url=${encodeURIComponent(playlistUrl)}`, {
    cache: 'no-store',
  });
  row(
    'Playlist expansion',
    `GET ${backendBase}/api/info?url=${encodeURIComponent(playlistUrl)}`,
    `HTTP ${playlistInfo.response.status}; isPlaylist=${playlistInfo.body?.isPlaylist}; entryCount=${playlistInfo.body?.entryCount}; firstItem=${playlistInfo.body?.entries?.[0]?.url || '-'}`,
    playlistInfo.response.ok && playlistInfo.body?.isPlaylist === true && Number(playlistInfo.body?.entryCount || 0) > 1 ? 'OK' : 'FALHA',
    playlistInfo.response.ok ? 'Nenhuma' : 'Trocar para uma playlist publica acessivel',
  );

  const playlistItemUrl = playlistInfo.body?.entries?.[1]?.url || playlistInfo.body?.entries?.[0]?.url;
  if (playlistItemUrl) {
    const playlistItemDownload = await fetch(`${backendBase}/api/download?url=${encodeURIComponent(playlistItemUrl)}&format=video&quality=best&id=550e8400-e29b-41d4-a716-446655440010&title=Playlist%20item%20manual`, {
      cache: 'no-store',
    });
    const playlistItemBytes = (await playlistItemDownload.arrayBuffer()).byteLength;
    row(
      'Playlist item download',
      `GET ${backendBase}/api/download?url=${encodeURIComponent(playlistItemUrl)}&format=video&quality=best&id=550e8400-e29b-41d4-a716-446655440010&title=Playlist%20item%20manual`,
      `HTTP ${playlistItemDownload.status}; bytes=${playlistItemBytes}; content-type=${playlistItemDownload.headers.get('content-type') || '-'}`,
      playlistItemDownload.ok && playlistItemBytes > 0 ? 'OK' : 'FALHA',
      playlistItemDownload.ok ? 'Nenhuma' : 'Selecionar outro item da playlist ou revisar extractor do Vimeo',
    );
  }

  const downloadVideo = await fetch(`${backendBase}/api/download?url=${encodeURIComponent(sampleUrl)}&format=video&quality=best&id=550e8400-e29b-41d4-a716-446655440011&title=QA%20Video`, {
    cache: 'no-store',
  });
  const videoBytes = (await downloadVideo.arrayBuffer()).byteLength;
  row(
    '/api/download video',
    `GET ${backendBase}/api/download?url=${encodeURIComponent(sampleUrl)}&format=video&quality=best&id=qa-video&title=QA%20Video`,
    `HTTP ${downloadVideo.status}; bytes=${videoBytes}; content-type=${downloadVideo.headers.get('content-type') || '-'}`,
    downloadVideo.ok && videoBytes > 0 ? 'OK' : 'FALHA',
    downloadVideo.ok ? 'Nenhuma' : 'Checar yt-dlp/saida binaria ou rota de download',
  );

  const downloadAudio = await fetch(`${backendBase}/api/download?url=${encodeURIComponent(sampleAudioUrl)}&format=audio&quality=best&id=550e8400-e29b-41d4-a716-446655440012&title=QA%20Audio`, {
    cache: 'no-store',
  });
  const audioBytes = (await downloadAudio.arrayBuffer()).byteLength;
  row(
    '/api/download audio',
    `GET ${backendBase}/api/download?url=${encodeURIComponent(sampleAudioUrl)}&format=audio&quality=best&id=550e8400-e29b-41d4-a716-446655440012&title=QA%20Audio`,
    `HTTP ${downloadAudio.status}; bytes=${audioBytes}; content-type=${downloadAudio.headers.get('content-type') || '-'}`,
    downloadAudio.ok && audioBytes > 0 ? 'OK' : 'FALHA',
    downloadAudio.ok ? 'Nenhuma' : 'Checar ffmpeg/saida mp3 ou dependencias de audio',
  );

  const mediaFile = await ensureFile(sampleFilePath);
  const mediaForm = new FormData();
  mediaForm.append('file', mediaFile);
  mediaForm.append('operation', 'optimize-png');
  mediaForm.append('preset', 'balanced');
  const mediaCreate = await fetchJson(`${backendBase}/api/media/jobs`, {
    method: 'POST',
    body: mediaForm,
  });
  const mediaJob = mediaCreate.body;
  row(
    'Media job create',
    `POST ${backendBase}/api/media/jobs (multipart file=${path.basename(sampleFilePath)})`,
    `HTTP ${mediaCreate.response.status}; ${summarizeBody(mediaJob)}`,
    mediaCreate.response.status === 201 && mediaJob?.id ? 'OK' : 'FALHA',
    mediaCreate.response.status === 201 ? 'Nenhuma' : 'Checar multer/operacao/preset e permissao do arquivo',
  );

  if (mediaCreate.response.status === 201 && mediaJob?.id) {
    const finished = await waitForJob('media', mediaJob.id, 'completed');
    row(
      'Media job completion',
      `GET ${backendBase}/api/media/jobs (poll id=${mediaJob.id})`,
      `status=${finished.status}; progress=${finished.progress}; output=${finished.outputName || '-'}`,
      finished.status === 'completed' ? 'OK' : 'FALHA',
      finished.status === 'completed' ? 'Nenhuma' : `Investigar ${finished.error || 'processamento de midia'}`,
    );

    const mediaDownload = await fetch(`${backendBase}/api/media/jobs/${mediaJob.id}/download`, { cache: 'no-store' });
    const mediaDownloadBytes = (await mediaDownload.arrayBuffer()).byteLength;
    row(
      'Media job download',
      `GET ${backendBase}/api/media/jobs/${mediaJob.id}/download`,
      `HTTP ${mediaDownload.status}; bytes=${mediaDownloadBytes}; content-type=${mediaDownload.headers.get('content-type') || '-'}`,
      mediaDownload.ok && mediaDownloadBytes > 0 ? 'OK' : 'FALHA',
      mediaDownload.ok ? 'Nenhuma' : 'Checar arquivo expirado, status do job ou stream de download',
    );

    const mediaDelete = await fetchJson(`${backendBase}/api/media/jobs/${mediaJob.id}`, {
      method: 'DELETE',
    });
    row(
      'Media job remove',
      `DELETE ${backendBase}/api/media/jobs/${mediaJob.id}`,
      `HTTP ${mediaDelete.response.status}; ${summarizeBody(mediaDelete.body)}`,
      mediaDelete.response.ok ? 'OK' : 'FALHA',
      mediaDelete.response.ok ? 'Nenhuma' : 'Checar removeByIds e cleanup da fila',
    );
  }

  const thumbFile = await ensureFile(sampleFilePath);
  const thumbForm = new FormData();
  thumbForm.append('file', thumbFile);
  thumbForm.append('operation', 'thumbnail');
  thumbForm.append('preset', '16x9');
  const thumbCreate = await fetchJson(`${backendBase}/api/thumbnails/jobs`, {
    method: 'POST',
    body: thumbForm,
  });
  const thumbJob = thumbCreate.body;
  row(
    'Thumbnail job create',
    `POST ${backendBase}/api/thumbnails/jobs (multipart file=${path.basename(sampleFilePath)})`,
    `HTTP ${thumbCreate.response.status}; ${summarizeBody(thumbJob)}`,
    thumbCreate.response.status === 201 && thumbJob?.id ? 'OK' : 'FALHA',
    thumbCreate.response.status === 201 ? 'Nenhuma' : 'Checar multer/operacao/preset e permissao do arquivo',
  );

  if (thumbCreate.response.status === 201 && thumbJob?.id) {
    const finished = await waitForJob('thumbnail', thumbJob.id, 'completed');
    row(
      'Thumbnail job completion',
      `GET ${backendBase}/api/thumbnails/jobs (poll id=${thumbJob.id})`,
      `status=${finished.status}; progress=${finished.progress}; output=${finished.outputName || '-'}`,
      finished.status === 'completed' ? 'OK' : 'FALHA',
      finished.status === 'completed' ? 'Nenhuma' : `Investigar ${finished.error || 'processamento de thumbnail'}`,
    );

    const thumbDownload = await fetch(`${backendBase}/api/thumbnails/jobs/${thumbJob.id}/download`, { cache: 'no-store' });
    const thumbDownloadBytes = (await thumbDownload.arrayBuffer()).byteLength;
    row(
      'Thumbnail job download',
      `GET ${backendBase}/api/thumbnails/jobs/${thumbJob.id}/download`,
      `HTTP ${thumbDownload.status}; bytes=${thumbDownloadBytes}; content-type=${thumbDownload.headers.get('content-type') || '-'}`,
      thumbDownload.ok && thumbDownloadBytes > 0 ? 'OK' : 'FALHA',
      thumbDownload.ok ? 'Nenhuma' : 'Checar arquivo expirado, status do job ou stream de download',
    );

    const thumbDelete = await fetchJson(`${backendBase}/api/thumbnails/jobs/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [thumbJob.id] }),
    });
    row(
      'Thumbnail job remove',
      `POST ${backendBase}/api/thumbnails/jobs/delete`,
      `HTTP ${thumbDelete.response.status}; ${summarizeBody(thumbDelete.body)}`,
      thumbDelete.response.ok ? 'OK' : 'FALHA',
      thumbDelete.response.ok ? 'Nenhuma' : 'Checar removeByIds e limpeza da fila',
    );
  }

  const news = await fetchJson(`${backendBase}/api/news?limit=3`, { cache: 'no-store' });
  row(
    '/api/news',
    `GET ${backendBase}/api/news?limit=3`,
    `HTTP ${news.response.status}; ${summarizeBody(news.body)}`,
    news.response.ok ? 'OK' : 'FALHA',
    news.response.ok ? 'Nenhuma' : 'Checar Supabase/rede/RSS e fallback memory',
  );

  const newsHealth = await fetchJson(`${backendBase}/api/news/health`, { cache: 'no-store' });
  row(
    '/api/news/health',
    `GET ${backendBase}/api/news/health`,
    `HTTP ${newsHealth.response.status}; ${summarizeBody(newsHealth.body)}`,
    newsHealth.response.ok ? 'OK' : 'FALHA',
    newsHealth.response.ok ? 'Nenhuma' : 'Checar status do coletor e acesso ao Supabase',
  );

  const timeoutProbe = await fetch(`${backendBase}/api/info?url=${encodeURIComponent(sampleUrl)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(250),
  }).then(
    () => ({ ok: false, message: 'request finished before timeout' }),
    (error) => ({ ok: error?.name === 'TimeoutError' || error?.name === 'AbortError', message: error?.name || String(error) }),
  );
  row(
    'Timeout probe',
    `GET ${backendBase}/api/info?url=${encodeURIComponent(sampleUrl)} with AbortSignal.timeout(250)`,
    timeoutProbe.ok ? `Abortou como esperado (${timeoutProbe.message})` : `Falhou/retornou cedo (${timeoutProbe.message})`,
    timeoutProbe.ok ? 'OK' : 'FALHA',
    timeoutProbe.ok ? 'Nenhuma' : 'Ajustar timeout do frontend/backend ou investigar latência da URL de teste',
  );

  const failed = results.filter((item) => item.status === 'FALHA').length;
  const summary = {
    total: results.length,
    ok: results.length - failed,
    falha: failed,
  };

  console.log(JSON.stringify({ summary, results }, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
