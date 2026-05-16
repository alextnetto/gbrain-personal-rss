// The orchestrator's top-level flow. Called by bin/personal-rss-daily.ts.
// Reads subscriptions → ingests new items → scores them → composes brief.

import { getPage, putPage, listPages, invokeSubagent } from "./brain";
import { fetchAndParse, type ParsedItem } from "../../scripts/fetch-rss";
import { extractFromUrl } from "../../scripts/extract-text";
import { detectContentType } from "../../scripts/content-type-detect";
import type {
  Subscription, ItemFrontmatter, BriefFrontmatter,
  ArchiveCandidate, ScoreResult,
} from "../types";

const ALLOWED_PREFIXES = ["subscriptions/", "items/", "briefs/", "interests"];
const SCORE_THRESHOLD = 70;
const NEW_CAP = 8;
const ARCHIVE_MIN_AGE_MS = 30 * 24 * 3600 * 1000;
const SCORING_MODEL = "claude-haiku-4-5-20251001";

function nowIso() { return new Date().toISOString(); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// -------- Ingest --------

async function ingestSubscription(slug: string): Promise<string[]> {
  const sub = await getPage(`subscriptions/${slug}`);
  if (!sub) { console.warn(`[ingest] missing subscription page: ${slug}`); return []; }
  const sf = sub.frontmatter as unknown as Subscription;

  const fetched = await fetchAndParse(sf.feed_url, sf.etag ?? undefined);
  if (fetched.status === 304) {
    await putPage(`subscriptions/${slug}`, { ...sf, last_fetched_at: nowIso() }, sub.body);
    return [];
  }
  if (fetched.status !== 200) {
    console.warn(`[ingest] ${slug} returned ${fetched.status}: ${fetched.error ?? "unknown"}`);
    await putPage(`subscriptions/${slug}`, { ...sf, last_fetched_at: nowIso() },
      sub.body + `\n\n- ${nowIso()}: fetch failed (status ${fetched.status})`);
    return [];
  }

  const xmlForKindHint = ""; // we'd need to keep the raw XML; for MVP, use URL-only heuristic
  const detectedKind = detectContentType(xmlForKindHint, sf.feed_url);
  const newItemSlugs: string[] = [];

  for (const item of fetched.items) {
    // Skip very old items on first fetch (>14 days back)
    const publishedTs = item.published_at ? Date.parse(item.published_at) : Date.now();
    if (Date.now() - publishedTs > 14 * 24 * 3600 * 1000) continue;
    if (!item.url) continue;

    const itemSlug = `items/${slug}/${item.id}`;
    const existing = await getPage(itemSlug);
    if (existing) continue;

    // Determine kind: enclosure beats default
    let kind: ItemFrontmatter["kind"] = detectedKind;
    if (item.enclosure_url) {
      if (/\.(mp3|m4a|aac|ogg|wav)(\?|$)/i.test(item.enclosure_url)) kind = "audio";
      else if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(item.enclosure_url)) kind = "video";
    }

    const fm: ItemFrontmatter = {
      source: slug,
      published_at: new Date(publishedTs).toISOString(),
      url: item.url,
      title: item.title,
      kind,
      duration: item.duration,
    };

    // Populate body: text items get extracted now; audio/video left empty for transcription
    let body = item.summary ?? "";
    if (kind === "text") {
      const extracted = await extractFromUrl(item.url);
      if ("text" in extracted) body = extracted.text.slice(0, 80_000); // cap to keep page small
      else fm.extraction_failed = true;
    } else {
      fm.transcription_failed = true; // MVP: transcription not implemented; tracked as a roadmap item
    }

    await putPage(itemSlug, fm as any, body);
    newItemSlugs.push(itemSlug);
  }

  await putPage(`subscriptions/${slug}`,
    { ...sf, etag: fetched.etag, last_fetched_at: nowIso() }, sub.body);
  console.log(`[ingest] ${slug}: ${newItemSlugs.length} new items`);
  return newItemSlugs;
}

// -------- Score --------

async function scoreItem(itemSlug: string, interestsText: string): Promise<void> {
  const item = await getPage(itemSlug);
  if (!item) return;
  const fm = item.frontmatter as unknown as ItemFrontmatter;
  if (fm.extraction_failed || fm.transcription_failed) {
    await putPage(itemSlug, { ...fm, score: 0, why_it_matters: "could not extract content" } as any, item.body);
    return;
  }
  const prompt = [
    "## User interests",
    interestsText,
    "",
    "## Item to score",
    `Title: ${fm.title}`,
    `URL: ${fm.url}`,
    `Kind: ${fm.kind}`,
    `Body excerpt (first 1500 chars):`,
    item.body.slice(0, 1500),
    "",
    "Emit only the JSON object as specified.",
  ].join("\n");

  const raw = await invokeSubagent({
    subagent_def: "score-item",
    prompt,
    allowed_slug_prefixes: ALLOWED_PREFIXES,
    timeout_ms: 90_000,
  });

  let parsed: ScoreResult;
  try { parsed = JSON.parse(raw.trim()); }
  catch {
    console.warn(`[score] ${itemSlug}: non-JSON output, defaulting score:0`);
    parsed = { score: 0, why_it_matters: "scoring failed (non-JSON)" };
  }
  await putPage(itemSlug, { ...fm, score: parsed.score, why_it_matters: parsed.why_it_matters } as any, item.body);
}

// -------- Brief composition --------

async function gatherTodaysNewItems(): Promise<Array<ItemFrontmatter & { slug: string; body: string }>> {
  const slugs = await listPages("items/");
  const now = Date.now();
  const collected: Array<ItemFrontmatter & { slug: string; body: string }> = [];
  for (const slug of slugs) {
    const page = await getPage(slug);
    if (!page) continue;
    const fm = page.frontmatter as unknown as ItemFrontmatter;
    const publishedTs = Date.parse(fm.published_at);
    if (now - publishedTs > 24 * 3600 * 1000) continue;
    if (typeof fm.score !== "number" || fm.score < SCORE_THRESHOLD) continue;
    collected.push({ ...fm, slug, body: page.body });
  }
  return collected.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, NEW_CAP);
}

async function gatherArchiveCandidates(topNewSlugs: string[]): Promise<Array<{slug: string; title: string; summary: string; published_at: string}>> {
  const slugs = await listPages("items/");
  const now = Date.now();
  const out: Array<{slug: string; title: string; summary: string; published_at: string}> = [];
  for (const slug of slugs) {
    if (topNewSlugs.includes(slug)) continue;
    const page = await getPage(slug);
    if (!page) continue;
    const fm = page.frontmatter as unknown as ItemFrontmatter;
    const publishedTs = Date.parse(fm.published_at);
    if (now - publishedTs < ARCHIVE_MIN_AGE_MS) continue;
    out.push({ slug, title: fm.title, summary: page.body.slice(0, 800), published_at: fm.published_at });
  }
  // Cap at 50 to keep prompt size sane
  return out.slice(0, 50);
}

async function composeAndWriteBrief(): Promise<void> {
  const interests = (await getPage("interests"))?.body ?? "";
  const newItems = await gatherTodaysNewItems();
  const archiveCandidates = await gatherArchiveCandidates(newItems.slice(0, 3).map(i => i.slug));

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
      subagent_def: "resurface-archive",
      prompt: archivePrompt,
      allowed_slug_prefixes: ALLOWED_PREFIXES,
      timeout_ms: 180_000,
    });
    try { archive = (JSON.parse(raw.trim()) as { candidates: ArchiveCandidate[] }).candidates ?? []; }
    catch { console.warn("[brief] resurface-archive returned non-JSON; archive section empty"); }
  }

  const archiveDetail = await Promise.all(archive.map(async c => {
    const page = await getPage(c.item_slug);
    return { ...c, title: (page?.frontmatter as any)?.title, url: (page?.frontmatter as any)?.url, body_excerpt: (page?.body ?? "").slice(0, 600) };
  }));

  const composePrompt = [
    `date: ${todayStr()}`,
    "## interests_text", interests,
    "## new_items", JSON.stringify(newItems.map(i => ({
      slug: i.slug, title: i.title, url: i.url, why_it_matters: i.why_it_matters,
      kind: i.kind, body_excerpt: i.body.slice(0, 1500),
      duration: i.duration,
      body_word_count: i.body.split(/\s+/).length,
    })), null, 2),
    "## archive_candidates", JSON.stringify(archiveDetail, null, 2),
    "",
    "Emit ONLY the brief markdown per the format in your system prompt.",
  ].join("\n\n");

  const briefMarkdown = await invokeSubagent({
    subagent_def: "compose-brief",
    prompt: composePrompt,
    allowed_slug_prefixes: ALLOWED_PREFIXES,
    timeout_ms: 300_000,
  });

  // Estimate total minutes from rendered brief (rough — pull the "~N min" line)
  const minutesLine = briefMarkdown.match(/~(\d+)\s*min/);
  const totalMinutes = minutesLine ? Number(minutesLine[1]) : 0;

  const brief: BriefFrontmatter = {
    date: todayStr(),
    items_considered: (await listPages("items/")).length,
    items_included_new: newItems.length,
    items_included_archive: archive.length,
    scoring_model: SCORING_MODEL,
    estimated_total_minutes: totalMinutes,
    generated_at: nowIso(),
  };
  await putPage(`briefs/${todayStr()}`, brief as any, briefMarkdown);
  console.log(`[brief] wrote briefs/${todayStr()} (${newItems.length} new, ${archive.length} archive)`);
}

// -------- Top-level --------

export async function runDaily(): Promise<void> {
  console.log(`[runDaily] start ${nowIso()}`);
  const subscriptionSlugs = (await listPages("subscriptions/"))
    .map(s => s.replace(/^subscriptions\//, "").replace(/\.md$/, ""));

  const interestsText = (await getPage("interests"))?.body ?? "";
  if (!interestsText) console.warn("[runDaily] interests page is empty — scoring will likely be uniform");

  const newSlugs: string[] = [];
  for (const slug of subscriptionSlugs) {
    newSlugs.push(...(await ingestSubscription(slug)));
  }

  for (const slug of newSlugs) {
    await scoreItem(slug, interestsText);
  }

  await composeAndWriteBrief();
  console.log(`[runDaily] done ${nowIso()}`);
}
