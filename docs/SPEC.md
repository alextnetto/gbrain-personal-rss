# `gbrain-personal-rss` — Spec (v2, minimal)

A daily AI-filtered content brief, in your Obsidian vault. Demo-grade: simple, happy-path, reliable.

---

## Files

User edits 2 files in `personal-rss/`:

- `interests.md` — free text. What you care about.
- `following.md` — one URL per line: `<url> - <description>`. URLs are RSS/Atom feeds.

The orchestrator writes 1 file:

- `daily/<YYYY-MM-DD>.md` — today's brief.

No frontmatter on any file. No `seen.md`. No `inbox.md`. No `media/` pages. Re-running the same day re-writes the brief (idempotent).

---

## Flow (5 steps)

1. Read `interests.md` and `following.md`.
2. For each URL in `following.md`, fetch the feed and parse items from the last 24 hours.
3. For each item, fetch the article HTML (skip on error).
4. Pass `{interests, items[]}` to a single `brief` subagent.
5. Subagent emits the brief markdown; orchestrator writes `daily/<date>.md`.

That's it.

---

## Brief format

```markdown
# Daily Brief — YYYY-MM-DD

## [Title](url) — N min read
One-sentence why this matters to you.
> A few sentences quoted from the article.

## [Title](url) — N min read
…
```

Subagent picks 4–6 items max. No archive section. No inbox section. No deep-link timestamps. No frontmatter.

---

## Content types

| Type | Status |
|---|---|
| HTML articles via RSS/Atom feeds | ✅ works |
| Substack (uses `<root>/feed`) | ✅ works (feed URL form) |
| YouTube videos | 🚧 later |
| Audio podcasts | 🚧 later |
| PDFs | 🚧 later |

User puts feed URLs directly in `following.md`. No auto-discovery for v2 minimal — paste the feed URL, not the site URL.

---

## Failure modes

| Failure | Behavior |
|---|---|
| Feed 404/5xx | Skip that source, log, continue |
| Article 404 | Skip that item, continue |
| Subagent returns non-markdown | Write a fallback brief: title + plain list of fetched item titles + URLs |
| Subagent throws | Same fallback |

---

## Out of scope (intentionally cut)

- Inbox / one-off saves
- Archive re-surfacing
- `seen.md` dedup log
- Persisted item pages in `media/`
- Brief frontmatter / item frontmatter
- YouTube / audio / video / PDF
- Per-source scoring detail
- Multi-user
- Auto-discover feeds from site URLs
