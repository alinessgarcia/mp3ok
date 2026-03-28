const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns/promises');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { thumbnailConfig } = require('./thumbnailConfig');

const THUMB_OPERATION_SET = new Set(['thumbnail']);
const THUMB_PRESET_SET = new Set(['16x9', '1x1', '9x16']);

const THUMB_PRESETS = {
  '16x9': { width: 1280, height: 720 },
  '1x1': { width: 1080, height: 1080 },
  '9x16': { width: 1080, height: 1920 },
};

function sanitizeName(input) {
  return String(input || 'thumbnail')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
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

function resolveDriveFileUrl(rawUrl) {
  const driveMatch = rawUrl.pathname.match(/^\/file\/d\/([^/]+)/);
  if (driveMatch) {
    const fileId = driveMatch[1];
    return {
      resolvedUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
      suggestedName: `drive-${fileId}`,
    };
  }

  if (rawUrl.pathname.includes('/drive/folders/') || rawUrl.pathname.includes('/folders/')) {
    throw new Error('MVP suporta apenas link de arquivo do Google Drive.');
  }

  if (rawUrl.pathname === '/uc' && rawUrl.searchParams.get('id')) {
    const fileId = rawUrl.searchParams.get('id');
    return {
      resolvedUrl: rawUrl.toString(),
      suggestedName: `drive-${fileId}`,
    };
  }

  return null;
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  return false;
}

function isPrivateIPv4(address) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isPrivateIPv6(address) {
  const value = address.toLowerCase();
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) {
    return true;
  }
  return false;
}

async function assertSafeRemoteUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('URL invalida para thumbnail.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Somente URLs HTTP/HTTPS sao aceitas.');
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('Hostname nao permitido para importacao remota.');
  }

  const resolvedDrive = parsed.hostname.toLowerCase() === 'drive.google.com' ? resolveDriveFileUrl(parsed) : null;
  const normalized = resolvedDrive
    ? { url: resolvedDrive.resolvedUrl, name: resolvedDrive.suggestedName }
    : { url: parsed.toString(), name: path.basename(parsed.pathname) || 'remote-media' };

  const normalizedUrl = new URL(normalized.url);
  const addresses = await dns.lookup(normalizedUrl.hostname, { all: true });
  for (const address of addresses) {
    const ip = address.address;
    if (ip.includes(':')) {
      if (isPrivateIPv6(ip)) {
        throw new Error('Endereco IP privado nao permitido para importacao remota.');
      }
    } else if (isPrivateIPv4(ip)) {
      throw new Error('Endereco IP privado nao permitido para importacao remota.');
    }
  }

  return normalized;
}

function extensionFromUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    const ext = path.extname(parsed.pathname || '').replace('.', '').toLowerCase();
    if (!ext) return 'bin';
    return ext.slice(0, 10);
  } catch {
    return 'bin';
  }
}

async function downloadRemoteSource(sourceUrl) {
  const normalized = await assertSafeRemoteUrl(sourceUrl);
  const ext = extensionFromUrl(normalized.url);
  const tempPath = path.join(
    thumbnailConfig.uploadDir,
    `thumb-url-${Date.now()}-${randomUUID()}.${ext}`,
  );

  await fs.promises.mkdir(thumbnailConfig.uploadDir, { recursive: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), thumbnailConfig.remoteTimeoutMs);

  let response;
  try {
    response = await fetch(normalized.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error && error.name === 'AbortError') {
      throw new Error('Timeout ao baixar URL remota.');
    }
    throw new Error('Falha ao baixar URL remota.');
  }

  if (!response.ok || !response.body) {
    clearTimeout(timer);
    throw new Error(`Falha ao baixar URL remota (HTTP ${response.status}).`);
  }

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength && declaredLength > thumbnailConfig.remoteMaxBytes) {
    clearTimeout(timer);
    throw new Error('Arquivo remoto excede o tamanho maximo permitido para thumbnail.');
  }

  const fileHandle = await fs.promises.open(tempPath, 'w');
  try {
    const reader = response.body.getReader();
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > thumbnailConfig.remoteMaxBytes) {
        await reader.cancel();
        throw new Error('Arquivo remoto excede o tamanho maximo permitido para thumbnail.');
      }
      await fileHandle.write(chunk);
    }
  } finally {
    clearTimeout(timer);
    await fileHandle.close();
  }

  return {
    inputPath: tempPath,
    inputName: sanitizeName(normalized.name || `remote-${Date.now()}`),
  };
}

async function probeDurationSeconds(inputPath) {
  try {
    const { stdout } = await runCommand('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ]);
    const n = Number((stdout || '').trim());
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
    return 0;
  } catch {
    return 0;
  }
}

async function extractMiddleFrameToJpeg(inputPath, outputFramePath) {
  const duration = await probeDurationSeconds(inputPath);
  const second = duration > 0 ? Math.max(0, duration / 2) : 0;

  const args = ['-y'];
  if (second > 0) {
    args.push('-ss', second.toFixed(3));
  }
  args.push('-i', inputPath, '-frames:v', '1', outputFramePath);

  await runCommand('ffmpeg', args);
}

function buildOutputName(inputName, presetKey) {
  const base = sanitizeName(path.parse(inputName || 'thumbnail').name || 'thumbnail');
  const preset = THUMB_PRESETS[presetKey];
  return `${base}-thumb-${preset.width}x${preset.height}.jpg`;
}

async function processThumbnailJob(job, outputDir, progressCb) {
  if (!THUMB_OPERATION_SET.has(job.operation)) {
    throw new Error('Operacao de thumbnail invalida.');
  }
  if (!THUMB_PRESET_SET.has(job.preset)) {
    throw new Error('Preset de thumbnail invalido.');
  }

  await fs.promises.mkdir(outputDir, { recursive: true });
  progressCb(5, 'Preparando thumbnail...');

  let inputPath = job.inputPath || null;
  let inputName = job.inputName || 'thumbnail';

  if (!inputPath && job.sourceUrl) {
    progressCb(15, 'Baixando URL remota...');
    const downloaded = await downloadRemoteSource(job.sourceUrl);
    inputPath = downloaded.inputPath;
    inputName = downloaded.inputName;
    job.inputPath = inputPath;
    job.inputName = inputName;
  }

  if (!inputPath) {
    throw new Error('Origem invalida para thumbnail.');
  }

  const preset = THUMB_PRESETS[job.preset];
  const outputName = buildOutputName(inputName, job.preset);
  const outputPath = path.join(outputDir, `${job.id}-${outputName}`);
  const tempFramePath = path.join(outputDir, `${job.id}-frame.jpg`);

  let staticImageHandled = false;

  try {
    const metadata = await sharp(inputPath, { animated: true }).metadata();
    const isAnimatedGif = metadata.format === 'gif' && (metadata.pages || 1) > 1;
    const isStaticImage = !isAnimatedGif && Boolean(metadata.width) && Boolean(metadata.height);

    if (isStaticImage) {
      progressCb(45, 'Gerando thumbnail da imagem...');
      await sharp(inputPath)
        .resize(preset.width, preset.height, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(outputPath);
      staticImageHandled = true;
    }
  } catch {
    staticImageHandled = false;
  }

  if (!staticImageHandled) {
    progressCb(45, 'Extraindo frame central...');
    try {
      await extractMiddleFrameToJpeg(inputPath, tempFramePath);
      await sharp(tempFramePath)
        .resize(preset.width, preset.height, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(outputPath);
    } catch {
      throw new Error('Midia nao suportada para gerar thumbnail.');
    } finally {
      await fs.promises.rm(tempFramePath, { force: true });
    }
  }

  progressCb(95, 'Finalizando thumbnail...');

  const [inputStat, outputStat] = await Promise.all([
    fs.promises.stat(inputPath),
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
  THUMB_OPERATION_SET,
  THUMB_PRESET_SET,
  processThumbnailJob,
};

