// v2-minimal orchestrator. Reads following + interests, fetches feeds and
// articles, calls a single `brief` subagent, writes today's brief.

import { getPage, putPage, invokeSubagent } from "./brain";
import { fetchAndParse } from "../../scripts/fetch-rss";
import type { FollowingEntry, BriefItem } from "../types";

const FOLLOWING_SLUG = "personal-rss/following";
const INTERESTS_SLUG = "personal-rss/interests";
const BRIEF_TIMEOUT_MS = 240_000;
const ITEMS_PER_FEED_CAP = 10;
const BODY_CHARS_CAP = 4000;
const ITEM_AGE_MS = 24 * 3600 * 1000;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Inline parser: `<url> - <description>` per line. Skips blanks and `#` comments.
function parseFollowing(src: string): FollowingEntry[] {
  const out: FollowingEntry[] = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (!/^https?:\/\//i.test(line)) continue;
    const sep = line.indexOf(" - ");
    if (sep === -1) out.push({ url: line, description: "" });
    else out.push({ url: line.slice(0, sep).trim(), description: line.slice(sep + 3).trim() });
  }
  return out;
}

async function fetchArticleBody(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": "gbrain-personal-rss/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const html = await res.text();
  // Crude HTML strip — the brief subagent reasons over what we hand it.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function runDaily(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`[runDaily] start ${startedAt}`);

  const interests = (await getPage(INTERESTS_SLUG))?.body ?? "";
  const followingBody = (await getPage(FOLLOWING_SLUG))?.body ?? "";
  const following = parseFollowing(followingBody);
  if (following.length === 0) {
    console.warn(`[runDaily] no feeds in ${FOLLOWING_SLUG}.md — writing empty brief`);
  }

  const items: BriefItem[] = [];
  const cutoff = Date.now() - ITEM_AGE_MS;

  for (const sub of following) {
    try {
      const fetched = await fetchAndParse(sub.url);
      if (fetched.status !== 200) {
        console.warn(`[feed ${sub.url}] status ${fetched.status}`);
        continue;
      }
      const recent = fetched.items
        .filter((it) => {
          if (!it.url) return false;
          const ts = it.published_at ? Date.parse(it.published_at) : Date.now();
          return ts >= cutoff;
        })
        .slice(0, ITEMS_PER_FEED_CAP);

      for (const it of recent) {
        try {
          const body = await fetchArticleBody(it.url);
          items.push({
            url: it.url,
            title: it.title,
            source: sub.url,
            source_description: sub.description,
            body: body.slice(0, BODY_CHARS_CAP),
          });
        } catch (e) {
          console.warn(`[item ${it.url}] ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      console.warn(`[feed ${sub.url}] ${e instanceof Error ? e.message : e}`);
    }
  }

  const prompt = [
    "## interests",
    interests || "(empty)",
    "",
    "## date",
    todayStr(),
    "",
    "## items",
    JSON.stringify(items, null, 2),
  ].join("\n");

  let briefMd: string;
  try {
    briefMd = await invokeSubagent({
      subagent_def: "brief",
      prompt,
      allowed_slug_prefixes: ["personal-rss/"],
      timeout_ms: BRIEF_TIMEOUT_MS,
    });
  } catch (e) {
    console.error(`[brief] subagent failed: ${e instanceof Error ? e.message : e}`);
    briefMd = [
      `# Daily Brief — ${todayStr()}`,
      "",
      `_(brief subagent failed — falling back to raw item list of ${items.length} items)_`,
      "",
      ...items.map((i) => `- [${i.title}](${i.url})`),
    ].join("\n");
  }

  await putPage(`personal-rss/daily/${todayStr()}`, {}, briefMd.trim() + "\n");
  console.log(`[runDaily] wrote personal-rss/daily/${todayStr()} (${items.length} items considered)`);
}
