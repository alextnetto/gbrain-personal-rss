# gbrain-personal-rss

> Your personal content firehose, AI-filtered to what actually matters.

You follow more podcasts, channels, and blogs than you have hours to consume. **gbrain-personal-rss** reads everything you subscribe to, scores it against your stated interests, and lands a daily brief — with the exact minute or paragraph worth your time.

Lives in Claude Desktop, Claude Code, OpenClaw, or Obsidian through MCP. A skillpack on [gbrain](https://github.com/garrytan/gbrain), not a fork.

## Quick start

```bash
git clone https://github.com/alextnetto/gbrain-personal-rss
cd gbrain-personal-rss
bun install
export ANTHROPIC_API_KEY=sk-ant-...
export PERSONAL_RSS_VAULT=/path/to/your/vault
bun run daily
```

Requires Bun ≥ 1.3.10 and a vault folder with three files in `personal-rss/`: `interests.md`, `following.md`, and optionally `inbox.md`.

## How it works

```
following.md ─╲                               ┌──────────────────┐
               ╲      ┌──────────────┐        │                  │
                ▶─►   │   SUBAGENT   │ ─────► │ daily/today.md   │
                ▶─►   │     brief    │        │                  │
inbox.md ─────╱       └──────────────┘        └──────────────────┘
                            ▲                  today's brief · 4–6 items
                            │ based on
                            │
                      ┌──────────────┐
                      │ interests.md │
                      └──────────────┘
                      what you care about
```

| File | What it holds |
|------|---------------|
| `following.md` | Recurring sources — one feed per line: `<rss-url> - <description>` |
| `inbox.md` | Ad-hoc saves — one URL per line, always in the next brief, then archived |
| `interests.md` | What you care about, free text |
| `daily/<YYYY-MM-DD>.md` | Today's brief — 4–6 items, each with why-it-matters and a quote |

No database. No queue. One script, ~150 lines. See [`docs/SPEC.md`](./docs/SPEC.md) for the full contract.

## Talk to your brief (optional, via MCP)

A skill ships at `skills/personal-rss/SKILL.md` for the [gbrain](https://github.com/garrytan/gbrain) MCP server. Install it into your gbrain checkout:

```bash
./install.sh /path/to/your/gbrain
```

Then in any MCP client — Claude Desktop, Claude Code, Cursor, OpenClaw — *"what should I read today?"* · *"save this URL"* · *"add this YouTube channel to my feeds"*.

## License

[MIT](./LICENSE) © 2026 Alex Netto

---

Built for the [YC hackathon](https://github.com/garrytan/gbrain), May 2026.
