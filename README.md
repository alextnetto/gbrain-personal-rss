# `gbrain-personal-rss`

**Your personal content firehose, AI-filtered to what actually matters.**

Status: 🚧 YC Hackathon prototype — May 2026

---

## The problem

A serious reader/listener today juggles 50+ subscriptions across podcasts, newsletters, YouTube, blogs, news sites, and X. That's easily 8+ hours of new material every single day against a real-life budget closer to 45 minutes. The existing tools either summarize *everything* (and flatten the signal), filter only *text* (and ignore the half of your inputs that are audio), or recommend by what's *popular* rather than what's relevant to *you*. Nobody has a cross-source taste model that knows you.

## What it does

- **Heterogeneous ingest** — one inbox for podcasts, newsletters, blogs, YouTube channels, news sites, and X/Twitter accounts.
- **Full transcription** — every podcast episode and YouTube upload is transcribed end-to-end, not just title-and-description matched.
- **AI-filtered daily brief** — an LLM scores each new item against your stated interests and reading history, and only the high-signal stuff makes it to your brief.
- **Segment-level recommendations** — not "listen to this 2-hour podcast", but "listen to minutes 23–34" or "read paragraphs 4–7 of this article".
- **Archive re-surfacing** — old saves become new recommendations when they suddenly matter again ("you saved that RAG article in 2024 — it's relevant to today's model release").
- **Delivered where you already are** — an MCP server makes your brief queryable from ChatGPT, Claude Desktop, or Cursor; a lightweight SPA handles subscriptions and admin.

## Why now

Whisper-class transcription has dropped to roughly **$0.006 per minute**, and long-context LLMs can score a full podcast transcript in a single call. The economics that would have made this absurd in 2022 — full transcription plus per-item LLM scoring across a 50-source firehose — now land at roughly **$0.30–$1 per user per day** at high-signal subscription levels. The wall is down.

## Built on gBrain

This project is a **skillpack + recipes on top of [gBrain](https://github.com/garrytan/gbrain) v0.35.1.0**, not a fork. The contribution is the domain (personal content firehose); the infrastructure is gBrain.

| Capability | gBrain primitive |
| --- | --- |
| Podcast + YouTube transcription | `src/core/transcription.ts` |
| Timestamped chunks for segment-level recs | `src/core/chunkers/` (recursive, semantic, LLM-guided) |
| Per-user taste filter | `src/core/search/hybrid.ts` — keyword + vector + RRF, intent classification, reranking |
| Daily scheduled ingest | Postgres-native Minions job queue |
| Archive re-surfacing | The 9-phase nightly **dream cycle** — synthesize, patterns, emotional-weight, embed, orphans |
| Delivery surface | gBrain's MCP server (ChatGPT / Claude Desktop / Cursor) + OAuth + admin SPA |

If you're building anything personal-knowledge-shaped, read [gBrain](https://github.com/garrytan/gbrain) first.

## How it compares

| | Heterogeneous sources | Audio transcription | Per-user taste model | Segment-level recs | Archive re-surfacing |
| --- | :---: | :---: | :---: | :---: | :---: |
| **`gbrain-personal-rss`** [^1] | ✅ | ✅ | ✅ | ✅ | ✅ |
| Snipd | Audio only | ✅ | — | ✅ | — |
| Readwise Reader | Text only | — | — | — | ✅ |
| Feedly + Leo | Text only | — | ✅ | — | — |
| Folo | ✅ | — | — | — | — |
| Pocket | — | — | — | — | — (shut down Jul 2025) |
| Omnivore | — | — | — | — | — (shut down Nov 2024) |

[^1]: Marked as the design target. This is what the hackathon build is aiming at end-to-end; not all five legs are wired up yet.

## Roadmap

### Hackathon (May 2026)

- [ ] Subscription model: podcasts, RSS, YouTube channels, X accounts
- [ ] Daily ingest worker on gBrain Minions
- [ ] Transcription pipeline (audio → timestamped chunks)
- [ ] Per-user taste model — stated interests + interaction history
- [ ] LLM scoring + ranking per item
- [ ] Segment-level recommendation output (start/end timestamps, paragraph spans)
- [ ] Daily brief delivery via MCP
- [ ] Demo: Garry Tan's actual feeds, end-to-end

### Next

- Read/listen receipts feeding back into the taste model
- Cross-user signal opt-in ("people with taste similar to yours also flagged this")
- Browser extension for one-click subscribe from any source
- Email/Slack/Telegram delivery in addition to MCP

### Maybe later

- Open marketplace of curated source bundles
- Audio re-mixing — auto-generated "your personalized 25-minute podcast" stitched from the day's best segments
- Self-hosted Whisper for cost-sensitive deployments

## Hackathon context

Built for the Y Combinator hackathon in May 2026, on top of [gBrain](https://github.com/garrytan/gbrain) — Garry Tan's open-source personal-knowledge framework. The intended demo user is **Garry himself**: feeds wired to his podcast, his X timeline, and his subscriptions. Building a polished public skillpack on Garry's own framework at his own hackathon is the move.

## License

[MIT](./LICENSE) © 2026 Alex Netto

## Acknowledgements

- **Garry Tan** and the [gBrain](https://github.com/garrytan/gbrain) project — every hard part of this product was already solved upstream.
