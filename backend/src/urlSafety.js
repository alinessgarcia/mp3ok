const dns = require('node:dns/promises');
const net = require('node:net');

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
}

function isPrivateIPv4(address) {
  const parts = String(address || '')
    .split('.')
    .map((part) => Number(part));

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
  const value = String(address || '').toLowerCase();
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) {
    return true;
  }
  return false;
}

function isPublicHostAddress(address) {
  if (!address) {
    return false;
  }

  if (address.includes(':')) {
    return !isPrivateIPv6(address);
  }

  return !isPrivateIPv4(address);
}

function isYoutubeHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
}

function stripYoutubePlaylistParams(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (!isYoutubeHostname(parsed.hostname)) {
      return parsed.toString();
    }

    parsed.searchParams.delete('list');
    parsed.searchParams.delete('index');
    parsed.searchParams.delete('start_radio');
    parsed.searchParams.delete('pp');
    parsed.searchParams.delete('feature');
    parsed.searchParams.delete('si');
    return parsed.toString();
  } catch {
    return String(rawUrl || '');
  }
}

function sanitizePublicHttpUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }

    if (isPrivateHostname(parsed.hostname)) {
      return '';
    }

    if (net.isIP(parsed.hostname) && !isPublicHostAddress(parsed.hostname)) {
      return '';
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

async function assertPublicHttpUrl(rawUrl, label = 'URL') {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error(`${label} invalida.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} deve usar HTTP ou HTTPS.`);
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`${label} aponta para host privado e foi bloqueada.`);
  }

  if (net.isIP(parsed.hostname) && !isPublicHostAddress(parsed.hostname)) {
    throw new Error(`${label} aponta para endereco IP privado e foi bloqueada.`);
  }

  try {
    const resolved = await dns.lookup(parsed.hostname, { all: true });
    for (const entry of resolved || []) {
      if (!isPublicHostAddress(entry.address)) {
        throw new Error(`${label} resolve para endereco privado e foi bloqueada.`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('bloqueada')) {
      throw error;
    }
    throw new Error(`${label} nao pode ser resolvida com seguranca.`);
  }

  return parsed;
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

module.exports = {
  assertPublicHttpUrl,
  isPrivateHostname,
  isPrivateIPv4,
  isPrivateIPv6,
  isPublicHostAddress,
  isUuidLike,
  isYoutubeHostname,
  sanitizePublicHttpUrl,
  stripYoutubePlaylistParams,
};
