'use client';
import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoInfo, setVideoInfo] = useState<any>(null);

  const [format, setFormat] = useState('video');
  const [quality, setQuality] = useState('best');
  const [tasks, setTasks] = useState<any[]>([]);

  const fetchInfo = async () => {
    if (!url) return;
    setLoading(true);
    setError('');
    setVideoInfo(null);
    try {
      const res = await fetch(`https://mp3ok.onrender.com/api/info?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to fetch video info');
      }
      const data = await res.json();
      setVideoInfo(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startDownload = () => {
    if (!videoInfo || !url) return;

    const taskId = Date.now().toString() + Math.random().toString(36).substring(7);

    // Create new task entry
    setTasks(prev => [...prev, {
      id: taskId,
      title: videoInfo.title,
      thumbnail: videoInfo.thumbnail,
      progress: 0,
      size: 'Starting...',
      status: 'downloading'
    }]);

    // Setup SSE connection
    const evtSource = new EventSource(`https://mp3ok.onrender.com/api/progress?id=${taskId}`);

    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setTasks(prev => prev.map(t => {
        if (t.id === taskId) {
          return { ...t, progress: data.percentage, size: data.size };
        }
        return t;
      }));
      if (data.percentage >= 100) {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'completed', progress: 100 } : t));
        evtSource.close();
      }
    };

    evtSource.onerror = (err) => {
      console.error("SSE Error:", err);
      // Backend closes when stream is interrupted or finished. Assume success if progress > 95
      setTasks(prev => prev.map(t => {
        if (t.id === taskId && t.progress < 95) return { ...t, status: 'error' };
        if (t.id === taskId && t.progress >= 95) return { ...t, status: 'completed', progress: 100 };
        return t;
      }));
      evtSource.close();
    };

    // Trigger standard browser download
    const downloadUrl = `https://mp3ok.onrender.com/api/download?url=${encodeURIComponent(url)}&format=${format}&quality=${quality}&id=${taskId}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <main className="flex min-h-screen flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-4xl space-y-8">

        {/* Header section */}
        <div className="text-center">
          <h1 className="text-5xl font-extrabold tracking-tight text-white mb-4">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">OpenDownloader</span>
          </h1>
          <p className="text-lg text-slate-300">
            Download videos and audio from YouTube, Vimeo, Twitter & TikTok cleanly.
          </p>
        </div>

        {/* Action Bar */}
        <div className="bg-slate-800/50 backdrop-blur-md rounded-2xl p-6 shadow-xl border border-slate-700/50">
          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="url"
              placeholder="Paste video URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
            <button
              onClick={fetchInfo}
              disabled={loading || !url}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {loading ? 'Fetching...' : 'Fetch Media'}
            </button>
          </div>
          {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}
        </div>

        {/* Media Info Card */}
        {videoInfo && (
          <div className="bg-slate-800/50 backdrop-blur-md rounded-2xl overflow-hidden shadow-xl border border-slate-700/50 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row">
              <div className="md:w-1/3 relative aspect-video md:aspect-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={videoInfo.thumbnail} alt="Thumbnail" className="w-full h-full object-cover" />
              </div>
              <div className="p-6 md:w-2/3 flex flex-col justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white mb-2 line-clamp-2">{videoInfo.title}</h2>
                  <p className="text-slate-400 text-sm mb-6">Duration: {Math.floor(videoInfo.duration / 60)}:{(videoInfo.duration % 60).toString().padStart(2, '0')}</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 items-end">
                  <div className="flex-1 w-full">
                    <label className="block text-sm font-medium text-slate-400 mb-1">Format</label>
                    <select
                      value={format}
                      onChange={(e) => setFormat(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    >
                      <option value="video">MP4 Video</option>
                      <option value="audio">MP3 Audio</option>
                    </select>
                  </div>

                  {format === 'video' && (
                    <div className="flex-1 w-full">
                      <label className="block text-sm font-medium text-slate-400 mb-1">Quality</label>
                      <select
                        value={quality}
                        onChange={(e) => setQuality(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="best">Best Available</option>
                        <option value="1080">1080p</option>
                        <option value="720">720p</option>
                        <option value="480">480p</option>
                      </select>
                    </div>
                  )}

                  <button
                    onClick={startDownload}
                    className="w-full sm:w-auto px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Download
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Downloads Queue */}
        {tasks.length > 0 && (
          <div className="bg-slate-800/30 rounded-2xl p-6 border border-slate-700/30">
            <h3 className="text-lg font-semibold text-white mb-4">Downloads Queue</h3>
            <div className="space-y-4">
              {tasks.map(task => (
                <div key={task.id} className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50 flex flex-col sm:flex-row items-center gap-4">
                  <div className="w-16 h-12 bg-slate-800 rounded flex-shrink-0 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {task.thumbnail && <img src={task.thumbnail} alt="" className="w-full h-full object-cover" />}
                  </div>

                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex justify-between items-end mb-1">
                      <p className="text-sm font-medium text-white truncate pr-4">{task.title}</p>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {task.status === 'error' ? 'Failed' :
                          task.status === 'completed' ? 'Done' :
                            `${task.progress.toFixed(1)}%`}
                      </span>
                    </div>

                    <div className="w-full bg-slate-800 rounded-full h-2 mb-1 overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${task.status === 'error' ? 'bg-red-500' :
                          task.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-500'
                          }`}
                        style={{ width: `${task.progress}%` }}
                      ></div>
                    </div>
                    <div className="text-xs text-slate-500 flex justify-between">
                      <span>{task.size}</span>
                      {task.status === 'downloading' && <span>Downloading...</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
