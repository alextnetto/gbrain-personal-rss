# Processing Spec (v2 — Obsidian-native, simplified)

Proposed pivot from v1 (`docs/SPEC.md`). Goal: the user never authors YAML or learns slug conventions. They edit plain markdown files in Obsidian; everything else is machine-managed.

---

## 1 · Files the user touches

All under `personal-rss/` in the user's gBrain-connected Obsidian vault. Plus `interests.md` at the vault root.

### `personal-rss/watchlist.md`

One line per subscription. Format:

```
<url> - <free-text description of what's interesting about this source>
```

Example:

```
https://claude.com/blog - news about tech, interesting insights about using better AI
https://www.youtube.com/@DwarkeshPatel - great interviews with deep insights
https://api.substack.com/feed/podcast/65244.rss - Dwarkesh's actual RSS if I know it
```

URLs may be RSS feed URLs, site URLs (auto-discover the feed), YouTube channel URLs, Substack roots, etc. The description is **per-source interest context** — used by scoring in addition to the global `interests.md`.

### `personal-rss/to read.md`

One URL per line. One-off articles the user wants to read soon. No description needed.

```
https://slatestarcodex.com/2015/08/17/the-goddess-of-everything-else-2/
https://www.example.com/some-piece
```

### `interests.md` (at vault root)

Free-text. The user's global taste model. Already exists.

### `personal-rss/already processed.md` (machine writes, user may inspect/edit)

Append-only list of URLs that have appeared in a daily brief. Used to dedup. User can delete a line to force a re-process. The file is markdown but acts as a flat URL log:

```
https://www.anthropic.com/news/extended-thinking
https://www.dwarkesh.com/p/some-old-ep
...
```

## 2 · Files the machine writes (visible to the user)

### `personal-rss/daily/YYYY-MM-DD.md`

Today's brief. Markdown with two sections (New / From your archive) per `docs/SPEC.md` §3 — that part of v1 stays. Obsidian renders this natively; deep-links work in-app.

## 3 · Files the machine writes (hidden — db_only)

Full ingested content lives in the existing `db_only` tiers — invisible in Obsidian sidebar (gitignored, machine-managed).

- **Articles** → `media/articles/<sha1-of-url>.md`
- **Podcast / video transcripts** → `media/podcasts/<sha1-of-url>.md`

Each carries minimal frontmatter the orchestrator wrote:

```yaml
---
source_url: <original URL>
source: <watchlist-line or "to-read">
fetched_at: <ISO>
kind: text | audio | video
duration: <seconds, if audio/video>
score: <0–100, last scoring run>
why_it_matters: "<one sentence>"
---
```

The user does not need to know these exist for the product to work. They exist so:
- The next day's `resurface-archive` step has a corpus to query
- Re-scoring against updated interests doesn't require re-fetching
- The web view can deep-link back to original content

## 4 · Processing flow (one nightly run)

```
1. PARSE WATCHLIST
   Read personal-rss/watchlist.md → list of {url, description}.
   For each url:
     - If RSS/Atom feed → use directly
     - Else → fetch HTML, look for <link rel="alternate" type="application/rss+xml">
              fall back to known patterns (/feed, /rss, YouTube channel-id rewrite, etc.)
     - Store etag (in-memory for this run only; no per-source state file)

2. INGEST NEW FEED ITEMS
   For each parsed item:
     - skip if item.url is in `already processed.md`
     - extract: text articles → readability; audio/video → transcribe
     - write media/articles/<hash>.md or media/podcasts/<hash>.md
       with frontmatter (source, fetched_at, kind, duration)

3. INGEST TO-READ
   Read personal-rss/to read.md → list of urls.
   For each url:
     - skip if in `already processed.md`
     - same extraction → write media/articles/<hash>.md
     - mark internally as source: "to-read" (boosts score floor)

4. SCORE EACH NEW ITEM
   For each new file written in steps 2–3:
     - Invoke score-item subagent with:
       · global interests (interests.md)
       · per-source description (from watchlist line) — empty for to-read
       · item title + body excerpt
     - Subagent emits {score, why_it_matters}
     - Update item file's frontmatter

5. RESURFACE ARCHIVE
   Find old items (>30 days, in media/) similar to today's top-3 new items.
   Invoke resurface-archive subagent → JSON candidate list.

6. COMPOSE BRIEF
   Gather:
     - new items today with score ≥ 70 (cap 8)
     - archive candidates (cap 2)
   Invoke compose-brief subagent → markdown body.
   Write personal-rss/daily/YYYY-MM-DD.md.

7. UPDATE DEDUP LOG
   Append every URL that landed in today's brief to `already processed.md`.
   (Items that were ingested but didn't clear the threshold are NOT added —
    they can re-appear in tomorrow's brief if they become newly relevant via context.)
```

## 5 · Dedup mechanism

**`already processed.md` is the only source of truth for "have we shown the user this before."**

- Item gets added to the log only when it appears in a brief.
- Subsequent runs skip URLs in the log (cheap line-by-line check; file rarely exceeds a few thousand lines in a year of use).
- User can `rm` a line to force a re-process — useful for debugging or when interests change drastically.
- Distinct from the `media/` cache: a URL can be in `media/` (already fetched) but not yet in `already processed.md` (not yet shown). This is fine — we won't re-fetch, but we will re-consider.

## 6 · Skill / MCP delivery

The `SKILL.md` (already shipped) becomes lighter:

- "Add this source" → append `URL - description` to `personal-rss/watchlist.md`
- "Save this for later" → append URL to `personal-rss/to read.md`
- "What should I read today?" → read `personal-rss/daily/<today>.md`
- "Show me last Tuesday's brief" → read `personal-rss/daily/<date>.md`
- "Update my interests" → edit `interests.md`
- "What am I subscribed to?" → read `personal-rss/watchlist.md`

All actions are reads/writes on plain markdown files. Claude doesn't need to know about subagents or scoring — that runs in the nightly orchestrator.

## 7 · What changes in the code (delta from v1)

| Area | v1 (current code) | v2 (proposed) |
|---|---|---|
| Subscription parsing | reads `subscriptions/<slug>.md` with YAML frontmatter | reads `personal-rss/watchlist.md`, parses lines |
| Per-source state (etag, last_fetched) | stored in subscription frontmatter | per-run only (in-memory); rely on `already processed.md` for dedup |
| To-read queue | not implemented | reads `personal-rss/to read.md` |
| Item storage | `items/<source>/<id>.md` (new top-level dir) | `media/articles/<hash>.md` or `media/podcasts/<hash>.md` (reuse existing db_only tiers) |
| Brief location | `briefs/<date>.md` (new top-level dir) | `personal-rss/daily/<date>.md` (visible in vault) |
| Dedup | filesystem (does item file exist?) | explicit URL log (`already processed.md`) |
| Scoring input | global interests only | global interests + per-source description |
| User-visible top-level dirs added | `subscriptions/`, `items/`, `briefs/`, `interests.md` | `personal-rss/`, `interests.md` |
| `gbrain.yml` registrations | added 4 paths | add 1 path (`personal-rss/`); remove `items/` and `briefs/` and `subscriptions/` |

**Concrete v1 → v2 code touches:**
1. `src/orchestrator/pipeline.ts` — rewrite `ingestSubscription` to parse `watchlist.md`; add `ingestToRead`; change item paths to `media/articles/` and `media/podcasts/`; change brief path to `personal-rss/daily/`; add dedup against `already processed.md`.
2. `scripts/parse-watchlist.ts` — new tiny TDD-tested parser for the `URL - description` line format.
3. `scripts/feed-discover.ts` — new (small) helper: given a URL, return the feed URL (RSS auto-discover, known-host patterns).
4. `subagents/score-item.md` — prompt update: accept and use per-source description in scoring.
5. `skills/personal-rss/SKILL.md` — replace the workflow section with the simpler 6-action list above.
6. `gbrain.yml` (in the vault) — remove the four paths I added; add `personal-rss/` as `db_tracked`.

The three subagents themselves don't move. The brain-library wrapper (`src/orchestrator/brain.ts`) doesn't change. ~150 lines of pipeline edits.

## 8 · Why this is the right pivot

- **Zero learning curve for the user.** Anyone who knows how to type a URL into a markdown file is now subscribed.
- **Obsidian-first delivery.** The brief renders where the user already lives — no separate web view needed for the primary surface (web view stays, optional).
- **Dedup is debuggable.** A grep-able URL list beats "does this file exist in the brain DB."
- **Per-source descriptions improve scoring.** "I follow Anthropic for model releases" vs "I follow this YC partner for office-hours essays" are different filters — same global interests, different relevance.
- **`to read.md` is the killer feature I missed.** Half of personal-content-firehose use is "save this for later, just remind me when." First-class queue, not a hack.
- **No new top-level vault dirs.** Everything lives under `personal-rss/` plus the existing `media/` tiers. The vault stays tidy.

## 9 · What's out of scope for this pivot

- Multi-user / multi-brain — same as v1, single-user.
- Image / PDF ingestion — text and audio only.
- Newsletter (email) ingestion — still roadmap; user can add Substack-via-RSS today.
- Pruning `already processed.md` — append-only for MVP; revisit if file size becomes a real issue.

---

## Open questions before locking this spec

1. **What if a `to read.md` URL is also covered by a watchlist source?** Probably: treat as the same item; "to read" precedence boosts the score floor but doesn't double-ingest.
2. **What if the user deletes a line from `watchlist.md`?** Stop fetching it. Existing items in `media/` stay for archive resurfacing; user can `rm media/articles/*` manually if they want a hard cleanup.
3. **Should the daily brief append a "you saved these but they didn't clear threshold" footer?** Useful for transparency; can be opt-in via a `show_low_scoring` flag in interests.md frontmatter (if we add frontmatter to interests.md at all).
