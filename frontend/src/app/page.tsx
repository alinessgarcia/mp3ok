'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';

type DownloadStatus = 'downloading' | 'completed' | 'error';
type MediaStatus = 'queued' | 'processing' | 'completed' | 'failed';
type MediaOperation =
  | 'optimize-gif'
  | 'optimize-png'
  | 'optimize-jpeg'
  | 'mp4-to-gif'
  | 'gif-to-mp4'
  | 'optimize-mp4'
  | 'mp4-to-mp3-segmented'
  | 'ogg-to-mp3';
type Preset = 'light' | 'balanced' | 'aggressive';
type ThumbnailPreset = '16x9' | '1x1' | '9x16';

type VideoEntry = {
  id: string;
  title: string;
  thumbnail?: string;
  duration: number;
  url: string;
};

type VideoInfo = {
  title: string;
  thumbnail?: string;
  duration: number;
  isPlaylist?: boolean;
  entryCount?: number;
  entries?: VideoEntry[];
};

type UrlTask = {
  id: string;
  title: string;
  thumbnail?: string;
  progress: number;
  size: string;
  status: DownloadStatus;
};

type MediaJob = {
  id: string;
  status: MediaStatus;
  progress: number;
  progressLabel: string;
  operation: MediaOperation;
  preset: Preset;
  inputName: string;
  outputName: string | null;
  sizeIn: number | null;
  sizeOut: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

type ThumbnailJob = {
  id: string;
  status: MediaStatus;
  progress: number;
  progressLabel: string;
  operation: 'thumbnail';
  preset: ThumbnailPreset;
  inputName: string;
  outputName: string | null;
  sizeIn: number | null;
  sizeOut: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

type NewsItem = {
  source_url: string;
  source_name: string;
  title: string;
  summary: string;
  image_url?: string;
  published_at?: string;
  tags?: string;
  score?: number;
};

type PromoSlide = {
  eyebrow: string;
  title: string;
  description: string;
  meta: string;
  accent: string;
  imageUrl: string;
};

const PROMO_SLIDES: PromoSlide[] = [
  {
    eyebrow: 'Restaurante',
    title: 'Cantina Bela Mesa - buffet executivo e delivery',
    description: 'Almoco rapido para equipes e janta especial com reservas online.',
    meta: 'Centro · 11h as 23h',
    accent: 'from-[#163f85] via-[#1f5db0] to-[#79b6ff]',
    imageUrl: 'https://loremflickr.com/1600/900/restaurant,food',
  },
  {
    eyebrow: 'Casa de tintas',
    title: 'Tintas Horizonte - linha premium e industrial',
    description: 'Catalogo completo de cores, texturas e consultoria para pintura residencial.',
    meta: 'Entrega em 24h',
    accent: 'from-[#0f2a56] via-[#214b95] to-[#7ee0ff]',
    imageUrl: 'https://loremflickr.com/1600/900/paint,wall',
  },
  {
    eyebrow: 'Construcao',
    title: 'Constrular Materiais - cimento, ferro e acabamento',
    description: 'Tudo para obra do alicerce ao acabamento com condicoes para profissionais.',
    meta: 'Atacado e varejo',
    accent: 'from-[#132f63] via-[#294f9c] to-[#9ce8ff]',
    imageUrl: 'https://loremflickr.com/1600/900/construction,building',
  },
  {
    eyebrow: 'Automoveis',
    title: 'Vila Motors - seminovos revisados e financiamento',
    description: 'Loja especializada em carros urbanos, SUVs e utilitarios com garantia.',
    meta: 'Test drive diario',
    accent: 'from-[#1a3f74] via-[#2f5db1] to-[#86c0ff]',
    imageUrl: 'https://loremflickr.com/1600/900/car,dealership',
  },
  {
    eyebrow: 'Contabilidade',
    title: 'Fiscal Prime - abertura de empresa e BPO financeiro',
    description: 'Contabilidade digital para MEI, LTDA e e-commerce com suporte consultivo.',
    meta: 'Plano mensal flexivel',
    accent: 'from-[#0f2b5a] via-[#2a5db0] to-[#6fd8ff]',
    imageUrl: 'https://loremflickr.com/1600/900/accounting,office',
  },
  {
    eyebrow: 'Saude',
    title: 'Clinica Movimento - fisioterapia e reabilitacao',
    description: 'Atendimento ortopedico e pos-cirurgico com protocolo personalizado.',
    meta: 'Equipe especializada',
    accent: 'from-[#16386b] via-[#2861b7] to-[#78dfff]',
    imageUrl: 'https://loremflickr.com/1600/900/physiotherapy,clinic',
  },
  {
    eyebrow: 'Academia',
    title: 'PowerFit Studio - treino funcional e musculacao',
    description: 'Planos para iniciantes e avancados com avaliacao fisica e personal trainer.',
    meta: 'Primeira aula gratis',
    accent: 'from-[#14366b] via-[#2957ac] to-[#8fd1ff]',
    imageUrl: 'https://loremflickr.com/1600/900/gym,fitness',
  },
  {
    eyebrow: 'Pet shop',
    title: 'PetLar Premium - banho, tosa e clinica veterinaria',
    description: 'Cuidados completos para seu pet com atendimento agendado por aplicativo.',
    meta: 'Plantao aos sabados',
    accent: 'from-[#153265] via-[#2c56a8] to-[#8bd9ff]',
    imageUrl: 'https://loremflickr.com/1600/900/pet,dog',
  },
  {
    eyebrow: 'Moveis',
    title: 'Casa Nova Design - moveis planejados sob medida',
    description: 'Projetos para cozinhas, quartos e escritorios com equipe propria de montagem.',
    meta: 'Parcelamento facilitado',
    accent: 'from-[#13315e] via-[#3154a6] to-[#92cbff]',
    imageUrl: 'https://loremflickr.com/1600/900/furniture,interior',
  },
  {
    eyebrow: 'Tecnologia',
    title: 'NuvemPro SaaS - CRM e automacao comercial',
    description: 'Sistema para vendas e atendimento com dashboards e integracoes em tempo real.',
    meta: 'Teste gratis por 14 dias',
    accent: 'from-[#102a58] via-[#2d4f9e] to-[#7dd2ff]',
    imageUrl: 'https://loremflickr.com/1600/900/software,technology',
  },
  {
    eyebrow: 'Educacao',
    title: 'Idioma Express - ingles e espanhol para negocios',
    description: 'Aulas online e presenciais com foco em conversacao e certificacoes.',
    meta: 'Turmas noturnas',
    accent: 'from-[#17376a] via-[#3263b8] to-[#9ad8ff]',
    imageUrl: 'https://loremflickr.com/1600/900/classroom,students',
  },
  {
    eyebrow: 'Direito',
    title: 'Silva & Rocha - consultoria juridica empresarial',
    description: 'Suporte em contratos, tributario e recuperacao de credito para empresas.',
    meta: 'Atendimento nacional',
    accent: 'from-[#122d60] via-[#2e5aae] to-[#84c9ff]',
    imageUrl: 'https://loremflickr.com/1600/900/lawyer,office',
  },
];

function getApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return 'http://localhost:4000';
}

function getSupabaseConfig() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) {
    return null;
  }
  return { url, anonKey };
}

function buildAuthorizedUrl(rawUrl: string, accessToken: string) {
  if (!accessToken) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set('access_token', accessToken);
    return parsed.toString();
  } catch {
    const sep = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${sep}access_token=${encodeURIComponent(accessToken)}`;
  }
}

function formatBytes(bytes: number | null) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatNewsDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function createClientTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function guessFilenameFromHeader(contentDisposition: string | null, fallback: string) {
  const raw = String(contentDisposition || '');
  const utfMatch = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]).replace(/[/\\:*?"<>|]+/g, '_');
    } catch {
      // ignore decode errors
    }
  }
  const asciiMatch = raw.match(/filename="([^"]+)"/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1].replace(/[/\\:*?"<>|]+/g, '_');
  }
  return fallback;
}

const URL_INFO_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.NEXT_PUBLIC_URL_INFO_TIMEOUT_MS || 180_000),
);
const URL_TASK_TIMEOUT_MS = 12 * 60 * 1000;

export default function Home() {
  const apiBase = useMemo(() => getApiBase(), []);
  const supabaseConfig = useMemo(() => getSupabaseConfig(), []);
  const supabase = useMemo(() => {
    if (!supabaseConfig) {
      return null;
    }
    return createClient(supabaseConfig.url, supabaseConfig.anonKey);
  }, [supabaseConfig]);

  const [activeTab, setActiveTab] = useState<'url' | 'media' | 'thumb'>('url');
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [url, setUrl] = useState('');
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [format, setFormat] = useState<'video' | 'audio'>('video');
  const [quality, setQuality] = useState('best');
  const [playlistDownloadMode, setPlaylistDownloadMode] = useState<'all' | 'single'>('all');
  const [selectedPlaylistItemId, setSelectedPlaylistItemId] = useState('');
  const [urlTasks, setUrlTasks] = useState<UrlTask[]>([]);

  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaInputKey, setMediaInputKey] = useState(0);
  const [mediaOperation, setMediaOperation] = useState<MediaOperation>('optimize-gif');
  const [preset, setPreset] = useState<Preset>('balanced');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedCrf, setAdvancedCrf] = useState('28');
  const [advancedWidth, setAdvancedWidth] = useState('600');
  const [advancedFps, setAdvancedFps] = useState('10');
  const [advancedQuality, setAdvancedQuality] = useState('75');
  const [advancedLossy, setAdvancedLossy] = useState('60');
  const [advancedColors, setAdvancedColors] = useState('256');
  const [advancedSegmentMinutes, setAdvancedSegmentMinutes] = useState('20');

  const [mediaJobs, setMediaJobs] = useState<MediaJob[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [mediaNotice, setMediaNotice] = useState('');

  const [thumbInputMode, setThumbInputMode] = useState<'file' | 'url'>('file');
  const [thumbFiles, setThumbFiles] = useState<File[]>([]);
  const [thumbFileInputKey, setThumbFileInputKey] = useState(0);
  const [thumbUrlsText, setThumbUrlsText] = useState('');
  const [thumbPreset, setThumbPreset] = useState<ThumbnailPreset>('16x9');
  const [thumbJobs, setThumbJobs] = useState<ThumbnailJob[]>([]);
  const [selectedThumbIds, setSelectedThumbIds] = useState<Set<string>>(new Set());
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbError, setThumbError] = useState('');
  const [thumbNotice, setThumbNotice] = useState('');
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [promoIndex, setPromoIndex] = useState(0);
  const [videoInfoSourceUrl, setVideoInfoSourceUrl] = useState('');

  const urlSseRef = useRef<Map<string, EventSource>>(new Map());
  const urlTasksRef = useRef<Map<string, UrlTask>>(new Map());
  const urlDownloadQueueRef = useRef<VideoEntry[]>([]);
  const urlDownloadBusyRef = useRef(false);
  const mediaSseRef = useRef<Map<string, EventSource>>(new Map());
  const thumbSseRef = useRef<Map<string, EventSource>>(new Map());
  const autoDownloadedMediaRef = useRef<Set<string>>(new Set());
  const mediaHydratedRef = useRef(false);
  const autoDownloadedThumbRef = useRef<Set<string>>(new Set());
  const thumbHydratedRef = useRef(false);
  const infoAbortRef = useRef<AbortController | null>(null);
  const urlSearchRequestRef = useRef(0);
  const urlWatcherRef = useRef<Map<string, number>>(new Map());
  const currentUrlTaskIdRef = useRef<string | null>(null);
  const accessToken = session?.access_token || '';
  const currentPromo = PROMO_SLIDES[promoIndex % PROMO_SLIDES.length];
  const promoPreviewSlides = useMemo(() => {
    const total = PROMO_SLIDES.length;
    if (!total) return [];
    const visibleCount = Math.min(3, total);
    return Array.from({ length: visibleCount }, (_value, offset) => {
      const index = (promoIndex + offset) % total;
      return { slide: PROMO_SLIDES[index], index };
    });
  }, [promoIndex]);
  const featuredNews = newsItems[0] as NewsItem;
  const briefingNews = newsItems.slice(1, 6);

  useEffect(() => {
    const map = new Map<string, UrlTask>();
    urlTasks.forEach((task) => {
      map.set(task.id, task);
    });
    urlTasksRef.current = map;
  }, [urlTasks]);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return undefined;
    }

    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session || null);
        setAuthReady(true);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setAuthReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
      setAuthError('');
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const authFetch = useCallback(
    (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers || {});
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
      }
      return fetch(input, {
        ...init,
        headers,
      });
    },
    [accessToken],
  );

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setAuthError('Supabase nao configurado no frontend.');
      return;
    }

    setAuthLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    if (error) {
      setAuthError(error.message || 'Falha ao fazer login.');
    }
    setAuthLoading(false);
  };

  const handleLogout = async () => {
    if (!supabase) return;
    setAuthLoading(true);
    setAuthError('');
    await supabase.auth.signOut();
    setAuthLoading(false);
  };

  const fetchNews = useCallback(
    async (forceRefresh = false) => {
      if (!accessToken) {
        return;
      }
      setNewsLoading(true);
      setNewsError('');
      try {
        const suffix = forceRefresh ? '&refresh=1' : '';
        const res = await authFetch(`${apiBase}/api/news?limit=18${suffix}`, { cache: 'no-store' });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error || 'Falha ao carregar noticias');
        }
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        setNewsItems(items);
      } catch (error) {
        setNewsError(error instanceof Error ? error.message : 'Falha ao carregar noticias');
      } finally {
        setNewsLoading(false);
      }
    },
    [accessToken, apiBase, authFetch],
  );

  useEffect(() => {
    if (!accessToken) {
      setNewsItems([]);
      return;
    }
    fetchNews(false).catch(() => {});
  }, [accessToken, fetchNews]);

  useEffect(() => {
    if (!PROMO_SLIDES.length) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setPromoIndex((current) => (current + 1) % PROMO_SLIDES.length);
    }, 4200);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const normalizedUrl = url.trim();
    if (!videoInfoSourceUrl) {
      if (!normalizedUrl && loadingInfo) {
        if (infoAbortRef.current) {
          infoAbortRef.current.abort();
          infoAbortRef.current = null;
        }
        urlSearchRequestRef.current += 1;
        setLoadingInfo(false);
        setUrlError('');
        setVideoInfo(null);
        setVideoInfoSourceUrl('');
      }
      return;
    }

    if (!normalizedUrl || normalizedUrl === videoInfoSourceUrl) {
      return;
    }

    if (infoAbortRef.current) {
      infoAbortRef.current.abort();
      infoAbortRef.current = null;
    }
    urlSearchRequestRef.current += 1;
    setLoadingInfo(false);
    setUrlError('');
    setVideoInfo(null);
    setVideoInfoSourceUrl('');
  }, [loadingInfo, url, videoInfoSourceUrl]);

  useEffect(() => {
    if (!videoInfo?.isPlaylist) {
      setSelectedPlaylistItemId('');
      return;
    }

    const entries = Array.isArray(videoInfo.entries) ? videoInfo.entries : [];
    if (entries.length === 0) {
      setSelectedPlaylistItemId('');
      return;
    }

    setSelectedPlaylistItemId((current) => {
      if (current && entries.some((entry) => entry.id === current)) {
        return current;
      }
      return entries[0].id;
    });
  }, [videoInfo]);

  const fetchInfo = async () => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) return;
    if (!accessToken) {
      setUrlError('Sessao invalida. Faca login novamente.');
      return;
    }
    if (infoAbortRef.current) {
      infoAbortRef.current.abort();
      infoAbortRef.current = null;
    }

    setLoadingInfo(true);
    setUrlError('');
    setVideoInfo(null);
    const requestId = urlSearchRequestRef.current + 1;
    urlSearchRequestRef.current = requestId;
    const controller = new AbortController();
    infoAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), URL_INFO_TIMEOUT_MS);

    try {
      const res = await authFetch(`${apiBase}/api/info?url=${encodeURIComponent(normalizedUrl)}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to fetch video info');
      }
      const data = (await res.json()) as VideoInfo;
      const fallbackEntry: VideoEntry = {
        id: 'single',
        title: data?.title || 'Midia',
        thumbnail: data?.thumbnail,
        duration: Number(data?.duration || 0),
        url: normalizedUrl,
      };
      const safeEntries = Array.isArray(data?.entries) && data.entries.length > 0 ? data.entries : [fallbackEntry];
      if (urlSearchRequestRef.current !== requestId) {
        return;
      }
      setVideoInfo({
        ...data,
        entries: safeEntries,
        entryCount: Number(data?.entryCount || safeEntries.length),
        isPlaylist: Boolean(data?.isPlaylist || safeEntries.length > 1),
      });
      setVideoInfoSourceUrl(normalizedUrl);
    } catch (error) {
      if (urlSearchRequestRef.current !== requestId) {
        return;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        const seconds = Math.round(URL_INFO_TIMEOUT_MS / 1000);
        setUrlError(`Busca cancelada ou tempo de resposta excedido (${seconds}s).`);
      } else {
        setUrlError(error instanceof Error ? error.message : 'Failed to fetch video info');
      }
    } finally {
      window.clearTimeout(timeout);
      if (infoAbortRef.current === controller) {
        infoAbortRef.current = null;
      }
      if (urlSearchRequestRef.current === requestId) {
        setLoadingInfo(false);
      }
    }
  };

  const cancelInfoSearch = useCallback(() => {
    urlSearchRequestRef.current += 1;
    if (infoAbortRef.current) {
      infoAbortRef.current.abort();
      infoAbortRef.current = null;
    }
    setLoadingInfo(false);
    setUrlError('Busca cancelada.');
  }, []);

  const resetUrlSearch = useCallback(() => {
    cancelInfoSearch();
    setUrl('');
    setUrlError('');
    setVideoInfo(null);
    setVideoInfoSourceUrl('');
    setSelectedPlaylistItemId('');
  }, [cancelInfoSearch]);

  const closeUrlTaskChannel = useCallback((taskId: string) => {
    const source = urlSseRef.current.get(taskId);
    if (source) {
      source.close();
      urlSseRef.current.delete(taskId);
    }

    const watcher = urlWatcherRef.current.get(taskId);
    if (watcher != null) {
      window.clearInterval(watcher);
      urlWatcherRef.current.delete(taskId);
    }
  }, []);

  const triggerSingleDownload = useCallback((entry: VideoEntry) => {
    const targetUrl = entry?.url || url;
    if (!targetUrl) return;

    const taskId = createClientTaskId();

    setUrlTasks((prev) => [
      ...prev,
      {
        id: taskId,
        title: entry.title || 'Midia',
        thumbnail: entry.thumbnail,
        progress: 0,
        size: 'Starting...',
        status: 'downloading',
      },
    ]);

    const sse = new EventSource(buildAuthorizedUrl(`${apiBase}/api/progress?id=${taskId}`, accessToken));
    urlSseRef.current.set(taskId, sse);

    sse.onmessage = (event) => {
      const payload = JSON.parse(event.data) as {
        percentage?: number;
        size?: string;
        status?: 'downloading' | 'completed' | 'error';
        message?: string;
      };
      setUrlTasks((prev) =>
        prev.map((task) => {
          if (task.id !== taskId) return task;
          const nextStatus =
            payload.status === 'completed'
              ? 'completed'
              : payload.status === 'error'
                ? 'error'
                : task.status;
          return {
            ...task,
            progress: Number(payload.percentage || task.progress),
            size: payload.size || task.size,
            status: nextStatus,
          };
        }),
      );

      if (payload.status === 'completed' || payload.status === 'error') {
        sse.close();
        urlSseRef.current.delete(taskId);
      }
    };

    sse.onerror = () => {
      setUrlTasks((prev) =>
        prev.map((task) => {
          if (task.id !== taskId) return task;
          if (task.status === 'completed') return task;
          return { ...task, status: 'error' };
        }),
      );
      sse.close();
      urlSseRef.current.delete(taskId);
    };

    const downloadUrl = buildAuthorizedUrl(
      `${apiBase}/api/download?url=${encodeURIComponent(targetUrl)}&format=${format}&quality=${quality}&id=${taskId}&title=${encodeURIComponent(entry.title || 'download')}`,
      accessToken,
    );
    if (format === 'audio') {
      (async () => {
        try {
          const response = await fetch(downloadUrl, { cache: 'no-store' });
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.error || `Falha no download (${response.status}).`);
          }
          const blob = await response.blob();
          if (!blob || blob.size <= 0) {
            throw new Error('Arquivo de audio retornou vazio.');
          }

          const fallbackName = `${entry.title || 'download'}.mp3`;
          const filename = guessFilenameFromHeader(response.headers.get('content-disposition'), fallbackName);
          const objectUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = objectUrl;
          a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(objectUrl);
        } catch (error) {
          closeUrlTaskChannel(taskId);
          setUrlTasks((prev) =>
            prev.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    status: 'error',
                    size: error instanceof Error ? error.message : 'Falha ao baixar audio',
                  }
                : task,
            ),
          );
        }
      })();
    } else {
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    return taskId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, apiBase, closeUrlTaskChannel, format, quality, url]);

  const startDownloadQueue = useCallback(() => {
    if (urlDownloadBusyRef.current) return;
    const next = urlDownloadQueueRef.current.shift();
    if (!next) return;

    urlDownloadBusyRef.current = true;
    const taskId = triggerSingleDownload(next);
    if (!taskId) {
      urlDownloadBusyRef.current = false;
      if (urlDownloadQueueRef.current.length > 0) {
        window.setTimeout(() => startDownloadQueue(), 100);
      }
      return;
    }

    currentUrlTaskIdRef.current = taskId;
    const startedAt = Date.now();
    const watcher = window.setInterval(() => {
      const task = urlTasksRef.current.get(taskId);
      if (!task) {
        window.clearInterval(watcher);
        urlWatcherRef.current.delete(taskId);
        if (currentUrlTaskIdRef.current === taskId) {
          currentUrlTaskIdRef.current = null;
          urlDownloadBusyRef.current = false;
          if (urlDownloadQueueRef.current.length > 0) {
            window.setTimeout(() => startDownloadQueue(), 150);
          }
        }
        return;
      }

      if (Date.now() - startedAt > URL_TASK_TIMEOUT_MS) {
        setUrlTasks((prev) =>
          prev.map((item) =>
            item.id === taskId
              ? { ...item, status: 'error', size: 'Timeout: download demorou demais.' }
              : item,
          ),
        );
        closeUrlTaskChannel(taskId);
        if (currentUrlTaskIdRef.current === taskId) {
          currentUrlTaskIdRef.current = null;
          urlDownloadBusyRef.current = false;
          if (urlDownloadQueueRef.current.length > 0) {
            window.setTimeout(() => startDownloadQueue(), 150);
          }
        }
        return;
      }

      if (task.status === 'completed' || task.status === 'error') {
        window.clearInterval(watcher);
        urlWatcherRef.current.delete(taskId);
        urlDownloadBusyRef.current = false;
        if (currentUrlTaskIdRef.current === taskId) {
          currentUrlTaskIdRef.current = null;
        }
        if (urlDownloadQueueRef.current.length > 0) {
          window.setTimeout(() => startDownloadQueue(), 150);
        }
      }
    }, 300);
    urlWatcherRef.current.set(taskId, watcher);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeUrlTaskChannel, triggerSingleDownload]);

  const startDownload = () => {
    if (!videoInfo || !url) return;
    const entries = Array.isArray(videoInfo.entries) && videoInfo.entries.length
      ? videoInfo.entries
      : [
          {
            id: 'single',
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration || 0,
            url,
          },
        ];
    const selectedEntry = entries.find((entry) => entry.id === selectedPlaylistItemId) || entries[0];
    const entriesToDownload =
      videoInfo.isPlaylist && playlistDownloadMode === 'single'
        ? selectedEntry
          ? [selectedEntry]
          : entries.slice(0, 1)
        : entries;

    urlDownloadQueueRef.current = [...urlDownloadQueueRef.current, ...entriesToDownload];
    startDownloadQueue();
  };

  const removeSingleUrlTask = (id: string) => {
    closeUrlTaskChannel(id);
    setUrlTasks((prev) => prev.filter((task) => task.id !== id));

    if (currentUrlTaskIdRef.current === id) {
      currentUrlTaskIdRef.current = null;
      urlDownloadBusyRef.current = false;
      if (urlDownloadQueueRef.current.length > 0) {
        window.setTimeout(() => startDownloadQueue(), 150);
      }
    }
  };

  const clearUrlTasks = () => {
    Array.from(urlSseRef.current.keys()).forEach((id) => {
      closeUrlTaskChannel(id);
    });
    Array.from(urlWatcherRef.current.values()).forEach((watcher) => {
      window.clearInterval(watcher);
    });
    urlWatcherRef.current.clear();
    urlDownloadQueueRef.current = [];
    urlDownloadBusyRef.current = false;
    currentUrlTaskIdRef.current = null;
    setUrlTasks([]);
  };

  const removeCompletedUrlTasks = () => {
    const completedIds = urlTasks
      .filter((task) => task.status === 'completed' || task.status === 'error')
      .map((task) => task.id);
    const wasCurrentTaskRemoved =
      currentUrlTaskIdRef.current != null && completedIds.includes(currentUrlTaskIdRef.current);
    completedIds.forEach((id) => closeUrlTaskChannel(id));
    setUrlTasks((prev) => prev.filter((task) => !completedIds.includes(task.id)));
    if (wasCurrentTaskRemoved) {
      currentUrlTaskIdRef.current = null;
      urlDownloadBusyRef.current = false;
      if (urlDownloadQueueRef.current.length > 0) {
        window.setTimeout(() => startDownloadQueue(), 150);
      }
    }
  };

  const fetchMediaJobs = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    const res = await authFetch(`${apiBase}/api/media/jobs`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('Failed to load media jobs');
    }
    const data = await res.json();
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    if (!mediaHydratedRef.current) {
      jobs
        .filter((job: MediaJob) => job.status === 'completed')
        .forEach((job: MediaJob) => autoDownloadedMediaRef.current.add(job.id));
      mediaHydratedRef.current = true;
    }

    setMediaJobs(jobs);
    setSelectedMediaIds((prev) => {
      const next = new Set<string>();
      const valid = new Set(jobs.map((job: MediaJob) => job.id));
      Array.from(prev).forEach((id) => {
        if (valid.has(id)) next.add(id);
      });
      return next;
    });
  }, [accessToken, apiBase, authFetch]);

  const fetchThumbJobs = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    const res = await authFetch(`${apiBase}/api/thumbnails/jobs`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('Failed to load thumbnail jobs');
    }
    const data = await res.json();
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    if (!thumbHydratedRef.current) {
      jobs
        .filter((job: ThumbnailJob) => job.status === 'completed')
        .forEach((job: ThumbnailJob) => autoDownloadedThumbRef.current.add(job.id));
      thumbHydratedRef.current = true;
    }

    setThumbJobs(jobs);
    setSelectedThumbIds((prev) => {
      const next = new Set<string>();
      const valid = new Set(jobs.map((job: ThumbnailJob) => job.id));
      Array.from(prev).forEach((id) => {
        if (valid.has(id)) next.add(id);
      });
      return next;
    });
  }, [accessToken, apiBase, authFetch]);

  useEffect(() => {
    if (activeTab !== 'media') {
      return undefined;
    }

    fetchMediaJobs().catch(() => {});
    const timer = setInterval(() => {
      fetchMediaJobs().catch(() => {});
    }, 10_000);
    return () => clearInterval(timer);
  }, [activeTab, fetchMediaJobs]);

  useEffect(() => {
    if (activeTab !== 'thumb') {
      return undefined;
    }

    fetchThumbJobs().catch(() => {});
    const timer = setInterval(() => {
      fetchThumbJobs().catch(() => {});
    }, 10_000);
    return () => clearInterval(timer);
  }, [activeTab, fetchThumbJobs]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const activeIds = new Set(
      mediaJobs
        .filter((job) => job.status === 'queued' || job.status === 'processing')
        .map((job) => job.id),
    );

    Array.from(activeIds).forEach((jobId) => {
      if (mediaSseRef.current.has(jobId)) {
        return;
      }
      const sse = new EventSource(buildAuthorizedUrl(`${apiBase}/api/media/jobs/${jobId}/progress`, accessToken));
      mediaSseRef.current.set(jobId, sse);

      sse.onmessage = (event) => {
        const payload: MediaJob = JSON.parse(event.data);
        setMediaJobs((prev) => prev.map((job) => (job.id === payload.id ? payload : job)));
      };

      sse.onerror = () => {
        sse.close();
        mediaSseRef.current.delete(jobId);
      };
    });

    Array.from(mediaSseRef.current.entries()).forEach(([jobId, source]) => {
      if (!activeIds.has(jobId)) {
        source.close();
        mediaSseRef.current.delete(jobId);
      }
    });
  }, [accessToken, apiBase, mediaJobs]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const activeIds = new Set(
      thumbJobs
        .filter((job) => job.status === 'queued' || job.status === 'processing')
        .map((job) => job.id),
    );

    Array.from(activeIds).forEach((jobId) => {
      if (thumbSseRef.current.has(jobId)) {
        return;
      }
      const sse = new EventSource(buildAuthorizedUrl(`${apiBase}/api/thumbnails/jobs/${jobId}/progress`, accessToken));
      thumbSseRef.current.set(jobId, sse);

      sse.onmessage = (event) => {
        const payload: ThumbnailJob = JSON.parse(event.data);
        setThumbJobs((prev) => prev.map((job) => (job.id === payload.id ? payload : job)));
      };

      sse.onerror = () => {
        sse.close();
        thumbSseRef.current.delete(jobId);
      };
    });

    Array.from(thumbSseRef.current.entries()).forEach(([jobId, source]) => {
      if (!activeIds.has(jobId)) {
        source.close();
        thumbSseRef.current.delete(jobId);
      }
    });
  }, [accessToken, apiBase, thumbJobs]);

  useEffect(() => {
    const urlSources = urlSseRef.current;
    const mediaSources = mediaSseRef.current;
    const thumbSources = thumbSseRef.current;
    const urlWatchers = urlWatcherRef.current;
    return () => {
      Array.from(urlSources.values()).forEach((source) => {
        source.close();
      });
      Array.from(urlWatchers.values()).forEach((watcher) => {
        window.clearInterval(watcher);
      });
      Array.from(mediaSources.values()).forEach((source) => {
        source.close();
      });
      Array.from(thumbSources.values()).forEach((source) => {
        source.close();
      });
    };
  }, []);

  useEffect(() => {
    const toDownload = mediaJobs.filter((job) => job.status === 'completed' && !autoDownloadedMediaRef.current.has(job.id));
    toDownload.forEach((job, index) => {
      autoDownloadedMediaRef.current.add(job.id);
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = buildAuthorizedUrl(`${apiBase}/api/media/jobs/${job.id}/download`, accessToken);
        a.download = job.outputName || 'media-output';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, index * 300);
    });
  }, [accessToken, apiBase, mediaJobs]);

  useEffect(() => {
    const toDownload = thumbJobs.filter((job) => job.status === 'completed' && !autoDownloadedThumbRef.current.has(job.id));
    toDownload.forEach((job, index) => {
      autoDownloadedThumbRef.current.add(job.id);
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = buildAuthorizedUrl(`${apiBase}/api/thumbnails/jobs/${job.id}/download`, accessToken);
        a.download = job.outputName || 'thumbnail.jpg';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, index * 300);
    });
  }, [accessToken, apiBase, thumbJobs]);

  const buildAdvancedPayload = () => {
    if (!showAdvanced) {
      return null;
    }

    const payload: Record<string, string | number> = {};

    if (mediaOperation === 'optimize-mp4' || mediaOperation === 'gif-to-mp4') {
      payload.crf = Number(advancedCrf);
    }
    if (mediaOperation === 'mp4-to-gif') {
      payload.width = Number(advancedWidth);
      payload.fps = Number(advancedFps);
    }
    if (mediaOperation === 'optimize-png' || mediaOperation === 'optimize-jpeg') {
      payload.quality = Number(advancedQuality);
    }
    if (mediaOperation === 'optimize-gif') {
      payload.lossy = Number(advancedLossy);
      payload.colors = Number(advancedColors);
    }
    if (mediaOperation === 'mp4-to-mp3-segmented') {
      payload.segmentMinutes = Number(advancedSegmentMinutes);
    }

    return JSON.stringify(payload);
  };

  const createMediaJob = async (event: FormEvent) => {
    event.preventDefault();
    if (mediaFiles.length === 0) {
      setMediaError('Escolha ao menos um arquivo antes de converter/otimizar.');
      return;
    }

    setMediaLoading(true);
    setMediaError('');
    setMediaNotice('');

    try {
      const body = new FormData();
      mediaFiles.forEach((file) => {
        body.append('files', file);
      });
      body.set('operation', mediaOperation);
      body.set('preset', preset);
      const advanced = buildAdvancedPayload();
      if (advanced) {
        body.set('advanced', advanced);
      }

      const res = await authFetch(`${apiBase}/api/media/jobs`, {
        method: 'POST',
        body,
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Falha ao criar job de midia');
      }

      const added = Array.isArray(payload?.jobs) ? payload.jobs.length : payload?.id ? 1 : 0;
      if (added === 0) {
        throw new Error('Nenhum job foi adicionado na fila.');
      }

      const suffix = added > 1 ? 's' : '';
      setMediaNotice(`${added} job${suffix} adicionado${suffix} com sucesso. Processamento iniciado na fila.`);
      setMediaFiles([]);
      setMediaInputKey((prev) => prev + 1);
      await fetchMediaJobs();
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Falha ao criar job');
    } finally {
      setMediaLoading(false);
    }
  };

  const toggleMediaSelection = (id: string) => {
    setSelectedMediaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedMediaIds.size === mediaJobs.length) {
      setSelectedMediaIds(new Set());
      return;
    }
    setSelectedMediaIds(new Set(mediaJobs.map((job) => job.id)));
  };

  const removeMediaByIds = async (ids: string[]) => {
    if (!ids.length) return;
      const res = await authFetch(`${apiBase}/api/media/jobs/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error || 'Falha ao remover itens');
    }
  };

  const removeSingleMedia = async (id: string) => {
    try {
      await authFetch(`${apiBase}/api/media/jobs/${id}`, { method: 'DELETE' });
      autoDownloadedMediaRef.current.delete(id);
      setSelectedMediaIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await fetchMediaJobs();
    } catch {
      setMediaError('Falha ao remover item.');
    }
  };

  const removeSelectedMedia = async () => {
    if (selectedMediaIds.size === 0) return;
    if (!window.confirm(`Remover ${selectedMediaIds.size} item(ns) selecionado(s)?`)) return;

    setMediaLoading(true);
    setMediaError('');
    setMediaNotice('');
    try {
      const ids = Array.from(selectedMediaIds);
      await removeMediaByIds(ids);
      ids.forEach((id) => autoDownloadedMediaRef.current.delete(id));
      setSelectedMediaIds(new Set());
      await fetchMediaJobs();
      setMediaNotice('Itens selecionados removidos.');
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Falha ao remover selecionados');
    } finally {
      setMediaLoading(false);
    }
  };

  const clearMediaQueue = async () => {
    if (!mediaJobs.length) return;
    if (!window.confirm('Limpar toda a fila de midia?')) return;

    setMediaLoading(true);
    setMediaError('');
    setMediaNotice('');
    try {
      const res = await authFetch(`${apiBase}/api/media/jobs`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Falha ao limpar fila');
      autoDownloadedMediaRef.current = new Set();
      setSelectedMediaIds(new Set());
      await fetchMediaJobs();
      setMediaNotice('Fila de midia limpa com sucesso.');
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Falha ao limpar fila');
    } finally {
      setMediaLoading(false);
    }
  };

  const parseThumbUrls = () =>
    thumbUrlsText
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean);

  const createThumbnailJobs = async (event: FormEvent) => {
    event.preventDefault();
    setThumbLoading(true);
    setThumbError('');
    setThumbNotice('');

    try {
      let res: Response;
      if (thumbInputMode === 'file') {
        if (thumbFiles.length === 0) {
          throw new Error('Escolha ao menos um arquivo para gerar thumbnails.');
        }
        const body = new FormData();
        thumbFiles.forEach((file) => body.append('files', file));
        body.set('operation', 'thumbnail');
        body.set('preset', thumbPreset);
        res = await authFetch(`${apiBase}/api/thumbnails/jobs`, {
          method: 'POST',
          body,
        });
      } else {
        const urls = parseThumbUrls();
        if (urls.length === 0) {
          throw new Error('Cole ao menos uma URL para gerar thumbnails.');
        }
        res = await authFetch(`${apiBase}/api/thumbnails/jobs/url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'thumbnail',
            preset: thumbPreset,
            urls,
          }),
        });
      }

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Falha ao criar job de thumbnail');
      }

      const added = Array.isArray(payload?.jobs) ? payload.jobs.length : payload?.id ? 1 : 0;
      if (added === 0) {
        throw new Error('Nenhum job de thumbnail foi adicionado.');
      }

      const suffix = added > 1 ? 's' : '';
      setThumbNotice(`${added} thumbnail${suffix} enfileirado${suffix} com sucesso.`);
      setThumbFiles([]);
      setThumbUrlsText('');
      setThumbFileInputKey((prev) => prev + 1);
      await fetchThumbJobs();
    } catch (error) {
      setThumbError(error instanceof Error ? error.message : 'Falha ao criar thumbnails');
    } finally {
      setThumbLoading(false);
    }
  };

  const toggleThumbSelection = (id: string) => {
    setSelectedThumbIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllThumb = () => {
    if (selectedThumbIds.size === thumbJobs.length) {
      setSelectedThumbIds(new Set());
      return;
    }
    setSelectedThumbIds(new Set(thumbJobs.map((job) => job.id)));
  };

  const removeThumbByIds = async (ids: string[]) => {
    if (!ids.length) return;
      const res = await authFetch(`${apiBase}/api/thumbnails/jobs/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error || 'Falha ao remover thumbnails');
    }
  };

  const removeSingleThumb = async (id: string) => {
    try {
      await authFetch(`${apiBase}/api/thumbnails/jobs/${id}`, { method: 'DELETE' });
      autoDownloadedThumbRef.current.delete(id);
      setSelectedThumbIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await fetchThumbJobs();
    } catch {
      setThumbError('Falha ao remover thumbnail.');
    }
  };

  const removeSelectedThumbs = async () => {
    if (selectedThumbIds.size === 0) return;
    if (!window.confirm(`Remover ${selectedThumbIds.size} thumbnail(s) selecionada(s)?`)) return;

    setThumbLoading(true);
    setThumbError('');
    setThumbNotice('');
    try {
      const ids = Array.from(selectedThumbIds);
      await removeThumbByIds(ids);
      ids.forEach((id) => autoDownloadedThumbRef.current.delete(id));
      setSelectedThumbIds(new Set());
      await fetchThumbJobs();
      setThumbNotice('Thumbnails selecionadas removidas.');
    } catch (error) {
      setThumbError(error instanceof Error ? error.message : 'Falha ao remover selecionadas');
    } finally {
      setThumbLoading(false);
    }
  };

  const clearThumbQueue = async () => {
    if (!thumbJobs.length) return;
    if (!window.confirm('Limpar toda a fila de thumbnails?')) return;

    setThumbLoading(true);
    setThumbError('');
    setThumbNotice('');
    try {
      const res = await authFetch(`${apiBase}/api/thumbnails/jobs`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Falha ao limpar fila de thumbnails');
      autoDownloadedThumbRef.current = new Set();
      setSelectedThumbIds(new Set());
      await fetchThumbJobs();
      setThumbNotice('Fila de thumbnails limpa com sucesso.');
    } catch (error) {
      setThumbError(error instanceof Error ? error.message : 'Falha ao limpar fila');
    } finally {
      setThumbLoading(false);
    }
  };

  if (!authReady) {
    return (
      <main className="min-h-screen bg-[#0b1326] text-[#dae2fd]">
        <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-6">
          <div className="w-full rounded-2xl border border-[#454652]/35 bg-[#171f33]/85 p-6 text-center">
            <p className="text-sm text-[#c5c5d4]">Validando sessao...</p>
          </div>
        </div>
      </main>
    );
  }

  if (!supabase) {
    return (
      <main className="min-h-screen bg-[#0b1326] text-[#dae2fd]">
        <div className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-6">
          <div className="w-full rounded-2xl border border-rose-400/40 bg-[#171f33]/85 p-6">
            <h1 className="text-xl font-bold text-[#e2dfff]">Configurar Supabase no frontend</h1>
            <p className="mt-3 text-sm text-[#c5c5d4]">
              Defina <code>NEXT_PUBLIC_SUPABASE_URL</code> e <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> em
              <code> frontend/.env.local</code> (ou nas variaveis do Netlify) e recarregue a pagina.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#0b1326] text-[#dae2fd]">
        <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-6">
          <form
            onSubmit={handleLogin}
            className="w-full rounded-2xl border border-[#454652]/35 bg-[#171f33]/85 p-6 shadow-[0_20px_60px_rgba(6,14,32,0.55)]"
          >
            <p className="text-xs uppercase tracking-[0.28em] text-[#8f909e]">MP3ok</p>
            <h1 className="mt-2 text-2xl font-black text-[#e2dfff]">Entrar</h1>
            <p className="mt-2 text-sm text-[#c5c5d4]">Acesso protegido por Supabase Authentication.</p>

            <div className="mt-5 space-y-3">
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="Seu e-mail"
                required
                className="h-11 w-full rounded-xl border border-[#454652]/35 bg-[#060e20] px-3 text-sm outline-none focus:border-[#c3c0ff]"
              />
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Sua senha"
                required
                className="h-11 w-full rounded-xl border border-[#454652]/35 bg-[#060e20] px-3 text-sm outline-none focus:border-[#c3c0ff]"
              />
            </div>

            {authError ? <p className="mt-3 text-sm text-rose-400">{authError}</p> : null}

            <button
              type="submit"
              disabled={authLoading}
              className="mt-5 h-11 w-full rounded-xl bg-gradient-to-br from-[#c3c0ff] to-[#5250a4] text-sm font-bold text-[#100563] shadow-[0_10px_24px_rgba(195,192,255,0.35)] disabled:opacity-60"
            >
              {authLoading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(95,147,255,0.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(126,224,255,0.12),transparent_26%),linear-gradient(180deg,#08111f_0%,#0b1326_42%,#0f1830_100%)] text-[#dce7fb] selection:bg-[#8ecbff] selection:text-[#08111f]">
      <nav className="fixed top-0 z-50 w-full border-b border-white/10 bg-[#08111f]">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-4 py-4 sm:px-8">
          <div />
          <p className="text-center text-3xl font-black tracking-[0.08em] text-white sm:text-4xl">MP3ok</p>
          <div className="flex items-center justify-self-end gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#8fb7ff]">Logado</p>
              <p className="max-w-[220px] truncate text-xs text-[#dce7fb]">{session.user.email || '-'}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={authLoading}
              className="h-9 rounded-xl border border-[#87b6ff]/20 bg-white/8 px-3 text-xs font-semibold text-[#dce7fb] disabled:opacity-60"
            >
              Sair
            </button>
          </div>
        </div>
      </nav>

      <div className="mx-auto w-full max-w-7xl px-4 pb-14 pt-28 sm:px-8">
        <section className="relative mb-5 overflow-hidden rounded-[28px] border border-[#8fb7ff]/18 bg-[rgba(244,248,255,0.92)] shadow-[0_18px_48px_rgba(10,22,43,0.18)] backdrop-blur-2xl">
          <div className="grid gap-0 lg:grid-cols-[1.35fr_0.9fr]">
            <article className={`relative overflow-hidden p-6 sm:p-7 bg-gradient-to-br ${currentPromo.accent}`}>
              <img
                src={currentPromo.imageUrl}
                alt={currentPromo.title}
                className="absolute inset-0 h-full w-full object-cover opacity-35"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.12),transparent_30%),linear-gradient(140deg,rgba(11,24,49,0.72),rgba(18,52,101,0.5))]" />
              <div className="relative flex h-full flex-col justify-between gap-6">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.32em] text-white/75">{currentPromo.eyebrow}</p>
                  <h2 className="mt-3 max-w-2xl text-2xl font-black leading-tight text-white sm:text-3xl">
                    {currentPromo.title}
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-white/82">{currentPromo.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/80">
                  <span className="rounded-full border border-white/18 bg-white/10 px-3 py-1">{currentPromo.meta}</span>
                  <span className="rounded-full border border-white/18 bg-white/10 px-3 py-1">Banner fixo</span>
                  <span className="rounded-full border border-white/18 bg-white/10 px-3 py-1">Carrossel automatico</span>
                </div>
              </div>
            </article>
            <aside className="grid gap-3 p-4 sm:p-5">
              {promoPreviewSlides.map(({ slide, index }) => (
                <button
                  key={`${slide.title}-${index}`}
                  type="button"
                  onClick={() => setPromoIndex(index)}
                  className={`rounded-[20px] border p-4 text-left transition ${
                    index === promoIndex
                      ? 'border-[#6ea1ff]/55 bg-[#eaf2ff] shadow-[0_12px_30px_rgba(31,79,166,0.12)]'
                      : 'border-[#d8e4f5] bg-white/80 hover:border-[#9dc3ff]'
                  }`}
                >
                  <div className="mb-3 h-20 overflow-hidden rounded-xl border border-[#c8d9ef] bg-[#dbe8fa]">
                    <img src={slide.imageUrl} alt={slide.title} className="h-full w-full object-cover" loading="lazy" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#6f86a8]">{slide.eyebrow}</p>
                  <p className="mt-2 text-sm font-semibold leading-5 text-[#10203a]">{slide.title}</p>
                  <p className="mt-2 text-xs leading-5 text-[#4f627f]">{slide.description}</p>
                </button>
              ))}
              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-[#d8e4f5] bg-white/72 px-4 py-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#6f86a8]">Rotacao</p>
                  <p className="text-sm font-semibold text-[#10203a]">
                    {promoIndex + 1}/{PROMO_SLIDES.length}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {PROMO_SLIDES.map((slide, index) => (
                    <button
                      key={slide.meta}
                      type="button"
                      onClick={() => setPromoIndex(index)}
                      className={`h-2.5 rounded-full transition ${
                        index === promoIndex ? 'w-8 bg-[#1f5db0]' : 'w-2.5 bg-[#b9cbe6]'
                      }`}
                      aria-label={`Ir para anuncio ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </section>

        <header className="relative overflow-hidden rounded-[32px] border border-[#cad9ee] bg-[linear-gradient(135deg,rgba(250,251,255,0.98),rgba(240,244,251,0.96),rgba(228,235,246,0.96))] p-8 text-[#10203a] shadow-[0_24px_70px_rgba(10,22,43,0.18)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(31,79,166,0.08),transparent_28%),radial-gradient(circle_at_86%_0%,rgba(126,224,255,0.12),transparent_26%)]" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#c9d9ef] bg-white/80 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-[#1f5db0]">
              <span className="h-2 w-2 rounded-full bg-[#1f5db0] shadow-[0_0_10px_rgba(31,93,176,0.75)]" />
              Processamento em tempo real
            </div>
            <h1 className="mt-4 max-w-4xl font-serif text-4xl font-bold leading-tight text-[#10203a] sm:text-6xl">
              MP3ok.
              <span className="block text-[#1f5db0]">
                Downloader + Conversor + Otimizador + Thumbnail Studio
              </span>
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[#4f627f] sm:text-base">
              Cole links, processe arquivos em lote e gere resultados com fila automatica em um painel editorial, rapido e legivel.
            </p>
          </div>

          <div className="relative mt-8 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setActiveTab('url')}
              className={`h-12 rounded-full text-sm font-bold uppercase tracking-[0.08em] transition ${
                activeTab === 'url'
                  ? 'bg-gradient-to-br from-[#1f5db0] to-[#7fb6ff] text-white shadow-[0_14px_28px_rgba(31,93,176,0.22)]'
                  : 'border border-[#cbd8ea] bg-white/76 text-[#10203a] hover:bg-white'
              }`}
            >
              Downloader
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('media')}
              className={`h-12 rounded-full text-sm font-bold uppercase tracking-[0.08em] transition ${
                activeTab === 'media'
                  ? 'bg-gradient-to-br from-[#1f5db0] to-[#7fb6ff] text-white shadow-[0_14px_28px_rgba(31,93,176,0.22)]'
                  : 'border border-[#cbd8ea] bg-white/76 text-[#10203a] hover:bg-white'
              }`}
            >
              Conversor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('thumb')}
              className={`h-12 rounded-full text-sm font-bold uppercase tracking-[0.08em] transition ${
                activeTab === 'thumb'
                  ? 'bg-gradient-to-br from-[#1f5db0] to-[#7fb6ff] text-white shadow-[0_14px_28px_rgba(31,93,176,0.22)]'
                  : 'border border-[#cbd8ea] bg-white/76 text-[#10203a] hover:bg-white'
              }`}
            >
              Thumbnails
            </button>
          </div>
        </header>

        {activeTab === 'url' ? (
          <section className="mt-6 space-y-6">
            <div className="rounded-[28px] border border-[#cad9ee] bg-[rgba(248,250,255,0.92)] p-6 text-[#10203a] shadow-[0_18px_48px_rgba(10,22,43,0.12)] backdrop-blur-xl">
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="url"
                  placeholder="Cole uma URL de video..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="h-12 flex-1 rounded-2xl border border-[#cad9ee] bg-white/90 px-4 text-sm text-[#10203a] outline-none placeholder:text-[#8aa0be] focus:border-[#1f5db0] focus:bg-white"
                />
                <button
                  type="button"
                  onClick={fetchInfo}
                  disabled={loadingInfo || !url.trim()}
                  className="h-12 rounded-2xl bg-gradient-to-br from-[#1f5db0] to-[#7fb6ff] px-6 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(31,93,176,0.22)] disabled:opacity-50"
                >
                  {loadingInfo ? 'Buscando...' : 'Buscar midia'}
                </button>
                {loadingInfo ? (
                  <button
                    type="button"
                    onClick={cancelInfoSearch}
                    className="h-12 rounded-2xl border border-[#e08a8a] bg-[#fff5f5] px-4 text-sm font-semibold text-[#b42318]"
                  >
                    Cancelar
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={resetUrlSearch}
                  className="h-12 rounded-2xl border border-[#cad9ee] bg-white/90 px-4 text-sm font-semibold text-[#10203a] hover:bg-white"
                >
                  Limpar busca
                </button>
              </div>
              {urlError ? <p className="mt-3 text-sm text-[#b42318]">{urlError}</p> : null}
            </div>

            {videoInfo ? (
              <div className="rounded-[28px] border border-[#cad9ee] bg-[rgba(248,250,255,0.92)] p-6 text-[#10203a] shadow-[0_18px_48px_rgba(10,22,43,0.12)] backdrop-blur-xl">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                  <div className="h-32 w-full overflow-hidden rounded-2xl border border-[#d8e4f5] bg-white/90 sm:w-56">
                    {videoInfo.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={videoInfo.thumbnail} alt={videoInfo.title} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="flex-1">
                    <h2 className="font-serif text-2xl font-bold leading-tight text-[#10203a]">{videoInfo.title}</h2>
                    {videoInfo.isPlaylist ? (
                      <p className="mt-1 text-sm leading-6 text-[#4f627f]">
                        Playlist detectada: {videoInfo.entryCount || videoInfo.entries?.length || 0} item(ns). O download sera feito em fila, um por vez.
                      </p>
                    ) : (
                      <p className="mt-1 text-sm leading-6 text-[#4f627f]">
                        Duracao: {Math.floor(videoInfo.duration / 60)}:{(videoInfo.duration % 60).toString().padStart(2, '0')}
                      </p>
                    )}
                    {videoInfo.isPlaylist ? (
                      <div className="mt-4 rounded-[24px] border border-[#d8e4f5] bg-[#f6f9fd] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6f86a8]">Controle da playlist</p>
                            <p className="mt-1 text-xs leading-5 text-[#4f627f]">
                              Escolha baixar a lista inteira ou apenas um item especifico.
                            </p>
                          </div>
                          <div className="inline-flex rounded-full border border-[#cad9ee] bg-white p-1 shadow-[0_6px_16px_rgba(10,22,43,0.06)]">
                            <button
                              type="button"
                              onClick={() => setPlaylistDownloadMode('all')}
                              className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                                playlistDownloadMode === 'all'
                                  ? 'bg-gradient-to-br from-[#1f5db0] to-[#7fb6ff] text-white'
                                  : 'text-[#4f627f] hover:text-[#10203a]'
                              }`}
                            >
                              Lista inteira
                            </button>
                            <button
                              type="button"
                              onClick={() => setPlaylistDownloadMode('single')}
                              className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                                playlistDownloadMode === 'single'
                                  ? 'bg-gradient-to-br from-[#1f5db0] to-[#7fb6ff] text-white'
                                  : 'text-[#4f627f] hover:text-[#10203a]'
                              }`}
                            >
                              Apenas 1 item
                            </button>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                          <label className="block">
                            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6f86a8]">Item da lista</span>
                            <select
                              value={selectedPlaylistItemId}
                              onChange={(e) => setSelectedPlaylistItemId(e.target.value)}
                              disabled={playlistDownloadMode !== 'single'}
                              className="mt-1 h-11 w-full rounded-2xl border border-[#cad9ee] bg-white/90 px-3 text-sm text-[#10203a] disabled:cursor-not-allowed disabled:bg-[#f3f6fb] disabled:text-[#7f92ad]"
                            >
                              {(videoInfo.entries || []).map((entry, index) => (
                                <option key={entry.id} value={entry.id}>
                                  {index + 1}. {entry.title}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="rounded-2xl border border-[#d8e4f5] bg-white/85 px-3 py-2 text-xs leading-5 text-[#4f627f]">
                            {playlistDownloadMode === 'single'
                              ? 'Baixa apenas o item escolhido.'
                              : 'Mantem o fluxo atual e envia todos os itens em fila.'}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <select
                        value={format}
                        onChange={(e) => setFormat(e.target.value as 'video' | 'audio')}
                        className="h-11 rounded-2xl border border-[#cad9ee] bg-white/90 px-3 text-sm text-[#10203a]"
                      >
                        <option value="video">MP4 Video</option>
                        <option value="audio">MP3 Audio</option>
                      </select>
                      <select
                        value={quality}
                        onChange={(e) => setQuality(e.target.value)}
                        className="h-11 rounded-2xl border border-[#cad9ee] bg-white/90 px-3 text-sm text-[#10203a]"
                        disabled={format === 'audio'}
                      >
                        <option value="best">Best</option>
                        <option value="1080">1080p</option>
                        <option value="720">720p</option>
                        <option value="480">480p</option>
                      </select>
                      <button
                        onClick={startDownload}
                        className="h-11 rounded-2xl bg-gradient-to-br from-[#0f2a56] to-[#1f5db0] px-4 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,42,86,0.18)] hover:brightness-110"
                      >
                        {videoInfo.isPlaylist
                          ? playlistDownloadMode === 'single'
                            ? 'Baixar 1 item'
                            : 'Lista inteira'
                          : 'Download'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {urlTasks.length ? (
              <div className="rounded-[28px] border border-[#cad9ee] bg-[rgba(248,250,255,0.92)] p-6 text-[#10203a] shadow-[0_16px_38px_rgba(10,22,43,0.12)] backdrop-blur-xl">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-[#10203a]">Fila de downloads por URL</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={removeCompletedUrlTasks}
                      disabled={!urlTasks.some((task) => task.status === 'completed' || task.status === 'error')}
                      className="rounded-xl border border-[#cad9ee] bg-white/80 px-3 py-1 text-xs font-semibold text-[#10203a] disabled:opacity-50"
                    >
                      Remover concluidos
                    </button>
                    <button
                      type="button"
                      onClick={clearUrlTasks}
                      className="rounded-xl border border-[#e08a8a] bg-[#fff5f5] px-3 py-1 text-xs font-semibold text-[#b42318]"
                    >
                      Limpar lista
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {urlTasks.map((task) => (
                    <div key={task.id} className="rounded-2xl border border-[#d8e4f5] bg-white/88 p-4">
                      <div className="flex justify-between gap-3">
                        <p className="truncate text-sm font-semibold text-[#10203a]">{task.title}</p>
                        <p className="text-xs text-[#6f86a8]">
                          {task.status === 'error' ? 'Falhou' : task.status === 'completed' ? 'Concluido' : `${task.progress.toFixed(1)}%`}
                        </p>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-[#e8eff8]">
                        <div
                          className={`h-2 rounded-full ${task.status === 'error' ? 'bg-[#e5484d]' : task.status === 'completed' ? 'bg-[#1a9f6d]' : 'bg-[#1f5db0]'}`}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-[#6f86a8]">{task.size}</p>
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => removeSingleUrlTask(task.id)}
                          className="rounded-xl border border-[#e08a8a] bg-[#fff5f5] px-3 py-1 text-xs font-semibold text-[#b42318]"
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : activeTab === 'media' ? (
          <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <div className="space-y-4">
              <form onSubmit={createMediaJob} className="rounded-2xl border border-[#454652]/30 bg-[#171f33]/80 p-6 backdrop-blur-xl shadow-[0_18px_40px_rgba(6,14,32,0.35)]">
                <h3 className="text-lg font-semibold">Novo job de conversao/otimizacao</h3>
                <div className="mt-4 space-y-3">
                  <input
                    key={mediaInputKey}
                    type="file"
                    multiple
                    onChange={(e) => setMediaFiles(Array.from(e.target.files || []))}
                    className="block w-full rounded-xl border border-[#454652]/35 bg-[#060e20] px-4 py-3 text-sm"
                    accept="video/*,audio/*,image/gif,image/png,image/jpeg"
                  />
                  <p className="text-xs text-slate-400">
                    {mediaFiles.length > 0
                      ? `${mediaFiles.length} arquivo(s) selecionado(s): ${mediaFiles
                          .slice(0, 3)
                          .map((file) => file.name)
                          .join(', ')}${mediaFiles.length > 3 ? ' ...' : ''}`
                      : 'Selecione um ou varios arquivos para processar em lote.'}
                  </p>
                  <select
                    value={mediaOperation}
                    onChange={(e) => setMediaOperation(e.target.value as MediaOperation)}
                    className="h-11 w-full rounded-xl border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                  >
                    <option value="optimize-gif">Otimizar GIF</option>
                    <option value="optimize-png">Otimizar PNG</option>
                    <option value="optimize-jpeg">Otimizar JPEG</option>
                    <option value="mp4-to-gif">Converter MP4 para GIF</option>
                    <option value="gif-to-mp4">Converter GIF para MP4</option>
                    <option value="optimize-mp4">Otimizar MP4</option>
                    <option value="mp4-to-mp3-segmented">Converter MP4 para MP3 (dividido)</option>
                    <option value="ogg-to-mp3">Converter audio WhatsApp (OGG) para MP3</option>
                  </select>
                  <select
                    value={preset}
                    onChange={(e) => setPreset(e.target.value as Preset)}
                    className="h-11 w-full rounded-xl border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                  >
                    <option value="light">Leve</option>
                    <option value="balanced">Balanced</option>
                    <option value="aggressive">Agressivo</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="h-11 w-full rounded-xl border border-slate-600 text-sm font-semibold text-slate-200"
                  >
                    {showAdvanced ? 'Ocultar avancado' : 'Mostrar avancado'}
                  </button>

                  {showAdvanced ? (
                    <div className="rounded-xl border border-[#454652]/25 bg-[#060e20]/78 p-4">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-xs text-slate-300">
                          CRF
                          <input
                            value={advancedCrf}
                            onChange={(e) => setAdvancedCrf(e.target.value)}
                            className="mt-1 h-10 w-full rounded-lg border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-300">
                          Width
                          <input
                            value={advancedWidth}
                            onChange={(e) => setAdvancedWidth(e.target.value)}
                            className="mt-1 h-10 w-full rounded-lg border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-300">
                          FPS
                          <input
                            value={advancedFps}
                            onChange={(e) => setAdvancedFps(e.target.value)}
                            className="mt-1 h-10 w-full rounded-lg border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-300">
                          Quality
                          <input
                            value={advancedQuality}
                            onChange={(e) => setAdvancedQuality(e.target.value)}
                            className="mt-1 h-10 w-full rounded-lg border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-300">
                          GIF Lossy
                          <input
                            value={advancedLossy}
                            onChange={(e) => setAdvancedLossy(e.target.value)}
                            className="mt-1 h-10 w-full rounded-lg border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-300">
                          GIF Colors
                          <input
                            value={advancedColors}
                            onChange={(e) => setAdvancedColors(e.target.value)}
                            className="mt-1 h-10 w-full rounded-lg border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-300">
                          Segment Minutes
                          <input
                            value={advancedSegmentMinutes}
                            onChange={(e) => setAdvancedSegmentMinutes(e.target.value)}
                            className="mt-1 h-10 w-full rounded-lg border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={mediaLoading}
                    className="h-12 w-full rounded-xl bg-gradient-to-br from-[#c3c0ff] to-[#5250a4] text-sm font-bold text-[#100563] shadow-[0_10px_24px_rgba(195,192,255,0.35)] hover:brightness-110 disabled:opacity-60"
                  >
                    {mediaLoading ? 'Processando...' : mediaFiles.length > 1 ? 'Criar jobs em lote' : 'Criar job'}
                  </button>
                </div>
              </form>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={removeSelectedMedia}
                  disabled={mediaLoading || selectedMediaIds.size === 0}
                  className="h-11 rounded-xl border border-rose-400 bg-slate-900 text-sm font-semibold text-rose-300 disabled:opacity-50"
                >
                  Remover selecionados ({selectedMediaIds.size})
                </button>
                <button
                  type="button"
                  onClick={clearMediaQueue}
                  disabled={mediaLoading || mediaJobs.length === 0}
                  className="h-11 rounded-xl border border-slate-500 bg-slate-900 text-sm font-semibold text-slate-200 disabled:opacity-50"
                >
                  Limpar fila
                </button>
              </div>

              {mediaError ? <p className="text-sm text-rose-400">{mediaError}</p> : null}
              {mediaNotice ? <p className="text-sm text-emerald-400">{mediaNotice}</p> : null}
            </div>

            <div className="rounded-2xl border border-[#454652]/28 bg-[#171f33]/72 p-6 backdrop-blur-xl shadow-[0_16px_32px_rgba(6,14,32,0.3)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Fila de midia</h3>
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  disabled={mediaJobs.length === 0}
                  className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200 disabled:opacity-50"
                >
                  {selectedMediaIds.size === mediaJobs.length && mediaJobs.length > 0 ? 'Desmarcar todos' : 'Marcar todos'}
                </button>
              </div>

              {mediaJobs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                  Nenhum job de midia ainda.
                </p>
              ) : (
                <div className="space-y-3">
                  {mediaJobs.map((job) => (
                    <article key={job.id} className="rounded-xl border border-[#454652]/25 bg-[#060e20]/78 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedMediaIds.has(job.id)}
                            onChange={() => toggleMediaSelection(job.id)}
                            className="mt-1 h-4 w-4"
                          />
                          <div>
                            <p className="text-sm font-semibold text-slate-100">{job.outputName || job.inputName}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {job.operation} | {job.preset} | {formatBytes(job.sizeIn)} {'->'} {formatBytes(job.sizeOut)}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full border border-slate-600 px-2 py-1 text-xs uppercase tracking-wide text-slate-300">
                          {job.status}
                        </span>
                      </div>

                      <div className="mt-3 h-2 w-full rounded-full bg-slate-800">
                        <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${job.progress || 0}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-slate-400">{job.progressLabel || '-'}</p>
                      {job.error ? <p className="mt-1 text-xs text-rose-400">{job.error}</p> : null}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {job.status === 'completed' ? (
                          <a
                            href={buildAuthorizedUrl(`${apiBase}/api/media/jobs/${job.id}/download`, accessToken)}
                            className="rounded-lg bg-gradient-to-br from-[#9cf0ff] to-[#00daf3] px-3 py-2 text-xs font-semibold text-[#00363d]"
                          >
                            Baixar agora
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeSingleMedia(job.id)}
                          className="rounded-lg border border-rose-400 px-3 py-2 text-xs font-semibold text-rose-300"
                        >
                          Remover
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <div className="space-y-4">
              <form onSubmit={createThumbnailJobs} className="rounded-2xl border border-[#454652]/30 bg-[#171f33]/80 p-6 backdrop-blur-xl shadow-[0_18px_40px_rgba(6,14,32,0.35)]">
                <h3 className="text-lg font-semibold">Thumbnail Studio</h3>
                <div className="mt-4 space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setThumbInputMode('file')}
                      className={`h-11 rounded-xl text-sm font-semibold ${thumbInputMode === 'file' ? 'bg-white text-slate-900' : 'bg-slate-700 text-white'}`}
                    >
                      Arquivos
                    </button>
                    <button
                      type="button"
                      onClick={() => setThumbInputMode('url')}
                      className={`h-11 rounded-xl text-sm font-semibold ${thumbInputMode === 'url' ? 'bg-white text-slate-900' : 'bg-slate-700 text-white'}`}
                    >
                      URLs
                    </button>
                  </div>

                  {thumbInputMode === 'file' ? (
                    <>
                      <input
                        key={thumbFileInputKey}
                        type="file"
                        multiple
                        onChange={(e) => setThumbFiles(Array.from(e.target.files || []))}
                        className="block w-full rounded-xl border border-[#454652]/35 bg-[#060e20] px-4 py-3 text-sm"
                        accept="image/*,video/*"
                      />
                      <p className="text-xs text-slate-400">
                        {thumbFiles.length > 0
                          ? `${thumbFiles.length} arquivo(s) selecionado(s).`
                          : 'Selecione imagens, GIFs ou videos para gerar thumbnails.'}
                      </p>
                    </>
                  ) : (
                    <textarea
                      value={thumbUrlsText}
                      onChange={(e) => setThumbUrlsText(e.target.value)}
                      placeholder="Cole URLs (uma por linha). Suporta URL direta e link de arquivo do Google Drive."
                      className="h-32 w-full rounded-xl border border-[#454652]/35 bg-[#060e20] px-3 py-2 text-sm outline-none focus:border-[#c3c0ff]"
                    />
                  )}

                  <select
                    value={thumbPreset}
                    onChange={(e) => setThumbPreset(e.target.value as ThumbnailPreset)}
                    className="h-11 w-full rounded-xl border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                  >
                    <option value="16x9">16:9 (1280x720)</option>
                    <option value="1x1">1:1 (1080x1080)</option>
                    <option value="9x16">9:16 (1080x1920)</option>
                  </select>

                  <button
                    type="submit"
                    disabled={thumbLoading}
                    className="h-12 w-full rounded-xl bg-gradient-to-br from-[#c3c0ff] to-[#5250a4] text-sm font-bold text-[#100563] shadow-[0_10px_24px_rgba(195,192,255,0.35)] hover:brightness-110 disabled:opacity-60"
                  >
                    {thumbLoading ? 'Gerando...' : 'Gerar thumbnails'}
                  </button>
                </div>
              </form>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={removeSelectedThumbs}
                  disabled={thumbLoading || selectedThumbIds.size === 0}
                  className="h-11 rounded-xl border border-rose-400 bg-slate-900 text-sm font-semibold text-rose-300 disabled:opacity-50"
                >
                  Remover selecionados ({selectedThumbIds.size})
                </button>
                <button
                  type="button"
                  onClick={clearThumbQueue}
                  disabled={thumbLoading || thumbJobs.length === 0}
                  className="h-11 rounded-xl border border-slate-500 bg-slate-900 text-sm font-semibold text-slate-200 disabled:opacity-50"
                >
                  Limpar fila
                </button>
              </div>

              {thumbError ? <p className="text-sm text-rose-400">{thumbError}</p> : null}
              {thumbNotice ? <p className="text-sm text-emerald-400">{thumbNotice}</p> : null}
            </div>

            <div className="rounded-2xl border border-[#454652]/28 bg-[#171f33]/72 p-6 backdrop-blur-xl shadow-[0_16px_32px_rgba(6,14,32,0.3)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Fila de thumbnails</h3>
                <button
                  type="button"
                  onClick={toggleSelectAllThumb}
                  disabled={thumbJobs.length === 0}
                  className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200 disabled:opacity-50"
                >
                  {selectedThumbIds.size === thumbJobs.length && thumbJobs.length > 0 ? 'Desmarcar todos' : 'Marcar todos'}
                </button>
              </div>

              {thumbJobs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                  Nenhum job de thumbnail ainda.
                </p>
              ) : (
                <div className="space-y-3">
                  {thumbJobs.map((job) => (
                    <article key={job.id} className="rounded-xl border border-[#454652]/25 bg-[#060e20]/78 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedThumbIds.has(job.id)}
                            onChange={() => toggleThumbSelection(job.id)}
                            className="mt-1 h-4 w-4"
                          />
                          <div>
                            <p className="text-sm font-semibold text-slate-100">{job.outputName || job.inputName}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {job.preset} | {formatBytes(job.sizeIn)} {'->'} {formatBytes(job.sizeOut)}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full border border-slate-600 px-2 py-1 text-xs uppercase tracking-wide text-slate-300">
                          {job.status}
                        </span>
                      </div>

                      <div className="mt-3 h-2 w-full rounded-full bg-slate-800">
                        <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${job.progress || 0}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-slate-400">{job.progressLabel || '-'}</p>
                      {job.error ? <p className="mt-1 text-xs text-rose-400">{job.error}</p> : null}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {job.status === 'completed' ? (
                          <a
                            href={buildAuthorizedUrl(`${apiBase}/api/thumbnails/jobs/${job.id}/download`, accessToken)}
                            className="rounded-lg bg-gradient-to-br from-[#9cf0ff] to-[#00daf3] px-3 py-2 text-xs font-semibold text-[#00363d]"
                          >
                            Baixar agora
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeSingleThumb(job.id)}
                          className="rounded-lg border border-rose-400 px-3 py-2 text-xs font-semibold text-rose-300"
                        >
                          Remover
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="mt-8 rounded-[32px] border border-[#cad9ee] bg-[rgba(248,250,255,0.92)] p-6 text-[#10203a] shadow-[0_18px_48px_rgba(10,22,43,0.12)] backdrop-blur-xl">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-[#1f5db0]">Newsroom / briefing</p>
              <h3 className="mt-2 font-serif text-2xl font-bold text-[#10203a]">Radar Retro BR</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#4f627f]">
                Coleta automatica de noticias sobre musica brasileira antiga, raridades e entrevistas com leitura mais clara.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchNews(true)}
              disabled={newsLoading}
              className="h-10 rounded-full bg-gradient-to-br from-[#1f5db0] to-[#7fb6ff] px-4 text-xs font-bold uppercase tracking-[0.14em] text-white shadow-[0_10px_24px_rgba(31,93,176,0.22)] disabled:opacity-50"
            >
              {newsLoading ? 'Atualizando...' : 'Atualizar feed'}
            </button>
          </div>

          {newsError ? <p className="mb-4 text-sm text-[#b42318]">{newsError}</p> : null}

          {newsItems.length === 0 ? (
            <p className="rounded-[22px] border border-dashed border-[#cad9ee] bg-white/80 p-4 text-sm text-[#4f627f]">
              Nenhuma noticia encontrada ainda. Clique em &quot;Atualizar feed&quot; para buscar agora.
            </p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.84fr]">
              <article className="overflow-hidden rounded-[28px] border border-[#d8e4f5] bg-white/92 shadow-[0_14px_30px_rgba(10,22,43,0.08)]">
                {featuredNews?.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={featuredNews.image_url}
                    alt={featuredNews.title}
                    className="h-64 w-full object-cover sm:h-72"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-64 items-center justify-center bg-[linear-gradient(135deg,rgba(31,93,176,0.14),rgba(126,224,255,0.12))] text-sm font-semibold uppercase tracking-[0.24em] text-[#1f5db0] sm:h-72">
                    Destaque editorial
                  </div>
                )}
                <div className="p-5 sm:p-6">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[#6f86a8]">
                    <span className="rounded-full bg-[#eaf2ff] px-2 py-1 font-bold text-[#1f5db0]">
                      {featuredNews.source_name || 'Fonte'}
                    </span>
                    {featuredNews.published_at ? <span>{formatNewsDate(featuredNews.published_at)}</span> : null}
                    {typeof featuredNews.score === 'number' ? <span>Score {featuredNews.score.toFixed(1)}</span> : null}
                  </div>
                  <a
                    href={featuredNews.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 block font-serif text-3xl font-bold leading-tight text-[#10203a] transition hover:text-[#1f5db0]"
                  >
                    {featuredNews.title}
                  </a>
                  {featuredNews.summary ? (
                    <p className="mt-3 text-sm leading-7 text-[#4f627f]">{featuredNews.summary}</p>
                  ) : null}
                  {featuredNews.tags ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {featuredNews.tags.split(',').map((tag) => (
                        <span
                          key={tag.trim()}
                          className="rounded-full border border-[#d8e4f5] bg-[#f6f9fd] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5f7391]"
                        >
                          {tag.trim()}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>

              <div className="space-y-4">
                <div className="rounded-[24px] border border-[#d8e4f5] bg-[#0f2a56] p-5 text-white shadow-[0_14px_30px_rgba(15,42,86,0.16)]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#8ecbff]">Ultimos briefings</p>
                  <p className="mt-2 text-sm leading-6 text-white/78">
                    A coluna lateral prioriza leitura rapida, sem poluir o painel principal.
                  </p>
                </div>

                <div className="space-y-3">
                  {briefingNews.map((item) => (
                    <article key={item.source_url} className="rounded-[24px] border border-[#d8e4f5] bg-white/90 p-4 shadow-[0_8px_20px_rgba(10,22,43,0.06)]">
                      <div className="flex items-start gap-3">
                        {item.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.image_url}
                            alt={item.title}
                            className="h-20 w-24 flex-shrink-0 rounded-2xl object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-20 w-24 flex-shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(31,93,176,0.16),rgba(126,224,255,0.12))] text-[10px] font-bold uppercase tracking-[0.18em] text-[#1f5db0]">
                            Briefing
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6f86a8]">
                            <span className="text-[#1f5db0]">{item.source_name || 'Fonte'}</span>
                            {item.published_at ? <span>{formatNewsDate(item.published_at)}</span> : null}
                          </div>
                          <a
                            href={item.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="line-clamp-2 text-sm font-semibold leading-6 text-[#10203a] transition hover:text-[#1f5db0]"
                          >
                            {item.title}
                          </a>
                          {item.summary ? (
                            <p className="mt-1 line-clamp-2 text-xs leading-6 text-[#4f627f]">{item.summary}</p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}


