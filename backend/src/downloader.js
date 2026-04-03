const { spawn } = require('child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('events');
const { assertPublicHttpUrl, stripYoutubePlaylistParams } = require('./urlSafety');
const { openSseStream } = require('./sse');

const progressEmitter = new EventEmitter();
let cachedCookiesPath = null;

function sanitizeFilename(name) {
  const raw = String(name || 'download');
  const clean = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return clean || 'download';
}

function buildContentDisposition(filenameWithExt) {
  const clean = sanitizeFilename(filenameWithExt).replace(/[\r\n"]/g, '_');
  const asciiFallback = clean.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(clean);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function normalizeUploadName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return 'media';
  }

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

function resolveEntryUrl(item, fallbackUrl) {
  if (typeof item?.webpage_url === 'string' && item.webpage_url.trim()) {
    return stripYoutubePlaylistParams(item.webpage_url);
  }

  if (typeof item?.url === 'string' && /^https?:\/\//i.test(item.url)) {
    return stripYoutubePlaylistParams(item.url);
  }

  if (typeof item?.id === 'string' && item.id.trim()) {
    return `https://www.youtube.com/watch?v=${item.id.trim()}`;
  }

  return stripYoutubePlaylistParams(fallbackUrl);
}

function toNumericDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.round(numeric);
}

function resolveCookiesPath() {
  if (cachedCookiesPath) {
    return cachedCookiesPath;
  }

  const cookiesFileEnv = String(process.env.YTDLP_COOKIES_FILE || '').trim();
  if (cookiesFileEnv && fs.existsSync(cookiesFileEnv)) {
    cachedCookiesPath = cookiesFileEnv;
    return cachedCookiesPath;
  }

  const cookiesB64 = String(process.env.YTDLP_COOKIES_B64 || '').trim();
  if (!cookiesB64) {
    return null;
  }

  try {
    const decoded = Buffer.from(cookiesB64, 'base64').toString('utf8');
    if (!decoded.includes('youtube.com')) {
      return null;
    }
    const filePath = path.join(os.tmpdir(), 'yt-cookies.txt');
    fs.writeFileSync(filePath, decoded, 'utf8');
    cachedCookiesPath = filePath;
    return cachedCookiesPath;
  } catch {
    return null;
  }
}

function getCommonYtdlpArgs() {
  const args = [];
  const jsRuntimes = String(process.env.YTDLP_JS_RUNTIMES || 'node').trim();
  if (jsRuntimes) {
    args.push('--js-runtimes', jsRuntimes);
  }

  const cookiesPath = resolveCookiesPath();
  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }

  const userAgent = String(process.env.YTDLP_USER_AGENT || '').trim();
  if (userAgent) {
    args.push('--user-agent', userAgent);
  }

  args.push('--retries', String(Math.max(1, Number(process.env.YTDLP_RETRIES || 8))));
  args.push('--fragment-retries', String(Math.max(1, Number(process.env.YTDLP_FRAGMENT_RETRIES || 8))));
  args.push('--retry-sleep', String(process.env.YTDLP_RETRY_SLEEP || 'http:2'));

  return args;
}

async function safeInfoUrl(url) {
  const parsed = await assertPublicHttpUrl(url, 'URL de midia');
  return parsed.toString();
}

function killChild(child) {
  if (!child) {
    return;
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // ignore kill errors
  }
}

function createDownloadAbortError(message) {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function emitSseProgress(id, payload) {
  progressEmitter.emit(`progress-${id}`, payload);
}

function runProcess(command, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = '';
    let stdout = '';
    let settled = false;

    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    };

    const onAbort = () => {
      killChild(child);
      finish(createDownloadAbortError('Operacao cancelada ou excedeu o tempo limite.'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      finish(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      if (code === 0) {
        finish(null, { stdout, stderr });
        return;
      }
      finish(new Error(`${command} failed (${code}): ${stderr || stdout}`));
    });
  });
}

async function createZipArchive(sourceDir, zipPath, signal) {
  try {
    await runProcess('tar', ['-a', '-c', '-f', zipPath, '-C', sourceDir, '.'], { signal });
    return;
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error;
    }
  }

  const escapedSource = sourceDir.replace(/'/g, "''");
  const escapedZip = zipPath.replace(/'/g, "''");
  await runProcess('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Compress-Archive -Path '${escapedSource}\\*' -DestinationPath '${escapedZip}' -Force`,
  ], { signal });
}

async function streamFileToResponse(filePath, res, contentType, downloadName) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error('Arquivo gerado esta vazio.');
  }

  res.setHeader('Content-Disposition', buildContentDisposition(downloadName));
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(stat.size));

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    let settled = false;
    let finished = false;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    stream.on('error', finish);
    res.on('error', finish);
    res.on('close', () => {
      if (!finished) {
        finish(new Error('Download interrompido.'));
      }
    });
    stream.on('end', () => {
      finished = true;
      finish();
    });
    stream.pipe(res);
  });
}

async function getInfo(url) {
  const safeUrl = await safeInfoUrl(url);
  let outputData = '';
  let errorData = '';
  let timedOut = false;
  const infoTimeoutMs = Math.max(15_000, Number(process.env.YTDLP_INFO_TIMEOUT_MS || 180_000));
  const infoMaxEntries = Math.max(1, Number(process.env.YTDLP_INFO_MAX_ENTRIES || 300));

  await new Promise((resolve, reject) => {
    const ytdlp = spawn('yt-dlp', [
      ...getCommonYtdlpArgs(),
      '--dump-single-json',
      '--flat-playlist',
      '--yes-playlist',
      '--playlist-end',
      String(infoMaxEntries),
      safeUrl,
    ]);

    const timeout = setTimeout(() => {
      timedOut = true;
      killChild(ytdlp);
    }, infoTimeoutMs);

    ytdlp.stdout.on('data', (data) => {
      outputData += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    ytdlp.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    ytdlp.on('close', (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        const seconds = Math.round(infoTimeoutMs / 1000);
        reject(new Error(`yt-dlp info timeout apos ${seconds}s. Tente novamente.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`yt-dlp failed: ${errorData}`));
        return;
      }

      resolve();
    });
  });

  try {
    const raw = outputData.trim();
    if (!raw) {
      throw new Error('empty');
    }

    const parsed = JSON.parse(raw);
    const parsedEntries = Array.isArray(parsed?.entries) && parsed.entries.length > 0 ? parsed.entries : [parsed];
    const first = parsedEntries[0] || parsed || {};
    const playlistCountRaw = Number(parsed?.playlist_count || parsed?.n_entries || parsedEntries.length);
    const playlistCount = Number.isFinite(playlistCountRaw) && playlistCountRaw > 0
      ? Math.round(playlistCountRaw)
      : parsedEntries.length;

    const entries = parsedEntries.map((item, index) => ({
      id: item?.id || String(index + 1),
      title: item?.title || `Item ${index + 1}`,
      thumbnail: item?.thumbnail || parsed?.thumbnail || '',
      duration: toNumericDuration(item?.duration || parsed?.duration),
      url: resolveEntryUrl(item, safeUrl),
    }));

    const isPlaylist = parsed?._type === 'playlist' || playlistCount > 1 || entries.length > 1;
    const totalDuration = entries.reduce((sum, entry) => sum + toNumericDuration(entry.duration), 0);
    const formats = Array.isArray(parsed?.formats) ? parsed.formats : (Array.isArray(first?.formats) ? first.formats : []);
    const videoFormats = formats
      .filter((f) => f.vcodec !== 'none' || f.acodec !== 'none')
      .map((f) => ({
        format_id: f.format_id,
        ext: f.ext,
        resolution: f.resolution,
        vcodec: f.vcodec,
        acodec: f.acodec,
        filesize: f.filesize || f.filesize_approx,
      }));

    return {
      title: isPlaylist
        ? (parsed?.title || parsed?.playlist_title || parsed?.playlist || first.playlist_title || first.playlist || `Playlist (${playlistCount} itens)`)
        : (first.title || parsed?.title || 'Midia'),
      thumbnail: first.thumbnail || parsed?.thumbnail,
      duration: isPlaylist ? totalDuration : toNumericDuration(first.duration),
      isPlaylist,
      entryCount: playlistCount,
      entries,
      formats: videoFormats,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Failed to parse yt-dlp output');
    }
    throw error;
  }
}

const subscribeProgress = (taskId, req, res) => {
  const stream = openSseStream(req, res);
  const listener = (data) => stream.send(data);

  progressEmitter.on(`progress-${taskId}`, listener);

  req.on('close', () => {
    progressEmitter.off(`progress-${taskId}`, listener);
    stream.close();
  });
};

const downloadMedia = (req, res, { url, format, quality, id, title, scope, entryUrl }) => {
  const safeTitle = sanitizeFilename(title || 'download');
  const downloadScope = String(scope || 'item').toLowerCase() === 'list' ? 'list' : 'item';
  const fileExt = format === 'audio' ? 'mp3' : 'mp4';
  const progressChannel = `progress-${id}`;
  const downloadTimeoutMs = Math.max(60_000, Number(process.env.YTDLP_DOWNLOAD_TIMEOUT_MS || 30 * 60 * 1000));
  let latestSize = '...';
  let latestProgress = 0;
  let terminalEventSent = false;
  let completed = false;
  let timeout = null;
  let timedOut = false;
  let ytdlp = null;
  let tempRoot = null;
  let outputDir = null;

  const emitProgress = (payload) => {
    emitSseProgress(progressChannel, payload);
  };

  const emitCompleted = () => {
    if (terminalEventSent) return;
    terminalEventSent = true;
    emitProgress({
      percentage: 100,
      size: latestSize,
      status: 'completed',
    });
  };

  const emitError = (message) => {
    if (terminalEventSent) return;
    terminalEventSent = true;
    emitProgress({
      percentage: latestProgress,
      size: latestSize,
      status: 'error',
      message: message || 'Falha no download',
    });
  };

  const finishWithError = (status, message) => {
    if (!res.headersSent) {
      res.status(status).json({ error: message });
      return;
    }
    if (!res.writableEnded) {
      res.destroy(createDownloadAbortError(message));
    }
  };

  const collectOutputFiles = async () => {
    const entries = await fs.promises.readdir(outputDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(outputDir, entry.name))
      .filter((filePath) => !filePath.endsWith('.part'))
      .filter((filePath) => !filePath.endsWith('.part-Frag'))
      .filter((filePath) => !filePath.endsWith('.ytdl'));
  };

  const cleanupTemp = async () => {
    if (!tempRoot) {
      return;
    }
    try {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  };

  (async () => {
    try {
      if (!['audio', 'video'].includes(String(format || ''))) {
        throw new Error('Formato invalido.');
      }

      const validatedUrl = await assertPublicHttpUrl(url, 'URL de midia');
      const targetUrl =
        downloadScope === 'list'
          ? validatedUrl.toString()
          : stripYoutubePlaylistParams(
              entryUrl
                ? (await assertPublicHttpUrl(entryUrl, 'URL do item')).toString()
                : validatedUrl.toString(),
            );

      const normalizedQuality = String(quality || 'best').trim();
      let formatSelector = 'best';
      if (normalizedQuality !== 'best') {
        const numericQuality = Number.parseInt(normalizedQuality, 10);
        if (!Number.isInteger(numericQuality) || numericQuality < 144 || numericQuality > 4320) {
          throw new Error('Quality invalida. Use best ou um valor numerico de altura em pixels.');
        }
        formatSelector = `bestvideo[height<=${numericQuality}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]`;
      }

      tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mp3ok-download-'));
      outputDir = path.join(tempRoot, 'content');
      await fs.promises.mkdir(outputDir, { recursive: true });

      const template = path.join(
        outputDir,
        downloadScope === 'list'
          ? '%(playlist_index)03d-%(title).120B [%(id)s].%(ext)s'
          : '%(title).120B [%(id)s].%(ext)s',
      );

      const ytdlpArgs = [
        ...getCommonYtdlpArgs(),
        '--newline',
        '--windows-filenames',
        downloadScope === 'list' ? '--yes-playlist' : '--no-playlist',
        '-o',
        template,
      ];

      if (format === 'audio') {
        ytdlpArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
      } else {
        ytdlpArgs.push('-f', formatSelector, '--merge-output-format', 'mp4');
      }

      ytdlpArgs.push(targetUrl);

      emitProgress({
        percentage: 0,
        size: latestSize,
        status: 'downloading',
      });

      ytdlp = spawn('yt-dlp', ytdlpArgs);

      req.on('close', () => {
        killChild(ytdlp);
        if (timeout) {
          clearTimeout(timeout);
        }
      });

      timeout = setTimeout(() => {
        timedOut = true;
        killChild(ytdlp);
      }, downloadTimeoutMs);

      if (typeof timeout.unref === 'function') {
        timeout.unref();
      }

      ytdlp.stderr.on('data', (data) => {
        const text = data.toString();
        const progressMatch = text.match(/\[download\]\s+([\d.]+)%\s+of\s+([~]?[\d.]+\w+|\bUnknown\b)/i);
        if (progressMatch) {
          latestProgress = Math.min(99, Math.max(0, parseFloat(progressMatch[1]) || latestProgress));
          latestSize = progressMatch[2] || latestSize;
          emitProgress({
            percentage: latestProgress,
            size: latestSize,
            status: 'downloading',
          });
        }
      });

      const result = await new Promise((resolve, reject) => {
        ytdlp.on('error', reject);
        ytdlp.on('close', (code) => {
          if (timedOut) {
            reject(new Error('Tempo limite excedido no download.'));
            return;
          }
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error('Falha no download da origem'));
        });
      });

      if (result === undefined) {
        // no-op, just keep linter happy
      }

      if (timeout) {
        clearTimeout(timeout);
      }

      const files = await collectOutputFiles();
      if (files.length === 0) {
        throw new Error('Arquivo gerado esta vazio.');
      }

      if (downloadScope === 'list') {
        const archiveName = `${safeTitle || 'download'}-${format === 'audio' ? 'audio' : 'video'}.zip`;
        const archivePath = path.join(tempRoot, archiveName);
        await createZipArchive(outputDir, archivePath);
        await streamFileToResponse(archivePath, res, 'application/zip', archiveName);
      } else {
        const preferredExt = fileExt;
        const selectedFile =
          files.find((filePath) => path.extname(filePath).toLowerCase().replace('.', '') === preferredExt) || files[0];
        if (!selectedFile) {
          throw new Error('Arquivo gerado esta vazio.');
        }
        await streamFileToResponse(selectedFile, res, format === 'audio' ? 'audio/mpeg' : 'video/mp4', `${safeTitle}.${fileExt}`);
      }

      completed = true;
      emitCompleted();
      await cleanupTemp();
    } catch (error) {
      if (timeout) {
        clearTimeout(timeout);
      }
      await cleanupTemp();
      if (!completed) {
        emitError(error.message || 'Falha no download');
        finishWithError(timedOut ? 504 : 400, error.message || 'Falha no download');
      }
    }
  })();
};

module.exports = {
  getInfo,
  downloadMedia,
  subscribeProgress,
};
