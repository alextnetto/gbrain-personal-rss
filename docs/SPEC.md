# Spec — v0.2 (working)

A daily AI-filtered content brief written to a folder in your Obsidian vault. One script, one Anthropic call per day, no infrastructure.

---

## Files

User edits 3 files in `<vault>/personal-rss/`:

- `interests.md` — free text. What you care about.
- `following.md` — one feed per line: `<rss-url> - <description>`.
- `inbox.md` — one URL per line. One-off saves; **always** show up in the next brief.

The script writes/updates these per run:

- `<vault>/personal-rss/daily/<YYYY-MM-DD>.md` — the brief (written fresh each run).
- `<vault>/personal-rss/seen.md` — append-only log of inbox URLs that have been processed. Each line: `<url>  # <YYYY-MM-DD>`.
- `<vault>/personal-rss/inbox.md` — URLs that successfully fetched are removed (those that failed stay so the user can investigate).

Backfill runs (`PERSONAL_RSS_DATE` set) do NOT touch `inbox.md` or `seen.md`.

That's the entire surface.

---

## Flow

```
1. Read <vault>/personal-rss/{interests,following,inbox}.md
2. Fetch all RSS feeds in parallel; keep items in the 24h window for the brief date
3. In parallel: fetch each feed article's body + fetch each inbox URL's body
4. Call Anthropic Claude Sonnet with: interests + items (inbox-flagged first) +
   a prompt that says "always include inbox items, then pick 3–5 best feed items"
5. Write the brief to <vault>/personal-rss/daily/<today>.md
6. Clear from inbox.md every URL that successfully fetched (unless backfill mode)
```

One script. Top-to-bottom. No queue, no DB, no plugin, no MCP, no worker.

---

## Brief format

```markdown
# Daily Brief — YYYY-MM-DD

## [Title](url) — N min read
One sentence why this matters given the user's interests.
> A few sentences quoted from the article body.

## [Title 2](url) — N min read
...
```

4–6 items max. If fewer meet the bar: `_(slim day — only N items met the bar)_`. No frontmatter, no archive section, no inbox section, no deep-link timestamps.

---

## Content types

| Source | Status |
|---|---|
| RSS/Atom feeds of HTML articles | ✅ works |
| Substack (use `<root>/feed`) | ✅ works |
| Hacker News RSS | ✅ works |
| YouTube channels (Atom feed) | 🚧 fetched but no transcript — body is the watch-page HTML stripped, which is junk |
| Audio podcasts | 🚧 fetched but no transcription |
| arXiv (Atom feed of abstracts) | ✅ abstracts only; full PDF roadmap |

User puts feed URLs directly in `following.md`. No site→feed auto-discovery.

---

## Failure modes

| Failure | Behavior |
|---|---|
| Feed 404/timeout | `Promise.allSettled` — skip, log, continue with others |
| Article 404 / network error / TLS error | Per-item try/catch — skip, log, continue |
| Anthropic call fails | Script exits with the SDK error; no brief written |
| `interests.md` or `following.md` missing | Script throws with a clear path |

---

## Runtime + cost

- Total wall-clock: ~30 seconds for 3 feeds × ~6 articles each
- Cost: one Claude Sonnet call, ~50K input tokens, ~1K output tokens = roughly $0.15 per run

---

## Environment

```
ANTHROPIC_API_KEY      required
PERSONAL_RSS_VAULT     path to vault root (default hardcoded; override per machine)
PERSONAL_RSS_MODEL     anthropic model id (default: claude-sonnet-4-5)
```

---

## Out of scope (intentionally cut)

Archive re-surfacing · seen-log dedup · YouTube transcription · audio podcast transcription · PDF extraction · MCP delivery · gBrain library integration · per-source item persistence · multi-user · web view.

Most of these are real features. None are needed for the demo.
