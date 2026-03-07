const { spawn } = require('child_process');
const EventEmitter = require('events');

// Event emitter to broadcast progress events
const progressEmitter = new EventEmitter();

/**
 * Fetch video metadata using yt-dlp
 */
const getInfo = (url) => {
    return new Promise((resolve, reject) => {
        let outputData = '';
        let errorData = '';

        const ytdlp = spawn('yt-dlp', [
            '--dump-json',
            '--no-playlist',
            url
        ]);

        ytdlp.stdout.on('data', (data) => {
            outputData += data.toString();
        });

        ytdlp.stderr.on('data', (data) => {
            errorData += data.toString();
        });

        ytdlp.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`yt-dlp failed: ${errorData}`));
            }
            try {
                const info = JSON.parse(outputData);
                // Extract useful formats to abstract complexity from frontend
                const formats = info.formats || [];

                // Filter out formats without video and audio
                const videoFormats = formats.filter(f => f.vcodec !== 'none' || f.acodec !== 'none').map(f => ({
                    format_id: f.format_id,
                    ext: f.ext,
                    resolution: f.resolution,
                    vcodec: f.vcodec,
                    acodec: f.acodec,
                    filesize: f.filesize || f.filesize_approx
                }));

                resolve({
                    title: info.title,
                    thumbnail: info.thumbnail,
                    duration: info.duration,
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
const downloadMedia = (req, res, { url, format, quality, id }) => {
    let title = 'download';

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${title}.mp4"`);
    res.setHeader('Content-Type', format === 'audio' ? 'audio/mpeg' : 'video/mp4');

    let ytdlpArgs = [];

    if (format === 'audio') {
        // For audio, we download best audio and pipe to ffmpeg later
        ytdlpArgs = ['--newline', '-f', 'bestaudio', '-o', '-', url];
        res.setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
    } else {
        // For video, we try to get requested quality with audio
        let formatSelector = 'best';
        if (quality && quality !== 'best') {
            formatSelector = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]`;
        }
        ytdlpArgs = ['--newline', '-f', formatSelector, '-o', '-', url];
    }

    const ytdlp = spawn('yt-dlp', ytdlpArgs);

    // Parse progress from stderr
    ytdlp.stderr.on('data', (data) => {
        const text = data.toString();
        // Example stdout: [download]  10.0% of 50.00MiB at  1.50MiB/s ETA 00:30
        const progressMatch = text.match(/\[download\]\s+([\d.]+)%\s+of\s+([~]?[\d.]+MiB|\bUnknown\b)/);
        if (progressMatch) {
            const percentage = parseFloat(progressMatch[1]);
            const size = progressMatch[2];
            progressEmitter.emit(`progress-${id}`, {
                percentage, // 0-100
                size
            });
        }
    });

    if (format === 'audio') {
        // Pipe ytdlp output to ffmpeg for mp3 conversion
        const ffmpeg = spawn('ffmpeg', [
            '-i', 'pipe:0',      // Input from stdin
            '-f', 'mp3',         // Output format mp3
            '-b:a', '192k',      // Audio bitrate
            'pipe:1'             // Output to stdout
        ]);

        ytdlp.stdout.pipe(ffmpeg.stdin);
        ffmpeg.stdout.pipe(res);

        ffmpeg.on('error', (err) => {
            console.error('FFmpeg Error:', err);
            if (!res.headersSent) res.status(500).end('FFmpeg conversion failed');
        });

    } else {
        // Directly pipe ytdlp to response (MP4)
        ytdlp.stdout.pipe(res);
    }

    ytdlp.on('error', (err) => {
        console.error('yt-dlp error:', err);
        if (!res.headersSent) res.status(500).end('Download failed');
    });

    // Handle client disconnect
    req.on('close', () => {
        ytdlp.kill('SIGKILL');
    });
};

module.exports = {
    getInfo,
    downloadMedia,
    subscribeProgress
};
