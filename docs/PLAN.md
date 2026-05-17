# Plan — shipped

v0.2 is the working version. Nothing to plan.

---

## What shipped

`bin/daily.ts` — one file, ~150 lines. Reads the user's vault, fetches feeds in parallel, calls Anthropic Sonnet once, writes today's brief.

`scripts/fetch-rss.ts` — RSS/Atom parser. 4 unit tests.

That's the whole product.

---

## What got cut between v0.1 and v0.2

For the record (it's all in git history):

- gBrain library integration (`src/orchestrator/brain.ts`)
- Three subagent definitions (`subagents/*.md`)
- Plugin manifest (`gbrain.plugin.json`)
- Skill (`skills/personal-rss/SKILL.md`)
- Web view (`web/`)
- Install script + launchd plist (`install.sh`)
- TypeScript types module (`src/types.ts`)
- Auxiliary scripts: `extract-text.ts`, `content-type-detect.ts`, `feed-discover.ts`, `parse-following.ts`, `smoke.sh`
- Per-item brain pages in `media/articles/`, `media/podcasts/`
- Inbox auto-clearing
- Seen-log dedup
- Archive re-surfacing
- Multi-subagent pipeline (`score-item` + `resurface-archive` + `compose-brief`)
- The PGLite engine lifecycle, shelling out to `gbrain agent run --follow`, the inline worker setup, the lock dance

All necessary if you want the full product. None necessary for the demo.

---

## What's next (in priority order, if anyone picks this up)

1. **YouTube transcription** — current code fetches the watch page HTML and strips it; that's mostly nav junk. Needs a captions-endpoint helper (~30 lines) to make video brief items actually useful.
2. **Per-machine vault path** — currently hardcoded; should default to `$HOME/.personal-rss-vault` or read from a config file.
3. **Inbox** — drop URLs in `inbox.md`, surface them in tomorrow's brief regardless of relevance score, auto-clear after.
4. **Archive re-surface** — keep a tiny SQLite of past brief items + their score, and on each run ask Claude "anything in the archive that's newly relevant?"
5. **Reintegrate with gBrain** as a v1.0 — once the demo lands, putting it on gBrain's MCP surface gives "what should I read today?" in Claude Desktop.
