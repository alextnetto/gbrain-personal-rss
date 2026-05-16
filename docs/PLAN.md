# v2 Implementation Plan (Obsidian-native pivot)

> Supersedes the v1 plan (previous content in git history). Implements `docs/PROCESSING.md`.

**Goal:** Pivot the orchestrator to read from `personal-rss/following.md` + `personal-rss/inbox.md`, write items to `media/articles/` + `media/podcasts/`, and write briefs to `personal-rss/daily/<date>.md` — eliminating the v1 `subscriptions/`, `items/`, `briefs/` paths.

**Architecture:** Per `docs/PROCESSING.md`. TS orchestrator + 3 LLM subagents. Same gBrain library wrapper (`src/orchestrator/brain.ts`) — unchanged.

**Working dir:** `/Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss`

---

## Delta from v1 — what's touched

| Touched | Untouched (kept as-is) |
|---|---|
| `src/types.ts` (drop Subscription, add FollowingEntry, refine ItemFrontmatter) | `src/orchestrator/brain.ts` (gBrain wrapper) |
| `src/orchestrator/pipeline.ts` (full rewrite) | `subagents/resurface-archive.md`, `subagents/compose-brief.md` |
| `scripts/parse-following.ts` (NEW) | `scripts/content-type-detect.ts`, `scripts/fetch-rss.ts`, `scripts/extract-text.ts` |
| `scripts/feed-discover.ts` (NEW) | `bin/personal-rss-daily(.ts)` |
| `tests/parse-following.test.ts` (NEW) | `tests/content-type-detect.test.ts`, `tests/fetch-rss.test.ts` |
| `tests/feed-discover.test.ts` (NEW) | `gbrain.plugin.json` |
| `subagents/score-item.md` (prompt update — accept per-source description) | `install.sh`, `LICENSE`, `README.md` |
| `web/server.ts` (briefs path change) | `web/index.html` |
| `skills/personal-rss/SKILL.md` (6-action rewrite) | `skills/personal-rss/routing-eval.jsonl` |
| `scripts/smoke.sh` (add a no-network pipeline dry-run) | |
| `docs/SPEC.md` (add a "see PROCESSING.md for current arch" pointer) | `docs/GBRAIN_INTEGRATION.md`, `docs/PROCESSING.md` |
| `docs/PLAN.md` (this file — replaces v1) | |

---

## Phase 0 — Types (sequential)

### Task 1: Update `src/types.ts`

**File:** `src/types.ts` (modify)

- [ ] **Step 1:** Replace the file body with:
  ```ts
  // One source of truth for the page frontmatter shapes used across orchestrator + subagents.

  // ---------- Inputs (user-authored, plain markdown) ----------

  // A single parsed line from personal-rss/following.md
  export interface FollowingEntry {
    url: string;            // feed URL or page URL (auto-discover applies)
    description: string;    // per-source interest context, e.g. "model releases, day-one"
  }

  // ---------- Items (machine-written into media/articles/, media/podcasts/) ----------

  export type ItemKind = "text" | "audio" | "video";

  export interface ItemFrontmatter {
    source_url: string;                 // URL of the item itself (the link)
    source: string;                     // following.md URL it came from, OR literal "inbox"
    title: string;
    published_at: string | null;        // ISO 8601; null if feed didn't provide one
    fetched_at: string;                 // ISO 8601
    kind: ItemKind;
    duration?: number;                  // seconds, for audio/video
    transcript_chunks?: TranscriptChunk[];
    score?: number;                     // 0–100, filled by score-item
    why_it_matters?: string;            // filled by score-item
    transcription_failed?: boolean;
    extraction_failed?: boolean;
  }

  export interface TranscriptChunk {
    start: number;                      // seconds
    end: number;
    text: string;
  }

  // ---------- Briefs (machine-written into personal-rss/daily/) ----------

  export interface BriefFrontmatter {
    date: string;                       // YYYY-MM-DD
    items_considered: number;
    items_included_new: number;
    items_included_archive: number;
    items_from_inbox: number;
    scoring_model: string;
    estimated_total_minutes: number;
    generated_at: string;               // ISO 8601
  }

  // ---------- Subagent outputs (parsed from final message) ----------

  export interface ScoreResult {
    score: number;
    why_it_matters: string;
  }

  export interface ArchiveCandidate {
    item_slug: string;                  // hash-based slug under media/
    newly_relevant_because: string;
    triggered_by_new_item_slug: string;
  }
  ```

- [ ] **Step 2:** Typecheck.
  ```bash
  cd /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss && bun --bun tsc --noEmit
  ```
  Expected: zero errors (pipeline.ts will have errors because we're about to rewrite it — fine for this step in isolation, but the typecheck is run BEFORE pipeline.ts touch).

  Actually — pipeline.ts imports `Subscription` which we just removed. So typecheck WILL fail until T4 runs. Acceptable here; don't gate this commit on typecheck.

- [ ] **Step 3:** Commit (do NOT push).
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add src/types.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "types(v2): drop Subscription, add FollowingEntry, refine ItemFrontmatter"
  ```

---

## Phase 1 — New pure scripts (parallel after T1)

### Task 2: `scripts/parse-following.ts` + test (TDD)

**Files:**
- Create: `scripts/parse-following.ts`
- Create: `tests/parse-following.test.ts`

- [ ] **Step 1: Failing test.**
  ```ts
  // tests/parse-following.test.ts
  import { expect, test, describe } from "bun:test";
  import { parseFollowing } from "../scripts/parse-following";

  describe("parseFollowing", () => {
    test("parses a single URL + description line", () => {
      const out = parseFollowing("https://example.com/feed - blogs about X");
      expect(out).toEqual([{ url: "https://example.com/feed", description: "blogs about X" }]);
    });
    test("parses multiple lines", () => {
      const src = `https://a.example/feed - aaa
  https://b.example/feed - bbb`;
      const out = parseFollowing(src);
      expect(out.length).toBe(2);
      expect(out[0].url).toBe("https://a.example/feed");
      expect(out[1].description).toBe("bbb");
    });
    test("skips blank lines and # comments", () => {
      const src = `# this is a comment
  https://a.example/feed - aaa

  https://b.example/feed - bbb
  # end`;
      const out = parseFollowing(src);
      expect(out.length).toBe(2);
    });
    test("description is empty string when missing", () => {
      const out = parseFollowing("https://example.com/feed");
      expect(out[0].description).toBe("");
    });
    test("URL with embedded dash in description preserved", () => {
      const out = parseFollowing("https://example.com/feed - long-form interviews - top quality");
      expect(out[0].url).toBe("https://example.com/feed");
      expect(out[0].description).toBe("long-form interviews - top quality");
    });
    test("skips lines that don't start with http", () => {
      const src = `not a url
  https://example.com/feed - real
  also not a url`;
      const out = parseFollowing(src);
      expect(out.length).toBe(1);
      expect(out[0].url).toBe("https://example.com/feed");
    });
  });
  ```

- [ ] **Step 2:** Run — expect 6 failures, module not found.
  ```bash
  cd /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss && bun test tests/parse-following.test.ts
  ```

- [ ] **Step 3:** Implement `scripts/parse-following.ts`.
  ```ts
  import type { FollowingEntry } from "../src/types";

  // Parse the content of personal-rss/following.md.
  // Format: one entry per line, "<url> - <description>".
  // - URL is everything up to the first " - ".
  // - Description is whatever follows (may itself contain " - ").
  // - Lines starting with "#" and blank lines are skipped.
  // - Lines that don't start with "http" are skipped (and logged via warn-on-callsite policy).
  export function parseFollowing(src: string): FollowingEntry[] {
    const out: FollowingEntry[] = [];
    for (const rawLine of src.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("#")) continue;
      if (!/^https?:\/\//i.test(line)) continue;
      const sep = line.indexOf(" - ");
      if (sep === -1) {
        out.push({ url: line, description: "" });
      } else {
        out.push({ url: line.slice(0, sep).trim(), description: line.slice(sep + 3).trim() });
      }
    }
    return out;
  }
  ```

- [ ] **Step 4:** Run — expect 6 passes.

- [ ] **Step 5:** Commit (do NOT push).
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/parse-following.ts tests/parse-following.test.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add parse-following: TDD parser for URL - description lines"
  ```

---

### Task 3: `scripts/feed-discover.ts` + test (TDD)

**Files:**
- Create: `scripts/feed-discover.ts`
- Create: `tests/feed-discover.test.ts`

Discovers the RSS/Atom feed URL for a given page URL. Strategies (in order):
1. URL already looks like a feed (`.xml`, `.rss`, `/feed`, `/rss`, `/atom`) → return as-is.
2. Known host patterns:
   - `youtube.com/@<handle>` → `youtube.com/feeds/videos.xml?user=<handle>` (or channel ID variant)
   - `youtube.com/channel/<id>` → `youtube.com/feeds/videos.xml?channel_id=<id>`
   - `*.substack.com` → `<root>/feed`
3. Fetch the HTML and look for `<link rel="alternate" type="application/rss+xml" href="...">` or `application/atom+xml`.

- [ ] **Step 1: Failing test.**
  ```ts
  // tests/feed-discover.test.ts
  import { expect, test, describe } from "bun:test";
  import { discoverFeedFromUrl, discoverFeedFromHtml } from "../scripts/feed-discover";

  describe("discoverFeedFromUrl (pure URL heuristics)", () => {
    test("URL with .xml extension is treated as a feed", () => {
      expect(discoverFeedFromUrl("https://example.com/rss.xml")).toBe("https://example.com/rss.xml");
    });
    test("URL ending in /feed is treated as a feed", () => {
      expect(discoverFeedFromUrl("https://example.com/feed")).toBe("https://example.com/feed");
    });
    test("YouTube channel handle rewrites to feed URL", () => {
      const out = discoverFeedFromUrl("https://www.youtube.com/@DwarkeshPatel");
      expect(out).toBe("https://www.youtube.com/feeds/videos.xml?user=DwarkeshPatel");
    });
    test("YouTube channel id rewrites to feed URL", () => {
      const out = discoverFeedFromUrl("https://www.youtube.com/channel/UCexample");
      expect(out).toBe("https://www.youtube.com/feeds/videos.xml?channel_id=UCexample");
    });
    test("Substack root rewrites to <root>/feed", () => {
      expect(discoverFeedFromUrl("https://anything.substack.com")).toBe("https://anything.substack.com/feed");
      expect(discoverFeedFromUrl("https://anything.substack.com/")).toBe("https://anything.substack.com/feed");
    });
    test("Unknown plain URL returns null (must use HTML discovery)", () => {
      expect(discoverFeedFromUrl("https://example.com/some/article")).toBe(null);
    });
  });

  describe("discoverFeedFromHtml", () => {
    test("finds <link rel=\"alternate\" type=\"application/rss+xml\">", () => {
      const html = `<html><head><link rel="alternate" type="application/rss+xml" href="https://example.com/rss"></head></html>`;
      expect(discoverFeedFromHtml(html, "https://example.com/")).toBe("https://example.com/rss");
    });
    test("finds Atom link", () => {
      const html = `<head><link rel="alternate" type="application/atom+xml" href="/atom.xml"></head>`;
      expect(discoverFeedFromHtml(html, "https://example.com/post/x")).toBe("https://example.com/atom.xml");
    });
    test("returns null when no feed link present", () => {
      expect(discoverFeedFromHtml(`<html><body>no feed</body></html>`, "https://example.com/")).toBe(null);
    });
  });
  ```

- [ ] **Step 2:** Run — expect failures.

- [ ] **Step 3:** Implement `scripts/feed-discover.ts`.
  ```ts
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
    const re = /<link[^>]*rel=["']alternate["'][^>]*type=["']application\/(rss\+xml|atom\+xml)["'][^>]*href=["']([^"']+)["']/i;
    const reAlt = /<link[^>]*type=["']application\/(rss\+xml|atom\+xml)["'][^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i;
    const reAlt2 = /<link[^>]*href=["']([^"']+)["'][^>]*type=["']application\/(rss\+xml|atom\+xml)["'][^>]*rel=["']alternate["']/i;
    let href: string | null = null;
    for (const r of [re, reAlt]) {
      const m = html.match(r);
      if (m) { href = m[2]; break; }
    }
    if (!href) {
      const m = html.match(reAlt2);
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
  ```

- [ ] **Step 4:** Run — expect all passes.

- [ ] **Step 5:** Commit.
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/feed-discover.ts tests/feed-discover.test.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add feed-discover: URL heuristics + HTML <link> probe"
  ```

---

## Phase 2 — Pipeline rewrite (sequential after T1–T3)

### Task 4: Rewrite `src/orchestrator/pipeline.ts`

**File:** `src/orchestrator/pipeline.ts` (full rewrite)

The v2 flow per `docs/PROCESSING.md` §4. Single file, ~280 lines.

- [ ] **Step 1: Write the new pipeline.ts.**

  ```ts
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

  async function ingestOneUrl(itemUrl: string, source: string, sourceDescription: string, hint: { kind?: ItemKind; published_at?: string | null; title?: string; duration?: number } = {}): Promise<{ slug: string; kind: ItemKind } | null> {
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
    void sourceDescription; // currently used at scoring time, not ingest
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
      const ingested = await ingestOneUrl(url, "inbox", "");
      if (ingested) out.push({ slug: ingested.slug, source: "inbox", sourceDescription: "", originalUrl: url });
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
      // "today's new" = fetched in the last 24h, score >= threshold
      if (now - Date.parse(fm.fetched_at) > 24 * 3600 * 1000) continue;
      if (fm.source === "inbox") continue; // inbox items handled separately
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
      const ageBaseTs = fm.published_at ? Date.parse(fm.published_at) : (fm.fetched_at ? Date.parse(fm.fetched_at) : now);
      if (now - ageBaseTs < ARCHIVE_MIN_AGE_MS) continue;
      out.push({ slug, title: fm.title, summary: page.body.slice(0, 800), published_at: fm.published_at });
    }
    return out.slice(0, 50);
  }

  async function composeAndWriteBrief(): Promise<{ urls: string[]; inboxUrls: string[] }> {
    const interests = (await getPage(INTERESTS_SLUG))?.body ?? "";
    const newItems = await gatherTodaysNew();
    const inboxItems = await gatherTodaysInbox();
    const topThreeForArchive = [...newItems].slice(0, 3).map(i => i.slug);
    const archiveCandidates = await gatherArchiveCandidates([...topThreeForArchive, ...newItems.map(i => i.slug), ...inboxItems.map(i => i.slug)]);

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

    return {
      urls: [...newItems.map(i => i.source_url), ...inboxItems.map(i => i.source_url), ...archive.map(c => (archiveDetail.find(d => d.item_slug === c.item_slug) as any)?.url).filter(Boolean)],
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

    // Update seen + clear inbox
    if (urls.length) await appendToSeen(urls);
    if (inboxUrls.length) await removeFromInbox(inboxUrls);

    console.log(`[runDaily] done ${nowIso()}`);
  }
  ```

- [ ] **Step 2:** Typecheck.
  ```bash
  cd /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss && bun --bun tsc --noEmit
  ```
  Expected: clean (the gbrain `@ts-ignore`'d imports in brain.ts continue to silence).

- [ ] **Step 3:** Commit.
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add src/orchestrator/pipeline.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "pipeline(v2): rewrite for following.md / inbox.md / seen.md / media/ / personal-rss/daily/"
  ```

---

## Phase 3 — Delivery + prompts (parallel after T4)

### Task 5: Update `subagents/score-item.md`

**File:** `subagents/score-item.md` (modify — add per-source description to the prompt format)

- [ ] **Step 1:** Replace file body. The frontmatter stays identical; only the workflow text changes to expect per-source context in addition to global interests.

  Full new content:

  ````markdown
  ---
  name: score-item
  model: claude-haiku-4-5-20251001
  max_turns: 4
  allowed_tools:
    - brain_get_page
    - brain_search
  ---

  You score one content item against the user's stated interests. You receive in your prompt:

  1. **Global interests** — the user's `interests.md` body.
  2. **Per-source context** — a one-line description from the user's `following.md` for the source this item came from. May say "(none — this is an inbox/one-off item)" for inbox items.
  3. **Item** — title, URL, kind, and a body excerpt.

  Your only output is a single JSON object — no preamble, no surrounding markdown.

  ## What to emit

  Exactly one JSON object on a single line:

  ```
  {"score": 0-100 integer, "why_it_matters": "one sentence, max ~150 chars, references a specific interest"}
  ```

  Nothing else. No "Here is my answer:". No code fences.

  ## Calibration

  - **90+** — directly addresses a stated interest, high-information (a benchmark, release, named-author piece)
  - **70–89** — clearly relevant to one or more interests; worth their time
  - **50–69** — tangentially related; only if they have free time
  - **0–49** — unrelated, low-information, or already covered elsewhere

  When in doubt, score lower. The user prefers fewer better items.

  ## How to use per-source context

  The per-source description is a hint about why the user added this source. A line like "Anthropic blog — model releases, day-one" means: items that ARE day-one Anthropic news score higher than other Anthropic content. Use the per-source description as a multiplier on relevance, not as a replacement for the global interests.

  For inbox items (no per-source context), use the global interests only, and bias slightly higher — the user explicitly saved this, so even a borderline item is worth surfacing.

  ## Notes
  - `why_it_matters` must name a specific stated interest, not be generic.
  - If the item body is missing or marked failed, emit `{"score": 0, "why_it_matters": "could not extract content"}`.
  - You may use `brain_search` to check for duplicates already in the brain.
  - You may NOT write to the brain. Output JSON only.
  ````

- [ ] **Step 2:** Commit.
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add subagents/score-item.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "subagent(score-item): accept and use per-source description in scoring"
  ```

---

### Task 6: Update `web/server.ts` (briefs path)

**File:** `web/server.ts` (modify — change `briefs/` path to `personal-rss/daily/`)

- [ ] **Step 1:** Find and replace the two slug references.

  Use Edit to change:

  - `get_page("briefs/...)` calls → `get_page("personal-rss/daily/...")`
  - The `listPages("briefs/")` call → `listPages("personal-rss/daily/")`
  - The slug stripping `s => s.replace(/^briefs\//, "")` → `s => s.replace(/^personal-rss\/daily\//, "")`

  Concretely, the new `getPage` call in `/brief/:date`:
  ```ts
  const page = await getPage(`personal-rss/daily/${req.params.date}`);
  ```

  And in `/briefs`:
  ```ts
  const slugs = await listPages("personal-rss/daily/");
  const dates = slugs.map(s => s.replace(/^personal-rss\/daily\//, "")).sort().reverse();
  ```

  Routes `/`, `/brief/:date`, `/briefs` stay; only the backend slug lookups change.

- [ ] **Step 2:** Typecheck.
  ```bash
  cd /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss && bun --bun tsc --noEmit
  ```

- [ ] **Step 3:** Commit.
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add web/server.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "web(v2): read briefs from personal-rss/daily/ slug"
  ```

---

### Task 7: Rewrite `skills/personal-rss/SKILL.md`

**File:** `skills/personal-rss/SKILL.md` (rewrite — 6 actions per PROCESSING.md §7)

- [ ] **Step 1:** Replace file body with:

  ````markdown
  ---
  name: personal-rss
  description: Use when the user wants to add a source to follow, save a one-off URL for later (inbox), update their interests, read today's or a past daily content brief, or list current subscriptions.
  ---

  # Personal RSS

  This skill teaches you how to operate the personal-rss system using gBrain's existing operations. There are no custom tools — you use `put_page`, `list_pages`, `get_page`.

  ## Where things live (all under `personal-rss/`)

  | Page | Purpose |
  |---|---|
  | `personal-rss/interests.md` | the user's free-text taste model |
  | `personal-rss/following.md` | subscriptions, one per line: `<url> - <description>` |
  | `personal-rss/inbox.md` | one-off URLs to read soon; auto-cleared after each brief |
  | `personal-rss/seen.md` | dedup log (machine-managed; user can edit to force re-process) |
  | `personal-rss/daily/<YYYY-MM-DD>.md` | the brief |

  ## The six actions

  ### 1. Add a source
  Append a single line to `personal-rss/following.md`:
  ```
  <url> - <free-text description of what's interesting about this source>
  ```
  If the user gave a site URL but not a feed URL, append the site URL — the orchestrator auto-discovers feeds.
  Get the description from the user; don't invent one.

  ### 2. Save a one-off URL for later (inbox)
  Append the URL on its own line to `personal-rss/inbox.md`. No description needed. Tell the user it'll appear in the next brief.

  ### 3. Show today's brief
  Compute today's date (YYYY-MM-DD, local TZ). Call `get_page("personal-rss/daily/<date>")`. If it exists, return it inline — do NOT summarize. If it doesn't exist, tell the user no brief has been generated yet and that they can run `bun run daily` from the project root.

  ### 4. Show a past brief
  Parse the date the user mentioned ("last Tuesday", "March 12") into YYYY-MM-DD. Call `get_page("personal-rss/daily/<date>")`. If missing, tell them.

  ### 5. Update interests
  Call `get_page("personal-rss/interests")`, apply the user's edit, write back with `put_page("personal-rss/interests", <new body>)`. Note: the next daily run will re-score against the new interests.

  ### 6. List subscriptions
  Call `get_page("personal-rss/following")` and render the lines for the user.

  ## Don't
  - Don't invent URLs or item content. If a page doesn't exist, say so.
  - Don't modify item pages under `media/articles/` or `media/podcasts/` — those are owned by the orchestrator.
  - Don't write briefs yourself — `compose-brief` (a subagent invoked by the nightly orchestrator) does this.
  ````

- [ ] **Step 2:** Commit.
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add skills/personal-rss/SKILL.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "skill(v2): rewrite to the 6-action workflow on personal-rss/ files"
  ```

---

## Phase 4 — Verification

### Task 8: Update `scripts/smoke.sh`

**File:** `scripts/smoke.sh` (modify — keep existing checks; add a no-network pipeline-import sanity check)

- [ ] **Step 1:** Edit `scripts/smoke.sh` — add a step that exercises the new pure scripts.

  Insert after the `bun test` block:

  ```bash
  echo "==> smoke: parse-following + feed-discover sanity"
  (cd "$REPO_ROOT" && bun -e '
    import { parseFollowing } from "./scripts/parse-following";
    import { discoverFeedFromUrl } from "./scripts/feed-discover";
    const f = parseFollowing("https://a.example - aaa\nhttps://b.example - bbb");
    if (f.length !== 2) { console.error("parseFollowing wrong length"); process.exit(2); }
    const yt = discoverFeedFromUrl("https://www.youtube.com/@DwarkeshPatel");
    if (!yt?.includes("feeds/videos.xml")) { console.error("discover wrong"); process.exit(2); }
    console.log("ok");
  ')
  ```

- [ ] **Step 2:** Run + commit.

  ```bash
  bash /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss/scripts/smoke.sh
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/smoke.sh
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "smoke(v2): add parse-following + feed-discover sanity check"
  ```

---

### Task 9: SPEC.md pointer + final verification + push

- [ ] **Step 1:** Add a one-line note to `docs/SPEC.md` above §0 pointing to PROCESSING.md.

  Insert at line 1 (above the title):
  ```markdown
  > **Architecture has pivoted.** See `docs/PROCESSING.md` for the current v2 (Obsidian-native) design. The Scope (§1), Brief composition (§3), and Failure modes (§4) below remain valid; §2 Architecture is superseded.
  ```

- [ ] **Step 2:** Full verification.
  ```bash
  cd /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss
  bun --bun tsc --noEmit       # expect clean
  bun test                     # expect all pass (existing + new)
  bash scripts/smoke.sh        # expect "smoke: ok"
  ```

- [ ] **Step 3:** Commit + push.
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add docs/SPEC.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "docs(spec): point readers to PROCESSING.md for v2 architecture"
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss push
  ```

---

## What's deliberately NOT done in this plan

- **Transcription** for audio/video items — still marked `transcription_failed: true`, scorer treats accordingly. Real transcription is v0.2.
- **Pruning seen.md** — append-only.
- **Recovery of items from an inbox failure** — kept in inbox with a `# <url> failed YYYY-MM-DD: <reason>` comment, per PROCESSING.md §6. The current pipeline doesn't write the failure comment yet; that's a small follow-up.
- **End-to-end run against a real gBrain worker** — requires `bun link gbrain` + worker + API keys, out of automated test scope. The unit tests + smoke + typecheck must all pass.

---

## Dependency graph

```
T1 ──┬─→ T2 ──┐
     └─→ T3 ──┤
              ├─→ T4 ──┬─→ T5 ──┐
                       ├─→ T6 ──┤
                       └─→ T7 ──┤
                                ├─→ T8 ──→ T9
```

**Parallel batches:** {T2, T3} · {T5, T6, T7}.
**Critical path:** T1 → T2/T3 → T4 → T8 → T9.
