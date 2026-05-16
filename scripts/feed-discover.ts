// Discover the RSS/Atom feed URL for a given page URL.

export function discoverFeedFromUrl(url: string): string | null {
  // Already feed-shaped
  if (/\.(xml|rss|atom)(\?|$)/i.test(url)) return url;
  if (/\/(feed|rss|atom)\/?(\?|$)/i.test(url)) return url;

  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.replace(/\/$/, "");

    // YouTube
    if (host === "www.youtube.com" || host === "youtube.com") {
      const handleMatch = path.match(/^\/@([^\/]+)/);
      if (handleMatch) return `https://www.youtube.com/feeds/videos.xml?user=${handleMatch[1]}`;
      const channelMatch = path.match(/^\/channel\/([^\/]+)/);
      if (channelMatch) return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelMatch[1]}`;
    }

    // Substack: any *.substack.com root
    if (host.endsWith(".substack.com")) {
      return `https://${host}/feed`;
    }

    return null;
  } catch {
    return null;
  }
}

// Search an HTML document for an RSS/Atom <link rel="alternate"> and return the absolute URL.
export function discoverFeedFromHtml(html: string, baseUrl: string): string | null {
  // The attribute order can vary; try the two common orderings first, then a fallback.
  const re = /<link[^>]*rel=["']alternate["'][^>]*type=["']application\/(rss\+xml|atom\+xml)["'][^>]*href=["']([^"']+)["']/i;
  const reAlt = /<link[^>]*type=["']application\/(rss\+xml|atom\+xml)["'][^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i;
  const reHrefFirst = /<link[^>]*href=["']([^"']+)["'][^>]*type=["']application\/(rss\+xml|atom\+xml)["'][^>]*rel=["']alternate["']/i;
  let href: string | null = null;
  for (const r of [re, reAlt]) {
    const m = html.match(r);
    if (m) { href = m[2]; break; }
  }
  if (!href) {
    const m = html.match(reHrefFirst);
    if (m) href = m[1];
  }
  if (!href) return null;
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}

// Combined: try URL heuristics first, then fetch HTML and look for <link rel="alternate">.
export async function discoverFeed(url: string): Promise<string | null> {
  const fromUrl = discoverFeedFromUrl(url);
  if (fromUrl) return fromUrl;
  try {
    const res = await fetch(url, { headers: { "user-agent": "gbrain-personal-rss/0.1" } });
    if (!res.ok) return null;
    const html = await res.text();
    return discoverFeedFromHtml(html, url);
  } catch {
    return null;
  }
}
