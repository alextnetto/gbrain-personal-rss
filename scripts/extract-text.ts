// Fetch a URL and return its readable text. Crude but enough for blog posts and Substack.
export function stripHtml(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { title, text: body };
}

export async function extractFromUrl(url: string): Promise<{ url: string; title: string; text: string; fetched_at: string } | { url: string; error: string; status: number }> {
  const res = await fetch(url, { headers: { "user-agent": "gbrain-personal-rss/0.1" } });
  if (!res.ok) return { url, error: res.statusText, status: res.status };
  const html = await res.text();
  const { title, text } = stripHtml(html);
  return { url, title, text, fetched_at: new Date().toISOString() };
}

if (import.meta.main) {
  const url = Bun.argv[2];
  if (!url) { console.error("usage: extract-text.ts <url>"); process.exit(2); }
  console.log(JSON.stringify(await extractFromUrl(url)));
}
