# v2 Plan

> Implements `docs/SPEC.md`. Supersedes prior plans (in git history).

**Goal of this pivot:** collapse the current per-step subagents (`score-item`) and hardcoded extractors (`extract-text`, `content-type-detect`) into a single polymorphic `ingest` subagent that handles any URL end-to-end. The orchestrator stays thin and grows only by source-protocol.

---

## Delta from current code

| Change | What |
|---|---|
| **Delete** | `subagents/score-item.md` · `scripts/extract-text.ts` · `scripts/content-type-detect.ts` · `tests/content-type-detect.test.ts` · `docs/PROCESSING.md` |
| **Add** | `subagents/ingest.md` (polymorphic) · `scripts/fetch-content.ts` + tests · `scripts/youtube-captions.ts` + tests |
| **Modify** | `src/orchestrator/pipeline.ts` (rewrite per-item flow) · `subagents/compose-brief.md` (add inbox section) · `src/types.ts` (add `FetchResult`, `IngestResult`; remove `ScoreResult`) |
| **Untouched** | `src/orchestrator/brain.ts` · `subagents/resurface-archive.md` · `scripts/parse-following.ts` · `scripts/feed-discover.ts` · `scripts/fetch-rss.ts` · `bin/` · `web/` · `install.sh` · `gbrain.plugin.json` |

---

## Tasks

Parallel groups in brackets; sequential otherwise.

### T1 — Add `scripts/youtube-captions.ts` (TDD)

**Files:** `scripts/youtube-captions.ts`, `tests/youtube-captions.test.ts`, `tests/fixtures/youtube-watch-page.html`, `tests/fixtures/youtube-captions.xml`

- `parseCaptionsXml(xml)` → `[{start, end, text}]`
- `extractCaptionTrackUrl(watchPageHtml)` → `string | null` (pulls `captionTracks[0].baseUrl` from `ytInitialPlayerResponse`)
- `fetchYouTubeTranscript(watchUrl)` → composed: fetch watch page, extract caption URL, fetch XML, parse chunks
- Three fixture-driven tests for the pure functions

### T2 — Add `scripts/fetch-content.ts` (TDD)

**Files:** `scripts/fetch-content.ts`, `tests/fetch-content.test.ts`

- Exports `fetchContent(url): Promise<FetchResult>`
- `FetchResult = { kind: "html" | "rss" | "youtube-video" | "youtube-channel" | "unknown"; content: string; metadata?: Record<string, any> }`
- Dispatch:
  - YouTube watch URL → uses `youtube-captions` → `kind: "youtube-video"`, content is `JSON.stringify(chunks)`
  - YouTube channel URL (handle or channel-id) → rewrite to Atom feed; return `kind: "youtube-channel"` with feed XML
  - URL with feed-shape (`.xml`, `.rss`, `/feed`, `/rss`) → `kind: "rss"` with feed XML
  - Anything else → `kind: "html"` (or `"unknown"` on non-2xx)
- Mocked-fetch tests for each dispatch branch

### T3 — Add `subagents/ingest.md`

Single subagent file. Frontmatter:

```yaml
name: ingest
model: claude-sonnet-4-6
max_turns: 6
allowed_tools:
  - brain_get_page
  - brain_search
```

Body: short, opinionated prompt that receives `{url, kind, raw_content, metadata, interests, source_description}` and emits:

```json
{
  "kind": "text" | "audio" | "video" | "paper",
  "title": "...",
  "summary": "<1–2 sentences>",
  "score": 0-100,
  "why_it_matters": "<one sentence, references a stated interest>",
  "cleaned_text": "<for text items: the article body, no nav/ads/comments>",
  "key_segments": [{"start": 1394, "end": 2042, "why": "<one sentence>"}]
}
```

Calibration rules (90+ direct match, 70–89 clearly relevant, etc.) preserved from `score-item`. The "extract the actual content from raw HTML" instruction is the new part — LLM reasons from first principles, no regex.

### T4 — Update `src/types.ts`

- Add `FetchResult` (matches T2 output)
- Add `IngestResult` (matches T3 output)
- Remove `ScoreResult`
- Keep `ItemFrontmatter`, `BriefFrontmatter`, `ArchiveCandidate`, `FollowingEntry`, `ItemKind`, `TranscriptChunk` unchanged

### T5 — Update `subagents/compose-brief.md`

Add a `## From your inbox` section between "New today" and "From your archive" in the format spec. Inbox items render with `*You saved this on <date>.*` instead of `*Why:*`. Bold-link deep-links with `→`.

### T6 — Rewrite `src/orchestrator/pipeline.ts`

Sequential after T1–T5. Single file, target ~250 lines.

New flow per URL:
1. `fetchContent(url)` → `FetchResult`
2. If `kind === "rss"` or `"youtube-channel"`: parse feed, iterate item URLs, recurse on each.
3. Else: skip if URL is in `seen.md`; invoke `ingest` subagent with `{url, kind, content, metadata, interests, source_description}`.
4. Parse `IngestResult` from subagent's final message.
5. Compute `media_slug = "media/articles/<sha1>"` if `result.kind === "text" | "paper"`, else `"media/podcasts/<sha1>"`.
6. `putPage(media_slug, frontmatter, body)` where body is `cleaned_text` (text items) or `JSON.stringify(chunks)` (audio/video).

After all ingest:
- Invoke `resurface-archive` (unchanged interface).
- Invoke `compose-brief` (new prompt expects inbox items separately).
- Write `personal-rss/daily/<date>.md`.
- `appendToSeen(urls)` · `removeFromInbox(inboxUrls)`.

### T7 — Delete dead files

- `git rm scripts/extract-text.ts scripts/content-type-detect.ts tests/content-type-detect.test.ts subagents/score-item.md docs/PROCESSING.md`

### T8 — Verify + commit + push

- `bun --bun tsc --noEmit` → clean
- `bun test` → all pass (existing 19 tests minus the 5 content-type-detect ones = 14, plus T1's ~3 + T2's ~4 = ~21 total)
- `bash scripts/smoke.sh` → ok
- Single final commit batching the docs + push

---

## Dependency graph

```
[T1, T2, T3, T4, T5, T7] ──→ T6 ──→ T8
```

T1, T2, T3, T4, T5, T7 are independent (different files, no shared state). Dispatch in parallel.
T6 is sequential (rewrites pipeline.ts using new T1–T5 outputs).
T8 is the final gate.

---

## Out of scope for this plan

- Whisper transcription for audio podcasts (roadmap)
- PDF text extraction for full arXiv papers (roadmap)
- Multi-user / multi-vault
- `seen.md` pruning
- Web view path stays at `personal-rss/daily/`; no changes required
- README updates (current install + usage section still applies)
