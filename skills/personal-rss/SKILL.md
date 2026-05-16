---
name: personal-rss
description: Use when the user wants to manage RSS subscriptions (podcasts, blogs, YouTube channels, papers), update their interests file, or read today's or past daily content briefs.
---

# Personal RSS

This skill teaches you how to operate the personal-rss system using gBrain's existing operations. There are no custom tools — use `put_page`, `list_pages`, `get_page`.

## Conventions
- Subscriptions live at `subscriptions/<slug>.md`. Slug is kebab-case from the source title.
- Items live at `items/<source-slug>/<item-id>.md` (managed by the orchestrator — you don't touch these).
- Daily briefs live at `briefs/<YYYY-MM-DD>.md`.
- The user's interests live at `interests.md` (single page, free-text).

## Add a subscription

1. If the user gave a site URL but not a feed URL, try common patterns:
   - YouTube channel → `https://www.youtube.com/feeds/videos.xml?channel_id=<ID>`
   - Substack → `<root>/feed`
   - Most blogs → look for an RSS link in the page source; otherwise ask
2. Derive a kebab-case slug from the source title.
3. Call `put_page` to write `subscriptions/<slug>.md` with frontmatter:
   ```yaml
   feed_url: <feed_url>
   content_type_hint: auto
   added_at: <ISO now>
   last_fetched_at: null
   etag: null
   ```
   Body: a one-sentence note from the user about what the source is.
4. Tell the user it's added. The next nightly run will pick it up; don't trigger ingest immediately unless they ask.

## Show today's brief

1. Compute today's date (YYYY-MM-DD, local TZ).
2. Call `get_page("briefs/<date>")`.
3. If it exists, return it inline — do NOT summarize, the brief itself is the artifact they want.
4. If it doesn't exist: tell them, and ask if they want you to trigger one. To trigger, instruct them to run `bun run daily` from the repo (you cannot trigger the orchestrator yourself — it must run with library access).

## Show a past brief

1. Parse the date they mention ("last Tuesday", "March 12") into YYYY-MM-DD.
2. Call `get_page("briefs/<date>")`.
3. If missing, tell them no brief exists for that date.

## Update interests

1. Call `get_page("interests")` to read the current body.
2. Apply the user's edit.
3. Call `put_page("interests", <new body>)`.
4. Note that the next nightly run re-scores against the new interests.

## List subscriptions

Call `list_pages({ prefix: "subscriptions/" })` and render with feed_url and added_at.

## Don't
- Don't invent items or briefs. If a page doesn't exist, say so.
- Don't modify item pages (`items/**`) — the orchestrator owns them.
- Don't write brief markdown yourself — `compose-brief` (a separate subagent invoked by the orchestrator) does this.
