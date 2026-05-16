# `gbrain-personal-rss` — Implementation Spec

**Status:** Draft v1 · 2026-05-16 · YC Hackathon
**Repo:** https://github.com/alextnetto/gbrain-personal-rss
**Built on:** [gBrain](https://github.com/garrytan/gbrain) v0.35.1.0

---

## 0 · Context

A YC hackathon (May 2026) project. The product is **your personal RSS for anything that publishes** — articles, podcasts, videos, talks, papers — ingested daily, AI-filtered against your stated interests, and assembled into a short brief with deep-links to the exact segments worth your time. Doubles as a re-discovery tool: surfaces older items from your own archive when they become newly relevant.

The hackathon's demo target user is **Garry Tan** (YC CEO, author of gBrain). The product is implemented as an **external skillpack + Minion subagent plugin** installed alongside a user's gBrain checkout — **no fork** of gBrain.

---

## 1 · Scope and Demo Storyboard

### 1.1 Sources (universal RSS in, content-aware processing)

The headline is *your personal RSS*. Every subscription is an RSS feed URL; the system dispatches by content-type. This covers podcasts (audio enclosures), YouTube channels (video via RSS bridge / yt-dlp), blogs, news, Substack newsletters (which expose RSS), and arXiv. Out of scope for MVP: email-only newsletters (no RSS, needs piping infra) and X (no RSS, hostile API). Both stay on the roadmap and can later reuse gBrain's `email-to-brain` and `x-to-brain` recipes.

### 1.2 Interest model

A single page `interests.md` in the user's brain, free-text. Example:

> *"I care about: AI agents, RAG, dev tools, YC W26 batch news, vector DBs, ENS DAO governance, the post-LLM tooling stack."*

Embedded on creation/edit. No thumbs up/down for MVP — reading-history signals from gBrain's existing page-access tracking are enough.

### 1.3 Personalization mechanism

1. New item is ingested → chunked → embedded (all native gBrain).
2. Item is scored against `interests.md` via `core/search/hybrid.ts` (vector + keyword + RRF).
3. Top 30 are sent through Claude Haiku for a rerank, emitting `{"score": 0–100, "why_it_matters": "<one sentence>"}`.
4. Items at or above the threshold land in today's brief; the rest stay searchable, not deleted.

### 1.4 Delivery surfaces

**Primary — MCP in Claude Desktop.** The user talks to Claude; Claude reads our `SKILL.md`, calls gBrain's existing MCP operations (`get_page`, `submit_job`, `put_page`, etc.), and returns the brief.

**Secondary — tiny web view.** A single-page Express server at `127.0.0.1:7777` renders `briefs/YYYY-MM-DD.md` from the brain. Used for screen-sharing demos and for users who don't live in Claude Desktop.

### 1.5 Demo storyboard (90 seconds)

1. **Setup shot:** Garry's `interests.md` visible on screen, plus his subscription list (~15 sources spanning podcast / YouTube / RSS / arXiv).
2. **Trigger:** In Claude Desktop, "What should I read today?"
3. **Output:** A two-section markdown brief renders inline. ~6 minutes of reading: 4 articles with paragraph anchors, 2 podcast segments with `[listen → 23:14–34:02]` deep-links, 1 YouTube clip with timestamp. Each item carries a one-line "why it's relevant to your interests."
4. **The kicker (the moment that lands):** A `From your archive` item — an article saved Nov 2024 on retrieval-augmented generation, surfaced today because Anthropic shipped something this week that makes the framework newly actionable. No competitor has this.
5. **Beat:** Garry asks "skip the second podcast, give me something shorter." Claude reranks and returns an updated brief.

### 1.6 Explicitly out of MVP scope

Newsletter (email) ingestion · X ingestion · explicit feedback loop · email digest delivery · multi-user / multi-brain · generated AI-voice podcast version of the brief.

### 1.7 Storage

PGLite (zero-config, runs on a laptop). Single-brain, single-user.

---

## 2 · Architecture

### 2.1 Integration model with gBrain

**External repo. No fork.** Installed alongside a user's gBrain checkout via `install.sh`, which (a) symlinks `skills/personal-rss/` into `<gbrain_root>/skills/`, and (b) sets `GBRAIN_PLUGIN_PATH` to point at our `plugin/` directory so the Minions worker discovers our subagents.

State lives in the user's brain as plain gBrain pages. We add no schema, no migrations, no operations to gBrain core.

### 2.2 Repo layout

```
gbrain-personal-rss/
├── skills/personal-rss/
│   ├── SKILL.md                ← teaches Claude how to use gBrain's page/job ops
│   │                             to add subscriptions, run briefs, fetch them back
│   └── routing-eval.jsonl
├── plugin/
│   ├── gbrain.plugin.json      ← manifest discovered via GBRAIN_PLUGIN_PATH
│   └── subagents/              ← markdown subagent definitions
│       ├── rss-ingest.md       (per subscription: fetch feed, enqueue items)
│       ├── item-process.md     (dispatch by content-type)
│       ├── transcribe.md       (audio/video → time-anchored chunks)
│       ├── score-item.md       (hybrid search + Haiku rerank vs interests.md)
│       ├── resurface-archive.md (compute archive→new similarity, flag candidates)
│       └── compose-brief.md    (assemble two-section brief, write to brain)
├── scripts/                    ← deterministic TS the subagents shell out to
│   ├── fetch-rss.ts
│   ├── extract-text.ts
│   ├── content-type-detect.ts
│   └── smoke.sh                ← end-to-end smoke test (run by install.sh)
├── web/
│   ├── server.ts               ← Express on 127.0.0.1:7777, reads briefs via gBrain lib
│   └── index.html              ← marked.js + tiny CSS
├── recipes/                    ← user-facing markdown how-tos
│   ├── add-podcast-source.md
│   ├── add-youtube-channel.md
│   └── add-arxiv-feed.md
├── docs/
│   └── SPEC.md                 ← this document
├── install.sh
├── LICENSE
└── README.md
```

### 2.3 User-facing actions map onto existing gBrain MCP operations

| Conceptual action | gBrain MCP op the skill teaches Claude to call |
|---|---|
| "Add this RSS feed" | `put_page("subscriptions/<slug>.md", {frontmatter})` |
| "List my subscriptions" | `list_pages({prefix: "subscriptions/"})` |
| "Run today's brief now" | `submit_job({handler: "compose-brief"})` |
| "Show today's brief" | `get_page("briefs/<YYYY-MM-DD>.md")` |
| "Show me a specific past brief" | `get_page("briefs/<date>.md")` |
| "Edit my interests" | `put_page("interests.md", body)` |

No custom MCP tools needed. The `SKILL.md` is the *workflow teacher*; the ops are already there.

### 2.4 Data model (plain gBrain pages)

- **`interests.md`** — single page, free-text body, no required frontmatter.
- **`subscriptions/<slug>.md`** — one per source. Frontmatter:
  ```yaml
  feed_url: https://example.com/feed.xml
  content_type_hint: podcast | youtube | blog | arxiv | auto   # default: auto
  added_at: 2026-05-16T10:00:00Z
  last_fetched_at: null
  etag: null
  ```
  Body: human notes on what this source is and why it's subscribed.
- **`items/<source-slug>/<item-id>.md`** — one per ingested item. Frontmatter:
  ```yaml
  source: <source-slug>
  published_at: 2026-05-16T08:30:00Z
  url: https://example.com/post/123
  kind: text | audio | video
  duration: 1834                              # seconds, for audio/video
  score: 82                                   # filled by score-item
  why_it_matters: "First-hand benchmark…"     # filled by score-item
  transcript_chunks: [...]                    # for audio/video
  ```
  Body: the text content, or the full transcript for audio/video.
- **`briefs/YYYY-MM-DD.md`** — one per day. Frontmatter records meta (see §3.3). Body: the rendered two-section brief.

### 2.5 Job DAG

```
for each subscription in subscriptions/:
  rss-ingest (conditional GET via etag/last-modified)
    └─ item-process (per new item)
         ├─ text   → extract → chunk → embed
         ├─ audio  → transcribe → time-chunk → embed
         └─ video  → yt-dlp → transcribe → time-chunk → embed
              └─ score-item (hybrid search + Haiku rerank)

after all subscriptions complete:
  resurface-archive (find archive items newly-relevant to today's top-3 new items)
    └─ compose-brief (top-N new + top-2 archive → write briefs/<today>.md)
```

**Scheduling.** gBrain's `autopilot-cycle` Minion handler is sealed to the dream cycle's phases and is not user-extensible (see Appendix A). Our DAG therefore needs its own trigger. The MVP uses **external scheduling**: a shipped `bin/personal-rss-daily` script that runs `gbrain submit-job compose-brief`, configured by the user as a system cron / launchd entry. `install.sh` writes a sample launchd plist on macOS and prints the line for other systems. On-demand invocation by Claude is `submit_job({handler: "compose-brief"})` via the standard gBrain MCP op.

### 2.6 Subagent ↔ deterministic-work pattern

gBrain's plugin system ships **subagent definitions**, not raw TypeScript handlers. Deterministic work is done by Bun scripts in `scripts/` that subagents invoke via the built-in `shell` handler. The subagent definition is thin orchestration; the script does the work and writes results to the brain via the gBrain library API.

Example: `rss-ingest.md` is a one-paragraph subagent definition telling the LLM "shell out to `scripts/fetch-rss.ts <subscription-slug>`, then for each new item ID returned, `submit_job` an `item-process` for it." The actual fetch + parse logic lives in TypeScript.

This pattern keeps the LLM doing what LLMs are good at (orchestration, dispatch, error explanation) and keeps deterministic work fast and cheap.

**Trust boundary.** gBrain's `OperationContext` carries a `remote` flag — `false` for local CLI invocations, `true` for jobs submitted via MCP. Security-sensitive ops (notably `submit_job` for the `shell` and `subagent` handlers) tighten when `remote === true`. Our subagents are LLM-driven and will frequently be invoked through MCP (`remote: true`), so every shell-out in `scripts/` must (a) accept only well-formed arguments from the subagent prompt (no arbitrary command construction), and (b) operate only on paths inside the brain. Subagent definitions must declare `allowed_slug_prefixes` matching our data model (§2.4) so write attempts outside `subscriptions/`, `items/`, `briefs/`, and `interests.md` are rejected by gBrain's filing rules.

### 2.7 Web view

Single Express server, ~80 lines. Three routes:

- `GET /` — today's brief
- `GET /brief/:date` — specific day
- `GET /briefs` — index of past briefs

Reads pages via `import { BrainEngine } from 'gbrain'` (a public export). Renders with `marked` + a tiny CSS file. Binds to `127.0.0.1:7777` (gBrain's default-bind pattern). No auth, single-user, demo-only.

---

## 3 · Brief Composition

### 3.1 Format

```markdown
# Daily Brief — 2026-05-17
_~6 min · 4 new · 2 from your archive_

## New today

### 1. [Article title](url) — 3 min read
*Why:* matches your interest in [X]; cites [Y] you've been tracking
> [first 2 sentences or LLM-extracted hook]
[read · paragraphs 4–7](url#:~:text=…)

### 2. [Podcast title](url) — 11 min segment
*Why:* host argues [X], directly relevant to your work on [Y]
[listen · 23:14–34:02](url?t=1394)

…

## From your archive

### 1. [Article you saved Nov 14, 2024](url) — 4 min re-read
*Newly relevant because:* this week's [event/release] makes the framework here actionable
> [snippet]
[re-read](url)
```

### 3.2 Scoring and selection rules

- **Score range:** 0–100, emitted by Haiku as JSON `{score, why_it_matters}`.
- **"New today" threshold:** include items with score ≥ 70, capped at 8.
- **"From your archive" candidates:** items in `items/**` with `published_at` more than 30 days old, whose embedding cosine-similarity to *today's top-3 new items* exceeds a threshold. The top 5 candidates are LLM-judged for "is this newly relevant?"; the top 2 keepers are written into the brief.
- **Fallback:** if nothing in the archive qualifies, the section is omitted entirely. We do not pad.
- **Determinism:** same brain state + same date should produce the same brief. Inputs and scoring-model id are recorded in frontmatter (§3.3) for debug.

### 3.3 Brief frontmatter

```yaml
---
date: 2026-05-17
items_considered: 47
items_included_new: 4
items_included_archive: 2
scoring_model: claude-haiku-4-5-20251001
estimated_total_minutes: 6
generated_at: 2026-05-17T06:30:00Z
---
```

Used by the web view for meta-stats and by debugging tooling to understand ranking decisions.

---

## 4 · Failure Modes and Testing

Lightweight, hackathon-appropriate.

### 4.1 Failure handling

| Failure | Behavior |
|---|---|
| RSS feed 404 / 5xx | Log to subscription page, retry next day, mark stale after 7 consecutive days. |
| Transcription fails (length, format, etc.) | Skip item; write `transcription_failed: true` in item frontmatter. |
| Score-item LLM call rate-limited | Backoff via gBrain's existing `core/backoff.ts`; retry within the same Minion run. |
| `interests.md` missing | Brief composer writes a friendly stub asking the user to create it. |
| No items pass threshold | Brief is still written: *"Quiet day. 12 items considered, none cleared the 70 threshold."* with a link to see everything. |
| Disk full / DB write fails | Bubbles up to gBrain; its error handling owns recovery. |

No retries on the brief composer itself. If a day is missed, the next nightly run produces tomorrow's brief; missed days don't auto-backfill.

### 4.2 Testing strategy

For a 48-hour hackathon, full coverage is wrong. What we *do* test:

1. **`scripts/content-type-detect.ts`** — pure function, unit-tested with tabular fixtures (RSS items from a podcast, a YouTube channel, an arXiv feed, a blog). Asserts the correct `kind` is returned.
2. **`scripts/fetch-rss.ts`** + recorded HTTP fixture — given a known feed XML, asserts the right set of item pages is produced.
3. **End-to-end smoke (`scripts/smoke.sh`):** add a known RSS feed, run ingest + brief, grep the resulting brief for an expected substring. The only "is it working" check we need. Run as the last step of `install.sh` to catch broken installs.

We do **not** test: Minion crash recovery (gBrain owns it), transcription accuracy (we're not the transcriber), Haiku rerank output beyond schema-level (it's a probabilistic model).

---

## 5 · What's Explicitly Out of Scope

- Newsletter (email) ingestion
- X / Twitter ingestion
- Explicit thumbs-up / thumbs-down feedback loop
- Email digest delivery
- AI-voice generated podcast version of the brief
- Multi-user / multi-brain / multi-tenant
- Custom MCP tools (would require gBrain core changes)
- Modifications to gBrain's dream cycle
- Anything that requires forking gBrain

These are good post-hackathon directions; not hackathon work.

---

## Appendix A · gBrain architectural verification (2026-05-16)

A subagent verified three architectural assumptions against gBrain v0.35.1.0 source before this spec was locked. Documented here so future-us knows why this spec looks the way it does.

| Assumption | Verdict | Evidence | Spec consequence |
|---|---|---|---|
| Dream cycle (`src/core/cycle.ts`) is hookable by external plugins | ❌ False | `runCycle()` phase order is hardcoded; only `yieldBetweenPhases` / `yieldDuringPhase` signal-handling callbacks exist. | Archive re-surfacing is its own scheduled `resurface-archive` subagent that runs after the dream cycle, not a phase of it. |
| Skills can register custom MCP tools | ❌ False | `src/mcp/server.ts` calls `buildToolDefs(operations)`; MCP surface is generated **only** from `src/core/operations.ts`. Skills are workflow markdown that Claude reads, not callable tools. | All user actions map onto existing gBrain MCP ops (`put_page`, `list_pages`, `submit_job`, `get_page`). The `SKILL.md` is a workflow teacher, not a tool exposer. |
| `gbrain.plugin.json` + `GBRAIN_PLUGIN_PATH` lets external repos ship Minion subagent handlers without forking | ✅ Confirmed | `src/core/minions/plugin-loader.ts` `loadPluginsFromEnv()` discovers manifests at `GBRAIN_PLUGIN_PATH`; plugins declare a `subagents/` directory of `.md` subagent definitions. | Our plugin is laid out exactly this way: `plugin/gbrain.plugin.json` + `plugin/subagents/*.md`. Deterministic work happens in `scripts/` and is invoked by subagents via the built-in `shell` handler. |
