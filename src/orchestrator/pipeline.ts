// v2 orchestrator pipeline. Reads following.md + inbox.md, writes items to media/,
// composes brief into personal-rss/daily/<date>.md, manages seen.md as the dedup log.

import { getPage, putPage, listPages, invokeSubagent } from "./brain";
import { parseFollowing } from "../../scripts/parse-following";
import { discoverFeed } from "../../scripts/feed-discover";
import { fetchAndParse } from "../../scripts/fetch-rss";
import { extractFromUrl } from "../../scripts/extract-text";
import { createHash } from "crypto";
import type {
  FollowingEntry, ItemKind, ItemFrontmatter, BriefFrontmatter,
  ScoreResult, ArchiveCandidate,
} from "../types";

const ALLOWED_PREFIXES = ["media/articles/", "media/podcasts/", "personal-rss/"];
const SCORE_THRESHOLD = 70;
const NEW_CAP = 8;
const ARCHIVE_MIN_AGE_MS = 30 * 24 * 3600 * 1000;
const SCORING_MODEL = "claude-haiku-4-5-20251001";

const FOLLOWING_SLUG = "personal-rss/following";
const INBOX_SLUG = "personal-rss/inbox";
const SEEN_SLUG = "personal-rss/seen";
const INTERESTS_SLUG = "personal-rss/interests";

function nowIso() { return new Date().toISOString(); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function urlHash(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}
function itemSlugFor(kind: ItemKind, url: string): string {
  const dir = kind === "audio" || kind === "video" ? "media/podcasts" : "media/articles";
  return `${dir}/${urlHash(url)}`;
}

// -------- Seen log + inbox helpers --------

async function readUrlList(slug: string): Promise<{ urls: string[]; body: string }> {
  const page = await getPage(slug);
  if (!page) return { urls: [], body: "" };
  const urls = page.body.split(/\r?\n/).map(l => l.trim()).filter(l => /^https?:\/\//i.test(l));
  return { urls, body: page.body };
}

async function appendToSeen(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const existing = await readUrlList(SEEN_SLUG);
  const set = new Set(existing.urls);
  const additions = urls.filter(u => !set.has(u));
  if (additions.length === 0) return;
  const newBody = (existing.body.replace(/\s+$/, "") + "\n" + additions.join("\n") + "\n").replace(/^\n+/, "");
  await putPage(SEEN_SLUG, {}, newBody);
}

async function removeFromInbox(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const page = await getPage(INBOX_SLUG);
  if (!page) return;
  const remove = new Set(urls);
  const kept = page.body.split(/\r?\n/).filter(l => {
    const u = l.trim();
    return !remove.has(u);
  });
  const newBody = kept.join("\n").replace(/\n{3,}/g, "\n\n");
  await putPage(INBOX_SLUG, {}, newBody);
}

// -------- Ingest helpers --------

async function ingestOneUrl(
  itemUrl: string, source: string, sourceDescription: string,
  hint: { kind?: ItemKind; published_at?: string | null; title?: string; duration?: number } = {},
): Promise<{ slug: string; kind: ItemKind } | null> {
  const kind: ItemKind = hint.kind ?? "text";
  const slug = itemSlugFor(kind, itemUrl);
  const existing = await getPage(slug);
  if (existing) return { slug, kind };

  const fm: ItemFrontmatter = {
    source_url: itemUrl,
    source,
    title: hint.title ?? "",
    published_at: hint.published_at ?? null,
    fetched_at: nowIso(),
    kind,
    duration: hint.duration,
  };

  let body = "";
  if (kind === "text") {
    const extracted = await extractFromUrl(itemUrl);
    if ("text" in extracted) {
      body = extracted.text.slice(0, 80_000);
      if (extracted.title && !fm.title) fm.title = extracted.title;
    } else {
      fm.extraction_failed = true;
    }
  } else {
    // MVP: transcription not implemented for audio/video. Mark as failed; scorer will downscore.
    fm.transcription_failed = true;
  }
  await putPage(slug, fm as any, body);
  void sourceDescription; // used at scoring time, not ingest
  return { slug, kind };
}

async function ingestFollowing(): Promise<Array<{ slug: string; source: string; sourceDescription: string }>> {
  const page = await getPage(FOLLOWING_SLUG);
  if (!page) {
    console.warn(`[pipeline] no ${FOLLOWING_SLUG}.md found; skipping feed ingest`);
    return [];
  }
  const entries: FollowingEntry[] = parseFollowing(page.body);
  const seen = new Set((await readUrlList(SEEN_SLUG)).urls);
  const newItems: Array<{ slug: string; source: string; sourceDescription: string }> = [];

  for (const entry of entries) {
    try {
      const feedUrl = (await discoverFeed(entry.url)) ?? entry.url;
      const fetched = await fetchAndParse(feedUrl);
      if (fetched.status !== 200) {
        console.warn(`[pipeline] ${entry.url} → feed status ${fetched.status}`);
        continue;
      }
      for (const item of fetched.items) {
        if (!item.url) continue;
        if (seen.has(item.url)) continue;
        const publishedTs = item.published_at ? Date.parse(item.published_at) : Date.now();
        if (Date.now() - publishedTs > 14 * 24 * 3600 * 1000) continue;

        const kind: ItemKind = item.enclosure_url
          ? /\.(mp3|m4a|aac|ogg|wav)(\?|$)/i.test(item.enclosure_url) ? "audio"
            : /\.(mp4|webm|mov|m4v)(\?|$)/i.test(item.enclosure_url) ? "video"
            : "text"
          : "text";

        const ingested = await ingestOneUrl(item.url, entry.url, entry.description, {
          kind, published_at: new Date(publishedTs).toISOString(),
          title: item.title, duration: item.duration,
        });
        if (ingested) newItems.push({ slug: ingested.slug, source: entry.url, sourceDescription: entry.description });
      }
    } catch (err) {
      console.warn(`[pipeline] entry ${entry.url} threw: ${err}`);
    }
  }
  return newItems;
}

async function ingestInbox(): Promise<Array<{ slug: string; source: string; sourceDescription: string; originalUrl: string }>> {
  const inbox = await readUrlList(INBOX_SLUG);
  if (inbox.urls.length === 0) return [];
  const seen = new Set((await readUrlList(SEEN_SLUG)).urls);
  const out: Array<{ slug: string; source: string; sourceDescription: string; originalUrl: string }> = [];
  for (const url of inbox.urls) {
    if (seen.has(url)) {
      // Already shown previously; just remove from inbox quietly.
      await removeFromInbox([url]);
      continue;
    }
    try {
      const ingested = await ingestOneUrl(url, "inbox", "");
      if (ingested) out.push({ slug: ingested.slug, source: "inbox", sourceDescription: "", originalUrl: url });
    } catch (err) {
      console.warn(`[pipeline] inbox ${url} threw: ${err}`);
    }
  }
  return out;
}

// -------- Score --------

async function scoreItem(slug: string, sourceDescription: string, interestsText: string): Promise<void> {
  const item = await getPage(slug);
  if (!item) return;
  const fm = item.frontmatter as unknown as ItemFrontmatter;
  if (fm.extraction_failed || fm.transcription_failed) {
    await putPage(slug, { ...fm, score: 0, why_it_matters: "could not extract content" } as any, item.body);
    return;
  }
  const prompt = [
    "## User interests (global)",
    interestsText || "(empty)",
    "",
    "## Per-source context",
    sourceDescription || "(none — this is an inbox/one-off item)",
    "",
    "## Item",
    `Title: ${fm.title}`,
    `URL: ${fm.source_url}`,
    `Kind: ${fm.kind}`,
    `Body excerpt (first 1500 chars):`,
    item.body.slice(0, 1500),
    "",
    "Emit only the JSON object as specified.",
  ].join("\n");
  const raw = await invokeSubagent({
    subagent_def: "score-item", prompt,
    allowed_slug_prefixes: ALLOWED_PREFIXES, timeout_ms: 90_000,
  });
  let parsed: ScoreResult;
  try { parsed = JSON.parse(raw.trim()); }
  catch {
    console.warn(`[score] ${slug}: non-JSON output, defaulting score:0`);
    parsed = { score: 0, why_it_matters: "scoring failed (non-JSON)" };
  }
  await putPage(slug, { ...fm, score: parsed.score, why_it_matters: parsed.why_it_matters } as any, item.body);
}

// -------- Gather + brief --------

async function gatherTodaysNew(): Promise<Array<ItemFrontmatter & { slug: string; body: string }>> {
  const slugs = [
    ...(await listPages("media/articles/")),
    ...(await listPages("media/podcasts/")),
  ];
  const now = Date.now();
  const out: Array<ItemFrontmatter & { slug: string; body: string }> = [];
  for (const slug of slugs) {
    const page = await getPage(slug);
    if (!page) continue;
    const fm = page.frontmatter as unknown as ItemFrontmatter;
    if (!fm.fetched_at) continue;
    if (now - Date.parse(fm.fetched_at) > 24 * 3600 * 1000) continue;
    if (fm.source === "inbox") continue;
    if (typeof fm.score !== "number" || fm.score < SCORE_THRESHOLD) continue;
    out.push({ ...fm, slug, body: page.body });
  }
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, NEW_CAP);
}

async function gatherTodaysInbox(): Promise<Array<ItemFrontmatter & { slug: string; body: string }>> {
  const slugs = [
    ...(await listPages("media/articles/")),
    ...(await listPages("media/podcasts/")),
  ];
  const now = Date.now();
  const out: Array<ItemFrontmatter & { slug: string; body: string }> = [];
  for (const slug of slugs) {
    const page = await getPage(slug);
    if (!page) continue;
    const fm = page.frontmatter as unknown as ItemFrontmatter;
    if (fm.source !== "inbox") continue;
    if (!fm.fetched_at) continue;
    if (now - Date.parse(fm.fetched_at) > 24 * 3600 * 1000) continue;
    out.push({ ...fm, slug, body: page.body });
  }
  return out;
}

async function gatherArchiveCandidates(excludeSlugs: string[]): Promise<Array<{ slug: string; title: string; summary: string; published_at: string | null }>> {
  const slugs = [
    ...(await listPages("media/articles/")),
    ...(await listPages("media/podcasts/")),
  ];
  const now = Date.now();
  const out: Array<{ slug: string; title: string; summary: string; published_at: string | null }> = [];
  const exclude = new Set(excludeSlugs);
  for (const slug of slugs) {
    if (exclude.has(slug)) continue;
    const page = await getPage(slug);
    if (!page) continue;
    const fm = page.frontmatter as unknown as ItemFrontmatter;
    const ageBaseTs = fm.published_at
      ? Date.parse(fm.published_at)
      : (fm.fetched_at ? Date.parse(fm.fetched_at) : now);
    if (now - ageBaseTs < ARCHIVE_MIN_AGE_MS) continue;
    out.push({ slug, title: fm.title, summary: page.body.slice(0, 800), published_at: fm.published_at });
  }
  return out.slice(0, 50);
}

async function composeAndWriteBrief(): Promise<{ urls: string[]; inboxUrls: string[] }> {
  const interests = (await getPage(INTERESTS_SLUG))?.body ?? "";
  const newItems = await gatherTodaysNew();
  const inboxItems = await gatherTodaysInbox();
  const topThreeForArchive = newItems.slice(0, 3).map(i => i.slug);
  const archiveCandidates = await gatherArchiveCandidates([
    ...topThreeForArchive,
    ...newItems.map(i => i.slug),
    ...inboxItems.map(i => i.slug),
  ]);

  let archive: ArchiveCandidate[] = [];
  if (newItems.length > 0 && archiveCandidates.length > 0) {
    const archivePrompt = [
      "## Top new items today",
      JSON.stringify(newItems.slice(0, 3).map(i => ({ slug: i.slug, title: i.title, why_it_matters: i.why_it_matters })), null, 2),
      "",
      "## Archive candidates (older than 30 days)",
      JSON.stringify(archiveCandidates, null, 2),
    ].join("\n");
    const raw = await invokeSubagent({
      subagent_def: "resurface-archive", prompt: archivePrompt,
      allowed_slug_prefixes: ALLOWED_PREFIXES, timeout_ms: 180_000,
    });
    try { archive = (JSON.parse(raw.trim()) as { candidates: ArchiveCandidate[] }).candidates ?? []; }
    catch { console.warn("[brief] resurface-archive non-JSON; archive empty"); }
  }

  const archiveDetail = await Promise.all(archive.map(async c => {
    const page = await getPage(c.item_slug);
    const fm = page?.frontmatter as any;
    return { ...c, title: fm?.title, url: fm?.source_url, body_excerpt: (page?.body ?? "").slice(0, 600) };
  }));

  const composePrompt = [
    `date: ${todayStr()}`,
    "## interests_text", interests || "(empty)",
    "## new_items", JSON.stringify(newItems.map(i => ({
      slug: i.slug, title: i.title, url: i.source_url, why_it_matters: i.why_it_matters,
      kind: i.kind, body_excerpt: i.body.slice(0, 1500),
      duration: i.duration, body_word_count: i.body.split(/\s+/).length,
    })), null, 2),
    "## inbox_items", JSON.stringify(inboxItems.map(i => ({
      slug: i.slug, title: i.title, url: i.source_url, why_it_matters: i.why_it_matters ?? "you saved this for later",
      kind: i.kind, body_excerpt: i.body.slice(0, 1500), body_word_count: i.body.split(/\s+/).length,
    })), null, 2),
    "## archive_candidates", JSON.stringify(archiveDetail, null, 2),
    "",
    "Emit ONLY the brief markdown per the format in your system prompt.",
  ].join("\n\n");

  const briefMarkdown = await invokeSubagent({
    subagent_def: "compose-brief", prompt: composePrompt,
    allowed_slug_prefixes: ALLOWED_PREFIXES, timeout_ms: 300_000,
  });

  const minutesLine = briefMarkdown.match(/~(\d+)\s*min/);
  const totalMinutes = minutesLine ? Number(minutesLine[1]) : 0;

  const brief: BriefFrontmatter = {
    date: todayStr(),
    items_considered: (await listPages("media/articles/")).length + (await listPages("media/podcasts/")).length,
    items_included_new: newItems.length,
    items_included_archive: archive.length,
    items_from_inbox: inboxItems.length,
    scoring_model: SCORING_MODEL,
    estimated_total_minutes: totalMinutes,
    generated_at: nowIso(),
  };
  await putPage(`personal-rss/daily/${todayStr()}`, brief as any, briefMarkdown);
  console.log(`[brief] wrote personal-rss/daily/${todayStr()} (${newItems.length} new, ${inboxItems.length} inbox, ${archive.length} archive)`);

  const archiveUrls = archive
    .map(c => (archiveDetail.find(d => d.item_slug === c.item_slug) as any)?.url)
    .filter((x: unknown): x is string => typeof x === "string");

  return {
    urls: [...newItems.map(i => i.source_url), ...inboxItems.map(i => i.source_url), ...archiveUrls],
    inboxUrls: inboxItems.map(i => i.source_url),
  };
}

// -------- Top-level --------

export async function runDaily(): Promise<void> {
  console.log(`[runDaily] start ${nowIso()}`);

  const interestsText = (await getPage(INTERESTS_SLUG))?.body ?? "";
  if (!interestsText) console.warn(`[runDaily] ${INTERESTS_SLUG}.md is empty — scoring will be uniform`);

  const newFromFeeds = await ingestFollowing();
  const newFromInbox = await ingestInbox();
  const allNew = [...newFromFeeds, ...newFromInbox];

  for (const it of allNew) {
    try { await scoreItem(it.slug, it.sourceDescription, interestsText); }
    catch (e) { console.warn(`[score] ${it.slug} threw: ${e}`); }
  }

  const { urls, inboxUrls } = await composeAndWriteBrief();

  if (urls.length) await appendToSeen(urls);
  if (inboxUrls.length) await removeFromInbox(inboxUrls);

  console.log(`[runDaily] done ${nowIso()}`);
}
