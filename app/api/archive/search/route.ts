const ARCHIVE_SEARCH_URL = "https://archive.org/advancedsearch.php";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();

  if (!query || query.length < 2 || query.length > 120) {
    return Response.json({ error: "Search terms must be 2 to 120 characters." }, { status: 400 });
  }

  const search = new URL(ARCHIVE_SEARCH_URL);
  search.searchParams.set("q", `mediatype:audio AND (${query})`);
  search.searchParams.set("fl[]", "identifier,title,creator,date,year,downloads,description,licenseurl");
  search.searchParams.set("rows", "30");
  search.searchParams.set("page", "1");
  search.searchParams.set("output", "json");

  try {
    const response = await fetch(search, {
      headers: { "User-Agent": "OfflineMusicPWA/1.0" },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });

    if (!response.ok) {
      return Response.json({ error: "Archive.org search is temporarily unavailable." }, { status: 502 });
    }

    const data = await response.json();
    return Response.json({ results: data.response?.docs ?? [], total: data.response?.numFound ?? 0 });
  } catch {
    return Response.json({ error: "Could not reach Archive.org. Check your connection and retry." }, { status: 502 });
  }
}