# `gbrain-personal-rss` — Spec (v2)

> Single source of truth. Supersedes prior v1 + PROCESSING drafts.

**Goal.** A daily AI-filtered content brief, edited in plain markdown in an Obsidian vault, written by a thin orchestrator that delegates almost all reasoning to LLM subagents.

**Substrate.** Installed alongside a [gBrain](https://github.com/garrytan/gbrain) vault (v0.35.1.0). State lives as gBrain pages; the brief is a vault file the user opens in Obsidian.

---

## 1 · Files the user touches (in `personal-rss/`)

| File | Purpose |
|---|---|
| `interests.md` | free-text taste model |
| `following.md` | one source per line: `<url> - <description>` — URL is any RSS feed, YouTube channel, blog root, Substack root, arXiv category, etc. |
| `inbox.md` | one-off URLs to surface in the next brief; **auto-cleared** after processing |
| `seen.md` | URL log; dedup truth (machine writes; user may edit to force re-process) |
| `daily/<YYYY-MM-DD>.md` | the brief |

## 2 · Files the machine writes (hidden, `db_only`)

| Path | What |
|---|---|
| `media/articles/<sha1>.md` | text items — articles, blog posts, paper abstracts |
| `media/podcasts/<sha1>.md` | time-anchored items — podcast episodes, YouTube videos |

---

## 3 · Architecture — two thin layers

### Orchestrator (TypeScript, run by cron)

1. Parse `following.md` + `inbox.md`.
2. For each URL, invoke a **fetcher** chosen by source-protocol:
   - **HTML / unknown** → plain `fetch(url)` → raw body
   - **RSS/Atom feed** → parse to items; recurse per item
   - **YouTube channel URL** → rewrite to Atom feed; recurse
   - **YouTube watch URL** → fetch watch page, extract `captionTracks`, fetch captions XML, parse to `[{start, end, text}]`
   - **(later) Audio enclosure** → Whisper transcribe
   - **(later) PDF** → text extraction
3. Pass `{url, kind, raw_content, metadata, interests, source_description}` to the single **`ingest`** subagent.
4. Persist `ingest`'s structured JSON to `media/articles/<hash>.md` or `media/podcasts/<hash>.md`.
5. After all items: invoke `resurface-archive`, then `compose-brief`. Write `personal-rss/daily/<date>.md`. Append surfaced URLs to `seen.md`. Remove inbox URLs from `inbox.md`.

### Subagents (LLM-driven, 3 total)

| Subagent | Input | Emits | Why one not many |
|---|---|---|---|
| **`ingest`** *(polymorphic)* | URL + raw content + content-kind hint + interests + source description | `{kind, title, summary, score, why_it_matters, cleaned_text?, key_segments?}` | The LLM decides what the content is and how to extract value. No per-type prompts; new content types are mostly new fetchers, not new subagents. |
| **`resurface-archive`** | today's top-3 new items + ≤50 archive candidates (>30 days old) | `{candidates: [{item_slug, newly_relevant_because, triggered_by_new_item_slug}]}` | Pure judgment; never writes. |
| **`compose-brief`** | scored new items + inbox items + archive candidates + interests | the brief markdown body | Pure judgment; orchestrator writes the page. |

**The key idea:** the orchestrator grows by *source protocol* (only when content lives behind a special endpoint). The intelligence — what's important, how to summarize, where the value is — lives in prompts.

---

## 4 · What we can process

| Source type | Fetcher | Subagent path | Status |
|---|---|---|---|
| HTML pages (blogs, news, Substack posts) | `fetch(url)` → raw HTML | `ingest` reasons about the body | works |
| RSS/Atom feeds (any) | parse to items; iterate | per-item routing | works |
| Substack newsletter root | rewrite to `<root>/feed` → HTML per post | same as HTML | works |
| YouTube channels | rewrite `/@handle` → Atom feed → per-video captions XML | `ingest` reasons about chunks, picks key segments | works |
| YouTube individual videos | fetch captions XML, parse chunks | same | works |
| arXiv (Atom feed) | parse feed; `ingest` on each abstract | text path | partial — full-PDF roadmap |
| **One-off URLs** (`inbox.md`) | same dispatch as above | `ingest` + always included in brief | works |
| Audio podcast enclosures | needs Whisper transcribe | text-fallback for now | roadmap |
| Full arXiv PDFs | needs PDF text extractor | abstract-only for now | roadmap |
| Email-only newsletters | needs email forwarder | — | out of scope |
| X / Twitter | no RSS, hostile API | — | out of scope |

**Adding a new type:**
1. *(Sometimes)* a new fetcher (only if the content lives behind a special endpoint). ~20–40 lines.
2. *(Optionally)* a prompt tweak in `ingest` to remind it how to read this format.
3. *(Sometimes)* a one-line addition to the URL → fetcher router.

Most new types are zero code — just URLs in `following.md`. The `ingest` subagent already handles arbitrary text content; new things mostly need a way to extract bytes.

---

## 5 · The brief

```markdown
# Daily Brief — <YYYY-MM-DD>
_~<N> min · <X> new · <Y> from your inbox · <Z> from your archive_

## New today
[items with score ≥ 70, capped at 8]

## From your inbox
[every URL the user dropped in inbox.md]

## From your archive
[≤ 2 newly-relevant old items, judged by resurface-archive]
```

**Per-item:** title (linked), one-line *Why:*, blockquote excerpt, bold deep-link. Audio/video deep-links use `?t=<seconds>`. Text deep-links use `#:~:text=…` text fragments where possible.

**Frontmatter** records `items_considered`, `items_included_*`, `scoring_model`, `estimated_total_minutes`, `generated_at`.

---

## 6 · Failure modes

| Failure | Behavior |
|---|---|
| Feed 404/5xx | Log, skip; retry next day |
| One item's fetch fails | Skip that item; `ingest` not invoked |
| YouTube captions endpoint missing | Item gets HTML-only content; `ingest` works with what it has |
| `ingest` returns non-JSON | Log; default `{score: 0, why_it_matters: "ingest failed"}` |
| `compose-brief` throws | Brief not written; inbox not cleared; URLs not added to seen — full retry tomorrow (idempotent) |

---

## 7 · Out of scope

Multi-user · PDF/image ingest beyond text · email-only newsletters · X · pruning `seen.md` · daily-cadence flexibility (weekly/on-demand briefs).
