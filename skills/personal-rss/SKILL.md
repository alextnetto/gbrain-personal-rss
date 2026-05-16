---
name: personal-rss
description: Use when the user wants to add a feed URL to their personal-rss watchlist, edit their interests, or read today's or a past daily content brief.
---

# Personal RSS

This skill teaches you how to operate the personal-rss system using gBrain's existing `put_page` and `get_page` operations. There are no custom tools.

## Where things live (under `personal-rss/`)

| Page | Purpose |
|---|---|
| `personal-rss/interests.md` | the user's free-text taste model |
| `personal-rss/following.md` | feed URLs, one per line: `<url> - <description>` |
| `personal-rss/daily/<YYYY-MM-DD>.md` | the brief |

## The four actions

### 1. Add a feed source
Append a single line to `personal-rss/following.md` in this exact format:
```
<feed-url> - <one-line description from the user>
```
The URL must be a working RSS/Atom feed (paste it directly — auto-discovery isn't supported in this version). Get the description from the user; don't invent one. Confirm the addition and tell them it'll appear in the next daily brief.

### 2. Edit interests
Call `get_page("personal-rss/interests")` to read the current body. Apply the user's edit (add, remove, rewrite). Call `put_page("personal-rss/interests", <new body>)`. Note: the next daily run will re-score everything against the new interests.

### 3. Show today's brief
Compute today's date as `YYYY-MM-DD` (local TZ). Call `get_page("personal-rss/daily/<date>")`. If it exists, return its body inline — do NOT summarize, the brief itself is the artifact the user wants. If it doesn't exist, tell them no brief has been generated yet and that they can run `bun run daily` from the project root.

### 4. Show a past brief
Parse the date the user mentions ("last Tuesday", "March 12") into `YYYY-MM-DD`. Call `get_page("personal-rss/daily/<date>")`. If missing, tell them no brief exists for that date.

## Don't

- Don't invent feed URLs or brief content. If a page doesn't exist, say so.
- Don't write or modify briefs yourself — the nightly orchestrator does this via the `brief` subagent.
