"use client";

import Link from "next/link";
import { Archive, ArrowDownToLine, AudioLines, Check, ChevronDown, CircleHelp, Database, Disc3, Download, ExternalLink, Headphones, Library, LoaderCircle, Music2, Pause, Play, Radio, Search, Signal, Trash2, WifiOff, X } from "lucide-react";
import { FormEvent, MouseEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { deleteOfflineTrack, getOfflineTracks, OfflineTrack, saveOfflineTrack } from "@/lib/offline-library";

type ArchiveResult = { identifier: string; title?: string | string[]; creator?: string | string[]; date?: string | string[]; year?: number | string; downloads?: number };
type AudioFile = { name: string; format: string; size: number };
type ArchiveItem = { identifier: string; title: string; creator: string; license: string; rights: string; tracks: AudioFile[]; restrictedAudioCount: number };
type MusicBrainzRecording = { id: string; title: string; artist: string; length: number | null; firstReleaseDate?: string };
type PlayerTrack = { id: string; title: string; creator: string; src: string; offline: boolean };
type PageView = "discover" | "library" | "musicbrainz";
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineStatus() { return navigator.onLine; }
function getServerOnlineStatus() { return true; }

function text(value: unknown, fallback = "") {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(", ") || fallback;
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function formatBytes(bytes: number) {
  if (!bytes) return "Size varies";
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function audioUrl(identifier: string, file: string) {
  return `/api/archive/download?${new URLSearchParams({ identifier, file })}`;
}

async function readError(response: Response, fallback: string) {
  try { return (await response.json()).error || fallback; } catch { return fallback; }
}

export default function MusicLibrary() {
  const [view, setView] = useState<PageView>("discover");
  const [query, setQuery] = useState("ambient jazz");
  const [results, setResults] = useState<ArchiveResult[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [musicBrainzResults, setMusicBrainzResults] = useState<MusicBrainzRecording[]>([]);
  const [musicBrainzTotal, setMusicBrainzTotal] = useState(0);
  const [selected, setSelected] = useState<ArchiveResult | null>(null);
  const [item, setItem] = useState<ArchiveItem | null>(null);
  const [offlineTracks, setOfflineTracks] = useState<OfflineTrack[]>([]);
  const [activeTrack, setActiveTrack] = useState<PlayerTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingItem, setLoadingItem] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [itemError, setItemError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const online = useSyncExternalStore(subscribeOnline, getOnlineStatus, getServerOnlineStatus);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [storageEstimate, setStorageEstimate] = useState("");
  const objectUrl = useRef("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const visualizerCanvas = useRef<HTMLCanvasElement>(null);
  const audioGraph = useRef<{ context: AudioContext; analyser: AnalyserNode } | null>(null);
  const playbackPosition = useRef(0);
  const trackDuration = useRef(0);

  useEffect(() => {
    let mounted = true;
    getOfflineTracks().then((tracks) => mounted && setOfflineTracks(tracks)).catch(() => mounted && setDownloadError("This browser could not open local music storage."));
    navigator.serviceWorker?.register("/sw.js", { updateViaCache: "none" }).catch(() => undefined);
    navigator.storage?.estimate().then((estimate) => {
      if (mounted && estimate.quota) setStorageEstimate(`${Math.round((estimate.usage ?? 0) / (1024 * 1024))} MB used`);
    });
    const handleInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => {
      mounted = false;
      window.removeEventListener("beforeinstallprompt", handleInstall);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void searchArchive("ambient jazz"); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    void audioGraph.current?.context.close();
  }, []);

  useEffect(() => {
    const canvas = visualizerCanvas.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const analyser = audioGraph.current?.analyser;
    const samples = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let frame = 0;
    let width = 0;
    let height = 0;
    const pixelRatio = window.devicePixelRatio || 1;

    const draw = (time: number) => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      if (width !== bounds.width || height !== bounds.height) {
        width = bounds.width;
        height = bounds.height;
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (analyser && samples) analyser.getByteFrequencyData(samples);

      const count = Math.max(28, Math.min(72, Math.floor(width / 6)));
      const gap = 2;
      const barWidth = Math.max(1, (width - gap * (count - 1)) / count);
      const progress = trackDuration.current ? playbackPosition.current / trackDuration.current : 0;
      for (let index = 0; index < count; index += 1) {
        const sampleIndex = samples ? Math.floor((index / count) * samples.length * 0.82) : 0;
        const pulse = isPlaying ? 0.16 + Math.abs(Math.sin(time * 0.004 + index * 0.71)) * 0.36 : 0.07;
        const amplitude = samples ? samples[sampleIndex] / 255 : pulse;
        const barHeight = Math.max(2, (0.07 + amplitude * 0.82) * height);
        context.fillStyle = index / count <= progress ? "#e56547" : "#496d59";
        context.fillRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
      }
    };

    const resizeObserver = new ResizeObserver(() => draw(performance.now()));
    resizeObserver.observe(canvas);
    draw(0);
    if (isPlaying && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const animate = (time: number) => {
        draw(time);
        frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    }
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [activeTrack?.id, isPlaying]);

  async function searchArchive(searchTerm: string) {
    setLoadingSearch(true);
    setSearchError("");
    try {
      const response = await fetch(`/api/archive/search?q=${encodeURIComponent(searchTerm)}`);
      if (!response.ok) throw new Error(await readError(response, "Search failed."));
      const data = await response.json();
      setResults(data.results ?? []);
      setTotalResults(data.total ?? 0);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed. Please retry.");
      setResults([]);
      setTotalResults(0);
    } finally { setLoadingSearch(false); }
  }

  async function searchMusicBrainz(searchTerm: string) {
    setLoadingSearch(true);
    setSearchError("");
    try {
      const response = await fetch(`/api/musicbrainz/search?q=${encodeURIComponent(searchTerm)}`);
      if (!response.ok) throw new Error(await readError(response, "MusicBrainz search failed."));
      const data = await response.json();
      setMusicBrainzResults(data.recordings ?? []);
      setMusicBrainzTotal(data.total ?? 0);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "MusicBrainz search failed. Please retry.");
      setMusicBrainzResults([]);
      setMusicBrainzTotal(0);
    } finally { setLoadingSearch(false); }
  }

  async function changeSource(source: "discover" | "musicbrainz") {
    setView(source);
    const trimmed = query.trim();
    // A too-short term should not be sent upstream; fall back to the default browse term.
    const searchTerm = trimmed.length >= 2 ? trimmed : "ambient jazz";
    if (source === "musicbrainz") await searchMusicBrainz(searchTerm);
    else await searchArchive(searchTerm);
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!runSearch(value)) return;
    if (view === "musicbrainz") await searchMusicBrainz(value);
    else await searchArchive(value);
  }

  // Returns false and shows guidance when the term is too short to search.
  function runSearch(value: string) {
    if (value.length < 2) {
      setSearchError("Enter at least two characters to search.");
      return false;
    }
    setSelected(null);
    setItem(null);
    return true;
  }

  async function findOnArchive(recording: MusicBrainzRecording) {
    const searchTerm = [recording.title, recording.artist].filter(Boolean).join(" ");
    setQuery(searchTerm);
    setView("discover");
    if (searchTerm.length >= 2) await searchArchive(searchTerm);
  }

  async function openItem(result: ArchiveResult) {
    setSelected(result);
    setItem(null);
    setItemError("");
    setLoadingItem(true);
    try {
      const response = await fetch(`/api/archive/item/${encodeURIComponent(result.identifier)}`);
      if (!response.ok) throw new Error(await readError(response, "Could not load audio files."));
      setItem(await response.json());
    } catch (error) { setItemError(error instanceof Error ? error.message : "Could not load audio files."); }
    finally { setLoadingItem(false); }
  }

  function connectAudioGraph() {
    const audio = audioRef.current;
    if (!audio || !window.AudioContext) return;
    try {
      if (!audioGraph.current) {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.78;
        const source = context.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(context.destination);
        audioGraph.current = { context, analyser };
      }
      if (audioGraph.current.context.state === "suspended") void audioGraph.current.context.resume();
    } catch {
      audioGraph.current = null;
    }
  }

  function playTrack(track: PlayerTrack) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    audioRef.current?.pause();
    connectAudioGraph();
    objectUrl.current = track.offline ? track.src : "";
    playbackPosition.current = 0;
    trackDuration.current = 0;
    setCurrentTime(0);
    setDuration(0);
    setActiveTrack(track);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !activeTrack) return;
    if (audio.paused) {
      connectAudioGraph();
      try {
        await audio.play();
      } catch {
        setDownloadError("Playback could not start. Tap play again or check your connection.");
      }
    } else {
      audio.pause();
    }
  }

  function stopPlayback() {
    audioRef.current?.pause();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
    playbackPosition.current = 0;
    trackDuration.current = 0;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setActiveTrack(null);
  }

  function seekFromVisualizer(event: MouseEvent<HTMLButtonElement>) {
    const audio = audioRef.current;
    if (!audio || !trackDuration.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * trackDuration.current;
  }

  async function downloadTrack(file: AudioFile, archiveItem: ArchiveItem) {
    const id = `${archiveItem.identifier}:${file.name}`;
    if (offlineTracks.some((track) => track.id === id)) return;
    setDownloadingId(id);
    setDownloadProgress(0);
    setDownloadError("");
    try {
      const response = await fetch(audioUrl(archiveItem.identifier, file.name));
      if (!response.ok) throw new Error(await readError(response, "Could not download this audio file."));
      const total = Number(response.headers.get("content-length")) || file.size;
      const reader = response.body?.getReader();
      const chunks: ArrayBuffer[] = [];
      let received = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const copiedChunk = new Uint8Array(value.byteLength);
            copiedChunk.set(value);
            chunks.push(copiedChunk.buffer);
            received += value.byteLength;
            if (total) setDownloadProgress(Math.min(99, Math.round((received / total) * 100)));
          }
        }
      } else {
        const buffer = await response.arrayBuffer();
        chunks.push(buffer);
        received = buffer.byteLength;
      }
      const audio = new Blob(chunks, { type: response.headers.get("content-type") || "audio/mpeg" });
      await saveOfflineTrack({
        id, identifier: archiveItem.identifier, file: file.name,
        title: `${archiveItem.title} · ${file.name.split("/").pop()?.replace(/\.[^.]+$/, "") || file.name}`,
        creator: archiveItem.creator, format: file.format, size: received || audio.size, downloadedAt: Date.now(), audio,
      });
      setOfflineTracks(await getOfflineTracks());
      setDownloadProgress(100);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Download failed. Check available storage and retry.");
    } finally { setDownloadingId(""); }
  }

  async function removeTrack(track: OfflineTrack) {
    try {
      await deleteOfflineTrack(track.id);
      setOfflineTracks((current) => current.filter((saved) => saved.id !== track.id));
      if (activeTrack?.id === track.id) stopPlayback();
    } catch {
      setDownloadError("Could not remove this file from local storage. Try again.");
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    setInstalling(true);
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstalling(false);
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Stillwave home"><span className="brand-mark"><AudioLines size={22} /></span><span>stillwave<span className="brand-period">.</span></span></Link>
        <div className="source-label">YOUR SPACE</div>
        <DesktopNavigation view={view} offlineCount={offlineTracks.length} onNavigate={setView} onMusicBrainz={() => void changeSource("musicbrainz")} />
        <div className="sidebar-rule" /><div className="source-label">SOURCE</div>
        <div className="source-card"><span className="source-icon"><Archive size={17} /></span><span className="source-name"><strong>Internet Archive</strong><small>Public collections</small></span><span className="source-live"><span /></span></div>
        <div className="sidebar-spacer" />
        <div className="local-storage"><div className="storage-heading"><Database size={14} /> ON THIS DEVICE</div><div className="storage-copy">{storageEstimate || `${offlineTracks.length} saved ${offlineTracks.length === 1 ? "track" : "tracks"}`}</div><div className="storage-meter"><span style={{ width: `${Math.min(100, offlineTracks.length * 8)}%` }} /></div><p>Music stays in this browser on this device.</p></div>
        <div className="sidebar-foot"><span className={online ? "connection-dot" : "connection-dot offline"} />{online ? "Connected" : "Offline mode"}</div>
      </aside>

      <main className="main-area" id="main-content">
        <header className="topbar"><div className="breadcrumb"><span>STILLWAVE</span><span className="breadcrumb-slash">/</span><span>{view === "discover" ? "ARCHIVE.ORG" : view === "library" ? "YOUR LIBRARY" : "MUSICBRAINZ"}</span></div><div className="top-actions">{!online && <span className="offline-pill"><WifiOff size={14} /> Offline</span>}{installPrompt && <button className="install-button" onClick={() => void installApp()} disabled={installing}><ArrowDownToLine size={15} />{installing ? "Opening…" : "Install app"}</button>}<span className="avatar" aria-label="Local profile">S</span></div></header>
        <div className="content-scroll">
          {(view === "discover" || view === "musicbrainz") && <>
            <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" />{view === "discover" ? "THE OPEN SOUND LIBRARY" : "MUSIC CATALOG"}</div><h1>{view === "discover" ? <>Find something<br /><em>to keep.</em></> : <>Look it<br /><em>up.</em></>}</h1><p className="intro-copy">{view === "discover" ? "Explore the Internet Archive, then save audio here for wherever the day takes you." : "Search recording credits and releases. MusicBrainz provides metadata, not audio."}</p></div><div className="record-art" aria-hidden="true"><div className="record-groove groove-one" /><div className="record-groove groove-two" /><div className="record-groove groove-three" /><div className="record-label"><AudioLines size={22} /></div><span className="record-hole" /></div></section>
            <form className="search-form" onSubmit={(event) => void submitSearch(event)}><Search className="search-icon" size={19} /><input aria-label="Search open audio" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search artists, recordings, or moods" />{query && <button className="clear-search" type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button>}<button className="search-submit" type="submit" disabled={loadingSearch}>{loadingSearch ? <LoaderCircle size={18} className="spin" /> : <>Search <span>↗</span></>}</button></form>
            <div className="search-meta"><div className="source-switch"><button className={view === "discover" ? "source-tab selected" : "source-tab"} type="button" onClick={() => view !== "discover" && void changeSource("discover")}><Archive size={14} />Archive.org</button><button className={view === "musicbrainz" ? "source-tab selected" : "source-tab"} type="button" onClick={() => view !== "musicbrainz" && void changeSource("musicbrainz")}><Radio size={14} />MusicBrainz</button></div><span className="result-total">{loadingSearch ? "Searching catalog…" : view === "musicbrainz" ? `${musicBrainzTotal.toLocaleString()} recordings` : totalResults ? `${totalResults.toLocaleString()} recordings` : "Open collections"}</span></div>
            {searchError && <div className="inline-alert"><CircleHelp size={16} />{searchError}</div>}{downloadError && <div className="inline-alert download-alert"><CircleHelp size={16} />{downloadError}<button onClick={() => setDownloadError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
            <div className={selected ? "discovery-grid with-detail" : "discovery-grid"}>
              <section className="results-section" aria-label="Search results"><div className="section-heading"><h2>{view === "musicbrainz" ? `Catalog matches for “${query.trim()}”` : query.trim() ? `Results for “${query.trim()}”` : "Search the archive"}</h2><span>{view === "musicbrainz" ? `${musicBrainzTotal} matches` : `${results.length} shown`}</span></div>
                {loadingSearch && (view === "musicbrainz" ? musicBrainzResults.length === 0 : results.length === 0) ? <div className="loading-state"><LoaderCircle className="spin" size={24} /><span>Finding recordings</span></div> : view === "musicbrainz" ? musicBrainzResults.length === 0 && !searchError ? <div className="empty-state"><Disc3 size={24} /><strong>No catalog matches</strong><span>Try another artist, title, or phrase.</span></div> : <div className="musicbrainz-list">{musicBrainzResults.map((recording, index) => <article className="musicbrainz-row" key={recording.id}><span className={`cover-art cover-${index % 5}`}><Music2 size={19} /><span>{String(index + 1).padStart(2, "0")}</span></span><span className="result-info"><strong>{recording.title}</strong><span>{recording.artist || "Artist credit unavailable"}{recording.firstReleaseDate ? ` · ${recording.firstReleaseDate.slice(0, 4)}` : ""}{recording.length ? ` · ${formatTime(recording.length / 1000)}` : ""}</span></span><a className="musicbrainz-link" href={`https://musicbrainz.org/recording/${encodeURIComponent(recording.id)}`} target="_blank" rel="noreferrer" aria-label={`Open ${recording.title} in MusicBrainz`} title="Open MusicBrainz recording"><ExternalLink size={15} /></a><button className="find-archive-button" onClick={() => void findOnArchive(recording)} title="Search this recording on Archive.org"><Search size={14} /><span>Archive</span></button></article>)}</div> : results.length === 0 && !searchError ? <div className="empty-state"><Disc3 size={24} /><strong>No recordings found</strong><span>Try another artist, genre, or phrase.</span></div> : <div className="result-list">{results.map((result, index) => {
                  const title = text(result.title, "Untitled recording");
                  const creator = text(result.creator, "Unknown creator");
                  const isSelected = result.identifier === selected?.identifier;
                  return <div className="result-entry" key={result.identifier}>
                    <button className={isSelected ? "result-row selected" : "result-row"} onClick={() => void openItem(result)}><span className={`cover-art cover-${index % 5}`}><Music2 size={19} /><span>{String(index + 1).padStart(2, "0")}</span></span><span className="result-info"><strong>{title}</strong><span>{creator}</span></span><span className="result-year">{text(result.year || result.date, "AUDIO")}</span><ChevronDown className={isSelected ? "row-chevron turned" : "row-chevron"} size={16} /></button>
                    {isSelected && <ArchiveItemDetails result={result} item={item} loading={loadingItem} error={itemError} offlineTracks={offlineTracks} downloadingId={downloadingId} downloadProgress={downloadProgress} onClose={() => { setSelected(null); setItem(null); }} onPlay={playTrack} onDownload={(file, archiveItem) => void downloadTrack(file, archiveItem)} />}
                  </div>;
                })}</div>}
                <p className="attribution">{view === "musicbrainz" ? <>Recording data supplied by <a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">MusicBrainz <ExternalLink size={11} /></a></> : <>Search results supplied by <a href="https://archive.org/" target="_blank" rel="noreferrer">Internet Archive <ExternalLink size={11} /></a></>}</p>
              </section>
            </div>
          </>}

          {view === "library" && <section className="library-view"><div className="eyebrow"><span className="eyebrow-line" />STORED LOCALLY</div><div className="library-heading"><div><h1>Your <em>offline</em><br />library.</h1><p className="intro-copy">These files are stored in this browser on this device.</p></div><div className="library-count"><strong>{offlineTracks.length.toString().padStart(2, "0")}</strong><span>SAVED FILES</span></div></div><div className="library-toolbar"><span>{offlineTracks.length ? `${offlineTracks.length} ${offlineTracks.length === 1 ? "file" : "files"} ready without internet` : "No saved audio yet"}</span>{storageEstimate && <span><Database size={13} />{storageEstimate}</span>}</div>
            {offlineTracks.length ? <div className="offline-list">{offlineTracks.map((track, index) => <div className="offline-row" key={track.id}><span className={`cover-art cover-${index % 5}`}><Headphones size={19} /></span><span className="result-info"><strong>{track.title}</strong><span>{track.creator}</span></span><span className="offline-format">{track.format} · {formatBytes(track.size)}</span><button className="play-offline" onClick={() => playTrack({ id: track.id, title: track.title, creator: track.creator, src: URL.createObjectURL(track.audio), offline: true })} aria-label={`Play ${track.title}`}><Play size={15} fill="currentColor" /></button><button className="remove-offline" onClick={() => void removeTrack(track)} aria-label={`Remove ${track.title}`} title="Remove download"><Trash2 size={16} /></button></div>)}</div> : <div className="library-empty"><div className="empty-disc"><Disc3 size={32} /></div><h2>A little quiet in here.</h2><p>Find a recording in Discover and save an audio file to keep it close.</p><button className="text-action" onClick={() => setView("discover")}>Explore recordings <span>↗</span></button></div>}
            <div className="storage-warning"><Signal size={16} /><span>Browser storage is managed by your device. Keep an eye on available space for large audio files.</span></div>
          </section>}

        </div>

        <footer className={activeTrack ? "player-bar playing" : "player-bar"}>
          <div className="player-track">
            <span className={activeTrack ? "mini-cover" : "mini-cover idle"}><AudioLines size={17} /></span>
            <span className="player-copy"><strong>{activeTrack?.title || "Nothing playing"}</strong><small>{activeTrack ? <>{activeTrack.creator}{activeTrack.offline && <span className="offline-tag"> · OFFLINE</span>}</> : "Your next favorite is out there."}</small></span>
          </div>
          <button className="visualizer-seek" type="button" onClick={seekFromVisualizer} disabled={!activeTrack || !duration} aria-label={`Seek playback, ${formatTime(currentTime)} of ${formatTime(duration)}`}>
            <canvas ref={visualizerCanvas} aria-hidden="true" />
          </button>
          <div className="player-controls">
            <span className="player-time">{formatTime(currentTime)} <i>/</i> {formatTime(duration)}</span>
            <button className="player-toggle" type="button" onClick={() => void togglePlayback()} disabled={!activeTrack} aria-label={isPlaying ? "Pause playback" : "Resume playback"} title={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            </button>
            <button className="player-stop" type="button" onClick={stopPlayback} disabled={!activeTrack} aria-label="Stop playback" title="Stop playback"><X size={16} /></button>
          </div>
          <audio
            className="audio-engine"
            ref={audioRef}
            src={activeTrack?.src}
            autoPlay={Boolean(activeTrack)}
            preload="metadata"
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              trackDuration.current = value;
              setDuration(value);
            }}
            onTimeUpdate={(event) => {
              const value = event.currentTarget.currentTime;
              playbackPosition.current = value;
              setCurrentTime(value);
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onError={() => { if (activeTrack) setDownloadError("This format could not be played in this browser."); }}
          />
        </footer>
      </main>
      <nav className="mobile-navigation" aria-label="Main navigation">
        <button className={view === "discover" ? "nav-item active" : "nav-item"} onClick={() => setView("discover")}><Search size={17} /><span>Discover</span></button>
        <button className={view === "library" ? "nav-item active" : "nav-item"} onClick={() => setView("library")}><Library size={17} /><span>Offline library</span><span className="nav-count">{offlineTracks.length}</span></button>
        <button className={view === "musicbrainz" ? "nav-item active" : "nav-item"} onClick={() => void changeSource("musicbrainz")}><Radio size={17} /><span>MusicBrainz</span></button>
      </nav>
    </div>
  );
}

function DesktopNavigation({
  view,
  offlineCount,
  onNavigate,
  onMusicBrainz,
}: {
  view: PageView;
  offlineCount: number;
  onNavigate: (view: PageView) => void;
  onMusicBrainz: () => void;
}) {
  return <nav className="primary-nav" aria-label="Main navigation">
    <button className={view === "discover" ? "nav-item active" : "nav-item"} onClick={() => onNavigate("discover")}><Search size={17} /><span>Discover</span></button>
    <button className={view === "library" ? "nav-item active" : "nav-item"} onClick={() => onNavigate("library")}><Library size={17} /><span>Offline library</span><span className="nav-count">{offlineCount}</span></button>
    <button className={view === "musicbrainz" ? "nav-item active" : "nav-item"} onClick={onMusicBrainz}><Radio size={17} /><span>MusicBrainz</span></button>
  </nav>;
}

function ArchiveItemDetails({
  result,
  item,
  loading,
  error,
  offlineTracks,
  downloadingId,
  downloadProgress,
  onClose,
  onPlay,
  onDownload,
}: {
  result: ArchiveResult;
  item: ArchiveItem | null;
  loading: boolean;
  error: string;
  offlineTracks: OfflineTrack[];
  downloadingId: string;
  downloadProgress: number;
  onClose: () => void;
  onPlay: (track: PlayerTrack) => void;
  onDownload: (file: AudioFile, archiveItem: ArchiveItem) => void;
}) {
  const title = item?.title || text(result.title, "Untitled collection");
  const creator = item?.creator || text(result.creator, "Unknown creator");

  return <aside className="detail-panel" aria-label={`${title} audio details`}>
    <div className="detail-topline"><span>COLLECTION DETAILS</span><button className="detail-close" onClick={onClose} aria-label="Close details"><X size={16} /></button></div>
    <div className="detail-art"><div className="detail-art-inner"><AudioLines size={42} /><span>OPEN<br />SOUND</span></div><div className="detail-art-noise" /></div>
    <h2>{title}</h2>
    <p className="detail-creator">{creator}</p>
    <div className="archive-id"><span>ARCHIVE IDENTIFIER</span><code>{result.identifier}</code></div>
    {(item?.license || item?.rights) && <div className="rights-note">{item.license ? <a href={item.license} target="_blank" rel="noreferrer">View license <ExternalLink size={11} /></a> : item.rights}</div>}
    <div className="files-heading"><span>AVAILABLE AUDIO</span><span>{item?.tracks.length ?? "—"} FILES</span></div>
    {loading ? <div className="detail-loading"><LoaderCircle size={18} className="spin" />Loading files…</div> : error ? <div className="detail-error">{error}</div> : item?.tracks.length ? <div className="file-list">{item.tracks.slice(0, 12).map((file) => {
      const id = `${item.identifier}:${file.name}`;
      const saved = offlineTracks.some((track) => track.id === id);
      const fileTitle = file.name.split("/").pop()?.replace(/\.[^.]+$/, "") || file.name;
      return <div className="file-row" key={file.name}>
        <button className="file-play" onClick={() => onPlay({ id, title: `${item.title} · ${fileTitle}`, creator: item.creator, src: audioUrl(item.identifier, file.name), offline: false })} aria-label={`Play ${fileTitle}`}><Play size={13} fill="currentColor" /></button>
        <span className="file-info"><strong title={fileTitle}>{fileTitle}</strong><small>{file.format} · {formatBytes(file.size)}</small></span>
        <button className={saved ? "file-download saved" : "file-download"} onClick={() => onDownload(file, item)} disabled={saved || Boolean(downloadingId)} title={saved ? "Saved offline" : "Save offline"} aria-label={saved ? "Saved offline" : `Save ${fileTitle} offline`}>
          {downloadingId === id ? <span className="progress-number">{downloadProgress}%</span> : saved ? <Check size={16} /> : <Download size={16} />}
        </button>
      </div>;
    })}</div> : !loading && !error ? <div className="detail-error">{item?.restrictedAudioCount ? "Audio files exist, but Archive.org marks them restricted." : "No supported audio files were listed for this item."}</div> : null}
    <p className="rights-reminder">Check the item’s rights before saving or sharing. Public access does not always mean public domain.</p>
    <a className="archive-link" href={`https://archive.org/details/${encodeURIComponent(result.identifier)}`} target="_blank" rel="noreferrer">Open item at Archive.org <ExternalLink size={13} /></a>
  </aside>;
}