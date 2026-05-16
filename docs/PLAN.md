# v2 Plan (minimal happy-path)

Collapses the prior multi-subagent pipeline into one subagent + one fetch loop. 5 tasks, ~30 min.

---

## Files

**Delete:**
- `subagents/score-item.md`
- `subagents/resurface-archive.md`
- `subagents/compose-brief.md`
- `scripts/content-type-detect.ts` + test + 4 fixtures
- `scripts/feed-discover.ts` + test
- `scripts/parse-following.ts` + test  *(inline 3-liner instead)*
- `scripts/extract-text.ts`  *(orchestrator inlines)*
- `scripts/smoke.sh`  *(no-op now)*

**Add:**
- `subagents/brief.md` — single subagent that writes the brief

**Modify:**
- `src/orchestrator/pipeline.ts` — full rewrite, target ~80 lines
- `src/types.ts` — drop unused types; keep only what `pipeline.ts` needs
- `skills/personal-rss/SKILL.md` — 4 actions only

**Untouched:**
- `src/orchestrator/brain.ts`
- `scripts/fetch-rss.ts` (we still use `fetchAndParse` + `parseRssItems`)
- `bin/personal-rss-daily(.ts)`
- `web/` (still reads briefs from `personal-rss/daily/`)
- `gbrain.plugin.json`
- `install.sh`

---

## Tasks

### T1 — Delete dead files

```bash
git rm subagents/score-item.md subagents/resurface-archive.md subagents/compose-brief.md
git rm scripts/content-type-detect.ts tests/content-type-detect.test.ts tests/fixtures/*.xml
git rm scripts/feed-discover.ts tests/feed-discover.test.ts
git rm scripts/parse-following.ts tests/parse-following.test.ts
git rm scripts/extract-text.ts scripts/smoke.sh
```

Single commit: `"v2 minimal: delete multi-subagent + content-type machinery"`.

### T2 — Add `subagents/brief.md`

Single file. Frontmatter:

```yaml
name: brief
model: claude-sonnet-4-6
max_turns: 4
allowed_tools: []
```

Body (full prompt): you receive a list of `items[]` and the user's `interests` (free text). Pick the 4–6 most relevant. For each picked item, emit a markdown block:

```markdown
## [<title>](<url>) — <N> min read
<one sentence: why this matters given the interests>
> <a few sentences quoted from the article>
```

Header line at top: `# Daily Brief — <date>`. No frontmatter. No archive section. No inbox section. If you cannot find 4 relevant items, surface what you can with a note `_(slim day — only X items met the bar)_`. Output ONLY markdown — no preamble, no JSON, no code fences.

### T3 — Rewrite `src/orchestrator/pipeline.ts`

Target ~80 lines. Single `runDaily()` export. Flow:

```ts
import { getPage, putPage, invokeSubagent } from "./brain";
import { fetchAndParse } from "../../scripts/fetch-rss";

const FOLLOWING = "personal-rss/following";
const INTERESTS = "personal-rss/interests";

function todayStr() { /* YYYY-MM-DD local TZ */ }
function parseFollowing(src: string) { /* inline: split lines, "url - desc" */ }
async function fetchHtml(url: string): Promise<string> { /* fetch + return body */ }

export async function runDaily() {
  const interests = (await getPage(INTERESTS))?.body ?? "";
  const following = parseFollowing((await getPage(FOLLOWING))?.body ?? "");

  const items: Array<{url, title, source, source_description, body}> = [];
  for (const sub of following) {
    try {
      const feed = await fetchAndParse(sub.url);
      if (feed.status !== 200) continue;
      const recent = feed.items.filter(/* last 24h */).slice(0, 10);
      for (const it of recent) {
        try {
          const body = await fetchHtml(it.url);
          items.push({ url: it.url, title: it.title, source: sub.url, source_description: sub.description, body: body.slice(0, 4000) });
        } catch (e) { console.warn(`[item ${it.url}] ${e}`); }
      }
    } catch (e) { console.warn(`[feed ${sub.url}] ${e}`); }
  }

  let briefMd: string;
  try {
    briefMd = await invokeSubagent({
      subagent_def: "brief",
      prompt: `## interests\n${interests}\n\n## date\n${todayStr()}\n\n## items\n${JSON.stringify(items, null, 2)}`,
      allowed_slug_prefixes: ["personal-rss/"],
      timeout_ms: 240_000,
    });
  } catch (e) {
    briefMd = `# Daily Brief — ${todayStr()}\n\n_(brief subagent failed: ${e})_\n\n` + items.map(i => `- [${i.title}](${i.url})`).join("\n");
  }

  await putPage(`personal-rss/daily/${todayStr()}`, {}, briefMd.trim() + "\n");
  console.log(`[runDaily] wrote personal-rss/daily/${todayStr()} (${items.length} items considered)`);
}
```

That's the whole pipeline. No `ItemFrontmatter`, no `BriefFrontmatter`, no `media/` writes, no inbox, no seen.

### T4 — Simplify `skills/personal-rss/SKILL.md`

4 actions only:
1. **Add a source** — append `<url> - <description>` line to `personal-rss/following.md`.
2. **Edit interests** — read/write `personal-rss/interests.md`.
3. **See today's brief** — `get_page("personal-rss/daily/<today>")`.
4. **See a past brief** — `get_page("personal-rss/daily/<date>")`.

No list-subscriptions action (user can open `following.md` in Obsidian). No inbox action.

### T5 — Verify + commit + push

```bash
cd gbrain-personal-rss
bun --bun tsc --noEmit          # clean
bun test                         # all remaining tests pass (just fetch-rss.test.ts → 4)
git add -A
git commit -m "v2 minimal: one-subagent pipeline, one fetch loop"
git push
```

---

## Dependency graph

```
[T1, T2, T4] ──→ T3 ──→ T5
```

T1, T2, T4 are independent file-level changes. T3 (pipeline rewrite) needs T2 (brief subagent exists). T5 is the final gate.

---

## Out of scope for this plan

Everything in SPEC §"Out of scope". This plan is the demo bar.
