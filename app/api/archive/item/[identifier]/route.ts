const AUDIO_EXTENSION = /\.(mp3|ogg|flac|m4a|wav|opus|aac)$/i;
const ARCHIVE_IDENTIFIER = /^[a-zA-Z0-9._-]{1,180}$/;

type ArchiveFile = {
  name: string;
  format?: string;
  size?: string;
  source?: string;
  private?: string | boolean;
};

export async function GET(
  _request: Request,
  context: RouteContext<"/api/archive/item/[identifier]">
) {
  const { identifier } = await context.params;

  if (!ARCHIVE_IDENTIFIER.test(identifier)) {
    return Response.json({ error: "Invalid Archive.org item identifier." }, { status: 400 });
  }

  try {
    const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });

    if (!response.ok) {
      return Response.json({ error: "Could not load this Archive.org item." }, { status: 502 });
    }

    const data = await response.json();
    const metadata = data.metadata ?? {};
    const audioFiles = (data.files ?? []).filter((file: ArchiveFile) =>
      AUDIO_EXTENSION.test(file.name) && file.source !== "metadata"
    );
    const tracks = audioFiles
      .filter((file: ArchiveFile) => file.private !== "true" && file.private !== true)
      .map((file: ArchiveFile) => ({
        name: file.name,
        format: file.format ?? file.name.split(".").pop()?.toUpperCase() ?? "Audio",
        size: Number(file.size) || 0,
      }));

    return Response.json({
      identifier,
      title: metadata.title ?? identifier,
      creator: metadata.creator ?? "Unknown creator",
      license: metadata.licenseurl ?? metadata.license ?? "",
      rights: metadata.rights ?? "",
      tracks,
      restrictedAudioCount: audioFiles.length - tracks.length,
    });
  } catch {
    return Response.json({ error: "Could not reach Archive.org. Check your connection and retry." }, { status: 502 });
  }
}