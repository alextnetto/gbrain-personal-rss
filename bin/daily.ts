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

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { fetchAndParse } from "../scripts/fetch-rss";

const VAULT = process.env.PERSONAL_RSS_VAULT
  ?? "/Users/netto/work/hackathons/yc-gbrain/notes/gbrain";
const PERSONAL_RSS = join(VAULT, "personal-rss");
const MODEL = process.env.PERSONAL_RSS_MODEL ?? "claude-sonnet-4-5";

const ITEMS_PER_FEED_CAP = 8;
const BODY_CHARS_CAP = 4000;
const ITEM_AGE_MS = 7 * 24 * 3600 * 1000; // last 7 days (was 24h — too tight for slow feeds)

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  source: string;
  source_description: string;
  body: string;
}

const BRIEF_PROMPT = `You write today's daily content brief. Your only output is a Markdown document — no preamble, no JSON, no surrounding code fences.

You receive three labeled sections in the user message:
- "## interests" — the user's free-text taste model.
- "## date" — today's date as YYYY-MM-DD.
- "## items" — a JSON array of items: {url, title, source, source_description, body}.

Pick the 4–6 most relevant items given the interests. For each, emit:

## [<title>](<url>) — <N> min read
<one sentence: why this matters given the user's interests, naming a specific stated interest>
> <a few sentences quoted from the body that show the substance of the piece>

Lead with: # Daily Brief — <date>

Rules:
- Output ONLY markdown. No preamble. No JSON. No code fences around the output.
- 4–6 items. Quality over quantity. If fewer than 4 meet a meaningful bar, add the line "_(slim day — only N items met the bar)_" under the H1.
- "why" must name a specific interest (bad: "interesting AI news"; good: "matches your post-LLM stack interest").
- Quote from the body verbatim. If body is empty/error, skip the item.
- Order by your judgment of relevance (best first).
- N is your reading-time estimate (~220 wpm).
- Plain markdown links. No deep-link anchors.`;

async function main() {
  console.log(`[daily] start ${new Date().toISOString()}`);
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
  const cutoff = Date.now() - ITEM_AGE_MS;
  const feedResults = await Promise.allSettled(subs.map(async (sub) => {
    const fetched = await fetchAndParse(sub.url);
    if (fetched.status !== 200) throw new Error(`status ${fetched.status}`);
    const recent = fetched.items
      .filter((it) => {
        if (!it.url) return false;
        const ts = it.published_at ? Date.parse(it.published_at) : Date.now();
        return ts >= cutoff;
      })
      .slice(0, ITEMS_PER_FEED_CAP);
    return { sub, items: recent };
  }));

  type FeedOk = { sub: typeof subs[number]; items: any[] };
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
            source: f.sub.url,
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
  console.log(`[daily] ${items.length} articles fetched`);

  // 4. Anthropic call.
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const anthropic = new Anthropic();
  const userMessage = [
    "## interests", interests || "(empty)",
    "", "## date", todayStr(),
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
  const outPath = join(dailyDir, `${todayStr()}.md`);
  writeFileSync(outPath, briefMd);
  console.log(`[daily] wrote ${outPath} (${briefMd.length} chars, ${items.length} items considered)`);
}

main().catch((err) => {
  console.error("[daily] FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
