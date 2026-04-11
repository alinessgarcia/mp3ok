const crypto = require('node:crypto');
const Parser = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');
const { sanitizePublicHttpUrl } = require('./urlSafety');

const parser = new Parser({
  timeout: Number(process.env.NEWS_FETCH_TIMEOUT_MS || 20_000),
});

const DEFAULT_FEEDS = [
  // International AI news
  { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/' },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
  { name: 'AI News', url: 'https://artificialintelligence-news.com/feed/' },
  // Brazilian AI & tech
  { name: 'Olhar Digital IA', url: 'https://olhardigital.com.br/editoria/inteligencia-artificial/feed' },
  { name: 'Canaltech IA', url: 'https://canaltech.com.br/inteligencia-artificial/rss' },
  { name: 'Tecmundo Tech', url: 'https://rss.tecmundo.com.br/feed' },
];

const DEFAULT_KEYWORDS = [
  // AI models & companies
  'chatgpt',
  'gpt-4',
  'gpt-5',
  'gpt-4o',
  'openai',
  'gemini',
  'claude',
  'anthropic',
  'mistral',
  'llama',
  'deepseek',
  'qwen',
  'grok',
  'perplexity',
  'sora',
  'dall-e',
  'midjourney',
  'stable diffusion',
  'flux',
  // Generic AI terms (PT + EN)
  'inteligencia artificial',
  'artificial intelligence',
  'machine learning',
  'deep learning',
  'large language model',
  'llm',
  'modelo de linguagem',
  'ia generativa',
  'generative ai',
  'multimodal',
  'agent',
  'agente',
  'reasoning',
  // Ecosystem & infra
  'nvidia',
  'google deepmind',
  'sam altman',
  'openai o3',
  'openai o4',
  // Pricing & features relevant to users
  'gratis',
  'gratuito',
  'free tier',
  'preco',
  'promo',
  'desconto',
  'api',
  'token',
  'subscription',
  'assinatura',
  // News categories
  'benchmark',
  'release',
  'lancamento',
  'novidade',
  'atualizacao',
  'update',
  'vazamento',
  'leak',
];

const NEWS_TABLE = process.env.NEWS_TABLE || 'music_news'; // set NEWS_TABLE=ai_news in Render env after creating the new table in Supabase
const HEARTBEAT_TABLE = process.env.NEWS_HEARTBEAT_TABLE || 'collector_heartbeat';
const HEARTBEAT_KEY = process.env.NEWS_HEARTBEAT_KEY || 'ai_news';
const MAX_ITEMS_PER_FEED = Math.max(1, Number(process.env.NEWS_MAX_ITEMS_PER_FEED || 25));
const REFRESH_MIN_INTERVAL_MS = Math.max(30_000, Number(process.env.NEWS_MIN_REFRESH_MS || 15 * 60 * 1000));

let memoryNews = [];
let memoryStatus = {
  mode: 'memory',
  lastRefreshAt: null,
  totalFetched: 0,
  matched: 0,
  upserted: 0,
  feedErrors: [],
};
let lastRefreshStart = 0;
let inflightRefresh = null;

function parseFeeds() {
  const raw = String(process.env.NEWS_FEEDS || '').trim();
  if (!raw) {
    return DEFAULT_FEEDS;
  }
  const feeds = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const url = sanitizePublicHttpUrl(entry);
      return url ? { name: entry, url } : null;
    })
    .filter(Boolean);
  return feeds.length ? feeds : DEFAULT_FEEDS;
}

function parseKeywords() {
  const raw = String(process.env.NEWS_KEYWORDS || '').trim();
  if (!raw) {
    return DEFAULT_KEYWORDS;
  }
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function cleanSummary(text) {
  const plain = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.slice(0, 560);
}

function normalizeExternalUrl(url) {
  return sanitizePublicHttpUrl(url);
}

function pickImage(item) {
  if (Array.isArray(item?.enclosure) && item.enclosure[0]?.url) {
    return normalizeExternalUrl(item.enclosure[0].url);
  }
  if (item?.enclosure?.url) {
    return normalizeExternalUrl(item.enclosure.url);
  }
  if (item?.itunes?.image) {
    return normalizeExternalUrl(item.itunes.image);
  }
  if (item?.image?.url) {
    return normalizeExternalUrl(item.image.url);
  }
  if (item?.thumbnail) {
    return normalizeExternalUrl(item.thumbnail);
  }
  if (item?.['media:content']?.$?.url) {
    return normalizeExternalUrl(item['media:content'].$.url);
  }
  return '';
}

function toIsoDate(input) {
  const date = new Date(input || Date.now());
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function buildArticle(feedName, item, keywords) {
  const link = normalizeExternalUrl(item?.link || item?.guid || item?.id);
  const title = String(item?.title || '').trim();
  if (!link || !title) {
    return null;
  }

  const summary = cleanSummary(item?.contentSnippet || item?.content || item?.summary || '');
  const haystack = normalizeText(`${title} ${summary}`);
  const hits = keywords.filter((keyword) => haystack.includes(keyword));

  if (hits.length === 0) {
    return null;
  }

  return {
    source_url: link,
    source_name: feedName,
    title: title.slice(0, 220),
    summary,
    image_url: pickImage(item),
    published_at: toIsoDate(item?.isoDate || item?.pubDate),
    tags: hits.join(', '),
    score: Math.min(100, hits.length * 20),
  };
}

function dedupeByUrl(items) {
  const seen = new Set();
  const output = [];
  items.forEach((item) => {
    const key = item.source_url;
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(item);
  });
  return output;
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function loadFeedArticles(feed, keywords) {
  const parsed = await parser.parseURL(feed.url);
  const entries = Array.isArray(parsed?.items) ? parsed.items.slice(0, MAX_ITEMS_PER_FEED) : [];
  return entries
    .map((item) => buildArticle(feed.name, item, keywords))
    .filter(Boolean);
}

async function collectNews() {
  const feeds = parseFeeds();
  const keywords = parseKeywords();
  const feedErrors = [];
  const collected = [];
  let fetchedCount = 0;

  // Process feeds sequentially to avoid bursting requests.
  // eslint-disable-next-line no-restricted-syntax
  for (const feed of feeds) {
    try {
      const articles = await loadFeedArticles(feed, keywords);
      fetchedCount += articles.length;
      collected.push(...articles);
    } catch (error) {
      feedErrors.push({
        feed: feed.name,
        url: feed.url,
        error: error instanceof Error ? error.message : 'Falha ao carregar feed',
      });
    }
  }

  return {
    collected: dedupeByUrl(collected),
    feedErrors,
    fetchedCount,
    feedsUsed: feeds.length,
  };
}

async function writeHeartbeat(client, payload) {
  if (!client) return;
  try {
    await client.from(HEARTBEAT_TABLE).upsert(
      {
        key: HEARTBEAT_KEY,
        last_seen_at: new Date().toISOString(),
        status: payload.status || 'ok',
        meta_json: payload,
      },
      { onConflict: 'key' },
    );
  } catch {
    // Ignore heartbeat write errors to avoid breaking refresh flow.
  }
}

async function refreshNews({ force = false } = {}) {
  if (inflightRefresh) {
    return inflightRefresh;
  }

  const now = Date.now();
  if (!force && now - lastRefreshStart < REFRESH_MIN_INTERVAL_MS && memoryStatus.lastRefreshAt) {
    return memoryStatus;
  }

  lastRefreshStart = now;
  inflightRefresh = (async () => {
    const client = getSupabaseClient();
    const mode = client ? 'supabase' : 'memory';
    const report = {
      mode,
      lastRefreshAt: new Date().toISOString(),
      totalFetched: 0,
      matched: 0,
      upserted: 0,
      feedErrors: [],
    };

    try {
      const { collected, feedErrors, fetchedCount } = await collectNews();
      report.totalFetched = fetchedCount;
      report.matched = collected.length;
      report.feedErrors = feedErrors;

      if (mode === 'supabase' && collected.length > 0) {
        const { error } = await client
          .from(NEWS_TABLE)
          .upsert(collected, { onConflict: 'source_url', ignoreDuplicates: false });
        if (error) {
          throw new Error(`Supabase upsert falhou: ${error.message}`);
        }
        report.upserted = collected.length;
      } else {
        memoryNews = collected.slice(0, 200);
        report.upserted = memoryNews.length;
      }

      await writeHeartbeat(client, {
        status: 'ok',
        report,
        hash: crypto.createHash('sha1').update(JSON.stringify(report)).digest('hex').slice(0, 12),
      });
      memoryStatus = report;
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao coletar noticias';
      const failed = {
        ...report,
        status: 'error',
        error: message,
      };
      memoryStatus = failed;
      await writeHeartbeat(client, failed);
      return failed;
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
}

async function listNews(limit = 20) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 20)));
  const client = getSupabaseClient();

  if (client) {
    const { data, error } = await client
      .from(NEWS_TABLE)
      .select('source_url, source_name, title, summary, image_url, published_at, tags, score, created_at')
      .order('published_at', { ascending: false })
      .limit(safeLimit);
    if (!error && Array.isArray(data)) {
      return data;
    }
  }

  return memoryNews.slice(0, safeLimit);
}

async function getNewsStatus() {
  const client = getSupabaseClient();
  if (!client) {
    return memoryStatus;
  }

  try {
    const { data } = await client
      .from(HEARTBEAT_TABLE)
      .select('last_seen_at, status, meta_json')
      .eq('key', HEARTBEAT_KEY)
      .single();
    if (!data) {
      return memoryStatus;
    }
    return {
      ...(data.meta_json || {}),
      lastSeenAt: data.last_seen_at,
      status: data.status,
    };
  } catch {
    return memoryStatus;
  }
}

module.exports = {
  refreshNews,
  listNews,
  getNewsStatus,
};
