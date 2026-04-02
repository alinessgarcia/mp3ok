const { spawn } = require('child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('events');

// Event emitter to broadcast progress events
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

function stripYoutubePlaylistParams(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const host = parsed.hostname.toLowerCase();
        const isYoutube = host === 'youtu.be' || host.endsWith('.youtube.com') || host === 'youtube.com';

        if (!isYoutube) {
            return rawUrl;
        }

        parsed.searchParams.delete('list');
        parsed.searchParams.delete('index');
        parsed.searchParams.delete('start_radio');
        parsed.searchParams.delete('pp');
        return parsed.toString();
    } catch {
        return rawUrl;
    }
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

/**
 * Fetch video metadata using yt-dlp
 */
const getInfo = (url) => {
    return new Promise((resolve, reject) => {
        let outputData = '';
        let errorData = '';
        let timedOut = false;
        const infoTimeoutMs = Math.max(15_000, Number(process.env.YTDLP_INFO_TIMEOUT_MS || 180_000));
        const infoMaxEntries = Math.max(1, Number(process.env.YTDLP_INFO_MAX_ENTRIES || 300));

        const ytdlp = spawn('yt-dlp', [
            ...getCommonYtdlpArgs(),
            '--dump-single-json',
            '--flat-playlist',
            '--yes-playlist',
            '--playlist-end',
            String(infoMaxEntries),
            url
        ]);

        const timeout = setTimeout(() => {
            timedOut = true;
            try {
                ytdlp.kill('SIGKILL');
            } catch {
                // ignore kill errors
            }
        }, infoTimeoutMs);

        ytdlp.stdout.on('data', (data) => {
            outputData += data.toString();
        });

        ytdlp.stderr.on('data', (data) => {
            errorData += data.toString();
        });

        ytdlp.on('close', (code) => {
            clearTimeout(timeout);

            if (timedOut) {
                const seconds = Math.round(infoTimeoutMs / 1000);
                return reject(new Error(`yt-dlp info timeout apos ${seconds}s. Tente novamente.`));
            }

            if (code !== 0) {
                return reject(new Error(`yt-dlp failed: ${errorData}`));
            }
            try {
                const raw = outputData.trim();
                if (!raw) {
                    throw new Error('empty');
                }

                const parsed = JSON.parse(raw);
                const parsedEntries = Array.isArray(parsed?.entries) && parsed.entries.length > 0
                    ? parsed.entries
                    : [parsed];
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
                    url: resolveEntryUrl(item, url)
                }));

                const isPlaylist = parsed?._type === 'playlist' || playlistCount > 1 || entries.length > 1;
                const totalDuration = entries.reduce((sum, entry) => sum + toNumericDuration(entry.duration), 0);

                // Formats may be empty in flat-playlist mode.
                const formats = Array.isArray(parsed?.formats) ? parsed.formats : (Array.isArray(first?.formats) ? first.formats : []);
                const videoFormats = formats
                    .filter((f) => f.vcodec !== 'none' || f.acodec !== 'none')
                    .map((f) => ({
                        format_id: f.format_id,
                        ext: f.ext,
                        resolution: f.resolution,
                        vcodec: f.vcodec,
                        acodec: f.acodec,
                        filesize: f.filesize || f.filesize_approx
                    }));

                resolve({
                    title: isPlaylist
                        ? (parsed?.title || parsed?.playlist_title || parsed?.playlist || first.playlist_title || first.playlist || `Playlist (${playlistCount} itens)`)
                        : (first.title || parsed?.title || 'Midia'),
                    thumbnail: first.thumbnail || parsed?.thumbnail,
                    duration: isPlaylist ? totalDuration : toNumericDuration(first.duration),
                    isPlaylist,
                    entryCount: playlistCount,
                    entries,
                    formats: videoFormats
                });
            } catch (e) {
                reject(new Error('Failed to parse yt-dlp output'));
            }
        });
    });
};

/**
 * Handle Server-Sent Events subscription for progress tracking
 */
const subscribeProgress = (taskId, req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const listener = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    progressEmitter.on(`progress-${taskId}`, listener);

    req.on('close', () => {
        progressEmitter.off(`progress-${taskId}`, listener);
    });
};

/**
 * Start download and stream directly to response
 */
const downloadMedia = (req, res, { url, format, quality, id, title }) => {
    const safeTitle = sanitizeFilename(title || 'download');
    const fileExt = format === 'audio' ? 'mp3' : 'mp4';
    const fileName = `${safeTitle}.${fileExt}`;
    const progressChannel = `progress-${id}`;

    let latestSize = '...';
    let latestProgress = 0;
    let terminalEventSent = false;

    const emitProgress = (payload) => {
        progressEmitter.emit(progressChannel, payload);
    };

    const emitCompleted = () => {
        if (terminalEventSent) return;
        terminalEventSent = true;
        emitProgress({
            percentage: 100,
            size: latestSize,
            status: 'completed'
        });
    };

    const emitError = (message) => {
        if (terminalEventSent) return;
        terminalEventSent = true;
        emitProgress({
            percentage: latestProgress,
            size: latestSize,
            status: 'error',
            message: message || 'Falha no download'
        });
    };

    res.setHeader('Content-Disposition', buildContentDisposition(fileName));
    res.setHeader('Content-Type', format === 'audio' ? 'audio/mpeg' : 'video/mp4');

    let ytdlpArgs = [];

    if (format === 'audio') {
        ytdlpArgs = [...getCommonYtdlpArgs(), '--newline', '--yes-playlist', '-f', 'bestaudio', '-o', '-', url];
    } else {
        let formatSelector = 'best';
        if (quality && quality !== 'best') {
            formatSelector = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]`;
        }
        ytdlpArgs = [...getCommonYtdlpArgs(), '--newline', '--yes-playlist', '-f', formatSelector, '-o', '-', url];
    }

    const ytdlp = spawn('yt-dlp', ytdlpArgs);
    let ffmpeg = null;

    emitProgress({
        percentage: 0,
        size: latestSize,
        status: 'downloading'
    });

    ytdlp.stderr.on('data', (data) => {
        const text = data.toString();
        const progressMatch = text.match(/\[download\]\s+([\d.]+)%\s+of\s+([~]?[\d.]+\w+|\bUnknown\b)/i);
        if (progressMatch) {
            latestProgress = Math.min(99, Math.max(0, parseFloat(progressMatch[1]) || latestProgress));
            latestSize = progressMatch[2] || latestSize;
            emitProgress({
                percentage: latestProgress,
                size: latestSize,
                status: 'downloading'
            });
        }
    });

    if (format === 'audio') {
        ffmpeg = spawn('ffmpeg', [
            '-i', 'pipe:0',      // Input from stdin
            '-f', 'mp3',         // Output format mp3
            '-b:a', '192k',      // Audio bitrate
            'pipe:1'             // Output to stdout
        ]);

        ytdlp.stdout.pipe(ffmpeg.stdin);
        ffmpeg.stdout.pipe(res);

        ffmpeg.on('error', (err) => {
            console.error('FFmpeg Error:', err);
            emitError('Falha na conversao de audio');
            if (!res.headersSent) res.status(500).end('FFmpeg conversion failed');
        });

        ffmpeg.on('close', (code) => {
            if (code !== 0) {
                emitError('Falha no processamento de audio');
            }
        });

    } else {
        ytdlp.stdout.pipe(res);
    }

    ytdlp.on('error', (err) => {
        console.error('yt-dlp error:', err);
        emitError('Falha ao iniciar yt-dlp');
        if (!res.headersSent) res.status(500).end('Download failed');
    });

    ytdlp.on('close', (code) => {
        if (code !== 0) {
            emitError('Falha no download da origem');
        }
    });

    res.on('finish', () => {
        emitCompleted();
    });

    res.on('close', () => {
        if (!res.writableEnded) {
            emitError('Download interrompido');
        }
    });

    req.on('close', () => {
        if (!res.writableEnded) {
            ytdlp.kill('SIGKILL');
            if (ffmpeg) {
                ffmpeg.kill('SIGKILL');
            }
        }
    });
};

module.exports = {
    getInfo,
    downloadMedia,
    subscribeProgress
};
