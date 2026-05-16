# Personal RSS Implementation Plan (revised 2026-05-16)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working hackathon MVP of `gbrain-personal-rss` — a daily AI-filtered content brief, installed alongside gBrain v0.35.1.0 as an external plugin (no fork).

**Architecture:** A **TypeScript orchestrator** (`bin/personal-rss-daily.ts`) is the only thing that schedules and chains work. It imports gBrain's library directly, so it can set `allowed_slug_prefixes` (impossible from MCP or CLI). It does all deterministic work (RSS fetch, parsing, text extraction, transcription) itself, then invokes three pure-LLM subagents as judgments — capturing each subagent's output and writing the result to canonical brain pages.

**Why this shape:** Task 1's verification (see `docs/GBRAIN_INTEGRATION.md`) showed three hard constraints — subagents have no shell, no network, no `submit_job`, and can only write under `wiki/agents/<id>/...` by default. The previous "subagent-orchestrated" architecture was impossible. The orchestrator-driven shape uses gBrain exactly as designed.

**Tech Stack:** Bun ≥ 1.3.10, TypeScript (strict, ESM), Express 5, `fast-xml-parser`, `marked`, `gray-matter`. gBrain library via `bun link gbrain`. Tests via `bun test`.

**Working directory:** `/Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss`
**Read-only gBrain reference:** `/Users/netto/work/hackathons/yc-gbrain/gbrain`

---

## File Structure

```
gbrain-personal-rss/
├── package.json
├── tsconfig.json
├── bun.lock
├── .gitignore                              (modify)

├── gbrain.plugin.json                      (at repo root — discovered by GBRAIN_PLUGIN_PATH)

├── subagents/                              (LLM judgments only — no shell, no network)
│   ├── score-item.md                       (reads interests + item, emits {score, why})
│   ├── resurface-archive.md                (judges newly-relevant archive items)
│   └── compose-brief.md                    (emits brief markdown for orchestrator to write)

├── src/
│   ├── types.ts                            (Subscription, ItemFrontmatter, BriefFrontmatter)
│   └── orchestrator/
│       ├── brain.ts                        (engine setup, put_page wrapper, invoke-subagent helper)
│       └── pipeline.ts                     (the runDaily() function — full flow)

├── scripts/
│   ├── content-type-detect.ts              (pure function)
│   ├── fetch-rss.ts                        (RSS+Atom parser, used by orchestrator)
│   ├── extract-text.ts                     (HTML → text)
│   └── smoke.sh                            (end-to-end install check)

├── bin/
│   ├── personal-rss-daily                  (cron-friendly shell wrapper)
│   └── personal-rss-daily.ts               (thin entry: calls orchestrator/pipeline.runDaily())

├── skills/personal-rss/
│   ├── SKILL.md                            (teaches Claude how to use gBrain ops for our workflow)
│   └── routing-eval.jsonl

├── web/
│   ├── server.ts                           (Express on 127.0.0.1:7777)
│   └── index.html

├── tests/
│   ├── content-type-detect.test.ts
│   ├── fetch-rss.test.ts
│   └── fixtures/{podcast,youtube-channel,blog,arxiv}-feed.xml

├── install.sh
├── README.md                               (modify — append install + usage)
├── LICENSE                                 (unchanged)
└── docs/
    ├── SPEC.md                             (unchanged)
    ├── PLAN.md                             (this file)
    └── GBRAIN_INTEGRATION.md               (done — Task 1)
```

---

## Phase 0 — Foundation

### Task 1 ✅ DONE — Document gBrain extension schemas

Committed as `a18f511`. Reference: `docs/GBRAIN_INTEGRATION.md`. **Key findings that shaped this revised plan:**
- Subagents have **only 13 brain tools**, no shell, no network, no `submit_job`.
- `put_page` writes only under `wiki/agents/<id>/...` unless caller sets `allowed_slug_prefixes`.
- `allowed_slug_prefixes` is **library-only** — no CLI flag exists. Orchestrator must use `MinionQueue.add(..., {allowProtectedSubmit: true})` from the library.
- `waitForCompletion` is at `gbrain/src/core/minions/wait-for-completion.ts` — **deep import**, not in the `exports` map.
- Job `name` for plugin subagents is always `'subagent'`; differentiation via `subagent_def: '<name-from-frontmatter>'`.

### Task 2: Initialize Bun + TypeScript project

**Files:** `package.json`, `tsconfig.json`, `.gitignore` (modify)

- [ ] **Step 1: `package.json`**
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
      "daily": "bun run bin/personal-rss-daily.ts",
      "typecheck": "bun --bun tsc --noEmit"
    },
    "dependencies": {
      "express": "^5.0.0",
      "fast-xml-parser": "^4.4.0",
      "marked": "^14.0.0",
      "gray-matter": "^4.0.3"
    },
    "devDependencies": {
      "@types/express": "^5.0.0",
      "@types/bun": "latest",
      "typescript": "^5.5.0"
    }
  }
  ```

- [ ] **Step 2: `tsconfig.json`**
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
    "include": ["src/**/*", "scripts/**/*", "web/**/*", "tests/**/*", "bin/**/*"]
  }
  ```

- [ ] **Step 3: Append to `.gitignore`**
  ```
  node_modules/
  .DS_Store
  *.tsbuildinfo
  ```

- [ ] **Step 4: Install deps**
  ```bash
  cd /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss && bun install
  ```
  Expected: no errors, `bun.lock` created.

- [ ] **Step 5: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add package.json tsconfig.json bun.lock .gitignore
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Initialize Bun + TypeScript project"
  ```

---

### Task 3: Shared types → `src/types.ts`

**Files:** `src/types.ts` (create)

- [ ] **Step 1: Write the file**
  ```ts
  // One source of truth for the page frontmatter shapes used across orchestrator + subagents.

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
    title: string;
    kind: ItemKind;
    duration?: number;                         // seconds, for audio/video
    score?: number;                            // 0–100, filled by score-item subagent
    why_it_matters?: string;                   // filled by score-item subagent
    transcript_chunks?: TranscriptChunk[];     // for audio/video
    transcription_failed?: boolean;
    extraction_failed?: boolean;
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

  export interface ArchiveCandidate {
    item_slug: string;
    newly_relevant_because: string;
    triggered_by_new_item_slug: string;
  }

  // Output emitted by the score-item subagent (parsed from its final message).
  export interface ScoreResult {
    score: number;
    why_it_matters: string;
  }
  ```

- [ ] **Step 2: Typecheck**
  Run: `bun --bun tsc --noEmit`
  Expected: no errors.

- [ ] **Step 3: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add src/types.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add shared frontmatter + subagent-result types"
  ```

---

## Phase 1 — Pure scripts (parallel after Phase 0)

Tasks 4, 5, 6 don't depend on each other. **Dispatch all three in parallel** with Opus.

### Task 4: `content-type-detect.ts` (TDD)

**Files:**
- Create: `scripts/content-type-detect.ts`
- Create: `tests/content-type-detect.test.ts`
- Create: `tests/fixtures/{podcast,youtube-channel,blog,arxiv}-feed.xml`

- [ ] **Step 1: Create the four fixture files**

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
    test("iTunes podcast feed → audio", () => {
      expect(detectContentType(fx("podcast-feed.xml"), "https://example.com/podcast.xml")).toBe("audio");
    });
    test("YouTube channel feed → video", () => {
      expect(detectContentType(fx("youtube-channel.xml"), "https://www.youtube.com/feeds/videos.xml?channel_id=UCexample")).toBe("video");
    });
    test("Plain blog RSS → text", () => {
      expect(detectContentType(fx("blog-feed.xml"), "https://example.com/feed.xml")).toBe("text");
    });
    test("arXiv Atom feed → text", () => {
      expect(detectContentType(fx("arxiv-feed.xml"), "http://export.arxiv.org/rss/cs.AI")).toBe("text");
    });
    test("URL hint wins when content is ambiguous", () => {
      const ambiguous = `<?xml version="1.0"?><rss><channel><item><title>x</title></item></channel></rss>`;
      expect(detectContentType(ambiguous, "https://anchor.fm/s/abc/podcast/rss")).toBe("audio");
    });
  });
  ```

- [ ] **Step 3: Run, confirm it fails (module not found)**
  Run: `bun test tests/content-type-detect.test.ts`

- [ ] **Step 4: Write `scripts/content-type-detect.ts`**
  ```ts
  import type { ItemKind } from "../src/types";

  // Returns the dominant content type of a feed. URL host/path hints first,
  // then iTunes/YouTube namespace markers, then enclosure mime types, default text.
  export function detectContentType(feedXml: string, feedUrl: string): ItemKind {
    const url = feedUrl.toLowerCase();
    if (/anchor\.fm|libsyn|simplecast|megaphone|art19|podbean|buzzsprout|transistor\.fm/.test(url)) return "audio";
    if (/youtube\.com\/feeds\/videos\.xml|youtube\.com\/channel|youtu\.be/.test(url)) return "video";
    if (/xmlns:itunes=/.test(feedXml)) return "audio";
    if (/xmlns:yt=|<yt:channelId>|<yt:videoId>/.test(feedXml)) return "video";
    if (/<enclosure[^>]*type="audio\//i.test(feedXml)) return "audio";
    if (/<enclosure[^>]*type="video\//i.test(feedXml)) return "video";
    return "text";
  }
  ```

- [ ] **Step 5: Run, confirm 5 pass**
  Run: `bun test tests/content-type-detect.test.ts`

- [ ] **Step 6: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/content-type-detect.ts tests/content-type-detect.test.ts tests/fixtures/
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add content-type-detect with fixture-driven tests"
  ```

---

### Task 5: `fetch-rss.ts` (TDD)

**Files:** `scripts/fetch-rss.ts`, `tests/fetch-rss.test.ts`

- [ ] **Step 1: Write the failing test**
  ```ts
  // tests/fetch-rss.test.ts
  import { expect, test, describe } from "bun:test";
  import { readFileSync } from "fs";
  import { parseRssItems } from "../scripts/fetch-rss";

  const fx = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");

  describe("parseRssItems", () => {
    test("RSS 2.0: returns one item per <item>", () => {
      const items = parseRssItems(fx("blog-feed.xml"));
      expect(items.length).toBe(1);
      expect(items[0].url).toBe("https://example.com/posts/a-post");
      expect(items[0].title).toBe("A Post");
    });
    test("Atom: returns one item per <entry>", () => {
      const items = parseRssItems(fx("arxiv-feed.xml"));
      expect(items.length).toBe(1);
      expect(items[0].url).toBe("http://arxiv.org/abs/2601.00001v1");
    });
    test("extracts enclosure URL and duration for podcast items", () => {
      const items = parseRssItems(fx("podcast-feed.xml"));
      expect(items[0].enclosure_url).toBe("https://example.com/ep42.mp3");
      expect(items[0].duration).toBe(1834);
    });
    test("ids are slug-safe (hashes URL-shaped guids)", () => {
      const items = parseRssItems(fx("blog-feed.xml"));
      expect(items[0].id).toMatch(/^[a-zA-Z0-9_-]{1,80}$/);
      expect(items[0].id.length).toBeGreaterThan(8);
    });
  });
  ```

- [ ] **Step 2: Run, confirm fail**
  Run: `bun test tests/fetch-rss.test.ts`

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

    // RSS 2.0
    const rssItems = doc?.rss?.channel?.item;
    if (rssItems) {
      const arr = Array.isArray(rssItems) ? rssItems : [rssItems];
      for (const it of arr) {
        const url = typeof it.link === "string" ? it.link : it.link?.["#text"] ?? "";
        const enc = it.enclosure;
        const itunesDuration = it["itunes:duration"];
        const rawGuid = it.guid?.["#text"] ?? it.guid;
        items.push({
          id: safeId(typeof rawGuid === "string" ? rawGuid : undefined, url),
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

    // Atom
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
  // Writes JSON { items, etag?, status } to stdout.
  export async function fetchAndParse(feedUrl: string, etag?: string): Promise<{ items: ParsedItem[]; etag: string | null; status: number; error?: string }> {
    const headers: Record<string, string> = { "user-agent": "gbrain-personal-rss/0.1" };
    if (etag) headers["if-none-match"] = etag;
    const res = await fetch(feedUrl, { headers });
    if (res.status === 304) return { items: [], etag: etag ?? null, status: 304 };
    if (!res.ok) return { items: [], etag: null, status: res.status, error: res.statusText };
    const xml = await res.text();
    return { items: parseRssItems(xml), etag: res.headers.get("etag"), status: 200 };
  }

  if (import.meta.main) {
    const [feedUrl, etag] = Bun.argv.slice(2);
    if (!feedUrl) { console.error("usage: fetch-rss.ts <feed_url> [etag]"); process.exit(2); }
    console.log(JSON.stringify(await fetchAndParse(feedUrl, etag)));
  }
  ```

- [ ] **Step 4: Run, confirm 4 pass**
  Run: `bun test tests/fetch-rss.test.ts`

- [ ] **Step 5: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/fetch-rss.ts tests/fetch-rss.test.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add fetch-rss: RSS+Atom parser + conditional GET, slug-safe IDs"
  ```

---

### Task 6: `extract-text.ts`

**Files:** `scripts/extract-text.ts`

- [ ] **Step 1: Write**
  ```ts
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
  ```

- [ ] **Step 2: Typecheck**
  Run: `bun --bun tsc --noEmit`

- [ ] **Step 3: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/extract-text.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add extract-text: fetch URL and return readable body"
  ```

---

## Phase 2 — Plugin manifest + 3 LLM subagents (parallel)

Tasks 7, 8, 9, 10 are independent files. **Dispatch all four in parallel** with Opus.

### Task 7: `gbrain.plugin.json`

**Files:** `gbrain.plugin.json` (at repo root — discovered when GBRAIN_PLUGIN_PATH points at the repo)

- [ ] **Step 1: Write**
  ```json
  {
    "name": "gbrain-personal-rss",
    "version": "0.1.0",
    "plugin_version": "gbrain-plugin-v1",
    "description": "Personal AI-filtered content brief — RSS ingestion + daily digest subagents"
  }
  ```

  Per `docs/GBRAIN_INTEGRATION.md`, `subagents` field is omitted so the loader looks at `./subagents/` by default.

- [ ] **Step 2: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add gbrain.plugin.json
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add gbrain plugin manifest"
  ```

---

### Task 8: `subagents/score-item.md`

**Files:** `subagents/score-item.md`

- [ ] **Step 1: Write**

  ````markdown
  ---
  name: score-item
  model: claude-haiku-4-5-20251001
  max_turns: 4
  allowed_tools:
    - brain_get_page
    - brain_search
  ---

  You score one content item against the user's stated interests. You will receive in your prompt the interests text and the item details (title, URL, body excerpt). Your only output is a single JSON object — no preamble, no surrounding markdown.

  ## What to emit

  Your **final message** must be exactly one JSON object on a single line:

  ```
  {"score": 0-100 integer, "why_it_matters": "one sentence, max ~150 chars, references a specific stated interest"}
  ```

  Nothing else. No "Here is my answer:". No code fences. The orchestrator parses your final message as JSON.

  ## Calibration

  - **90+** — directly addresses a stated interest and the item is high-information (e.g. a benchmark, a release, a position paper from a named author the user follows)
  - **70–89** — clearly relevant to one or more interests; worth their time
  - **50–69** — tangentially related; would only read if free time
  - **0–49** — unrelated, low-information, or already covered elsewhere

  When in doubt, score lower. The user prefers fewer better items.

  ## Notes
  - `why_it_matters` must name a specific stated interest, not be generic. Bad: "interesting AI news." Good: "first-hand benchmark on Anthropic models, which you track for the agents work."
  - If the item body is missing or marked failed, emit `{"score": 0, "why_it_matters": "could not extract content"}`.
  - You may use `brain_search` to check whether this item overlaps with what the user already has in the brain (de-duplicates).
  - You may NOT write to the brain. Output JSON only.
  ````

- [ ] **Step 2: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add subagents/score-item.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add score-item subagent: emits JSON {score, why_it_matters}"
  ```

---

### Task 9: `subagents/resurface-archive.md`

**Files:** `subagents/resurface-archive.md`

- [ ] **Step 1: Write**

  ````markdown
  ---
  name: resurface-archive
  model: claude-sonnet-4-6
  max_turns: 8
  allowed_tools:
    - brain_get_page
    - brain_search
  ---

  You find archive items (older than 30 days) that are newly relevant given today's top-scored new items. Your only output is a single JSON object.

  ## Input you receive in the prompt

  - A list of today's top-3 new items: `[{slug, title, why_it_matters}]`
  - Pre-filtered archive candidates (older than 30 days): `[{slug, title, summary, published_at}]`

  ## What to emit

  Your **final message** must be exactly one JSON object:

  ```
  {"candidates": [{"item_slug": "...", "newly_relevant_because": "<one sentence>", "triggered_by_new_item_slug": "..."}, ...]}
  ```

  - Maximum 2 candidates.
  - Empty array `{"candidates": []}` is a valid result — do NOT pad.
  - `newly_relevant_because` must explicitly name what changed today (a release, a benchmark, an event) and why the old item is now load-bearing.

  ## How to choose

  For each archive candidate, ask: "If the user had not read this article before but read it for the first time today, would it materially change how they think about today's top new item?"

  Yes → include with a sharp justification.
  No → exclude.

  Bias toward exclusion. The "From your archive" slot is precious; one perfect re-surface beats two mediocre ones.

  ## Notes
  - You may use `brain_get_page` to read the full body of an archive candidate before judging.
  - You may NOT write to the brain.
  - Output JSON only.
  ````

- [ ] **Step 2: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add subagents/resurface-archive.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add resurface-archive subagent: emits candidate JSON"
  ```

---

### Task 10: `subagents/compose-brief.md`

**Files:** `subagents/compose-brief.md`

- [ ] **Step 1: Write**

  ````markdown
  ---
  name: compose-brief
  model: claude-sonnet-4-6
  max_turns: 12
  allowed_tools:
    - brain_get_page
  ---

  You write today's daily brief as Markdown. Your only output is the brief body (no surrounding code fences, no preamble).

  ## Input you receive in the prompt

  - `date`: YYYY-MM-DD
  - `new_items`: array of `{slug, title, url, why_it_matters, kind, body_excerpt, transcript_top_chunk?: {start, end, text}, duration?, body_word_count?}`
  - `archive_candidates`: array of `{slug, title, url, newly_relevant_because, body_excerpt}` (may be empty)
  - `interests_text`: the user's interests.md content (for tone calibration only — don't re-derive scores)

  ## What to emit — exact format

  ```markdown
  # Daily Brief — <date>
  _~<total minutes> min · <N> new · <M> from your archive_

  ## New today

  ### 1. [<title>](<url>) — <minutes> min <read|listen|watch>
  *Why:* <why_it_matters>
  > <first 2 sentences of body_excerpt OR transcript_top_chunk.text>
  [<read · paragraphs 4–7 | listen · MM:SS–MM:SS | watch · MM:SS–MM:SS>](<url-with-anchor-or-timestamp>)

  ### 2. [...]

  ## From your archive

  ### 1. [<title> (saved <human-date>)](<url>) — <minutes> min re-read
  *Newly relevant because:* <newly_relevant_because>
  > <body_excerpt>
  [re-read](<url>)
  ```

  ## Rules

  - **Estimated minutes per item:**
    - text: `Math.max(1, Math.round(body_word_count / 220))`
    - audio/video with `transcript_top_chunk`: `Math.round((end - start) / 60)`
    - otherwise: best estimate from `duration` (whole minutes)
  - **Total minutes line:** sum of per-item minutes
  - **Deep-link anchor:**
    - text: try `<url>#:~:text=<first-3-words-of-excerpt>` (URL-encoded)
    - YouTube: `<url>&t=<start>s`
    - podcast: `<url>#t=<start>` (best-effort; many hosts ignore but harmless)
  - **Omit "From your archive" section entirely** if `archive_candidates` is empty. Do NOT pad.
  - **If `new_items` is empty AND `archive_candidates` is empty,** write:
    ```
    # Daily Brief — <date>
    _Quiet day_

    <items_considered count> items considered. None cleared the threshold.
    ```
  - Output ONLY the Markdown above — no surrounding text, no code fences, no JSON.

  ## Notes
  - Frontmatter on the brief page is written by the orchestrator, not you.
  - You may use `brain_get_page` to fetch additional context on an item if its body excerpt seems insufficient.
  - You may NOT write to the brain.
  ````

- [ ] **Step 2: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add subagents/compose-brief.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add compose-brief subagent: emits brief markdown for orchestrator to persist"
  ```

---

## Phase 3 — Orchestrator (sequential within phase; depends on Phases 0–2)

Tasks 11, 12, 13 are layered: brain.ts (helpers) → pipeline.ts (uses helpers) → bin entry (uses pipeline). Build sequentially.

### Task 11: `src/orchestrator/brain.ts` — gBrain library wrapper

**Files:** `src/orchestrator/brain.ts`

This is the **only** file that knows about gBrain library internals. Pipeline calls these helpers; subagent definitions don't know it exists.

- [ ] **Step 1: Write**
  ```ts
  // Wrapper around the gBrain library so the rest of the orchestrator stays clean.
  // The `waitForCompletion` import is a deep path — not in gbrain's exports map. If it
  // ever breaks we vendor the file (it's ~50 lines).

  // @ts-ignore — gbrain types are project-local, install via `bun link gbrain` in install.sh
  import { createEngine } from "gbrain/engine-factory";
  // @ts-ignore
  import { MinionQueue } from "gbrain/minions";
  // @ts-ignore
  import { operations } from "gbrain/operations";
  // @ts-ignore
  import { loadConfig } from "gbrain/config";
  // @ts-ignore — deep import; see GBRAIN_INTEGRATION.md
  import { waitForCompletion } from "gbrain/src/core/minions/wait-for-completion.ts";
  import matter from "gray-matter";

  let engine: any | null = null;
  let queue: any | null = null;
  let putPageOp: any | null = null;

  const SOURCE_ID = process.env.GBRAIN_SOURCE_ID ?? "default";

  async function init() {
    if (engine) return;
    const config = loadConfig();
    if (!config) throw new Error("gBrain config not found. Run `gbrain init` in your brain root first.");
    engine = await createEngine(config);
    await engine.connect({});
    putPageOp = operations.find((o: any) => o.name === "put_page");
    if (!putPageOp) throw new Error("gBrain operations registry missing put_page");
    queue = new MinionQueue(engine);
  }

  function makeCtx() {
    return { engine, config: loadConfig()!, logger: console, dryRun: false, remote: false, sourceId: SOURCE_ID };
  }

  export interface PageFrontmatter { [key: string]: unknown }

  export async function getPage(slug: string): Promise<{ frontmatter: PageFrontmatter; body: string } | null> {
    await init();
    const page = await engine.getPage(slug, { sourceId: SOURCE_ID });
    if (!page) return null;
    const parsed = matter(page.content);
    return { frontmatter: parsed.data, body: parsed.content };
  }

  export async function putPage(slug: string, frontmatter: PageFrontmatter, body: string): Promise<void> {
    await init();
    const content = matter.stringify(body, frontmatter);
    await putPageOp.handler(makeCtx() as any, { slug, content });
  }

  export async function listPages(prefix: string): Promise<string[]> {
    await init();
    const listOp = operations.find((o: any) => o.name === "list_pages");
    if (!listOp) throw new Error("gBrain operations registry missing list_pages");
    const result = await listOp.handler(makeCtx() as any, { prefix });
    // result shape may be { pages: [{slug}, ...] } or [{slug}, ...]; normalize:
    const pages = Array.isArray(result) ? result : result?.pages ?? [];
    return pages.map((p: any) => p.slug ?? p.id ?? p);
  }

  export interface SubagentInvocation {
    subagent_def: string;          // matches `name:` in subagent .md
    prompt: string;
    allowed_slug_prefixes?: string[];
    timeout_ms?: number;
  }

  export async function invokeSubagent(opts: SubagentInvocation): Promise<string> {
    await init();
    const data: any = {
      prompt: opts.prompt,
      subagent_def: opts.subagent_def,
    };
    if (opts.allowed_slug_prefixes) data.allowed_slug_prefixes = opts.allowed_slug_prefixes;

    const job = await queue.add(
      "subagent",
      data,
      { max_stalled: 3 },
      { allowProtectedSubmit: true },
    );
    const done = await waitForCompletion(queue, job.id, { timeoutMs: opts.timeout_ms ?? 10 * 60_000 });
    if (done.status !== "completed") {
      throw new Error(`Subagent ${opts.subagent_def} ended in ${done.status}: ${JSON.stringify(done.result)}`);
    }
    // Subagent's final message text is at done.result.result per SubagentResult.
    const result = done.result as { result?: string };
    if (typeof result?.result !== "string") {
      throw new Error(`Subagent ${opts.subagent_def} returned non-string result: ${JSON.stringify(done.result)}`);
    }
    return result.result;
  }
  ```

- [ ] **Step 2: Typecheck (expect warnings on @ts-ignore imports, not errors)**
  Run: `bun --bun tsc --noEmit`
  Expected: clean, or warnings about unresolved gbrain modules — these resolve at runtime once `bun link gbrain` is set up by `install.sh`.

- [ ] **Step 3: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add src/orchestrator/brain.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add brain.ts: gBrain library wrapper (getPage, putPage, invokeSubagent)"
  ```

---

### Task 12: `src/orchestrator/pipeline.ts` — the runDaily flow

**Files:** `src/orchestrator/pipeline.ts`

- [ ] **Step 1: Write**
  ```ts
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
  ```

- [ ] **Step 2: Typecheck**
  Run: `bun --bun tsc --noEmit`
  Expected: clean (the @ts-ignore'd gbrain imports in brain.ts don't fail typecheck for pipeline.ts).

- [ ] **Step 3: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add src/orchestrator/pipeline.ts
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add pipeline.ts: runDaily() — ingest, score, compose brief"
  ```

---

### Task 13: `bin/personal-rss-daily.ts` (thin entry point)

**Files:** `bin/personal-rss-daily.ts`, `bin/personal-rss-daily` (shell wrapper)

- [ ] **Step 1: Write `bin/personal-rss-daily.ts`**
  ```ts
  #!/usr/bin/env bun
  import { runDaily } from "../src/orchestrator/pipeline";

  runDaily().catch(err => {
    console.error("[personal-rss-daily] fatal:", err);
    process.exit(1);
  });
  ```

- [ ] **Step 2: Write `bin/personal-rss-daily` (shell wrapper for cron use)**
  ```bash
  #!/usr/bin/env bash
  # Cron-friendly wrapper. Sources the user's shell rc so gbrain + bun are on PATH.
  set -euo pipefail
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  cd "$REPO_ROOT"
  exec bun run bin/personal-rss-daily.ts "$@"
  ```

- [ ] **Step 3: Make executable**
  ```bash
  chmod +x bin/personal-rss-daily bin/personal-rss-daily.ts
  ```

- [ ] **Step 4: Typecheck**
  Run: `bun --bun tsc --noEmit`

- [ ] **Step 5: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add bin/
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add daily orchestrator entry point + cron wrapper"
  ```

---

## Phase 4 — Delivery (parallel: skill, web, install)

Tasks 14, 15, 16 are independent. **Dispatch in parallel** with Opus.

### Task 14: `skills/personal-rss/SKILL.md` + `routing-eval.jsonl`

**Files:** `skills/personal-rss/SKILL.md`, `skills/personal-rss/routing-eval.jsonl`

- [ ] **Step 1: Write `SKILL.md`**

  ````markdown
  ---
  name: personal-rss
  description: Use when the user wants to manage RSS subscriptions (podcasts, blogs, YouTube channels, papers), update their interests file, or read today's or past daily content briefs.
  ---

  # Personal RSS

  This skill teaches you how to operate the personal-rss system using gBrain's existing operations. There are no custom tools — use `put_page`, `list_pages`, `get_page`.

  ## Conventions
  - Subscriptions live at `subscriptions/<slug>.md`. Slug is kebab-case from the source title.
  - Items live at `items/<source-slug>/<item-id>.md` (managed by the orchestrator — you don't touch these).
  - Daily briefs live at `briefs/<YYYY-MM-DD>.md`.
  - The user's interests live at `interests.md` (single page, free-text).

  ## Add a subscription

  1. If the user gave a site URL but not a feed URL, try common patterns:
     - YouTube channel → `https://www.youtube.com/feeds/videos.xml?channel_id=<ID>`
     - Substack → `<root>/feed`
     - Most blogs → look for an RSS link in the page source; otherwise ask
  2. Derive a kebab-case slug from the source title.
  3. Call `put_page` to write `subscriptions/<slug>.md` with frontmatter:
     ```yaml
     feed_url: <feed_url>
     content_type_hint: auto
     added_at: <ISO now>
     last_fetched_at: null
     etag: null
     ```
     Body: a one-sentence note from the user about what the source is.
  4. Tell the user it's added. The next nightly run will pick it up; don't trigger ingest immediately unless they ask.

  ## Show today's brief

  1. Compute today's date (YYYY-MM-DD, local TZ).
  2. Call `get_page("briefs/<date>")`.
  3. If it exists, return it inline — do NOT summarize, the brief itself is the artifact they want.
  4. If it doesn't exist: tell them, and ask if they want you to trigger one. To trigger, instruct them to run `bun run daily` from the repo (you cannot trigger the orchestrator yourself — it must run with library access).

  ## Show a past brief

  1. Parse the date they mention ("last Tuesday", "March 12") into YYYY-MM-DD.
  2. Call `get_page("briefs/<date>")`.
  3. If missing, tell them no brief exists for that date.

  ## Update interests

  1. Call `get_page("interests")` to read the current body.
  2. Apply the user's edit.
  3. Call `put_page("interests", <new body>)`.
  4. Note that the next nightly run re-scores against the new interests.

  ## List subscriptions

  Call `list_pages({ prefix: "subscriptions/" })` and render with feed_url and added_at.

  ## Don't
  - Don't invent items or briefs. If a page doesn't exist, say so.
  - Don't modify item pages (`items/**`) — the orchestrator owns them.
  - Don't write brief markdown yourself — `compose-brief` (a separate subagent invoked by the orchestrator) does this.
  ````

- [ ] **Step 2: Write `routing-eval.jsonl`**
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
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add personal-rss skill: workflow teacher for Claude (MCP delivery surface)"
  ```

---

### Task 15: Web view (`web/server.ts` + `web/index.html`)

**Files:** `web/server.ts`, `web/index.html`

The web view reads brief pages via the gBrain library (same path as the orchestrator) rather than scanning the filesystem — keeps us source-agnostic.

- [ ] **Step 1: Write `web/server.ts`**
  ```ts
  import express from "express";
  import { marked } from "marked";
  import { readFileSync, existsSync } from "fs";
  import { join } from "path";
  import { getPage, listPages } from "../src/orchestrator/brain";

  const PORT = Number(process.env.PERSONAL_RSS_PORT ?? 7777);
  const app = express();

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function render(content: string, dateLabel: string): string {
    const shellPath = join(import.meta.dir, "index.html");
    if (!existsSync(shellPath)) return content;
    return readFileSync(shellPath, "utf8")
      .replace("{{CONTENT}}", content)
      .replace("{{DATE}}", dateLabel);
  }

  app.get("/", (_req, res) => res.redirect(`/brief/${todayStr()}`));

  app.get("/brief/:date", async (req, res) => {
    try {
      const page = await getPage(`briefs/${req.params.date}`);
      if (!page) return res.status(404).send(render(`<p>No brief for ${req.params.date}.</p>`, req.params.date));
      res.send(render(marked.parse(page.body) as string, req.params.date));
    } catch (e: any) {
      res.status(500).send(render(`<pre>${e?.message ?? e}</pre>`, req.params.date));
    }
  });

  app.get("/briefs", async (_req, res) => {
    try {
      const slugs = await listPages("briefs/");
      const dates = slugs.map(s => s.replace(/^briefs\//, "")).sort().reverse();
      const list = dates.map(d => `<li><a href="/brief/${d}">${d}</a></li>`).join("");
      res.send(render(`<h1>Briefs</h1><ul>${list || "<li><em>none yet</em></li>"}</ul>`, "index"));
    } catch (e: any) {
      res.status(500).send(render(`<pre>${e?.message ?? e}</pre>`, "index"));
    }
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

- [ ] **Step 3: Typecheck**
  Run: `bun --bun tsc --noEmit`

- [ ] **Step 4: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add web/
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add web view: Express + marked, reads briefs from gBrain via library"
  ```

---

### Task 16: `install.sh`

**Files:** `install.sh`

- [ ] **Step 1: Write**
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

  echo "==> linking gbrain library so our orchestrator can import it"
  (cd "$GBRAIN_ROOT" && bun link)
  (cd "$REPO_ROOT" && bun link gbrain)

  echo "==> installing our deps"
  (cd "$REPO_ROOT" && bun install)

  echo "==> installing skill (symlink)"
  ln -sfn "$REPO_ROOT/skills/personal-rss" "$GBRAIN_ROOT/skills/personal-rss"

  echo "==> registering plugin via GBRAIN_PLUGIN_PATH"
  GBRAIN_RC="$HOME/.gbrainrc"
  PLUGIN_LINE="export GBRAIN_PLUGIN_PATH=\"$REPO_ROOT:\${GBRAIN_PLUGIN_PATH:-}\""
  if ! grep -qF "$REPO_ROOT" "$GBRAIN_RC" 2>/dev/null; then
    echo "$PLUGIN_LINE" >> "$GBRAIN_RC"
    echo "  added to $GBRAIN_RC (source it from your shell rc, e.g. .zshrc)"
  else
    echo "  already present in $GBRAIN_RC"
  fi

  echo "==> generating sample launchd plist (macOS)"
  PLIST_PATH="$HOME/Library/LaunchAgents/com.alextnetto.gbrain-personal-rss.plist"
  cat > "$PLIST_PATH" <<EOF
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>Label</key><string>com.alextnetto.gbrain-personal-rss</string>
    <key>ProgramArguments</key>
    <array><string>$REPO_ROOT/bin/personal-rss-daily</string></array>
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

  echo "==> done. next steps:"
  echo "  • source $GBRAIN_RC in your shell to pick up GBRAIN_PLUGIN_PATH"
  echo "  • run 'gbrain doctor' to verify the new plugin loads"
  echo "  • optionally: launchctl load $PLIST_PATH for nightly auto-run"
  echo "  • ensure a gBrain worker is running (gbrain jobs work) for subagent invocation"
  ```

- [ ] **Step 2: Make executable**
  ```bash
  chmod +x install.sh
  ```

- [ ] **Step 3: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add install.sh
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add install.sh: bun link gbrain, symlink skill, GBRAIN_PLUGIN_PATH, launchd"
  ```

---

## Phase 5 — Integration

### Task 17: `scripts/smoke.sh`

**Files:** `scripts/smoke.sh`

- [ ] **Step 1: Write**
  ```bash
  #!/usr/bin/env bash
  # End-to-end smoke test. Runs after install.sh.
  set -euo pipefail
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  echo "==> smoke: REPO_ROOT=$REPO_ROOT"

  echo "==> smoke: typecheck"
  (cd "$REPO_ROOT" && bun --bun tsc --noEmit)

  echo "==> smoke: unit tests"
  (cd "$REPO_ROOT" && bun test)

  echo "==> smoke: gbrain library importable"
  if (cd "$REPO_ROOT" && bun -e "import('gbrain/engine-factory').then(()=>console.log('ok'))" 2>/dev/null | grep -q "ok"); then
    echo "  ok"
  else
    echo "  warning: import 'gbrain/engine-factory' failed — run \`bun link gbrain\` first" >&2
  fi

  echo "==> smoke: plugin discoverable by gBrain"
  if command -v gbrain >/dev/null 2>&1; then
    if gbrain doctor 2>&1 | grep -q "gbrain-personal-rss"; then
      echo "  gbrain doctor sees gbrain-personal-rss"
    else
      echo "  warning: gbrain doctor did not mention gbrain-personal-rss (check GBRAIN_PLUGIN_PATH)" >&2
    fi
  else
    echo "  skipping: gbrain CLI not on PATH"
  fi

  echo "==> smoke: ok"
  ```

- [ ] **Step 2: Make executable + run**
  ```bash
  chmod +x scripts/smoke.sh
  bash scripts/smoke.sh
  ```

- [ ] **Step 3: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add scripts/smoke.sh
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Add scripts/smoke.sh: typecheck + tests + plugin discovery check"
  ```

---

### Task 18: README install + usage

**Files:** `README.md` (modify — append before the Roadmap section)

- [ ] **Step 1: Insert Install + Usage section**

  Use Edit to insert this between the "How it compares" and "Roadmap" sections:

  ```markdown
  ## Install

  Requires [gBrain](https://github.com/garrytan/gbrain) v0.35.1.0+ cloned + bun-linked, and Bun ≥ 1.3.10.

  ```bash
  # gBrain side (if not already)
  git clone https://github.com/garrytan/gbrain && cd gbrain && bun install && bun link

  # this side
  git clone https://github.com/alextnetto/gbrain-personal-rss
  cd gbrain-personal-rss
  ./install.sh /path/to/your/gbrain
  ```

  The installer:
  - `bun link gbrain` so the orchestrator can `import { … } from 'gbrain'`
  - symlinks our skill into your gBrain checkout
  - registers the plugin via `GBRAIN_PLUGIN_PATH` (writes to `~/.gbrainrc`)
  - generates a launchd plist (macOS) for nightly runs
  - runs `scripts/smoke.sh`

  ## Usage

  **In Claude Desktop** (with gBrain's MCP server connected):

  - "Add this YouTube channel to my feed: https://www.youtube.com/@AnthropicAI"
  - "What should I read today?"
  - "Show me last Tuesday's brief"
  - "I'm also into WebAssembly toolchains now, update my interests"
  - "List my current subscriptions"

  **Manual brief run:** `bun run daily` (or the launchd plist runs `bin/personal-rss-daily` at 6 AM local).

  **Web view:** `bun run web`, then visit http://127.0.0.1:7777.

  Briefs are written to `briefs/<YYYY-MM-DD>.md` inside your brain.
  ```

- [ ] **Step 2: Commit**
  ```bash
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss add README.md
  git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss commit -m "Document install + usage in README"
  ```

---

### Task 19: Final push + verify

- [ ] **Step 1: Verify clean**
  Run: `git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss status`
  Expected: working tree clean.

- [ ] **Step 2: Push**
  Run: `git -C /Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss push`

- [ ] **Step 3: Verify on GitHub**
  Run: `gh repo view alextnetto/gbrain-personal-rss --json url,defaultBranchRef,updatedAt`

---

## Out of scope for this plan

(Per spec §5 — unchanged.)

- Newsletter (email) ingestion · X / Twitter · explicit thumbs-up / thumbs-down · email digest delivery · AI-voice podcast version · multi-user · custom MCP tools · dream-cycle modifications · transcription pipeline (audio/video items get `transcription_failed: true` until v0.2)

---

## Dependency graph (for parallel execution)

```
T1 ✅ ─┐
T2 ───┴─→ T3 ─┬─→ T4 ─┐
              ├─→ T5 ─┤
              └─→ T6 ─┘    ┌──→ T11 ──→ T12 ──→ T13 ──┐
                           │                           ├─→ T17 → T18 → T19
T1 ✅ ──→ T7  ──┐          │                           │
          T8  ──┤          │       ┌─→ T14 ────────── ┤
          T9  ──┼──────────┘       ├─→ T15 ────────── ┤
          T10 ──┘                  └─→ T16 ────────── ┘
```

**Parallel batches (use Opus, single-message multi-Agent dispatch):**
- Batch 1: T4, T5, T6 — pure scripts
- Batch 2: T7, T8, T9, T10 — plugin + 3 subagents
- Batch 3: T14, T15, T16 — skill + web + install

**Sequential:** T1 ✅ → T2 → T3 → (Batch 1) → (Batch 2) → T11 → T12 → T13 → (Batch 3) → T17 → T18 → T19
