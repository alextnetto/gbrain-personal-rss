import { XMLParser } from "fast-xml-parser";
import { createHash } from "crypto";

export interface ParsedItem {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  enclosure_url?: string;
  duration?: number;
  summary?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false,
  // Disable XML entity expansion — Simon Willison's atom feed (and others) hit
  // the default 1000-entity limit. We don't need entities expanded; the body
  // text passes through to the LLM regardless.
  processEntities: false,
});

const hashId = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

// Item IDs become filesystem path segments (items/<source>/<id>.md), so they
// must be slug-safe. If the feed's <guid> is a URL or contains punctuation,
// hash it instead of using it directly.
const safeId = (raw: string | undefined, fallbackSeed: string): string =>
  raw && /^[a-zA-Z0-9_-]{1,80}$/.test(raw) ? raw : hashId(raw ?? fallbackSeed);

export function parseRssItems(xml: string): ParsedItem[] {
  const doc = parser.parse(xml);
  const items: ParsedItem[] = [];

  // RSS 2.0
  const rssItems = doc?.rss?.channel?.item;
  if (rssItems) {
    const arr = Array.isArray(rssItems) ? rssItems : [rssItems];
    for (const it of arr) {
      const url = typeof it.link === "string" ? it.link : it.link?.["#text"] ?? "";
      const enc = it.enclosure;
      const itunesDuration = it["itunes:duration"];
      const rawGuid = it.guid?.["#text"] ?? it.guid;
      items.push({
        id: safeId(typeof rawGuid === "string" ? rawGuid : undefined, url),
        title: typeof it.title === "string" ? it.title : it.title?.["#text"] ?? "",
        url,
        published_at: it.pubDate ?? null,
        enclosure_url: enc?.["@_url"],
        duration: itunesDuration ? Number(itunesDuration) : undefined,
        summary: it.description,
      });
    }
    return items;
  }

  // Atom
  const entries = doc?.feed?.entry;
  if (entries) {
    const arr = Array.isArray(entries) ? entries : [entries];
    for (const e of arr) {
      const link = Array.isArray(e.link) ? e.link[0] : e.link;
      const url = link?.["@_href"] ?? "";
      items.push({
        id: safeId(typeof e.id === "string" ? e.id : undefined, url),
        title: typeof e.title === "string" ? e.title : e.title?.["#text"] ?? "",
        url,
        published_at: e.published ?? e.updated ?? null,
        summary: e.summary,
      });
    }
  }
  return items;
}

// CLI entry: bun run scripts/fetch-rss.ts <feed_url> [etag]
// Writes JSON { items, etag?, status } to stdout.
export async function fetchAndParse(feedUrl: string, etag?: string): Promise<{ items: ParsedItem[]; etag: string | null; status: number; error?: string }> {
  const headers: Record<string, string> = { "user-agent": "gbrain-personal-rss/0.1" };
  if (etag) headers["if-none-match"] = etag;
  const res = await fetch(feedUrl, { headers });
  if (res.status === 304) return { items: [], etag: etag ?? null, status: 304 };
  if (!res.ok) return { items: [], etag: null, status: res.status, error: res.statusText };
  const xml = await res.text();
  return { items: parseRssItems(xml), etag: res.headers.get("etag"), status: 200 };
}

if (import.meta.main) {
  const [feedUrl, etag] = Bun.argv.slice(2);
  if (!feedUrl) { console.error("usage: fetch-rss.ts <feed_url> [etag]"); process.exit(2); }
  console.log(JSON.stringify(await fetchAndParse(feedUrl, etag)));
}
