#!/usr/bin/env bun
// Daily content brief generator.
// Reads interests + following.md from a vault folder, fetches RSS feeds + articles,
// asks Claude to write a brief, writes it back to daily/<date>.md.
//
// Env:
//   ANTHROPIC_API_KEY    required
//   PERSONAL_RSS_VAULT   path to the vault dir that contains personal-rss/
//                        (default: /Users/netto/work/hackathons/yc-gbrain/notes/gbrain)
//   PERSONAL_RSS_MODEL   anthropic model id (default: claude-sonnet-4-5)
//   PERSONAL_RSS_DATE    override "today" as YYYY-MM-DD (for backfilling)
//                        (the brief covers items in the 24h before that date)

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

function resolveDate(): Date {
  const override = process.env.PERSONAL_RSS_DATE;
  if (!override) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(override)) throw new Error(`PERSONAL_RSS_DATE must be YYYY-MM-DD, got: ${override}`);
  // Treat the override as end-of-day local time (so window is full 24h preceding).
  const [y, m, d] = override.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59);
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

async function fetchArticleBody(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; personal-rss/0.2)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BODY_CHARS_CAP);
}

interface FetchedItem {
  url: string;
  title: string;
  source_title: string;        // the feed's channel title (author/publication)
  source_url: string;          // the feed URL from following.md
  source_description: string;  // the user's description for this source
  body: string;
}

const BRIEF_PROMPT = `You write a daily content brief. Your only output is a Markdown document — no preamble, no JSON, no surrounding code fences.

You receive three labeled sections in the user message:
- "## interests" — the user's free-text taste model.
- "## date" — the date this brief is for, as YYYY-MM-DD.
- "## items" — a JSON array of items: {url, title, source_title, source_url, source_description, body}.

Pick the 4–6 most relevant items given the interests. For each, emit exactly:

## <source_title> — [<title>](<url>) — <N> min read
<one sentence: why this matters given the user's interests, naming a specific stated interest>
> <a few sentences quoted from the body that show the substance of the piece>

Lead with: # Daily Brief — <date>

Rules:
- Output ONLY markdown. No preamble. No JSON. No code fences around the output.
- Each item heading MUST follow the format "## <source_title> — [<title>](<url>) — <N> min read" verbatim, with two em-dashes (—) as separators.
- 4–6 items. Quality over quantity. If fewer than 4 meet a meaningful bar, add the line "_(slim day — only N items met the bar)_" under the H1.
- "why" must name a specific interest (bad: "interesting AI news"; good: "matches your post-LLM stack interest").
- Quote from the body verbatim. If body is empty/error, skip the item.
- Order by your judgment of relevance (best first).
- N is your reading-time estimate (~220 wpm). Use "min read" for text and "min listen" for podcasts/audio.
- Plain markdown links. No deep-link anchors.`;

async function main() {
  const today = resolveDate();
  const todayStr = dateStr(today);
  const cutoff = today.getTime() - WINDOW_MS;

  console.log(`[daily] start ${new Date().toISOString()} (brief date: ${todayStr})`);
  console.log(`[daily] vault: ${PERSONAL_RSS}`);

  // 1. Read user files.
  const interestsPath = join(PERSONAL_RSS, "interests.md");
  const followingPath = join(PERSONAL_RSS, "following.md");
  if (!existsSync(interestsPath)) throw new Error(`missing ${interestsPath}`);
  if (!existsSync(followingPath)) throw new Error(`missing ${followingPath}`);
  const interests = readFileSync(interestsPath, "utf8");
  const subs = parseFollowing(readFileSync(followingPath, "utf8"));
  console.log(`[daily] ${subs.length} subscriptions`);

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

  // 3. Fetch all articles in parallel.
  const fetchJobs: Promise<FetchedItem | null>[] = [];
  for (const f of feedsOk) {
    for (const it of f.items) {
      fetchJobs.push(
        fetchArticleBody(it.url)
          .then((body) => ({
            url: it.url,
            title: it.title,
            source_title: f.source_title || f.sub.description || f.sub.url,
            source_url: f.sub.url,
            source_description: f.sub.description,
            body,
          }))
          .catch((e) => {
            console.warn(`[item ${it.url}] ${e.message ?? e}`);
            return null;
          }),
      );
    }
  }
  const items: FetchedItem[] = (await Promise.all(fetchJobs)).filter((x): x is FetchedItem => x !== null);
  console.log(`[daily] ${items.length} articles fetched in window`);

  if (items.length === 0) {
    const briefMd = `# Daily Brief — ${todayStr}\n\n_(no items published in the 24h window for this date)_\n`;
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
  console.log(`[daily] wrote ${outPath} (${briefMd.length} chars, ${items.length} items considered)`);
}

main().catch((err) => {
  console.error("[daily] FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
