---
name: personal-rss
description: Use when the user asks for today's daily brief, a past brief, wants to save a URL to read later (inbox), wants to add a feed source, or wants to edit their interests for the personal-rss content brief.
---

# Personal RSS

You operate on a small set of markdown pages stored in the user's brain under `personal-rss/`. There are no custom tools — use gBrain's existing `get_page` and `put_page` operations.

## Page layout

| Page | What it is |
|---|---|
| `personal-rss/interests.md` | the user's free-text taste model |
| `personal-rss/following.md` | feed URLs, one per line: `<rss-url> - <description>` |
| `personal-rss/inbox.md` | one-off URLs to surface in the next brief |
| `personal-rss/daily/<YYYY-MM-DD>.md` | a brief, written each day by the `bun run daily` script |
| `personal-rss/seen.md` | append-only log of inbox URLs that have been processed |

The brief is **written by a separate TypeScript script** (`bin/daily.ts` in the `gbrain-personal-rss` repo), not by you. You only read briefs and update the three input files.

## The five actions

### 1. Show today's brief

Compute today's date as `YYYY-MM-DD` in the user's local timezone. Call `get_page("personal-rss/daily/<date>")`. If it exists, return the body **verbatim** — do NOT summarize, the brief itself is the artifact. If it doesn't exist, tell the user no brief has been generated yet and that they can run `bun run daily` from the project root.

### 2. Show a past brief

Parse the date the user mentioned ("last Tuesday", "March 12") into `YYYY-MM-DD`. Call `get_page("personal-rss/daily/<date>")`. If missing, tell them.

### 3. Save a URL to read later (inbox)

1. Call `get_page("personal-rss/inbox")` to read the current inbox body.
2. Append the URL on its own line at the end (skip if already present).
3. Call `put_page("personal-rss/inbox", <new body>)`.
4. Tell the user it'll appear in the next brief.

The next `bun run daily` will process it. After successful processing, the URL is moved to `seen.md` automatically (you don't do that).

### 4. Edit interests

1. Call `get_page("personal-rss/interests")` to read the current body.
2. Apply the user's edit.
3. Call `put_page("personal-rss/interests", <new body>)`.
4. Note that the next daily run will re-score everything against the new interests.

### 5. Add a feed source

1. Call `get_page("personal-rss/following")`.
2. Append a single line in the exact format: `<rss-url> - <one-line description from the user>`.
3. Call `put_page("personal-rss/following", <new body>)`.
4. Get the description from the user; don't invent one. The URL must be an RSS/Atom feed URL — don't paste site URLs (no auto-discovery).

## Important — keep the brain DB and vault files in sync

The `bun run daily` script reads from **vault files** on disk. When you (via this skill) write a page through `put_page`, you're updating the **brain DB**. They diverge unless synced.

For full round-trip:
- After you write any page: tell the user to run `gbrain export` (or it will happen automatically if they have sync configured).
- Before the user runs `bun run daily`, the vault files should be current.

If unsure, instruct the user: `gbrain export && bun run daily`.

## Don't

- Don't invent URLs, feed sources, or brief content. If a page doesn't exist, say so.
- Don't write to `personal-rss/seen.md` — the daily script owns that.
- Don't write to `personal-rss/daily/*` — the daily script owns those.
- Don't run `bun run daily` yourself; you don't have shell access. Tell the user to run it.
