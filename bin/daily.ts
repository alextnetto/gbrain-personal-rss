#!/usr/bin/env bun
// Daily content brief generator.
// Reads interests + following.md + inbox.md from a vault folder, fetches RSS
// feeds + articles, asks Claude to write a brief, writes it back to
// daily/<date>.md. Auto-clears the inbox after a successful run.
//
// Env:
//   ANTHROPIC_API_KEY    required
//   PERSONAL_RSS_VAULT   path to the vault dir that contains personal-rss/
//                        (default: /Users/netto/work/hackathons/yc-gbrain/notes/gbrain)
//   PERSONAL_RSS_MODEL   anthropic model id (default: claude-sonnet-4-5)
//   PERSONAL_RSS_DATE    override "today" as YYYY-MM-DD (for backfilling).
//                        When set, the inbox is NOT auto-cleared.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { fetchAndParse } from "../scripts/fetch-rss";

const VAULT = process.env.PERSONAL_RSS_VAULT
  ?? "/Users/netto/work/hackathons/yc-gbrain/notes/gbrain";
const PERSONAL_RSS = join(VAULT, "personal-rss");
const MODEL = process.env.PERSONAL_RSS_MODEL ?? "claude-sonnet-4-5";

const ITEMS_PER_FEED_CAP = 12;
const BODY_CHARS_CAP = 4000;
const WINDOW_MS = 24 * 3600 * 1000; // items in the 24h before the date

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function resolveDate(): { date: Date; isBackfill: boolean } {
  const override = process.env.PERSONAL_RSS_DATE;
  if (!override) return { date: new Date(), isBackfill: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(override)) throw new Error(`PERSONAL_RSS_DATE must be YYYY-MM-DD, got: ${override}`);
  const [y, m, d] = override.split("-").map(Number);
  return { date: new Date(y, m - 1, d, 23, 59, 59), isBackfill: true };
}

function parseFollowing(src: string): Array<{ url: string; description: string }> {
  const out: Array<{ url: string; description: string }> = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !/^https?:\/\//i.test(line)) continue;
    const sep = line.indexOf(" - ");
    if (sep === -1) out.push({ url: line, description: "" });
    else out.push({ url: line.slice(0, sep).trim(), description: line.slice(sep + 3).trim() });
  }
  return out;
}

function parseInbox(src: string): string[] {
  const out: string[] = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !/^https?:\/\//i.test(line)) continue;
    out.push(line);
  }
  return out;
}

async function fetchArticle(url: string): Promise<{ title: string; body: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; personal-rss/0.3)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BODY_CHARS_CAP);
  return { title, body };
}

interface FetchedItem {
  url: string;
  title: string;
  source_title: string;        // "Dwarkesh Podcast" / "Inbox" / etc.
  source_url: string;          // the feed URL or "inbox"
  source_description: string;  // the user's description, "" for inbox
  body: string;
  inbox?: boolean;             // when true, brief MUST include it
}

const BRIEF_PROMPT = `You write a daily content brief. Your only output is a Markdown document — no preamble, no JSON, no surrounding code fences.

You receive three labeled sections in the user message:
- "## interests" — the user's free-text taste model.
- "## date" — the date this brief is for, as YYYY-MM-DD.
- "## items" — a JSON array of items: {url, title, source_title, source_url, source_description, body, inbox?}.

Pick the most relevant items given the interests. **Items with \`inbox: true\` MUST always be included regardless of relevance — the user explicitly saved them.** Beyond the inbox items, pick 3–5 of the highest-signal feed items.

For each picked item, emit exactly:

## <source_title> — [<title>](<url>) — <N> min read
<one sentence: why this matters. For inbox items, say "Saved to your inbox." For feed items, name a specific stated interest the item matches>
> <a few sentences quoted from the body that show the substance of the piece>

Lead with: # Daily Brief — <date>

Rules:
- Output ONLY markdown. No preamble. No JSON. No code fences around the output.
- Each item heading MUST follow "## <source_title> — [<title>](<url>) — <N> min read" verbatim, with two em-dashes (—) as separators.
- Inbox items ALWAYS appear; feed items only if relevant.
- "why" for feed items must name a specific interest (bad: "interesting AI news"; good: "matches your post-LLM stack interest").
- Quote from the body verbatim. If body is empty/error, skip that item (but still try to surface inbox items even with thin bodies).
- Order: inbox items first (in the order they appear in the array), then feed items by relevance.
- N is your reading-time estimate (~220 wpm). Use "min read" for text, "min listen" for podcasts/audio.
- Plain markdown links. No deep-link anchors.`;

async function main() {
  const { date: today, isBackfill } = resolveDate();
  const todayStr = dateStr(today);
  const cutoff = today.getTime() - WINDOW_MS;

  console.log(`[daily] start ${new Date().toISOString()} (brief date: ${todayStr}${isBackfill ? ", backfill" : ""})`);
  console.log(`[daily] vault: ${PERSONAL_RSS}`);

  // 1. Read user files.
  const interestsPath = join(PERSONAL_RSS, "interests.md");
  const followingPath = join(PERSONAL_RSS, "following.md");
  const inboxPath = join(PERSONAL_RSS, "inbox.md");
  if (!existsSync(interestsPath)) throw new Error(`missing ${interestsPath}`);
  if (!existsSync(followingPath)) throw new Error(`missing ${followingPath}`);
  const interests = readFileSync(interestsPath, "utf8");
  const subs = parseFollowing(readFileSync(followingPath, "utf8"));
  const inboxUrls = existsSync(inboxPath) ? parseInbox(readFileSync(inboxPath, "utf8")) : [];
  console.log(`[daily] ${subs.length} subscriptions, ${inboxUrls.length} inbox items`);

  // 2. Fetch feeds in parallel.
  const feedResults = await Promise.allSettled(subs.map(async (sub) => {
    const fetched = await fetchAndParse(sub.url);
    if (fetched.status !== 200) throw new Error(`status ${fetched.status}`);
    const recent = fetched.items
      .filter((it) => {
        if (!it.url) return false;
        const ts = it.published_at ? Date.parse(it.published_at) : Date.now();
        return ts >= cutoff && ts <= today.getTime();
      })
      .slice(0, ITEMS_PER_FEED_CAP);
    return { sub, source_title: fetched.source_title, items: recent };
  }));

  type FeedOk = { sub: typeof subs[number]; source_title: string; items: any[] };
  const feedsOk: FeedOk[] = [];
  feedResults.forEach((r, i) => {
    if (r.status === "fulfilled") feedsOk.push(r.value);
    else console.warn(`[feed ${subs[i].url}] ${(r.reason as Error)?.message ?? r.reason}`);
  });

  // 3a. Fetch feed articles + 3b. Fetch inbox URLs — both in parallel.
  const feedJobs: Promise<FetchedItem | null>[] = [];
  for (const f of feedsOk) {
    for (const it of f.items) {
      feedJobs.push(
        fetchArticle(it.url)
          .then(({ body }) => ({
            url: it.url,
            title: it.title,
            source_title: f.source_title || f.sub.description || f.sub.url,
            source_url: f.sub.url,
            source_description: f.sub.description,
            body,
          }))
          .catch((e) => { console.warn(`[item ${it.url}] ${e.message ?? e}`); return null; }),
      );
    }
  }

  const inboxJobs: Promise<{ url: string; item: FetchedItem | null }>[] = inboxUrls.map((url) =>
    fetchArticle(url)
      .then(({ title, body }) => ({
        url,
        item: {
          url,
          title: title || url,
          source_title: "Inbox",
          source_url: "inbox",
          source_description: "",
          body,
          inbox: true,
        } as FetchedItem,
      }))
      .catch((e) => { console.warn(`[inbox ${url}] ${e.message ?? e}`); return { url, item: null }; }),
  );

  const [feedItems, inboxResults] = await Promise.all([
    Promise.all(feedJobs).then((xs) => xs.filter((x): x is FetchedItem => x !== null)),
    Promise.all(inboxJobs),
  ]);

  const inboxItemsOk: FetchedItem[] = [];
  const inboxUrlsFetched = new Set<string>();
  const inboxUrlsFailed = new Set<string>();
  for (const { url, item } of inboxResults) {
    if (item) { inboxItemsOk.push(item); inboxUrlsFetched.add(url); }
    else inboxUrlsFailed.add(url);
  }

  const items: FetchedItem[] = [...inboxItemsOk, ...feedItems];
  console.log(`[daily] ${items.length} items total (${inboxItemsOk.length} inbox + ${feedItems.length} feed)`);

  if (items.length === 0) {
    const briefMd = `# Daily Brief — ${todayStr}\n\n_(no items published in the 24h window for this date, no inbox items)_\n`;
    const dailyDir = join(PERSONAL_RSS, "daily");
    if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
    writeFileSync(join(dailyDir, `${todayStr}.md`), briefMd);
    console.log(`[daily] wrote empty brief for ${todayStr}`);
    return;
  }

  // 4. Anthropic call.
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const anthropic = new Anthropic();
  const userMessage = [
    "## interests", interests || "(empty)",
    "", "## date", todayStr,
    "", "## items", JSON.stringify(items, null, 2),
  ].join("\n");

  console.log(`[daily] calling ${MODEL}...`);
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: BRIEF_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("anthropic returned no text block");
  const briefMd = block.text.trim() + "\n";

  // 5. Write brief.
  const dailyDir = join(PERSONAL_RSS, "daily");
  if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
  const outPath = join(dailyDir, `${todayStr}.md`);
  writeFileSync(outPath, briefMd);
  console.log(`[daily] wrote ${outPath} (${briefMd.length} chars)`);

  // 6. Move processed inbox URLs → seen.md, then clear them from inbox.md.
  //    Skip on backfill (preserves user's inbox state across historical runs).
  if (!isBackfill && inboxUrlsFetched.size > 0) {
    // 6a. Append to seen.md (one URL per line, with a date comment for context).
    const seenPath = join(PERSONAL_RSS, "seen.md");
    const seenBefore = existsSync(seenPath) ? readFileSync(seenPath, "utf8") : "";
    const seenLines = Array.from(inboxUrlsFetched).map((u) => `${u}  # ${todayStr}`);
    const seenAfter = (seenBefore.replace(/\s+$/, "") + (seenBefore.trim() ? "\n" : "") + seenLines.join("\n") + "\n").replace(/^\n+/, "");
    writeFileSync(seenPath, seenAfter);

    // 6b. Remove processed URLs from inbox.md.
    const keep: string[] = [];
    const original = existsSync(inboxPath) ? readFileSync(inboxPath, "utf8") : "";
    for (const raw of original.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#")) { keep.push(line); continue; }
      if (!/^https?:\/\//i.test(line)) { keep.push(line); continue; }
      if (inboxUrlsFetched.has(line)) continue; // processed — drop it
      keep.push(line);
    }
    const newBody = keep.length ? keep.join("\n") + "\n" : "";
    writeFileSync(inboxPath, newBody);

    console.log(`[daily] moved ${inboxUrlsFetched.size} URL(s) inbox → seen` +
      (inboxUrlsFailed.size > 0 ? `; ${inboxUrlsFailed.size} kept in inbox (fetch failed)` : ""));
  }
}

main().catch((err) => {
  console.error("[daily] FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
