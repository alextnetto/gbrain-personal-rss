# Personal RSS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working hackathon MVP of `gbrain-personal-rss` — a daily AI-filtered content brief, installed alongside gBrain v0.35.1.0 as an external skillpack + Minion subagent plugin (no fork).

**Architecture:** Bun + TypeScript scripts handle deterministic work (RSS fetch, content typing, extraction). Markdown subagent definitions handle LLM orchestration (ingest dispatch, scoring, brief composition), discovered by gBrain via `GBRAIN_PLUGIN_PATH`. All state lives as plain gBrain pages. A tiny Express server renders the daily brief for screen-share demos. External cron (system cron / launchd) triggers the daily run.

**Tech Stack:** Bun ≥ 1.3.10, TypeScript (strict, ESM), Express 5, `fast-xml-parser`, `marked`. Tests via `bun test`. All consistent with gBrain's own toolchain.

**Working directory for all commands:** `/Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss`

**Reference checkout of gBrain:** `/Users/netto/work/hackathons/yc-gbrain/gbrain` (read-only, source of truth for any schema lookup).

---

## File Structure

Files this plan creates or modifies. Each path is relative to the repo root.

**Project setup**
- `package.json` (new) — Bun project, scripts, deps
- `tsconfig.json` (new) — strict TS, ESM
- `.gitignore` (modify) — add `node_modules/`, `bun.lock` stays tracked
- `docs/GBRAIN_INTEGRATION.md` (new) — exact plugin/subagent schemas pulled from gBrain source

**Shared types**
- `src/types.ts` (new) — `Subscription`, `ItemFrontmatter`, `BriefFrontmatter` interfaces, one source of truth

**Deterministic TS scripts (called by subagents via `shell`)**
- `scripts/content-type-detect.ts` (new) — pure function, dispatches by URL/mime
- `scripts/fetch-rss.ts` (new) — conditional GET, parse, return new item IDs
- `scripts/extract-text.ts` (new) — fetch URL, return readable text body

**gBrain plugin (subagent definitions)**
- `plugin/gbrain.plugin.json` (new) — plugin manifest
- `plugin/subagents/rss-ingest.md` (new)
- `plugin/subagents/item-process.md` (new)
- `plugin/subagents/transcribe.md` (new)
- `plugin/subagents/score-item.md` (new)
- `plugin/subagents/resurface-archive.md` (new)
- `plugin/subagents/compose-brief.md` (new)

**gBrain skill (workflow teacher for Claude)**
- `skills/personal-rss/SKILL.md` (new) — teaches Claude the page/job conventions
- `skills/personal-rss/routing-eval.jsonl` (new) — gBrain's skillify-check expects this

**Web view**
- `web/server.ts` (new) — Express, ~80 lines, reads briefs via gBrain library
- `web/index.html` (new) — single page, `marked.js` + minimal CSS

**Delivery / install**
- `bin/personal-rss-daily` (new) — shell script that submits the daily job
- `install.sh` (new) — symlinks skill, sets `GBRAIN_PLUGIN_PATH`, installs cron entry
- `scripts/smoke.sh` (new) — end-to-end check, run by `install.sh`

**Tests**
- `tests/content-type-detect.test.ts` (new) — table-driven unit tests
- `tests/fetch-rss.test.ts` (new) — uses fixture XML
- `tests/fixtures/podcast-feed.xml` (new)
- `tests/fixtures/youtube-channel.xml` (new)
- `tests/fixtures/blog-feed.xml` (new)
- `tests/fixtures/arxiv-feed.xml` (new)

**Docs**
- `README.md` (modify) — append install + usage section

---

## Phase 0 — Foundation (sequential)

### Task 1: Document gBrain extension schemas

**Files:**
- Create: `docs/GBRAIN_INTEGRATION.md`
- Read (do NOT modify): `/Users/netto/work/hackathons/yc-gbrain/gbrain/src/core/minions/plugin-loader.ts`
- Read (do NOT modify): `/Users/netto/work/hackathons/yc-gbrain/gbrain/docs/guides/plugin-handlers.md` if it exists
- Read (do NOT modify): any existing example plugins in the gbrain checkout (search `find /Users/netto/work/hackathons/yc-gbrain/gbrain -name "gbrain.plugin.json"`)

- [ ] **Step 1: Read the plugin loader source**

  Read `plugin-loader.ts` lines 1–200 (or full file if shorter). Look specifically for:
  - The `PluginManifest` TypeScript interface — required fields, version constant
  - The `SubagentDefinition` TypeScript interface — frontmatter fields, body convention
  - How manifests are discovered from `GBRAIN_PLUGIN_PATH` (colon-separated vs comma vs single)
  - Any validation / version-check (e.g. `gbrain-plugin-v1`)

- [ ] **Step 2: Search for an example plugin in the checkout**

  Run:
  ```bash
  find /Users/netto/work/hackathons/yc-gbrain/gbrain -name "gbrain.plugin.json" -not -path "*/node_modules/*"
  find /Users/netto/work/hackathons/yc-gbrain/gbrain -path "*plugin*" -name "*.md" -not -path "*/node_modules/*" | head -20
  ```
  If any exist, read them. They are the ground truth for shape.

- [ ] **Step 3: Write `docs/GBRAIN_INTEGRATION.md` with the verified schemas**

  Sections to include:
  - `## Plugin manifest format` — full JSON schema with every field, marked required/optional, with our actual values
  - `## Subagent definition format` — frontmatter keys (e.g. `name`, `description`, `allowed_slug_prefixes`, `tools`, `model`), body convention
  - `## GBRAIN_PLUGIN_PATH discovery` — separator, what counts as a valid plugin root
  - `## Calling shell from a subagent` — the exact syntax/tool name a subagent uses to shell out
  - `## Trust boundary notes` — when `OperationContext.remote` matters, which fields constrain it
  - `## Examples found` — paste any real example plugin found in step 2, verbatim

  This doc is the source of truth for Tasks 7–13. Every subagent task references it.

- [ ] **Step 4: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add docs/GBRAIN_INTEGRATION.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Document gBrain plugin and subagent schemas from source"
  ```

---

### Task 2: Initialize Bun + TypeScript project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create `package.json`**

  ```json
  {
    "name": "gbrain-personal-rss",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "engines": { "bun": ">=1.3.10" },
    "scripts": {
      "test": "bun test",
      "web": "bun run web/server.ts",
      "fetch-rss": "bun run scripts/fetch-rss.ts",
      "extract-text": "bun run scripts/extract-text.ts",
      "smoke": "bash scripts/smoke.sh"
    },
    "dependencies": {
      "express": "^5.0.0",
      "fast-xml-parser": "^4.4.0",
      "marked": "^14.0.0"
    },
    "devDependencies": {
      "@types/express": "^5.0.0",
      "@types/bun": "latest",
      "typescript": "^5.5.0"
    }
  }
  ```

- [ ] **Step 2: Create `tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "resolveJsonModule": true,
      "allowImportingTsExtensions": true,
      "noEmit": true,
      "types": ["bun-types"]
    },
    "include": ["src/**/*", "scripts/**/*", "web/**/*", "tests/**/*"]
  }
  ```

- [ ] **Step 3: Append to `.gitignore`**

  Add these lines (keep existing content):
  ```
  node_modules/
  .DS_Store
  *.tsbuildinfo
  ```
  (`bun.lock` stays tracked — it's reproducible state.)

- [ ] **Step 4: Install dependencies**

  ```bash
  cd /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss && bun install
  ```
  Expected: no errors, `bun.lock` created, `node_modules/` populated.

- [ ] **Step 5: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add package.json tsconfig.json bun.lock .gitignore
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Initialize Bun + TypeScript project"
  ```

---

### Task 3: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

  ```ts
  // One source of truth for the page frontmatter shapes used across scripts + subagents.

  export interface Subscription {
    slug: string;                              // filename stem under subscriptions/
    feed_url: string;
    content_type_hint?: "podcast" | "youtube" | "blog" | "arxiv" | "auto";
    added_at: string;                          // ISO 8601
    last_fetched_at: string | null;
    etag: string | null;
  }

  export type ItemKind = "text" | "audio" | "video";

  export interface ItemFrontmatter {
    source: string;                            // subscription slug
    published_at: string;                      // ISO 8601
    url: string;
    kind: ItemKind;
    duration?: number;                         // seconds, for audio/video
    score?: number;                            // 0–100, filled by score-item
    why_it_matters?: string;                   // one sentence, filled by score-item
    transcript_chunks?: TranscriptChunk[];     // for audio/video
    transcription_failed?: boolean;
  }

  export interface TranscriptChunk {
    start: number;                             // seconds
    end: number;
    text: string;
  }

  export interface BriefFrontmatter {
    date: string;                              // YYYY-MM-DD
    items_considered: number;
    items_included_new: number;
    items_included_archive: number;
    scoring_model: string;
    estimated_total_minutes: number;
    generated_at: string;                      // ISO 8601
  }
  ```

- [ ] **Step 2: Verify it type-checks**

  Run: `bun --bun tsc --noEmit`
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add src/types.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add shared frontmatter types (Subscription, Item, Brief)"
  ```

---

## Phase 1 — Pure scripts (parallel after Phase 0)

Tasks 4, 5, 6 have no dependencies on each other. Dispatch in parallel.

### Task 4: `content-type-detect.ts` (TDD)

**Files:**
- Create: `scripts/content-type-detect.ts`
- Create: `tests/content-type-detect.test.ts`
- Create: `tests/fixtures/podcast-feed.xml`
- Create: `tests/fixtures/youtube-channel.xml`
- Create: `tests/fixtures/blog-feed.xml`
- Create: `tests/fixtures/arxiv-feed.xml`

- [ ] **Step 1: Create the four fixture files**

  These are minimal real-shape RSS samples. Each must include enough of the source's distinctive markers to be recognized.

  `tests/fixtures/podcast-feed.xml`:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
    <channel>
      <title>Example Podcast</title>
      <itunes:author>Jane Doe</itunes:author>
      <item>
        <title>Episode 42</title>
        <enclosure url="https://example.com/ep42.mp3" type="audio/mpeg" length="98765432" />
        <itunes:duration>1834</itunes:duration>
      </item>
    </channel>
  </rss>
  ```

  `tests/fixtures/youtube-channel.xml`:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
    <yt:channelId>UCexample</yt:channelId>
    <title>Example YouTube Channel</title>
    <entry>
      <yt:videoId>dQw4w9WgXcQ</yt:videoId>
      <title>A Video</title>
      <link href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />
    </entry>
  </feed>
  ```

  `tests/fixtures/blog-feed.xml`:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
    <title>Example Blog</title>
    <item>
      <title>A Post</title>
      <link>https://example.com/posts/a-post</link>
      <description>A short summary of the post.</description>
    </item>
  </channel></rss>
  ```

  `tests/fixtures/arxiv-feed.xml`:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>arXiv cs.AI new submissions</title>
    <entry>
      <id>http://arxiv.org/abs/2601.00001v1</id>
      <title>A Paper Title</title>
      <link href="http://arxiv.org/abs/2601.00001v1" />
      <summary>Abstract text.</summary>
    </entry>
  </feed>
  ```

- [ ] **Step 2: Write the failing test**

  `tests/content-type-detect.test.ts`:
  ```ts
  import { expect, test, describe } from "bun:test";
  import { readFileSync } from "fs";
  import { detectContentType } from "../scripts/content-type-detect";

  const fx = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");

  describe("detectContentType", () => {
    test("classifies an iTunes podcast feed as audio", () => {
      expect(detectContentType(fx("podcast-feed.xml"), "https://example.com/podcast.xml")).toBe("audio");
    });
    test("classifies a YouTube channel feed as video", () => {
      expect(detectContentType(fx("youtube-channel.xml"), "https://www.youtube.com/feeds/videos.xml?channel_id=UCexample")).toBe("video");
    });
    test("classifies a plain blog RSS as text", () => {
      expect(detectContentType(fx("blog-feed.xml"), "https://example.com/feed.xml")).toBe("text");
    });
    test("classifies an arXiv Atom feed as text", () => {
      expect(detectContentType(fx("arxiv-feed.xml"), "http://export.arxiv.org/rss/cs.AI")).toBe("text");
    });
    test("URL hint wins when content is ambiguous", () => {
      const ambiguous = `<?xml version="1.0"?><rss><channel><item><title>x</title></item></channel></rss>`;
      expect(detectContentType(ambiguous, "https://anchor.fm/s/abc/podcast/rss")).toBe("audio");
    });
  });
  ```

- [ ] **Step 3: Run the test, confirm it fails**

  Run: `bun test tests/content-type-detect.test.ts`
  Expected: 5 tests fail with "cannot resolve module '../scripts/content-type-detect'".

- [ ] **Step 4: Write `scripts/content-type-detect.ts`**

  ```ts
  import type { ItemKind } from "../src/types";

  // Returns the dominant content type of a feed, given its XML body and feed URL.
  // Strategy: URL host/path hints first (cheapest, most reliable), then enclosure mime types,
  // then iTunes/YouTube namespace markers, default text.
  export function detectContentType(feedXml: string, feedUrl: string): ItemKind {
    const url = feedUrl.toLowerCase();

    if (/anchor\.fm|libsyn|simplecast|megaphone|art19|podbean|buzzsprout|transistor\.fm/.test(url)) {
      return "audio";
    }
    if (/youtube\.com\/feeds\/videos\.xml|youtube\.com\/channel|youtu\.be/.test(url)) {
      return "video";
    }

    if (/xmlns:itunes=/.test(feedXml)) return "audio";
    if (/xmlns:yt=|<yt:channelId>|<yt:videoId>/.test(feedXml)) return "video";

    if (/<enclosure[^>]*type="audio\//i.test(feedXml)) return "audio";
    if (/<enclosure[^>]*type="video\//i.test(feedXml)) return "video";

    return "text";
  }
  ```

- [ ] **Step 5: Run the test, confirm it passes**

  Run: `bun test tests/content-type-detect.test.ts`
  Expected: 5 pass, 0 fail.

- [ ] **Step 6: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/content-type-detect.ts tests/content-type-detect.test.ts tests/fixtures/
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add content-type-detect with fixture-driven tests"
  ```

---

### Task 5: `fetch-rss.ts` (TDD with HTTP mock)

**Files:**
- Create: `scripts/fetch-rss.ts`
- Create: `tests/fetch-rss.test.ts`

- [ ] **Step 1: Write the failing test**

  `tests/fetch-rss.test.ts`:
  ```ts
  import { expect, test, describe, mock } from "bun:test";
  import { readFileSync } from "fs";
  import { parseRssItems } from "../scripts/fetch-rss";

  describe("parseRssItems", () => {
    test("returns one item per <item> in a blog RSS feed", () => {
      const xml = readFileSync("tests/fixtures/blog-feed.xml", "utf8");
      const items = parseRssItems(xml);
      expect(items.length).toBe(1);
      expect(items[0].url).toBe("https://example.com/posts/a-post");
      expect(items[0].title).toBe("A Post");
    });
    test("returns one item per <entry> in an Atom feed", () => {
      const xml = readFileSync("tests/fixtures/arxiv-feed.xml", "utf8");
      const items = parseRssItems(xml);
      expect(items.length).toBe(1);
      expect(items[0].url).toBe("http://arxiv.org/abs/2601.00001v1");
    });
    test("extracts enclosure URL for podcast items", () => {
      const xml = readFileSync("tests/fixtures/podcast-feed.xml", "utf8");
      const items = parseRssItems(xml);
      expect(items[0].enclosure_url).toBe("https://example.com/ep42.mp3");
      expect(items[0].duration).toBe(1834);
    });
    test("derives a stable item id from URL when no <guid>", () => {
      const xml = readFileSync("tests/fixtures/blog-feed.xml", "utf8");
      const items = parseRssItems(xml);
      expect(items[0].id).toBeTruthy();
      expect(items[0].id.length).toBeGreaterThan(8);
    });
  });
  ```

- [ ] **Step 2: Run, confirm it fails**

  Run: `bun test tests/fetch-rss.test.ts`
  Expected: 4 tests fail with module-not-found.

- [ ] **Step 3: Write `scripts/fetch-rss.ts`**

  ```ts
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

    // RSS 2.0: rss > channel > item[]
    const rssItems = doc?.rss?.channel?.item;
    if (rssItems) {
      const arr = Array.isArray(rssItems) ? rssItems : [rssItems];
      for (const it of arr) {
        const url = typeof it.link === "string" ? it.link : it.link?.["#text"] ?? "";
        const enc = it.enclosure;
        const itunesDuration = it["itunes:duration"];
        const rawGuid = it.guid?.["#text"] ?? it.guid;
        items.push({
          id: safeId(rawGuid, url),
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

    // Atom: feed > entry[]
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
  // Writes JSON to stdout with { items: ParsedItem[], etag?: string, status: number }
  if (import.meta.main) {
    const [feedUrl, etag] = Bun.argv.slice(2);
    if (!feedUrl) {
      console.error("usage: fetch-rss.ts <feed_url> [etag]");
      process.exit(2);
    }
    const headers: Record<string, string> = { "user-agent": "gbrain-personal-rss/0.1" };
    if (etag) headers["if-none-match"] = etag;
    const res = await fetch(feedUrl, { headers });
    if (res.status === 304) {
      console.log(JSON.stringify({ items: [], etag, status: 304 }));
      process.exit(0);
    }
    if (!res.ok) {
      console.log(JSON.stringify({ items: [], status: res.status, error: res.statusText }));
      process.exit(1);
    }
    const xml = await res.text();
    const items = parseRssItems(xml);
    console.log(JSON.stringify({ items, etag: res.headers.get("etag"), status: 200 }));
  }
  ```

- [ ] **Step 4: Run, confirm it passes**

  Run: `bun test tests/fetch-rss.test.ts`
  Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/fetch-rss.ts tests/fetch-rss.test.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add fetch-rss with RSS+Atom parsing and conditional-GET CLI"
  ```

---

### Task 6: `extract-text.ts`

**Files:**
- Create: `scripts/extract-text.ts`

No test for this one — it's a thin wrapper around `fetch` + a readability heuristic, the smoke test covers it end-to-end. (Spec §4.2 explicitly excludes broader testing from MVP scope.)

- [ ] **Step 1: Write the script**

  ```ts
  // CLI: bun run scripts/extract-text.ts <url>
  // Writes the readable text body of the URL to stdout as JSON: { url, title, text, fetched_at }
  // Strategy: fetch HTML, strip <script>/<style>, collapse whitespace. Crude but enough for blog posts and Substack.

  function stripHtml(html: string): { title: string; text: string } {
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

  if (import.meta.main) {
    const url = Bun.argv[2];
    if (!url) {
      console.error("usage: extract-text.ts <url>");
      process.exit(2);
    }
    const res = await fetch(url, { headers: { "user-agent": "gbrain-personal-rss/0.1" } });
    if (!res.ok) {
      console.log(JSON.stringify({ url, error: res.statusText, status: res.status }));
      process.exit(1);
    }
    const html = await res.text();
    const { title, text } = stripHtml(html);
    console.log(JSON.stringify({ url, title, text, fetched_at: new Date().toISOString() }));
  }
  ```

- [ ] **Step 2: Type-check**

  Run: `bun --bun tsc --noEmit`
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/extract-text.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add extract-text CLI for fetching readable body of an article URL"
  ```

---

## Phase 2 — gBrain plugin manifest + subagent definitions (parallel after Phase 0)

Tasks 7–13 all reference the schemas documented in `docs/GBRAIN_INTEGRATION.md` (Task 1). The exact frontmatter keys below are best-effort *templates*. **At task execution time, the engineer cross-checks each frontmatter against `docs/GBRAIN_INTEGRATION.md` and adjusts.** Body content (the prompt) is the substance and does not depend on the schema.

**Two specific names to verify in Task 1 and replace throughout Phase 2:**

1. **Brain-access tool names.** The template subagents use `brain_read`, `brain_write`, `brain_search`, `submit_job` — these names are guessed. The real tool names live in `gbrain/src/core/operations.ts` (each op's `name` field). Task 1's deliverable should list every tool name available to subagents; Tasks 8–13 substitute the real names into their `tools:` arrays and prompt bodies.

2. **Shell-tool invocation syntax.** The templates say things like *"Run the shell command: `bun run scripts/fetch-rss.ts ...`"*. The actual mechanism (which tool the subagent calls, whether it's `shell({command: "..."})` or `bash({...})` or something else) needs to be verified. Task 1 should pin this down.

### Task 7: Plugin manifest

**Files:**
- Create: `plugin/gbrain.plugin.json`

- [ ] **Step 1: Write the manifest**

  Use the exact `version` and field names from `docs/GBRAIN_INTEGRATION.md` (Task 1). Template — adjust to verified schema:

  ```json
  {
    "version": "gbrain-plugin-v1",
    "name": "personal-rss",
    "description": "Personal RSS — AI-filtered daily content brief across podcasts, video, articles, papers.",
    "author": "Alex Netto",
    "subagents_dir": "./subagents"
  }
  ```

  If `docs/GBRAIN_INTEGRATION.md` shows additional required fields (e.g. `min_gbrain_version`, `handlers`, etc.), include them. If it shows a different field name for the subagents directory, use that name.

- [ ] **Step 2: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add plugin/gbrain.plugin.json
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add gbrain plugin manifest"
  ```

---

### Task 8: `rss-ingest` subagent

**Files:**
- Create: `plugin/subagents/rss-ingest.md`

- [ ] **Step 1: Write the subagent definition**

  Frontmatter shape — adjust per `docs/GBRAIN_INTEGRATION.md`:

  ```markdown
  ---
  name: rss-ingest
  description: Fetches one RSS subscription, parses items, enqueues item-process jobs for new items.
  allowed_slug_prefixes:
    - subscriptions/
    - items/
  tools: [shell, brain_read, brain_write, submit_job]
  model: claude-haiku-4-5-20251001
  ---

  You ingest one RSS subscription.

  ## Input
  You receive `{ subscription_slug: string }`.

  ## Workflow

  1. Read the subscription page at `subscriptions/{subscription_slug}.md`. Extract `feed_url` and `etag` from frontmatter.

  2. Run the shell command:
     ```
     bun run /opt/gbrain-personal-rss/scripts/fetch-rss.ts "{feed_url}" "{etag-or-empty}"
     ```
     The script outputs JSON `{ items, etag, status }`.

  3. If `status` is 304, write `last_fetched_at` to the subscription frontmatter and stop.
     If `status` is non-200, log the error to the subscription page body (append a dated line) and stop.

  4. For each item in `items`:
     - Construct an item slug: `{subscription_slug}/{item.id}`.
     - If a page already exists at `items/{item slug}.md`, skip.
     - Otherwise, write a new page at `items/{item slug}.md` with frontmatter:
       ```
       source: {subscription_slug}
       published_at: {item.published_at}
       url: {item.url}
       kind: pending           # item-process will set this
       title: {item.title}
       enclosure_url: {item.enclosure_url-if-present}
       duration: {item.duration-if-present}
       ```
       Body: `{item.summary}` if present, else empty.
     - `submit_job({ handler: "item-process", input: { item_slug: "{slug}" } })`.

  5. Update the subscription frontmatter: set `etag` to the returned etag, `last_fetched_at` to the current ISO timestamp.

  ## Rules
  - Never write outside `subscriptions/` or `items/`.
  - If the shell command fails or returns non-JSON, log it on the subscription page and stop — do not retry.
  - Skip items whose `url` is empty or whose `published_at` is more than 14 days old (avoids back-importing the full feed on first fetch).
  ```

- [ ] **Step 2: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add plugin/subagents/rss-ingest.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add rss-ingest subagent: fetch feed, parse, enqueue item-process"
  ```

---

### Task 9: `item-process` subagent

**Files:**
- Create: `plugin/subagents/item-process.md`

- [ ] **Step 1: Write the subagent definition**

  ```markdown
  ---
  name: item-process
  description: Determines content type for one ingested item, dispatches to text extraction or transcription, then triggers scoring.
  allowed_slug_prefixes:
    - items/
    - subscriptions/
  tools: [shell, brain_read, brain_write, submit_job]
  model: claude-haiku-4-5-20251001
  ---

  You process one ingested item.

  ## Input
  `{ item_slug: string }` (e.g. `example-blog/abc123`).

  ## Workflow

  1. Read `items/{item_slug}.md`. Get `url`, `enclosure_url`, `duration`, and the parent subscription slug.

  2. Read `subscriptions/{source}.md` to get the feed_url. Read the feed XML if needed (use the gBrain page if cached, otherwise re-fetch via fetch-rss — but typically rss-ingest already wrote it).

  3. Determine `kind` by running:
     ```
     bun run -e 'import("/opt/gbrain-personal-rss/scripts/content-type-detect.ts").then(m => console.log(m.detectContentType(process.argv[2], process.argv[3])))' "{feed_xml-or-empty}" "{feed_url}"
     ```
     Alternative if simpler: if `enclosure_url` is present and ends in `.mp3/.m4a/.aac`, set `kind: "audio"`. If `enclosure_url` ends in `.mp4/.webm`, set `kind: "video"`. Otherwise `kind: "text"`.
     Update the item frontmatter with the resolved `kind`.

  4. Dispatch by `kind`:
     - `text`: shell out to `bun run /opt/gbrain-personal-rss/scripts/extract-text.ts "{url}"`. Set the script's `text` output as the item body. Mark item ready for scoring.
     - `audio` or `video`: `submit_job({ handler: "transcribe", input: { item_slug } })`. The transcribe subagent will populate the body and mark ready.

  5. Once the body is populated (for `text` items, immediately; for audio/video, the transcribe subagent does this as its final step), `submit_job({ handler: "score-item", input: { item_slug } })`.

  ## Rules
  - Never modify the URL or `published_at` once set by rss-ingest.
  - If extraction fails, write `transcription_failed: true` (for audio/video) or `extraction_failed: true` (for text) into frontmatter and stop — score-item will skip these.
  ```

- [ ] **Step 2: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add plugin/subagents/item-process.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add item-process subagent: classify content, dispatch text/audio/video"
  ```

---

### Task 10: `transcribe` subagent

**Files:**
- Create: `plugin/subagents/transcribe.md`

- [ ] **Step 1: Write the subagent definition**

  ```markdown
  ---
  name: transcribe
  description: Transcribes one audio or video item using gBrain's transcription pipeline, writes time-anchored chunks.
  allowed_slug_prefixes:
    - items/
  tools: [shell, brain_read, brain_write, submit_job]
  model: claude-haiku-4-5-20251001
  ---

  You transcribe one audio or video item and write the transcript back to the item page.

  ## Input
  `{ item_slug: string }`

  ## Workflow

  1. Read `items/{item_slug}.md`. Extract `enclosure_url` (audio) or `url` (video).

  2. For audio (kind: audio): shell out to the gBrain transcription CLI:
     ```
     gbrain transcribe "{enclosure_url}"
     ```
     This returns JSON with `{ chunks: [{ start, end, text }, ...], full_text: string }`.

     For video (kind: video): first fetch with yt-dlp:
     ```
     yt-dlp -x --audio-format mp3 -o /tmp/yt-{item_id}.mp3 "{url}" && gbrain transcribe /tmp/yt-{item_id}.mp3
     ```

  3. Write back to the item page:
     - Frontmatter: add `transcript_chunks: [{start, end, text}, ...]` (keep chunks under 90s each — split larger ones at sentence boundaries).
     - Body: the `full_text`.

  4. `submit_job({ handler: "score-item", input: { item_slug } })`.

  ## Failure handling
  - If transcription fails (timeout, unsupported format), write `transcription_failed: true` to frontmatter, leave body empty, do NOT submit score-item.
  - Hard timeout: 15 minutes per item. Anything longer, mark as failed.

  ## Notes
  - The `gbrain transcribe` command is invoked as the gBrain user (`OperationContext.remote = false` when run via shell from a subagent triggered by autopilot; `true` when triggered via MCP). Both should work for transcribe, but if remote-trust constraints reject the call, fall back to direct Whisper if the env has `WHISPER_BIN` set.
  ```

- [ ] **Step 2: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add plugin/subagents/transcribe.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add transcribe subagent for audio/video items"
  ```

---

### Task 11: `score-item` subagent

**Files:**
- Create: `plugin/subagents/score-item.md`

- [ ] **Step 1: Write the subagent definition**

  ```markdown
  ---
  name: score-item
  description: Scores one item against the user's interests using gBrain hybrid search + an LLM rerank step.
  allowed_slug_prefixes:
    - items/
  tools: [brain_read, brain_write, brain_search]
  model: claude-haiku-4-5-20251001
  ---

  You score one item against the user's stated interests and write a 0–100 score plus a one-sentence "why it matters" to the item frontmatter.

  ## Input
  `{ item_slug: string }`

  ## Workflow

  1. Read `interests.md`. If missing, write `score: 0, why_it_matters: "interests.md missing"` to the item and stop.

  2. Read the item page at `items/{item_slug}.md`. Get the title, url, body (or transcript), and frontmatter.

  3. Compute a hybrid-search relevance signal: call `brain_search({ query: <text of interests.md>, limit: 30 })`. Check whether this item appears in the top-30 results. (Items that don't appear are usually score < 70.)

  4. Produce a 0–100 score and a one-sentence justification by reasoning over:
     - The interests.md content
     - The item's title and first ~500 characters of body
     - Whether the item appeared in the hybrid-search top-30

     Be calibrated. 70 means "clearly relevant to one or more stated interests." 50 means "tangential." 90+ means "directly on a stated interest and high-information." Default to lower scores when in doubt.

  5. Write back to the item frontmatter (preserving all other fields):
     ```
     score: <0–100 integer>
     why_it_matters: "<one sentence, max ~150 chars>"
     ```

  ## Rules
  - Never modify the body, only frontmatter.
  - `why_it_matters` should reference a specific stated interest, not be generic.
  - For items with `transcription_failed: true` or empty body: score: 0, why_it_matters: "could not extract content".
  ```

- [ ] **Step 2: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add plugin/subagents/score-item.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add score-item subagent: hybrid search + LLM rerank vs interests.md"
  ```

---

### Task 12: `resurface-archive` subagent

**Files:**
- Create: `plugin/subagents/resurface-archive.md`

- [ ] **Step 1: Write the subagent definition**

  ```markdown
  ---
  name: resurface-archive
  description: Finds items older than 30 days that have become newly relevant given today's top-scored new items.
  allowed_slug_prefixes:
    - items/
    - briefs/
  tools: [brain_read, brain_write, brain_search]
  model: claude-haiku-4-5-20251001
  ---

  You find archive items (older than 30 days) that are newly relevant given today's freshly-scored new items.

  ## Input
  None — read state from the brain.

  ## Workflow

  1. Find today's top-3 new items: read `items/**`, filter to items where `published_at` is within the last 24 hours and `score >= 80`, sort by score desc, take top 3.

  2. If there are fewer than 3 such items, take whatever exists (down to 1). If zero, write `briefs/<today>-archive.json` with `{ candidates: [] }` and stop.

  3. For each top-3 new item, run `brain_search({ query: <title + first 200 chars of body>, limit: 20 })`. Collect any results whose `published_at` is more than 30 days old.

  4. From the combined candidate set, dedupe by item slug and take the top 5 by hybrid-search rank.

  5. For each of the 5 candidates, use the LLM to judge: "Is this archive item newly relevant given the top-3 new items? Yes/no, and one sentence why." Keep the top 2 yeses (or fewer if fewer yeses).

  6. Write a small intermediate file at `briefs/<today>-archive.json` (JSON, not markdown — the compose-brief subagent will read it):
     ```json
     {
       "candidates": [
         {
           "item_slug": "...",
           "newly_relevant_because": "<one sentence>",
           "triggered_by_new_item_slug": "..."
         }
       ]
     }
     ```

  ## Rules
  - Empty candidate list is a valid result (don't pad).
  - Always cap at 2 keepers max — the brief has limited real estate.
  - Older than 30 days means: `now - published_at > 30 * 24 * 3600`.
  ```

- [ ] **Step 2: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add plugin/subagents/resurface-archive.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add resurface-archive subagent: find newly-relevant old items"
  ```

---

### Task 13: `compose-brief` subagent

**Files:**
- Create: `plugin/subagents/compose-brief.md`

- [ ] **Step 1: Write the subagent definition**

  ```markdown
  ---
  name: compose-brief
  description: Assembles the two-section daily brief and writes it to briefs/<today>.md.
  allowed_slug_prefixes:
    - items/
    - briefs/
  tools: [brain_read, brain_write]
  model: claude-haiku-4-5-20251001
  ---

  You write today's daily brief.

  ## Input
  `{ date?: string }` — defaults to today (YYYY-MM-DD in local TZ).

  ## Workflow

  1. Find "new" items: read `items/**`, filter to items with `published_at` within the last 24 hours AND `score >= 70`. Sort by score desc, cap at 8.

  2. Read `briefs/<date>-archive.json` (produced by resurface-archive). If missing or empty, the archive section is omitted.

  3. Read `interests.md` so per-item "why" lines can reference specific interests by name.

  4. For each "new" item, compute estimated read/listen minutes:
     - text: `Math.max(1, Math.round(body_word_count / 220))`
     - audio/video: pick the most-relevant transcript chunk (longest contiguous run of high-information chunks), report that range; minutes = `Math.round((chunk.end - chunk.start) / 60)`.

  5. Render the brief to markdown using exactly the format below.

  6. Write the brief to `briefs/<date>.md` with frontmatter recording:
     ```
     date: <date>
     items_considered: <total items examined in step 1 before filter>
     items_included_new: <length of "new" list>
     items_included_archive: <length of "archive" list>
     scoring_model: claude-haiku-4-5-20251001
     estimated_total_minutes: <sum of per-item minutes>
     generated_at: <ISO timestamp>
     ```

  ## Brief format (exact)

  ```markdown
  # Daily Brief — <date>
  _~<total minutes> min · <N> new · <M> from your archive_

  ## New today

  ### 1. [<title>](<url>) — <minutes> min <read|listen>
  *Why:* <why_it_matters from item frontmatter>
  > <first 2 sentences of body OR most-relevant transcript chunk text>
  [<read · paragraphs 4–7 | listen · MM:SS–MM:SS>](<url-with-anchor-or-timestamp>)

  ...

  ## From your archive

  ### 1. [<title (saved <human-date>)>](<url>) — <minutes> min re-read
  *Newly relevant because:* <newly_relevant_because from archive json>
  > <snippet>
  [re-read](<url>)
  ```

  Omit the "From your archive" section if the list is empty. Do not pad.

  ## Rules
  - If there are no "new" items meeting threshold AND no archive candidates, still write a brief saying "Quiet day. <N> items considered, none cleared the 70 threshold." — do not omit the brief entirely.
  - Do not invent items not present in the brain.
  - Timestamps in deep links: use `?t=<seconds>` for YouTube; for podcasts, append `#t=<seconds>` (best-effort; many podcast hosts ignore it but it's good practice).
  ```

- [ ] **Step 2: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add plugin/subagents/compose-brief.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add compose-brief subagent: two-section daily brief"
  ```

---

## Phase 3 — Skill (workflow teacher for Claude)

### Task 14: `SKILL.md` + `routing-eval.jsonl`

**Files:**
- Create: `skills/personal-rss/SKILL.md`
- Create: `skills/personal-rss/routing-eval.jsonl`

- [ ] **Step 1: Write `skills/personal-rss/SKILL.md`**

  ```markdown
  ---
  name: personal-rss
  description: Use when the user wants to manage RSS subscriptions (podcasts, blogs, YouTube channels, papers), trigger the daily content brief, or read today's/past briefs.
  ---

  # Personal RSS

  This skill teaches you how to operate the personal-rss system. All state lives as gBrain pages; you don't have custom tools — you use gBrain's existing `put_page`, `list_pages`, `get_page`, and `submit_job` operations.

  ## Conventions
  - Subscriptions live at `subscriptions/<slug>.md`. Slug is a kebab-case, derived from the source title.
  - Items live at `items/<source-slug>/<item-id>.md`. You don't manipulate items directly.
  - Daily briefs live at `briefs/<YYYY-MM-DD>.md`.
  - The user's interests live at `interests.md` (single page, free-text).

  ## When the user wants to add a subscription

  1. If they gave you a URL but not a feed URL, try common patterns:
     - YouTube channel: `https://www.youtube.com/feeds/videos.xml?channel_id=<ID>`
     - Substack: `<root>/feed`
     - Podcast: usually direct from the publisher; ask the user if you can't find it.
  2. Derive a kebab-case slug from the source title.
  3. Call `put_page` to write `subscriptions/<slug>.md` with frontmatter:
     ```yaml
     feed_url: <feed_url>
     content_type_hint: auto
     added_at: <now ISO>
     last_fetched_at: null
     etag: null
     ```
     Body: a one-sentence note from the user about what the source is.
  4. Tell the user the subscription was added. Don't trigger ingest immediately unless they ask — the next nightly run picks it up.

  ## When the user wants to see today's brief

  1. Compute today's date (YYYY-MM-DD, local TZ).
  2. Call `get_page("briefs/<date>.md")`.
  3. If it doesn't exist: tell the user, and offer to trigger one now via `submit_job({handler: "compose-brief"})`. Wait for confirmation before triggering.
  4. If it exists: return it inline. Don't summarize — they want to see the brief itself.

  ## When the user wants to see a past brief

  1. Parse the date they mentioned ("last Tuesday", "March 12", etc.) into YYYY-MM-DD.
  2. Call `get_page("briefs/<date>.md")`.
  3. If missing: tell them no brief exists for that date.

  ## When the user wants to update their interests

  1. Call `get_page("interests.md")` to read current.
  2. Apply their edit (add, remove, rewrite).
  3. Call `put_page("interests.md", <new body>)`.
  4. Note: the next nightly run will re-score against the new interests.

  ## When the user wants to list subscriptions

  Call `list_pages({prefix: "subscriptions/"})` and render the list with feed_url and added_at.

  ## When the user wants to trigger the brief NOW

  `submit_job({handler: "compose-brief"})`. Then poll `get_page("briefs/<today>.md")` after ~30 seconds, or tell the user to ask again in a moment.

  ## Don't
  - Don't invent items or briefs. If a page doesn't exist, say so.
  - Don't modify item pages (`items/**`) directly — they're managed by ingest/scoring subagents.
  - Don't write briefs by hand — that's compose-brief's job.
  ```

- [ ] **Step 2: Write `skills/personal-rss/routing-eval.jsonl`**

  Five lines, one per realistic user request. Adjust schema per `docs/GBRAIN_INTEGRATION.md` if gBrain's routing-eval has a stricter shape.

  ```jsonl
  {"input": "Add this YouTube channel to my feed: https://www.youtube.com/@AnthropicAI", "should_route_to": "personal-rss"}
  {"input": "What should I read today?", "should_route_to": "personal-rss"}
  {"input": "Show me last Tuesday's brief", "should_route_to": "personal-rss"}
  {"input": "I'm now also interested in WebAssembly toolchains, update my interests", "should_route_to": "personal-rss"}
  {"input": "List my current subscriptions", "should_route_to": "personal-rss"}
  ```

- [ ] **Step 3: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add skills/personal-rss/
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add personal-rss skill: workflow teacher + routing-eval"
  ```

---

## Phase 4 — Delivery surfaces (parallel)

Tasks 15, 16, 17 can be dispatched in parallel — they don't depend on each other.

### Task 15: Web view

**Files:**
- Create: `web/server.ts`
- Create: `web/index.html`

- [ ] **Step 1: Write `web/server.ts`**

  ```ts
  import express from "express";
  import { marked } from "marked";
  import { readdirSync, readFileSync, existsSync } from "fs";
  import { join } from "path";

  // The brain root is provided by env (gBrain convention). For demo, default to ~/.gbrain/brain.
  const BRAIN_ROOT = process.env.GBRAIN_BRAIN_ROOT ?? `${process.env.HOME}/.gbrain/brain`;
  const BRIEFS_DIR = join(BRAIN_ROOT, "briefs");
  const PORT = Number(process.env.PERSONAL_RSS_PORT ?? 7777);

  const app = express();

  function readBrief(date: string): { ok: true; html: string; meta: Record<string, unknown> } | { ok: false } {
    const path = join(BRIEFS_DIR, `${date}.md`);
    if (!existsSync(path)) return { ok: false };
    const raw = readFileSync(path, "utf8");
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const meta = fm ? Object.fromEntries(fm[1].split("\n").map(l => l.split(/:\s*/, 2))) : {};
    const body = fm ? fm[2] : raw;
    return { ok: true, html: marked.parse(body) as string, meta };
  }

  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  app.get("/", (_req, res) => res.redirect(`/brief/${todayStr()}`));

  app.get("/brief/:date", (req, res) => {
    const brief = readBrief(req.params.date);
    const shell = readFileSync(join(import.meta.dir, "index.html"), "utf8");
    if (!brief.ok) {
      return res.status(404).send(shell.replace("{{CONTENT}}", `<p>No brief for ${req.params.date}.</p>`));
    }
    res.send(shell.replace("{{CONTENT}}", brief.html).replace("{{DATE}}", req.params.date));
  });

  app.get("/briefs", (_req, res) => {
    if (!existsSync(BRIEFS_DIR)) return res.send("<p>No briefs yet.</p>");
    const files = readdirSync(BRIEFS_DIR).filter(f => f.endsWith(".md")).sort().reverse();
    const list = files.map(f => `<li><a href="/brief/${f.replace(".md", "")}">${f.replace(".md", "")}</a></li>`).join("");
    const shell = readFileSync(join(import.meta.dir, "index.html"), "utf8");
    res.send(shell.replace("{{CONTENT}}", `<h1>Briefs</h1><ul>${list}</ul>`).replace("{{DATE}}", "index"));
  });

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`gbrain-personal-rss web → http://127.0.0.1:${PORT}`);
  });
  ```

- [ ] **Step 2: Write `web/index.html`**

  ```html
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Personal RSS — {{DATE}}</title>
    <style>
      :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color-scheme: light dark; }
      body { max-width: 720px; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.6; }
      h1 { font-weight: 700; margin-bottom: 0.25rem; }
      h2 { margin-top: 2.5rem; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); padding-bottom: 0.4rem; }
      h3 { margin-top: 1.75rem; font-weight: 600; }
      blockquote { color: color-mix(in srgb, currentColor 65%, transparent); border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent); margin-left: 0; padding-left: 1rem; }
      a { color: #0066cc; text-decoration: none; } a:hover { text-decoration: underline; }
      em { color: color-mix(in srgb, currentColor 75%, transparent); }
      nav { font-size: 0.85rem; opacity: 0.7; margin-bottom: 1.5rem; }
    </style>
  </head>
  <body>
    <nav><a href="/">today</a> · <a href="/briefs">all briefs</a></nav>
    {{CONTENT}}
  </body>
  </html>
  ```

- [ ] **Step 3: Type-check + smoke-start**

  Run: `bun --bun tsc --noEmit`
  Expected: no errors.

  Optional smoke: `bun run web` in a separate terminal, visit `http://127.0.0.1:7777` (should 404 since no briefs exist yet — that's the success criterion).

- [ ] **Step 4: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add web/
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add web view: Express + marked, reads briefs from brain root"
  ```

---

### Task 16: `bin/personal-rss-daily`

**Files:**
- Create: `bin/personal-rss-daily`

- [ ] **Step 1: Write the script**

  ```bash
  #!/usr/bin/env bash
  # Triggered by cron / launchd once a day.
  # Submits a compose-brief job which transitively triggers ingest for all subscriptions.

  set -euo pipefail

  PLUGIN_PATH="${GBRAIN_PLUGIN_PATH:-$HOME/.config/gbrain/plugins/personal-rss}"
  export GBRAIN_PLUGIN_PATH="$PLUGIN_PATH"

  # Step 1: for every subscription, submit an rss-ingest job.
  # (compose-brief assumes ingestion has already happened today.)
  gbrain list-pages --prefix "subscriptions/" --format json | \
    bun -e '
      const items = JSON.parse(require("fs").readFileSync(0, "utf8"));
      for (const p of items) {
        const slug = p.slug.replace(/^subscriptions\//, "").replace(/\.md$/, "");
        console.log(slug);
      }
    ' | while read slug; do
      gbrain submit-job rss-ingest --input "{\"subscription_slug\": \"$slug\"}"
    done

  # Step 2: wait briefly for ingest to settle. In practice the Minions queue is asynchronous;
  # for the MVP we just sleep enough for typical small subscription counts. A future
  # iteration should poll the job queue for completion.
  sleep 60

  # Step 3: resurface archive.
  gbrain submit-job resurface-archive

  sleep 15

  # Step 4: compose brief.
  gbrain submit-job compose-brief

  echo "personal-rss-daily: submitted jobs at $(date -Iseconds)"
  ```

- [ ] **Step 2: Make executable**

  ```bash
  chmod +x bin/personal-rss-daily
  ```

- [ ] **Step 3: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add bin/personal-rss-daily
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add bin/personal-rss-daily: cron entry point for daily run"
  ```

---

### Task 17: `install.sh`

**Files:**
- Create: `install.sh`

- [ ] **Step 1: Write the script**

  ```bash
  #!/usr/bin/env bash
  # Installs gbrain-personal-rss alongside an existing gBrain checkout.
  # Usage: ./install.sh /path/to/gbrain

  set -euo pipefail

  if [[ $# -ne 1 ]]; then
    echo "usage: $0 /path/to/gbrain" >&2
    exit 2
  fi

  GBRAIN_ROOT="$1"
  if [[ ! -d "$GBRAIN_ROOT/skills" ]]; then
    echo "error: $GBRAIN_ROOT does not look like a gbrain checkout (no skills/ dir)" >&2
    exit 1
  fi

  REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

  echo "==> installing skill"
  ln -sfn "$REPO_ROOT/skills/personal-rss" "$GBRAIN_ROOT/skills/personal-rss"

  echo "==> registering plugin via GBRAIN_PLUGIN_PATH"
  GBRAIN_RC="$HOME/.gbrainrc"
  PLUGIN_LINE="export GBRAIN_PLUGIN_PATH=\"$REPO_ROOT/plugin:\${GBRAIN_PLUGIN_PATH:-}\""
  if ! grep -qF "$REPO_ROOT/plugin" "$GBRAIN_RC" 2>/dev/null; then
    echo "$PLUGIN_LINE" >> "$GBRAIN_RC"
    echo "  added to $GBRAIN_RC (source it from your shell rc, e.g. .zshrc)"
  else
    echo "  already present in $GBRAIN_RC"
  fi

  echo "==> installing deps"
  (cd "$REPO_ROOT" && bun install)

  echo "==> generating sample launchd plist (macOS)"
  PLIST_PATH="$HOME/Library/LaunchAgents/com.alextnetto.gbrain-personal-rss.plist"
  cat > "$PLIST_PATH" <<EOF
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>Label</key><string>com.alextnetto.gbrain-personal-rss</string>
    <key>ProgramArguments</key>
    <array>
      <string>$REPO_ROOT/bin/personal-rss-daily</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
    <key>StandardOutPath</key><string>/tmp/personal-rss-daily.out</string>
    <key>StandardErrorPath</key><string>/tmp/personal-rss-daily.err</string>
  </dict>
  </plist>
  EOF
  echo "  wrote $PLIST_PATH (load with: launchctl load $PLIST_PATH)"

  echo "==> running smoke test"
  bash "$REPO_ROOT/scripts/smoke.sh"

  echo "==> done"
  echo "  • source $GBRAIN_RC in your shell"
  echo "  • run 'gbrain doctor' to verify gBrain still sees the new plugin"
  echo "  • optionally: launchctl load $PLIST_PATH"
  ```

- [ ] **Step 2: Make executable**

  ```bash
  chmod +x install.sh
  ```

- [ ] **Step 3: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add install.sh
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add install.sh: symlink skill, set GBRAIN_PLUGIN_PATH, write launchd plist"
  ```

---

## Phase 5 — Integration test + README

### Task 18: `scripts/smoke.sh`

**Files:**
- Create: `scripts/smoke.sh`

- [ ] **Step 1: Write the smoke test**

  ```bash
  #!/usr/bin/env bash
  # End-to-end smoke test. Runs after install.sh.
  # 1. Verifies our scripts are runnable.
  # 2. Verifies the plugin is discoverable by gBrain.
  # 3. (Optional) Runs a tiny ingest against a stable RSS feed and checks that an item page lands.

  set -euo pipefail

  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  echo "==> smoke: REPO_ROOT=$REPO_ROOT"

  echo "==> smoke: scripts are runnable"
  bun --bun tsc --noEmit
  bun test

  echo "==> smoke: plugin discoverable by gBrain"
  if command -v gbrain >/dev/null 2>&1; then
    # Expects gbrain doctor or gbrain plugins:list to mention 'personal-rss'.
    if gbrain doctor 2>&1 | grep -q "personal-rss"; then
      echo "  gbrain doctor sees personal-rss"
    else
      echo "  warning: gbrain doctor did not mention personal-rss (check GBRAIN_PLUGIN_PATH)" >&2
    fi
  else
    echo "  skipping: gbrain CLI not on PATH"
  fi

  echo "==> smoke: ok"
  ```

- [ ] **Step 2: Make executable**

  ```bash
  chmod +x scripts/smoke.sh
  ```

- [ ] **Step 3: Run it locally to catch obvious breakage**

  Run: `bash scripts/smoke.sh`
  Expected: tests pass; `gbrain doctor` line is informational only.

- [ ] **Step 4: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/smoke.sh
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add scripts/smoke.sh: end-to-end install verification"
  ```

---

### Task 19: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append an Install + Usage section to the existing README**

  Use Edit to insert a new section *before* the "Roadmap" section (the README currently has Status / Problem / What it does / Why now / Built on gBrain / How it compares / Roadmap / Hackathon context / License / Acknowledgements).

  New section text:

  ```markdown
  ## Install

  Requires a working [gBrain](https://github.com/garrytan/gbrain) checkout (v0.35.1.0+) and Bun ≥ 1.3.10.

  ```bash
  git clone https://github.com/alextnetto/gbrain-personal-rss
  cd gbrain-personal-rss
  ./install.sh /path/to/your/gbrain
  ```

  The installer symlinks the skill into your gBrain checkout, registers the plugin via `GBRAIN_PLUGIN_PATH`, installs dependencies, generates a daily launchd plist (macOS), and runs a smoke test.

  ## Usage

  In Claude Desktop (with gBrain's MCP server connected):

  - **Add a feed:** *"Add this YouTube channel to my feed: https://www.youtube.com/@AnthropicAI"*
  - **See today's brief:** *"What should I read today?"*
  - **Update interests:** *"I'm also into WebAssembly toolchains now, update my interests."*
  - **List subscriptions:** *"What am I subscribed to?"*

  Via the web view:

  ```bash
  bun run web
  # then visit http://127.0.0.1:7777
  ```

  Briefs are generated nightly at 6 AM local time (launchd plist) or on-demand by asking Claude to run one.
  ```

- [ ] **Step 2: Commit**

  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add README.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Document install + usage in README"
  ```

---

### Task 20: Final push

- [ ] **Step 1: Verify clean state**

  Run: `git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss status`
  Expected: working tree clean.

- [ ] **Step 2: Push**

  Run: `git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss push`
  Expected: push succeeds to `origin/main`.

- [ ] **Step 3: Verify on GitHub**

  Run: `gh repo view alextnetto/gbrain-personal-rss --json url,defaultBranchRef,updatedAt`
  Expected: repo URL printed, `updatedAt` is current.

---

## Out of scope for this plan

The following are explicitly NOT in this plan (matches spec §5):

- Newsletter (email) ingestion
- X / Twitter ingestion
- Explicit thumbs-up / thumbs-down feedback
- Email digest delivery
- Generated AI-voice podcast version of the brief
- Multi-user / multi-brain
- Custom MCP tools (would require fork)
- Modifications to gBrain's dream cycle
- User-facing recipes (`recipes/*.md`) — can be added post-demo if time permits

---

## Dependency graph (for parallel execution)

```
Task 1 ─┐
Task 2 ─┼─→ Task 3 ─┬─→ Task 4 ─┐
                    ├─→ Task 5 ─┤
                    └─→ Task 6 ─┤
                                ├─→ Task 11 ─┐
Task 1 ─→ Task 7 ──→ Task 8 ────┤             │
                  ├─→ Task 9 ───┤             │
                  ├─→ Task 10 ──┘             │
                                              ├─→ Task 13 ─┐
                                Task 12 ──────┘             │
                                                            ├─→ Task 18 → Task 19 → Task 20
Task 1 ─→ Task 14 ──────────────────────────────────────────┤
                                Task 15 ─────────────────── ┤
                                Task 16 ─────────────────── ┤
                                Task 17 ─────────────────── ┘
```

Reading the graph: anything in the same "column" can run in parallel. The hot path is **Phase 0 → Phase 1 (parallel) → Phase 2 (parallel after 7) → 11 → 12 → 13 → 18 → 19 → 20**.
