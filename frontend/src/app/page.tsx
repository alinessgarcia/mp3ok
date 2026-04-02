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
  const urlWatcherRef = useRef<Map<string, number>>(new Map());
  const currentUrlTaskIdRef = useRef<string | null>(null);
  const accessToken = session?.access_token || '';

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

  const fetchInfo = async () => {
    if (!url) return;
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
    const controller = new AbortController();
    infoAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), URL_INFO_TIMEOUT_MS);

    try {
      const res = await authFetch(`${apiBase}/api/info?url=${encodeURIComponent(url)}`, {
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
        url,
      };
      const safeEntries = Array.isArray(data?.entries) && data.entries.length > 0 ? data.entries : [fallbackEntry];
      setVideoInfo({
        ...data,
        entries: safeEntries,
        entryCount: Number(data?.entryCount || safeEntries.length),
        isPlaylist: Boolean(data?.isPlaylist || safeEntries.length > 1),
      });
    } catch (error) {
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
      setLoadingInfo(false);
    }
  };

  const cancelInfoSearch = () => {
    if (infoAbortRef.current) {
      infoAbortRef.current.abort();
      infoAbortRef.current = null;
    }
    setLoadingInfo(false);
    setUrlError('Busca cancelada.');
  };

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

    const taskId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    return taskId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, apiBase, format, quality, url]);

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

    urlDownloadQueueRef.current = [...urlDownloadQueueRef.current, ...entries];
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
    completedIds.forEach((id) => closeUrlTaskChannel(id));
    setUrlTasks((prev) => prev.filter((task) => !completedIds.includes(task.id)));
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
            <p className="text-xs uppercase tracking-[0.28em] text-[#8f909e]">OpenDownloader Local</p>
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
    <main className="min-h-screen text-[#dae2fd] selection:bg-[#c3c0ff] selection:text-[#272377]">
      <nav className="fixed top-0 z-50 w-full border-b border-[#454652]/20 bg-[#0b1326]/70 backdrop-blur-2xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-8">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[#8f909e]">OpenDownloader Local</p>
            <p className="mt-1 text-lg font-extrabold tracking-tight text-[#e2dfff]">Transcoder.ai</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden rounded-full border border-[#454652]/35 bg-[#171f33]/75 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#bdf4ff] sm:block">
              Digital Alchemist
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#8f909e]">Logado</p>
              <p className="max-w-[220px] truncate text-xs text-[#c5c5d4]">{session.user.email || '-'}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={authLoading}
              className="h-9 rounded-xl border border-[#454652]/35 bg-[#171f33]/75 px-3 text-xs font-semibold text-[#dae2fd] disabled:opacity-60"
            >
              Sair
            </button>
          </div>
        </div>
      </nav>

      <div className="mx-auto w-full max-w-7xl px-4 pb-14 pt-28 sm:px-8">
        <header className="relative overflow-hidden rounded-[28px] border border-[#454652]/30 bg-gradient-to-br from-[#171f33] via-[#131b2e] to-[#0b1326] p-8 shadow-[0_20px_60px_rgba(6,14,32,0.55)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(195,192,255,0.16),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(157,240,255,0.1),transparent_38%)]" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#454652]/35 bg-[#222a3d]/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#c3c0ff]">
              <span className="h-2 w-2 rounded-full bg-[#9cf0ff] shadow-[0_0_10px_rgba(157,240,255,0.9)]" />
              Processamento em tempo real
            </div>
            <h1 className="mt-4 max-w-4xl text-3xl font-black leading-tight text-[#e2dfff] sm:text-5xl">
              De URL para midia em segundos.
              <span className="block bg-gradient-to-r from-[#c3c0ff] via-[#bdf4ff] to-[#5250a4] bg-clip-text text-transparent">
                Downloader + Conversor + Otimizador + Thumbnail Studio
              </span>
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[#c5c5d4] sm:text-base">
              Cole links, processe arquivos em lote e gere resultados com fila automatica em um painel visual premium.
            </p>
          </div>

          <div className="relative mt-8 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setActiveTab('url')}
              className={`h-12 rounded-full text-sm font-bold uppercase tracking-[0.08em] transition ${
                activeTab === 'url'
                  ? 'bg-gradient-to-br from-[#c3c0ff] to-[#5250a4] text-[#100563] shadow-[0_12px_28px_rgba(195,192,255,0.35)]'
                  : 'border border-[#454652]/35 bg-[#2d3449]/65 text-[#dae2fd] hover:bg-[#31394d]'
              }`}
            >
              Downloader
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('media')}
              className={`h-12 rounded-full text-sm font-bold uppercase tracking-[0.08em] transition ${
                activeTab === 'media'
                  ? 'bg-gradient-to-br from-[#c3c0ff] to-[#5250a4] text-[#100563] shadow-[0_12px_28px_rgba(195,192,255,0.35)]'
                  : 'border border-[#454652]/35 bg-[#2d3449]/65 text-[#dae2fd] hover:bg-[#31394d]'
              }`}
            >
              Conversor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('thumb')}
              className={`h-12 rounded-full text-sm font-bold uppercase tracking-[0.08em] transition ${
                activeTab === 'thumb'
                  ? 'bg-gradient-to-br from-[#c3c0ff] to-[#5250a4] text-[#100563] shadow-[0_12px_28px_rgba(195,192,255,0.35)]'
                  : 'border border-[#454652]/35 bg-[#2d3449]/65 text-[#dae2fd] hover:bg-[#31394d]'
              }`}
            >
              Thumbnails
            </button>
          </div>
        </header>

        {activeTab === 'url' ? (
          <section className="mt-6 space-y-6">
            <div className="rounded-2xl border border-[#454652]/30 bg-[#171f33]/80 p-6 backdrop-blur-xl shadow-[0_18px_40px_rgba(6,14,32,0.35)]">
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="url"
                  placeholder="Cole uma URL de video..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="h-12 flex-1 rounded-xl border border-[#454652]/35 bg-[#060e20] px-4 text-sm outline-none focus:border-[#c3c0ff]"
                />
                <button
                  onClick={fetchInfo}
                  disabled={loadingInfo || !url}
                  className="h-12 rounded-xl bg-gradient-to-br from-[#c3c0ff] to-[#5250a4] px-6 text-sm font-semibold text-[#100563] shadow-[0_10px_24px_rgba(195,192,255,0.35)] disabled:opacity-50"
                >
                  {loadingInfo ? 'Buscando...' : 'Buscar midia'}
                </button>
                {loadingInfo ? (
                  <button
                    type="button"
                    onClick={cancelInfoSearch}
                    className="h-12 rounded-xl border border-rose-400 bg-slate-900 px-4 text-sm font-semibold text-rose-300"
                  >
                    Cancelar
                  </button>
                ) : null}
              </div>
              {urlError ? <p className="mt-3 text-sm text-rose-400">{urlError}</p> : null}
            </div>

            {videoInfo ? (
              <div className="rounded-2xl border border-[#454652]/30 bg-[#171f33]/80 p-6 backdrop-blur-xl shadow-[0_18px_40px_rgba(6,14,32,0.35)]">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                  <div className="h-32 w-full overflow-hidden rounded-xl bg-slate-800 sm:w-56">
                    {videoInfo.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={videoInfo.thumbnail} alt={videoInfo.title} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-bold">{videoInfo.title}</h2>
                    {videoInfo.isPlaylist ? (
                      <p className="mt-1 text-sm text-slate-400">
                        Playlist detectada: {videoInfo.entryCount || videoInfo.entries?.length || 0} item(ns). O download sera feito em fila, um por vez.
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-400">
                        Duracao: {Math.floor(videoInfo.duration / 60)}:{(videoInfo.duration % 60).toString().padStart(2, '0')}
                      </p>
                    )}
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <select
                        value={format}
                        onChange={(e) => setFormat(e.target.value as 'video' | 'audio')}
                        className="h-11 rounded-xl border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                      >
                        <option value="video">MP4 Video</option>
                        <option value="audio">MP3 Audio</option>
                      </select>
                      <select
                        value={quality}
                        onChange={(e) => setQuality(e.target.value)}
                        className="h-11 rounded-xl border border-[#454652]/35 bg-[#060e20] px-3 text-sm"
                        disabled={format === 'audio'}
                      >
                        <option value="best">Best</option>
                        <option value="1080">1080p</option>
                        <option value="720">720p</option>
                        <option value="480">480p</option>
                      </select>
                      <button
                        onClick={startDownload}
                        className="h-11 rounded-xl bg-gradient-to-br from-[#9cf0ff] to-[#00daf3] px-4 text-sm font-semibold text-[#00363d] hover:brightness-110"
                      >
                        {videoInfo.isPlaylist ? 'Download Lista' : 'Download'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {urlTasks.length ? (
              <div className="rounded-2xl border border-[#454652]/28 bg-[#171f33]/72 p-6 backdrop-blur-xl shadow-[0_16px_32px_rgba(6,14,32,0.3)]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">Fila de downloads por URL</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={removeCompletedUrlTasks}
                      disabled={!urlTasks.some((task) => task.status === 'completed' || task.status === 'error')}
                      className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200 disabled:opacity-50"
                    >
                      Remover concluidos
                    </button>
                    <button
                      type="button"
                      onClick={clearUrlTasks}
                      className="rounded-lg border border-rose-400 px-3 py-1 text-xs font-semibold text-rose-300"
                    >
                      Limpar lista
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {urlTasks.map((task) => (
                    <div key={task.id} className="rounded-xl border border-[#454652]/25 bg-[#060e20]/78 p-4">
                      <div className="flex justify-between gap-3">
                        <p className="truncate text-sm font-semibold">{task.title}</p>
                        <p className="text-xs text-slate-400">
                          {task.status === 'error' ? 'Falhou' : task.status === 'completed' ? 'Concluido' : `${task.progress.toFixed(1)}%`}
                        </p>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-slate-800">
                        <div
                          className={`h-2 rounded-full ${task.status === 'error' ? 'bg-rose-500' : task.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-400">{task.size}</p>
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => removeSingleUrlTask(task.id)}
                          className="rounded-lg border border-rose-400 px-3 py-1 text-xs font-semibold text-rose-300"
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

        <section className="mt-8 rounded-2xl border border-[#454652]/30 bg-[#171f33]/80 p-6 backdrop-blur-xl shadow-[0_18px_40px_rgba(6,14,32,0.35)]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-extrabold text-[#e2dfff]">Radar Retro BR</h3>
              <p className="mt-1 text-sm text-[#c5c5d4]">
                Coleta automatica de noticias sobre musica brasileira antiga, raridades e entrevistas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchNews(true)}
              disabled={newsLoading}
              className="h-10 rounded-full bg-gradient-to-br from-[#c3c0ff] to-[#5250a4] px-4 text-xs font-bold uppercase tracking-[0.12em] text-[#100563] shadow-[0_10px_24px_rgba(195,192,255,0.35)] disabled:opacity-50"
            >
              {newsLoading ? 'Atualizando...' : 'Atualizar feed'}
            </button>
          </div>

          {newsError ? <p className="mb-3 text-sm text-rose-400">{newsError}</p> : null}

          {newsItems.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#454652]/35 p-4 text-sm text-[#c5c5d4]">
              Nenhuma noticia encontrada ainda. Clique em &quot;Atualizar feed&quot; para buscar agora.
            </p>
          ) : (
            <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1">
              {newsItems.map((item) => (
                <article key={item.source_url} className="rounded-xl border border-[#454652]/25 bg-[#060e20]/78 p-4">
                  <div className="flex items-start gap-3">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="h-16 w-24 flex-shrink-0 rounded-lg object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.1em] text-[#8f909e]">
                        <span className="font-bold text-[#9cf0ff]">{item.source_name || 'Fonte'}</span>
                        {item.published_at ? (
                          <span>{new Date(item.published_at).toLocaleDateString('pt-BR')}</span>
                        ) : null}
                      </div>
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="line-clamp-2 text-sm font-bold text-[#e2dfff] hover:text-[#bdf4ff]"
                      >
                        {item.title}
                      </a>
                      {item.summary ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#c5c5d4]">{item.summary}</p>
                      ) : null}
                      {item.tags ? (
                        <p className="mt-2 text-[11px] text-[#8f909e]">Tags: {item.tags}</p>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}


