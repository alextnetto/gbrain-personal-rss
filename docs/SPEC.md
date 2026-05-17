# Spec — v0.2 (working)

A daily AI-filtered content brief written to a folder in your Obsidian vault. One script, one Anthropic call per day, no infrastructure.

---

## Files

User edits 2 files in `<vault>/personal-rss/`:

- `interests.md` — free text. What you care about.
- `following.md` — one feed per line: `<rss-url> - <description>`.

The script writes 1 file per run:

- `<vault>/personal-rss/daily/<YYYY-MM-DD>.md` — today's brief.

That's the entire surface.

---

## Flow

```
1. Read <vault>/personal-rss/interests.md
2. Read <vault>/personal-rss/following.md → list of {url, description}
3. Fetch all RSS feeds in parallel
4. Fetch all recent articles (last 7 days) in parallel; strip HTML to text
5. Call Anthropic Claude Sonnet with: interests + items + a prompt that says "pick 4–6 most relevant, write a markdown brief"
6. Write the brief to <vault>/personal-rss/daily/<today>.md
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

## Out of scope (intentionally cut from v0.2)

Inbox / one-off saves · archive re-surfacing · seen-log dedup · YouTube transcription · audio podcast transcription · PDF extraction · MCP delivery · gBrain library integration · per-source item persistence · multi-user · web view.

Most of these are real features. None are needed for the demo. The whole flow is 150 lines of TypeScript + one Anthropic call.
