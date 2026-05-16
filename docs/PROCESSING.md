# Processing Spec (v2 — Obsidian-native, simplified)

Proposed pivot from v1 (`docs/SPEC.md`). Goal: the user never authors YAML or learns slug conventions. They edit plain markdown files in Obsidian; everything else is machine-managed.

---

## 1 · Files the user touches

All under `personal-rss/` in the user's gBrain-connected Obsidian vault. Everything related to personal-rss lives here — no scattered vault-root files.

### `personal-rss/interests.md`

Free text. The user's taste model — what they care about, what they don't. Used by every scoring decision, every brief composition, every archive re-surfacing call. The single most important page for output quality.

Format: plain markdown. No frontmatter required. Sections, bullets, paragraphs — whatever the user prefers. The scorer reads it whole.

### `personal-rss/following.md`

One subscription per line. Format:

```
<url> - <free-text description of what's interesting about this source>
```

Example:

```
https://www.anthropic.com/news/rss.xml - Anthropic blog. Model cards and day-one release notes.
https://www.youtube.com/@DwarkeshPatel - long-form ML/AI lab interviews. Best segment-level demo source.
http://export.arxiv.org/rss/cs.CL - daily preprints. Aggressive filtering required.
```

URLs may be RSS feed URLs, site URLs (auto-discover the feed via `<link rel="alternate">`), YouTube channel URLs, Substack roots, etc. The description after the `-` is **per-source interest context** — used by scoring on top of the global `interests.md`. Lines starting with `#` and blank lines are skipped.

### `personal-rss/inbox.md`

One-off URLs the user wants to read soon. One URL per line, no description needed.

```
https://slatestarcodex.com/2015/08/17/the-goddess-of-everything-else-2/
https://www.example.com/some-piece
```

**The inbox is auto-clearing.** After a URL is processed and lands in a brief, the orchestrator **removes it from `inbox.md`** and appends it to `seen.md`. The user keeps the file in inbox-zero mode by adding new URLs as they think of them.

### `personal-rss/seen.md`

Append-only URL log. The orchestrator writes here; the user can read or edit it.

```
https://www.anthropic.com/news/extended-thinking
https://www.dwarkesh.com/p/some-old-ep
...
```

Functions as the dedup truth: any URL listed here is skipped on subsequent runs. The user can `rm` a line to force a re-process — useful when interests change drastically or for debugging.

## 2 · Files the machine writes (visible to the user)

### `personal-rss/daily/YYYY-MM-DD.md`

Today's brief. Markdown with two sections (New / From your archive) per the v1 spec §3. Obsidian renders it natively; deep-links work in-app.

## 3 · Files the machine writes (hidden — db_only tiers)

Full ingested content lives in the existing `db_only` tiers already declared in `gbrain.yml` — invisible in Obsidian sidebar (gitignored, machine-managed).

- **Articles** → `media/articles/<sha1-of-url>.md`
- **Podcast / video transcripts** → `media/podcasts/<sha1-of-url>.md`

Each carries minimal frontmatter:

```yaml
---
source_url: <original URL>
source: <following-line-url, or "inbox">
fetched_at: <ISO>
kind: text | audio | video
duration: <seconds, if audio/video>
score: <0–100, last scoring run>
why_it_matters: "<one sentence>"
---
```

The user does not need to know these exist for the product to work. They exist so that:
- The next day's `resurface-archive` step has a corpus to query.
- Re-scoring against updated interests doesn't require re-fetching.
- The web view can deep-link back to original content.

## 4 · Processing flow (one nightly run)

```
1. PARSE following.md
   Read personal-rss/following.md → list of {url, description}.
   Skip blank lines and lines starting with "#".
   For each url:
     - If RSS/Atom feed → use directly
     - Else → fetch HTML, look for <link rel="alternate" type="application/rss+xml">,
              fall back to known patterns (/feed, /rss, YouTube channel-id rewrite, etc.)

2. INGEST NEW FEED ITEMS
   For each parsed item:
     - skip if item.url is in seen.md
     - extract: text articles → readability; audio/video → transcribe
     - write media/articles/<hash>.md or media/podcasts/<hash>.md
       with frontmatter (source_url, source, fetched_at, kind, duration)

3. INGEST inbox.md
   Read personal-rss/inbox.md → list of urls.
   For each url:
     - skip if in seen.md
     - same extraction → write to media/articles/<hash>.md
     - mark internally with source: "inbox" (boosts score floor — see §6)

4. SCORE EACH NEW ITEM
   For each new file written in steps 2–3:
     - Invoke score-item subagent with:
       · global interests (personal-rss/interests.md)
       · per-source description (from the following.md line; empty for inbox)
       · item title + body excerpt
     - Subagent emits {score, why_it_matters}
     - Update item file's frontmatter

5. RESURFACE ARCHIVE
   Find old items (>30 days, in media/) similar to today's top-3 new items.
   Invoke resurface-archive subagent → JSON candidate list.

6. COMPOSE BRIEF
   Gather:
     - new items today with score ≥ 70 (cap 8)
     - all inbox items (regardless of score — user explicitly saved them)
     - archive candidates (cap 2)
   Invoke compose-brief subagent → markdown body.
   Write personal-rss/daily/YYYY-MM-DD.md.

7. CLEAR INBOX, APPEND TO SEEN
   For every URL that landed in today's brief:
     - if it came from inbox.md: remove that line from inbox.md
     - append the URL to seen.md
```

## 5 · Dedup mechanism

**`seen.md` is the only source of truth for "have we shown the user this before."**

- Item gets added only when it appears in a brief.
- Subsequent runs skip URLs in the log (cheap line-by-line check; file stays under a few thousand lines per year of normal use).
- User can `rm` a line to force a re-process.
- Distinct from the `media/` cache: a URL can be in `media/` (already fetched) but not yet in `seen.md` (not yet shown). This is fine — we won't re-fetch, but we will re-consider for today's brief.

## 6 · Inbox semantics in detail

Inbox is **transient**, not a durable read-list:

- User adds URLs as they think of them (any time).
- Next orchestrator run processes every inbox URL (independent of the following.md fetch loop).
- Each inbox URL is scored, but bypasses the score ≥ 70 threshold — user explicit save = always included.
- After landing in a brief, the URL is **removed from `inbox.md`** and **appended to `seen.md`**.
- Removing the URL line from inbox.md is idempotent: if the orchestrator runs twice in one day, the second run sees an empty inbox (well, empty of items it already processed).

Edge cases:
- **Same URL in both `following.md` (as a feed item) and `inbox.md`:** dedupe by URL; treat as inbox (boosts score floor) but only ingest once.
- **Inbox URL already in `seen.md` from a prior run:** skip + remove from inbox (the user manually re-added something we already showed them).
- **Inbox processing fails (404, etc.):** leave in inbox.md; log an entry in seen.md anyway? No — keep it in inbox with a comment line `# <url> failed YYYY-MM-DD: <reason>` so the user sees it next time and can choose to delete or retry.

## 7 · Skill / MCP delivery

`SKILL.md` reduces to six actions, all of which are reads/writes on plain markdown files in `personal-rss/`:

- "Add this source" → append `URL - description` to `personal-rss/following.md`
- "Save this for later" / "Read this when you get a chance" → append URL to `personal-rss/inbox.md`
- "What should I read today?" → read `personal-rss/daily/<today>.md`
- "Show me last Tuesday's brief" → read `personal-rss/daily/<date>.md`
- "Update my interests" → edit `personal-rss/interests.md`
- "What am I subscribed to?" → read `personal-rss/following.md`

Claude doesn't need to know about subagents or scoring — that runs in the nightly orchestrator.

## 8 · What changes in the code (delta from v1)

| Area | v1 (current code) | v2 (proposed) |
|---|---|---|
| Subscription input | `subscriptions/<slug>.md` w/ YAML frontmatter | `personal-rss/following.md`, parsed line-by-line |
| Per-source state (etag, last_fetched) | stored in subscription frontmatter | per-run only (in-memory); rely on `seen.md` for dedup |
| Inbox / read-later | not implemented | `personal-rss/inbox.md`, auto-clearing |
| Item storage | `items/<source>/<id>.md` (new top-level dir) | `media/articles/<hash>.md` and `media/podcasts/<hash>.md` (reuse existing db_only tiers) |
| Brief location | `briefs/<date>.md` (new top-level dir) | `personal-rss/daily/<date>.md` (visible in vault, opens in Obsidian) |
| Dedup | filesystem (does item file exist?) | explicit URL log (`seen.md`) |
| Scoring input | global interests only | global interests + per-source description |
| Interests file | `interests.md` at vault root | `personal-rss/interests.md` (consolidated) |
| Vault top-level dirs we own | `subscriptions/`, `items/`, `briefs/`, `interests.md` | `personal-rss/` only |
| `gbrain.yml` registrations | added 4 paths | add 1 path (`personal-rss/` in db_tracked); rely on existing `media/` paths in db_only |

**Concrete v1 → v2 code touches:**

1. `src/orchestrator/pipeline.ts` — rewrite `ingestSubscription` to parse `following.md`; add `ingestInbox` with auto-clear; switch item paths to `media/articles/` and `media/podcasts/`; switch brief path to `personal-rss/daily/`; add dedup against `seen.md`.
2. `scripts/parse-following.ts` — **new**, ~30 lines, TDD parser for the `URL - description` line format (with `#` comments and blank-line tolerance).
3. `scripts/feed-discover.ts` — **new**, ~40 lines: given a URL, return the feed URL (RSS auto-discover, known-host patterns for YouTube/Substack/Anchor/etc.).
4. `subagents/score-item.md` — prompt update: accept and use per-source description in scoring.
5. `skills/personal-rss/SKILL.md` — replace the workflow section with the simpler 6-action list above.
6. `gbrain.yml` in the vault — already updated (drops the four v1 paths, registers `personal-rss/` in db_tracked).

The three subagents themselves don't move. `src/orchestrator/brain.ts` doesn't change. Web view path config (`BRIEFS_DIR`) changes to `personal-rss/daily/`. ~200 lines of pipeline + new-script edits.

## 9 · Why this is the right pivot

- **Zero learning curve.** Anyone who can paste a URL into a markdown file is now subscribed.
- **Obsidian-first delivery.** The brief renders where the user already lives.
- **Dedup is debuggable.** A grep-able URL log beats "does this file exist in the brain DB."
- **Per-source descriptions improve scoring.** "I follow Anthropic for model releases" vs "I follow this YC partner for office-hours essays" are different filters; same global interests, different relevance signal.
- **Inbox is the killer concept.** Half of personal-content-firehose use is "save this for later, just remind me when." First-class queue with auto-clear — not a hack.
- **One folder, one mental model.** Everything related to personal-rss is under `personal-rss/`. The vault stays tidy.
- **No new vault-root dirs.** We don't pollute the user's other use cases.

## 10 · Out of scope for this pivot

- Multi-user / multi-brain — same as v1, single-user.
- Image / PDF ingestion — text and audio only.
- Newsletter (email) ingestion — still roadmap; Substack-via-RSS works today.
- Pruning `seen.md` — append-only for MVP; revisit if file size becomes a real issue.
- Daily-cadence flexibility (weekly briefs, on-demand only) — current shape is daily.

---

## Open questions worth resolving before implementing

1. **What if a `following.md` URL is also in `inbox.md`?** Proposal: treat as inbox precedence (boosts score floor, always include); dedupe by URL; only one item page in `media/`.
2. **What if the user removes a line from `following.md`?** Proposal: stop fetching that source. Existing items in `media/` stay for archive resurfacing.
3. **Should the brief append a "you saved/considered these but they didn't clear threshold" footer?** Proposal: opt-in via a `show_considered` flag at the top of `interests.md` (e.g. a single-line `<!-- show_considered: true -->` comment). Skip for MVP.
4. **Inbox failure handling.** Proposal in §6: keep the URL in inbox.md with an inline comment line documenting the failure, rather than silently dropping or auto-retrying.
