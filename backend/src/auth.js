const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;

function getAuthRequiredFlag() {
  const raw = String(process.env.AUTH_REQUIRED || '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function getSupabaseAdminClient() {
  if (cachedClient) return cachedClient;

  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!url || !serviceRole) {
    return null;
  }

  cachedClient = createClient(url, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}

function getAccessToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const queryToken = req.query?.access_token;
  if (typeof queryToken === 'string' && queryToken.trim().length > 0) {
    return queryToken.trim();
  }

  return '';
}

function shouldBypassAuth(req) {
  if (req.path === '/health') {
    return true;
  }

  // Keep GitHub keepalive/news refresh working with shared secret token.
  if (req.method === 'POST' && req.path === '/news/refresh') {
    const expectedToken = String(process.env.NEWS_REFRESH_TOKEN || '').trim();
    if (!expectedToken) {
      return false;
    }

    const headerToken = String(req.headers['x-news-token'] || '').trim();
    const bodyToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    return headerToken === expectedToken || bodyToken === expectedToken;
  }

  return false;
}

async function authenticateApiRequest(req, res, next) {
  if (!getAuthRequiredFlag() || shouldBypassAuth(req)) {
    return next();
  }

  const token = getAccessToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Autenticacao obrigatoria. Faca login para continuar.' });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return res.status(503).json({
      error: 'Autenticacao nao configurada no servidor (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).',
    });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Sessao invalida ou expirada. Faca login novamente.' });
  }

  req.authUser = data.user;
  return next();
}

module.exports = {
  authenticateApiRequest,
};
