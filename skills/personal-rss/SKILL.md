---
name: personal-rss
description: Use when the user wants to add a source to follow, save a one-off URL for later (inbox), update their interests, read today's or a past daily content brief, or list current subscriptions.
---

# Personal RSS

This skill teaches you how to operate the personal-rss system using gBrain's existing operations. There are no custom tools — you use `put_page`, `list_pages`, `get_page`.

## Where things live (all under `personal-rss/`)

| Page | Purpose |
|---|---|
| `personal-rss/interests.md` | the user's free-text taste model |
| `personal-rss/following.md` | subscriptions, one per line: `<url> - <description>` |
| `personal-rss/inbox.md` | one-off URLs to read soon; auto-cleared after each brief |
| `personal-rss/seen.md` | dedup log (machine-managed; user can edit to force re-process) |
| `personal-rss/daily/<YYYY-MM-DD>.md` | the brief |

## The six actions

### 1. Add a source
Append a single line to `personal-rss/following.md`:
```
<url> - <free-text description of what's interesting about this source>
```
If the user gave a site URL but not a feed URL, append the site URL — the orchestrator auto-discovers feeds.
Get the description from the user; don't invent one.

### 2. Save a one-off URL for later (inbox)
Append the URL on its own line to `personal-rss/inbox.md`. No description needed. Tell the user it'll appear in the next brief.

### 3. Show today's brief
Compute today's date (YYYY-MM-DD, local TZ). Call `get_page("personal-rss/daily/<date>")`. If it exists, return it inline — do NOT summarize. If it doesn't exist, tell the user no brief has been generated yet and that they can run `bun run daily` from the project root.

### 4. Show a past brief
Parse the date the user mentioned ("last Tuesday", "March 12") into YYYY-MM-DD. Call `get_page("personal-rss/daily/<date>")`. If missing, tell them.

### 5. Update interests
Call `get_page("personal-rss/interests")`, apply the user's edit, write back with `put_page("personal-rss/interests", <new body>)`. Note: the next daily run will re-score against the new interests.

### 6. List subscriptions
Call `get_page("personal-rss/following")` and render the lines for the user.

## Don't
- Don't invent URLs or item content. If a page doesn't exist, say so.
- Don't modify item pages under `media/articles/` or `media/podcasts/` — those are owned by the orchestrator.
- Don't write briefs yourself — `compose-brief` (a subagent invoked by the nightly orchestrator) does this.
