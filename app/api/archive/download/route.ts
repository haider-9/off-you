const ARCHIVE_IDENTIFIER = /^[a-zA-Z0-9._-]{1,180}$/;
const AUDIO_EXTENSION = /\.(mp3|ogg|flac|m4a|wav|opus|aac)$/i;

type ArchiveMetadata = {
  dir?: string;
  server?: string;
  d1?: string;
  d2?: string;
  workable_servers?: string[];
  files?: Array<{ name: string; private?: string | boolean }>;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const identifier = requestUrl.searchParams.get("identifier") ?? "";
  const file = requestUrl.searchParams.get("file") ?? "";
  const parts = file.split("/");

  if (
    !ARCHIVE_IDENTIFIER.test(identifier) ||
    file.length > 500 ||
    !AUDIO_EXTENSION.test(file) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    return Response.json({ error: "Invalid Archive.org audio file." }, { status: 400 });
  }

  const headers = new Headers({ "User-Agent": "Stillwave/0.1.0 (offline music player)" });
  const range = request.headers.get("range");
  if (range) headers.set("range", range);

  try {
    const metadataResponse = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!metadataResponse.ok) {
      return Response.json({ error: "Could not verify this Archive.org audio file." }, { status: 502 });
    }

    const metadata = await metadataResponse.json() as ArchiveMetadata;
    const archiveFile = metadata.files?.find((entry) => entry.name === file);
    if (!archiveFile || archiveFile.private === "true" || archiveFile.private === true) {
      return Response.json({ error: "This audio file is unavailable or restricted." }, { status: 404 });
    }

    const encodedFile = parts.map(encodeURIComponent).join("/");
    const hosts = [...new Set([
      ...(metadata.workable_servers ?? []),
      metadata.server,
      metadata.d1,
      metadata.d2,
    ].filter((host): host is string => typeof host === "string" && /^[a-z0-9.-]+$/i.test(host)))];
    const audioUrls = [
      ...(metadata.dir ? hosts.map((host) => `https://${host}${metadata.dir}/${encodedFile}`) : []),
      `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedFile}`,
    ];

    let response: Response | undefined;
    for (const audioUrl of audioUrls) {
      const candidate = await fetch(audioUrl, {
        headers,
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
      if (candidate.ok || candidate.status === 206) {
        response = candidate;
        break;
      }
      await candidate.body?.cancel();
    }
    if (!response) {
      return Response.json({ error: "Archive.org could not provide this audio file right now." }, { status: 502 });
    }

    const responseHeaders = new Headers({
      "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
      "Accept-Ranges": response.headers.get("accept-ranges") ?? "bytes",
      "Cache-Control": "no-store",
    });
    for (const name of ["content-length", "content-range"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: "Audio transfer failed. Check your connection and retry." }, { status: 502 });
  }
}