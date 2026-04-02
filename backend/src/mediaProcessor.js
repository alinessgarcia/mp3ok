const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { mediaConfig } = require('./mediaConfig');
const gifsicleModule = require('gifsicle');
const gifsicleBinary =
  typeof gifsicleModule === 'string'
    ? gifsicleModule
    : gifsicleModule?.default || gifsicleModule?.path;

const OPERATION_SET = new Set([
  'optimize-gif',
  'optimize-png',
  'optimize-jpeg',
  'mp4-to-gif',
  'gif-to-mp4',
  'optimize-mp4',
  'mp4-to-mp3-segmented',
  'ogg-to-mp3',
]);

const PRESET_SET = new Set(['light', 'balanced', 'aggressive']);

const PRESET_VALUES = {
  light: {
    gifLossy: 20,
    gifOptimizeLevel: 2,
    pngQuality: 90,
    pngCompressionLevel: 6,
    jpegQuality: 88,
    mp4Crf: 23,
    mp4ToGifWidth: 720,
    mp4ToGifFps: 12,
  },
  balanced: {
    gifLossy: 60,
    gifOptimizeLevel: 3,
    pngQuality: 75,
    pngCompressionLevel: 8,
    jpegQuality: 76,
    mp4Crf: 28,
    mp4ToGifWidth: 600,
    mp4ToGifFps: 10,
  },
  aggressive: {
    gifLossy: 120,
    gifOptimizeLevel: 3,
    pngQuality: 60,
    pngCompressionLevel: 9,
    jpegQuality: 62,
    mp4Crf: 33,
    mp4ToGifWidth: 480,
    mp4ToGifFps: 8,
  },
};

function sanitizeName(input) {
  return String(input || 'media')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function parseAdvanced(advancedRaw) {
  if (!advancedRaw) {
    return {};
  }
  if (typeof advancedRaw === 'object') {
    return advancedRaw;
  }
  try {
    const parsed = JSON.parse(advancedRaw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new Error('Campo advanced invalido. Use JSON valido.');
  }
}

function pickNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, n));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stderr = '';
    let stdout = '';

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    child.on('error', (error) => {
      if (error && error.code === 'ENOENT') {
        if (command === 'ffmpeg') {
          reject(new Error('ffmpeg nao encontrado no PATH. Instale FFmpeg e reinicie o backend.'));
          return;
        }
        if (command === 'ffprobe') {
          reject(new Error('ffprobe nao encontrado no PATH. Instale FFmpeg completo e reinicie o backend.'));
          return;
        }
        reject(new Error(`${command} nao encontrado no sistema.`));
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} failed (${code}): ${stderr || stdout}`));
      }
    });
  });
}

async function getMediaDimensions(filePath) {
  try {
    const { stdout } = await runCommand('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      filePath,
    ]);

    const payload = JSON.parse(stdout || '{}');
    const stream = Array.isArray(payload.streams) ? payload.streams[0] : null;
    const width = Number(stream?.width || 0);
    const height = Number(stream?.height || 0);
    if (width > 0 && height > 0) {
      return { width, height };
    }
    return null;
  } catch {
    return null;
  }
}

async function fallbackOptimizeGifWithFfmpeg(job, outputPath) {
  const safePath = `${outputPath}.safe.gif`;
  await runCommand('ffmpeg', [
    '-y',
    '-i',
    job.inputPath,
    '-filter_complex',
    '[0:v]split[v1][v2];[v1]palettegen=stats_mode=diff[p];[v2][p]paletteuse=dither=bayer:bayer_scale=3',
    safePath,
  ]);
  await fs.promises.rename(safePath, outputPath);
}

async function optimizeGif(job, outputPath, progressCb) {
  if (!gifsicleBinary || typeof gifsicleBinary !== 'string') {
    throw new Error('gifsicle nao encontrado ou invalido no ambiente.');
  }

  const preset = PRESET_VALUES[job.preset];
  const advanced = parseAdvanced(job.advanced);
  const lossy = pickNumber(advanced.lossy, preset.gifLossy, 0, 400);
  const optimizeLevel = Math.round(pickNumber(advanced.optimizeLevel, preset.gifOptimizeLevel, 1, 3));
  const colors = advanced.colors ? Math.round(pickNumber(advanced.colors, 256, 2, 256)) : null;

  progressCb(15, 'Otimizando GIF...');

  const args = [job.inputPath, `-O${optimizeLevel}`, `--lossy=${lossy}`];
  if (colors) {
    args.push(`--colors=${colors}`);
  }
  args.push('--careful');
  args.push('-o', outputPath);

  await runCommand(gifsicleBinary, args);

  // Protecao contra saidas quebradas (ex.: GIF reduzido para um quadrado preto)
  const [inMeta, outMeta, inStat, outStat] = await Promise.all([
    getMediaDimensions(job.inputPath),
    getMediaDimensions(outputPath),
    fs.promises.stat(job.inputPath),
    fs.promises.stat(outputPath),
  ]);

  const suspiciousBySize = inStat.size > 50_000 && outStat.size < 2_000;
  const suspiciousByDimensions =
    inMeta &&
    outMeta &&
    (outMeta.width <= Math.max(16, Math.floor(inMeta.width * 0.25)) ||
      outMeta.height <= Math.max(16, Math.floor(inMeta.height * 0.25)));

  if (suspiciousBySize || suspiciousByDimensions) {
    progressCb(70, 'Resultado suspeito, aplicando modo seguro...');
    await fallbackOptimizeGifWithFfmpeg(job, outputPath);
  }

  progressCb(95, 'Finalizando GIF...');
}

async function optimizePng(job, outputPath, progressCb) {
  const preset = PRESET_VALUES[job.preset];
  const advanced = parseAdvanced(job.advanced);

  const quality = Math.round(pickNumber(advanced.quality, preset.pngQuality, 20, 100));
  const compressionLevel = Math.round(pickNumber(advanced.compressionLevel, preset.pngCompressionLevel, 0, 9));

  progressCb(15, 'Otimizando PNG...');

  await sharp(job.inputPath)
    .png({
      quality,
      compressionLevel,
      palette: true,
      effort: 8,
    })
    .toFile(outputPath);

  progressCb(95, 'Finalizando PNG...');
}

async function optimizeJpeg(job, outputPath, progressCb) {
  const preset = PRESET_VALUES[job.preset];
  const advanced = parseAdvanced(job.advanced);
  const quality = Math.round(pickNumber(advanced.quality, preset.jpegQuality, 20, 100));

  progressCb(15, 'Otimizando JPEG...');

  await sharp(job.inputPath)
    .jpeg({
      quality,
      mozjpeg: true,
      progressive: true,
    })
    .toFile(outputPath);

  progressCb(95, 'Finalizando JPEG...');
}

async function convertMp4ToGif(job, outputPath, progressCb) {
  const preset = PRESET_VALUES[job.preset];
  const advanced = parseAdvanced(job.advanced);
  const fps = pickNumber(advanced.fps, preset.mp4ToGifFps, 5, 30);
  const width = Math.round(pickNumber(advanced.width, preset.mp4ToGifWidth, 240, 1280));
  const palettePath = `${outputPath}.palette.png`;

  const paletteFilter = `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`;
  const gifFilter = `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse`;

  progressCb(15, 'Gerando paleta...');
  await runCommand('ffmpeg', ['-y', '-i', job.inputPath, '-vf', paletteFilter, palettePath]);

  progressCb(60, 'Convertendo para GIF...');
  await runCommand('ffmpeg', ['-y', '-i', job.inputPath, '-i', palettePath, '-lavfi', gifFilter, outputPath]);

  await fs.promises.rm(palettePath, { force: true });
  progressCb(95, 'Finalizando GIF...');
}

async function convertGifToMp4(job, outputPath, progressCb) {
  const preset = PRESET_VALUES[job.preset];
  const advanced = parseAdvanced(job.advanced);
  const crf = Math.round(pickNumber(advanced.crf, preset.mp4Crf, 18, 38));

  progressCb(20, 'Convertendo GIF para MP4...');
  await runCommand('ffmpeg', [
    '-y',
    '-i',
    job.inputPath,
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-an',
    '-c:v',
    'libx264',
    '-crf',
    String(crf),
    outputPath,
  ]);
  progressCb(95, 'Finalizando MP4...');
}

async function optimizeMp4(job, outputPath, progressCb) {
  const preset = PRESET_VALUES[job.preset];
  const advanced = parseAdvanced(job.advanced);
  const crf = Math.round(pickNumber(advanced.crf, preset.mp4Crf, 18, 38));
  const audioBitrate = String(advanced.audioBitrate || '128k');

  progressCb(20, 'Otimizando MP4...');
  await runCommand('ffmpeg', [
    '-y',
    '-i',
    job.inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    String(crf),
    '-c:a',
    'aac',
    '-b:a',
    audioBitrate,
    '-movflags',
    '+faststart',
    outputPath,
  ]);
  progressCb(95, 'Finalizando MP4...');
}

async function convertOggToMp3(job, outputPath, progressCb) {
  const advanced = parseAdvanced(job.advanced);
  const audioBitrate = String(advanced.audioBitrate || '192k');

  progressCb(20, 'Convertendo OGG para MP3...');
  await runCommand('ffmpeg', [
    '-y',
    '-i',
    job.inputPath,
    '-vn',
    '-c:a',
    'libmp3lame',
    '-b:a',
    audioBitrate,
    outputPath,
  ]);
  progressCb(95, 'Finalizando MP3...');
}

async function createZipArchive(sourceDir, zipPath) {
  try {
    await runCommand('tar', ['-a', '-c', '-f', zipPath, '-C', sourceDir, '.']);
    return;
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error;
    }
  }

  const escapedSource = sourceDir.replace(/'/g, "''");
  const escapedZip = zipPath.replace(/'/g, "''");
  await runCommand('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Compress-Archive -Path '${escapedSource}\\*' -DestinationPath '${escapedZip}' -Force`,
  ]);
}

async function convertMp4ToMp3Segmented(job, outputDir, progressCb) {
  const advanced = parseAdvanced(job.advanced);
  const segmentMinutes = pickNumber(
    advanced.segmentMinutes,
    mediaConfig.defaultSegmentMinutes,
    1,
    720,
  );
  const segmentSeconds = Math.round(segmentMinutes * 60);
  const audioBitrate = String(advanced.audioBitrate || '192k');
  const baseName = sanitizeName(path.parse(job.inputName).name || 'output');
  const partsDir = path.join(outputDir, `${job.id}-parts`);
  const partPattern = path.join(partsDir, `${baseName}_part%02d.mp3`);

  await fs.promises.mkdir(partsDir, { recursive: true });

  progressCb(20, `Convertendo MP4 para MP3 em partes de ${segmentMinutes} min...`);
  await runCommand('ffmpeg', [
    '-y',
    '-i',
    job.inputPath,
    '-vn',
    '-c:a',
    'libmp3lame',
    '-b:a',
    audioBitrate,
    '-f',
    'segment',
    '-segment_time',
    String(segmentSeconds),
    '-segment_start_number',
    '1',
    '-reset_timestamps',
    '1',
    partPattern,
  ]);

  const partFiles = (await fs.promises.readdir(partsDir))
    .filter((file) => file.toLowerCase().endsWith('.mp3'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (partFiles.length === 0) {
    throw new Error('Falha ao segmentar MP3: nenhuma parte gerada.');
  }

  if (partFiles.length === 1) {
    const outputName = partFiles[0];
    const outputPath = path.join(outputDir, `${job.id}-${outputName}`);
    await fs.promises.rename(path.join(partsDir, partFiles[0]), outputPath);
    await fs.promises.rm(partsDir, { recursive: true, force: true });
    progressCb(95, 'Finalizando MP3...');
    return { outputPath, outputName };
  }

  progressCb(80, 'Compactando partes MP3...');
  const outputName = `${baseName}-parts.zip`;
  const outputPath = path.join(outputDir, `${job.id}-${outputName}`);
  await createZipArchive(partsDir, outputPath);
  await fs.promises.rm(partsDir, { recursive: true, force: true });
  progressCb(95, 'Finalizando pacote MP3...');
  return { outputPath, outputName };
}

function buildOutputName(inputName, ext) {
  const base = sanitizeName(path.parse(inputName).name || 'media');
  return `${base}-processed.${ext}`;
}

async function processMediaJob(job, outputDir, progressCb) {
  if (!OPERATION_SET.has(job.operation)) {
    throw new Error('Operacao de midia invalida.');
  }

  if (!PRESET_SET.has(job.preset)) {
    throw new Error('Preset invalido.');
  }

  await fs.promises.mkdir(outputDir, { recursive: true });

  let outputName = '';
  let outputPath = '';
  if (job.operation === 'mp4-to-mp3-segmented') {
    outputName = `${sanitizeName(path.parse(job.inputName).name || 'output')}-parts.zip`;
    outputPath = path.join(outputDir, `${job.id}-${outputName}`);
  } else {
    let ext = 'bin';
    if (job.operation === 'optimize-gif' || job.operation === 'mp4-to-gif') ext = 'gif';
    if (job.operation === 'optimize-png') ext = 'png';
    if (job.operation === 'optimize-jpeg') ext = 'jpg';
    if (job.operation === 'ogg-to-mp3') ext = 'mp3';
    if (job.operation === 'gif-to-mp4' || job.operation === 'optimize-mp4') ext = 'mp4';
    outputName = buildOutputName(job.inputName, ext);
    outputPath = path.join(outputDir, `${job.id}-${outputName}`);
  }

  progressCb(5, 'Iniciando processamento...');

  if (job.operation === 'optimize-gif') {
    await optimizeGif(job, outputPath, progressCb);
  } else if (job.operation === 'optimize-png') {
    await optimizePng(job, outputPath, progressCb);
  } else if (job.operation === 'optimize-jpeg') {
    await optimizeJpeg(job, outputPath, progressCb);
  } else if (job.operation === 'mp4-to-gif') {
    await convertMp4ToGif(job, outputPath, progressCb);
  } else if (job.operation === 'gif-to-mp4') {
    await convertGifToMp4(job, outputPath, progressCb);
  } else if (job.operation === 'optimize-mp4') {
    await optimizeMp4(job, outputPath, progressCb);
  } else if (job.operation === 'mp4-to-mp3-segmented') {
    const segmented = await convertMp4ToMp3Segmented(job, outputDir, progressCb);
    outputName = segmented.outputName;
    outputPath = segmented.outputPath;
  } else if (job.operation === 'ogg-to-mp3') {
    await convertOggToMp3(job, outputPath, progressCb);
  }

  progressCb(100, 'Concluido');

  const [inputStat, outputStat] = await Promise.all([
    fs.promises.stat(job.inputPath),
    fs.promises.stat(outputPath),
  ]);

  return {
    outputPath,
    outputName,
    sizeIn: inputStat.size,
    sizeOut: outputStat.size,
  };
}

module.exports = {
  OPERATION_SET,
  PRESET_SET,
  processMediaJob,
};
