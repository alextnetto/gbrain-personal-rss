# `gbrain-personal-rss`

**Your personal content firehose, AI-filtered to what actually matters.**

Status: 🚧 YC Hackathon (May 2026) — v0.2 shipped, working end-to-end.

---

## The problem

You subscribe to 50+ podcasts, newsletters, blogs, YouTube channels, news sites. That's 8+ hours of new material every day. You have 45 minutes. Existing tools summarize everything (flattening the signal), filter only text (ignoring half your inputs), or recommend what's popular (instead of what's relevant to *you*). Nobody has a cross-source taste model that knows you.

## What it does (today)

Drop URLs in a markdown file. Run one command. Get a brief.

```bash
$ bun run daily
[daily] 3 subscriptions
[daily] 18 articles fetched
[daily] calling claude-sonnet-4-5...
[daily] wrote .../personal-rss/daily/2026-05-16.md (3023 chars, 18 items considered)
```

The brief opens in Obsidian (or any markdown reader). It picks **4–6 items** out of everything fetched, each with a one-line "why this matters given your interests" and a quote from the body.

## Why now

Whisper-class transcription dropped to ~$0.006/min, and long-context LLMs can score a full feed in one call. The economics that would have made this absurd in 2022 — full transcription plus per-item LLM scoring across a 50-source firehose — now land at roughly **$0.15 per run** for ~20 articles.

## How it works (v0.2)

One script, ~150 lines:

1. Read `personal-rss/interests.md` and `personal-rss/following.md` from your vault folder.
2. Fetch all RSS feeds in parallel (`fast-xml-parser`).
3. Fetch each article's HTML, strip tags to text (~4KB excerpt per item).
4. One Anthropic Claude Sonnet call with the interests + the items + a brief-writer prompt.
5. Write `personal-rss/daily/<today>.md`.

No queue, no database, no inline worker. The script does NOT import gBrain. See [`docs/SPEC.md`](./docs/SPEC.md) for the full contract.

## Install (script only)

```bash
git clone https://github.com/alextnetto/gbrain-personal-rss
cd gbrain-personal-rss
bun install
export ANTHROPIC_API_KEY=sk-ant-...
export PERSONAL_RSS_VAULT=/path/to/your/vault   # contains personal-rss/ folder
bun run daily
```

Requirements: Bun ≥ 1.3.10, an Anthropic API key, a folder with `personal-rss/interests.md` + `personal-rss/following.md` + (optional) `personal-rss/inbox.md`.

## Optional — talk to your brief from Claude Desktop / Cursor (via gBrain MCP)

A skill ships at `skills/personal-rss/SKILL.md`. Install it into a [gBrain](https://github.com/garrytan/gbrain) checkout so an MCP client can read briefs, save URLs to your inbox, edit interests, or add feed sources by chatting:

```bash
./install.sh /path/to/your/gbrain
# then add gbrain's MCP server to your Claude Desktop / Cursor config
```

Once wired up, you can ask Claude Desktop *"what should I read today?"* and get the brief back inline, or *"save this URL for later"* and have it land in your inbox before tomorrow's run. The Python-equivalent layer is the gBrain MCP server reading + writing pages by slug; the skill is the prompt that teaches Claude the conventions.

## Vault layout

```
<your-vault>/personal-rss/
├── interests.md         ← free text — what you care about
├── following.md         ← one feed per line: <rss-url> - <description>
├── inbox.md             ← one URL per line; always shown in next brief, then moved to seen.md
├── seen.md              ← machine-managed: every processed inbox URL with the date
└── daily/
    └── 2026-05-16.md    ← today's brief (written by the script)
```

That's it. Plain markdown. Edit in Obsidian (or anything else).

## How it compares

| | Heterogeneous sources | Audio transcription | Per-user taste model | Segment-level recs | Archive re-surfacing |
| --- | :---: | :---: | :---: | :---: | :---: |
| **`gbrain-personal-rss`** v0.2 | partial (text/RSS) | — | ✅ | — | — |
| Snipd | Audio only | ✅ | — | ✅ | — |
| Readwise Reader | Text only | — | — | — | ✅ |
| Feedly + Leo | Text only | — | ✅ | — | — |
| Folo | ✅ | — | — | — | — |
| Pocket | — | — | — | — | shut down Jul 2025 |
| Omnivore | — | — | — | — | shut down Nov 2024 |

The whole-product vision (audio transcription, segment-level recs, archive re-surfacing) is real but **not in v0.2**. See [`docs/PLAN.md`](./docs/PLAN.md) for what's next.

## Hackathon context

Built for the Y Combinator hackathon in May 2026. Designed to coexist cleanly with a [gBrain](https://github.com/garrytan/gbrain)-managed Obsidian vault — the brief lands in `personal-rss/daily/`, which gBrain's storage tiering treats as user-edited tracked content. A future v1.0 will integrate properly as a gBrain plugin with MCP delivery; v0.2 ships first.

## License

[MIT](./LICENSE) © 2026 Alex Netto
