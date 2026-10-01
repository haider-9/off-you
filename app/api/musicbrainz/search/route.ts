const MUSICBRAINZ_SEARCH_URL = "https://musicbrainz.org/ws/2/recording";
const REQUEST_INTERVAL_MS = 1100;
const CACHE_DURATION_MS = 5 * 60 * 1000;

type CachedResult = { expiresAt: number; body: unknown };
type MusicBrainzGlobals = typeof globalThis & {
  __stillwaveMusicBrainzNextRequest?: number;
  __stillwaveMusicBrainzQueue?: Promise<void>;
  __stillwaveMusicBrainzCache?: Map<string, CachedResult>;
};

async function waitForRateLimit() {
  const globals = globalThis as MusicBrainzGlobals;
  const previousRequest = globals.__stillwaveMusicBrainzQueue ?? Promise.resolve();
  let releaseQueue!: () => void;
  globals.__stillwaveMusicBrainzQueue = new Promise<void>((resolve) => { releaseQueue = resolve; });
  await previousRequest;

  const waitMs = Math.max(0, (globals.__stillwaveMusicBrainzNextRequest ?? 0) - Date.now());
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  globals.__stillwaveMusicBrainzNextRequest = Date.now() + REQUEST_INTERVAL_MS;
  releaseQueue();
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length < 2 || query.length > 120) {
    return Response.json({ error: "Search terms must be 2 to 120 characters." }, { status: 400 });
  }

  const cache = ((globalThis as MusicBrainzGlobals).__stillwaveMusicBrainzCache ??= new Map());
  const cacheKey = query.toLocaleLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return Response.json(cached.body);

  await waitForRateLimit();
  const search = new URL(MUSICBRAINZ_SEARCH_URL);
  search.searchParams.set("query", query);
  search.searchParams.set("fmt", "json");
  search.searchParams.set("limit", "25");

  try {
    const response = await fetch(search, {
      headers: { "User-Agent": "Stillwave/0.1.0 (offline music catalog)" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!response.ok) {
      return Response.json({ error: "MusicBrainz search is temporarily unavailable." }, { status: 502 });
    }

    const data = await response.json();
    const recordings = (data.recordings ?? []).map((recording: Record<string, unknown>) => {
      const credits = Array.isArray(recording["artist-credit"]) ? recording["artist-credit"] as Record<string, unknown>[] : [];
      const artist = credits.map((credit) => {
        if (typeof credit.name === "string") return credit.name;
        const linkedArtist = credit.artist as Record<string, unknown> | undefined;
        return typeof linkedArtist?.name === "string" ? linkedArtist.name : "";
      }).map((name: string, index: number) => `${name}${typeof credits[index]?.joinphrase === "string" ? credits[index].joinphrase : ""}`).join("").trim();
      return {
        id: recording.id,
        title: recording.title,
        artist,
        length: recording.length,
        firstReleaseDate: recording["first-release-date"],
      };
    });
    const body = { recordings, total: data.count ?? recordings.length };
    cache.set(cacheKey, { body, expiresAt: Date.now() + CACHE_DURATION_MS });
    return Response.json(body);
  } catch {
    return Response.json({ error: "Could not reach MusicBrainz. Check your connection and retry." }, { status: 502 });
  }
}