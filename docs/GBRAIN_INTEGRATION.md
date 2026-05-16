# gBrain Plugin and Subagent Integration Reference

This document is the source of truth for writing the `gbrain-personal-rss` plugin
and its subagent `.md` files. Every schema claim is tied to a file and line number
in the gbrain checkout at `/Users/netto/work/hackathons/yc-gbrain/gbrain/`.

**Read-only source checkout:** `/Users/netto/work/hackathons/yc-gbrain/gbrain/`
**Our plugin root:** `/Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss/`

---

## Plugin manifest format

Source: `src/core/minions/plugin-loader.ts` lines 37–45, 159–186.
Guide:   `docs/guides/plugin-authors.md` lines 19–28, 82–92.

### TypeScript interface (from plugin-loader.ts:39–45)

```ts
export interface PluginManifest {
  name: string;         // required
  version: string;      // required
  plugin_version: string; // required — must equal "gbrain-plugin-v1"
  subagents?: string;   // optional — subdir name, default "subagents"
  description?: string; // optional — shown in future "gbrain plugin list"
}
```

### Field details

| Field            | Type   | Required | Validation at load time                                                    |
|------------------|--------|----------|----------------------------------------------------------------------------|
| `name`           | string | YES      | Must be a non-empty string (`plugin-loader.ts:172`). Used in collision logs. |
| `version`        | string | YES      | Free-form semver. Informational only; not validated by the loader.         |
| `plugin_version` | string | YES      | Must equal exactly `"gbrain-plugin-v1"` (`plugin-loader.ts:175`). Any other value rejects the plugin at worker startup with a loud error. |
| `subagents`      | string | NO       | Relative path to subagent dir. Defaults to `"subagents"` (`plugin-loader.ts:181`). Path-traversal escape (e.g. `../`) is rejected (`plugin-loader.ts:183–185`). |
| `description`    | string | NO       | Stored on the manifest; currently unused at runtime. Future `gbrain plugin list`. |

### Version constant

```ts
// plugin-loader.ts:37
export const SUPPORTED_PLUGIN_VERSION = 'gbrain-plugin-v1';
```

### Values for `personal-rss`

```json
{
  "name": "gbrain-personal-rss",
  "version": "0.1.0",
  "plugin_version": "gbrain-plugin-v1",
  "description": "Personal AI-filtered content brief — RSS ingestion + daily digest subagents"
}
```

The `subagents` field is omitted, so the loader will look for `subagents/` inside
the plugin root (`plugin-loader.ts:181`).

---

## Subagent definition format

Source: `src/core/minions/plugin-loader.ts` lines 47–59, 188–226.
Guide:  `docs/guides/plugin-authors.md` lines 95–107.

### TypeScript interface (from plugin-loader.ts:47–59)

```ts
export interface SubagentDefinition {
  plugin_name: string;        // set by the loader from manifest.name
  name: string;               // from frontmatter.name, else file basename without .md
  source_path: string;        // absolute path to the .md file on disk
  frontmatter: Record<string, unknown>; // all YAML frontmatter fields
  body: string;               // markdown body — the system prompt content
  allowed_tools?: string[];   // from frontmatter.allowed_tools
}
```

### File format

Files are plain Markdown with YAML frontmatter (parsed via `gray-matter`,
`plugin-loader.ts:33,195`).

```markdown
---
name: <subagent-identifier>
model: <anthropic-model-id>
max_turns: <number>
allowed_tools:
  - <tool-name-1>
  - <tool-name-2>
---

<System prompt body here. This becomes the subagent's system prompt.>
```

### Frontmatter fields

| Field           | Type     | Required | Notes                                                                                        |
|-----------------|----------|----------|----------------------------------------------------------------------------------------------|
| `name`          | string   | NO       | Stable agent identifier used as `--subagent-def` by callers. Defaults to filename without `.md` (`plugin-loader.ts:198–200`). |
| `model`         | string   | NO       | Anthropic model string. Defaults to the handler default (sonnet). Example: `claude-sonnet-4-6`. |
| `max_turns`     | number   | NO       | Cap on assistant turns. Defaults to 20 per the handler. Stored in frontmatter, consumed by `subagent.ts`. |
| `allowed_tools` | string[] | NO       | Tool names the subagent may call. Must be a subset of the brain tool registry (`plugin-loader.ts:201–203`). Validated at load time against `validAgentToolNames` (`plugin-loader.ts:205–210`). Unknown names cause a loud error at **worker startup**, not at dispatch time. |

### Body convention

The body (everything after the closing `---` of the frontmatter) becomes the
system prompt content. No special delimiters required. Any valid Markdown is
accepted. The body is stored in `SubagentDefinition.body` (`plugin-loader.ts:197`).

### Naming the subagent

The `name` frontmatter field becomes the `--subagent-def` value CLI callers use.
If omitted, the loader uses `entry.replace(/\.md$/, '')` — the filename without
the `.md` extension (`plugin-loader.ts:198–200`). For example, `rss-fetch.md`
produces subagent name `rss-fetch`.

### Unknown frontmatter fields

Unknown fields are preserved in `SubagentDefinition.frontmatter` but are otherwise
ignored by the handler in v0.15 (`plugin-authors.md:106`). Future versions may
consume additional fields.

---

## GBRAIN_PLUGIN_PATH discovery

Source: `src/core/minions/plugin-loader.ts` lines 1–16, 81–130.
Guide:  `docs/guides/plugin-authors.md` lines 47–56.

### Separator

Colon-separated, exactly like Unix `$PATH`:

```bash
export GBRAIN_PLUGIN_PATH="/path/to/plugin-a:/path/to/plugin-b"
```

Parsed at `plugin-loader.ts:83`:

```ts
const paths = raw.split(':').map(s => s.trim()).filter(Boolean);
```

### Path validation rules (enforced by `rejectIfNotAbsolute`, plugin-loader.ts:132–143)

| Condition                                     | Behavior                                      |
|-----------------------------------------------|-----------------------------------------------|
| Remote URL (`http://`, `https://`, `file://`) | Rejected with warning, plugin skipped         |
| `~`-prefixed path                             | Rejected — must be expanded explicitly        |
| Relative path (does not start with `/`)       | Rejected                                      |
| Non-existent path                             | Warning logged, skipped — does NOT crash worker (`plugin-loader.ts:93–95`) |
| Path exists but is not a directory            | Warning logged, skipped (`plugin-loader.ts:97–99`) |

### What counts as a valid plugin root

A valid plugin root is an absolute-path directory containing a `gbrain.plugin.json`
file (`plugin-loader.ts:159–160`). The manifest must parse as valid JSON, have a
non-empty `name`, and have `plugin_version` equal to `"gbrain-plugin-v1"`.

### Collision policy

Left-wins: the plugin listed first in `GBRAIN_PLUGIN_PATH` wins when two plugins
ship a subagent with the same `name` (`plugin-loader.ts:87–88, 111–116`). The
losing plugin's subagent is dropped with a warning naming both sources.

### For our plugin

```bash
export GBRAIN_PLUGIN_PATH="/Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss"
```

The loader expects `gbrain.plugin.json` at
`/Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss/gbrain.plugin.json`
and subagent files at
`/Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss/subagents/*.md`.

---

## Available tools for subagents

Source: `src/core/minions/tools/brain-allowlist.ts` lines 47–66.
Guide:  `docs/guides/plugin-authors.md` lines 67–74.

### The allow-list (brain-allowlist.ts:47–66)

These are the only tool names a subagent can reference in its `allowed_tools`
frontmatter field. The loader validates this against the derived registry at
worker startup.

| Op name (registry internal) | Tool name as seen by the LLM | Category     | Notes                                         |
|-----------------------------|------------------------------|--------------|-----------------------------------------------|
| `query`                     | `brain_query`                | Read         | Full-text + vector query with answer generation |
| `search`                    | `brain_search`               | Read         | Hybrid search, returns ranked pages            |
| `get_page`                  | `brain_get_page`             | Read         | Fetch a single page by slug                    |
| `list_pages`                | `brain_list_pages`           | Read         | List pages with optional filters               |
| `file_list`                 | `brain_file_list`            | Read         | List uploaded files                            |
| `file_url`                  | `brain_file_url`             | Read         | Get a signed URL for an uploaded file          |
| `get_backlinks`             | `brain_get_backlinks`        | Read         | Find pages linking to a given slug             |
| `traverse_graph`            | `brain_traverse_graph`       | Read         | Graph traversal from a slug                    |
| `resolve_slugs`             | `brain_resolve_slugs`        | Read         | Resolve slugs to page metadata                 |
| `get_ingest_log`            | `brain_get_ingest_log`       | Read         | Recent ingestion log entries                   |
| `put_page`                  | `brain_put_page`             | Conditional write | Write a page; namespace-enforced (see below) |
| `get_recent_salience`       | `brain_get_recent_salience`  | Read         | Pages ranked by emotional + activity salience (v0.29) |
| `find_anomalies`            | `brain_find_anomalies`       | Read         | Cohort-level activity outliers (v0.29)         |

### How tool names are formed

The loader prefixes op names with `brain_` (`brain-allowlist.ts:75–76`):

```ts
const prefixed = `brain_${opName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
```

So `search` becomes `brain_search`, `get_page` becomes `brain_get_page`, etc.

### Specifying tools in frontmatter

You may use either the prefixed name (`brain_search`) or the bare op name
(`search`) — `filterAllowedTools` checks both (`brain-allowlist.ts:257–259`):

```yaml
allowed_tools:
  - brain_search
  - brain_get_page
  - brain_put_page
```

Or equivalently:

```yaml
allowed_tools:
  - search
  - get_page
  - put_page
```

### `put_page` namespace enforcement

By default, a subagent can ONLY write under `wiki/agents/<subagentId>/`.
This is enforced both in the JSONSchema shown to the model (via a `pattern`
field) AND server-side in the operation handler (`brain-allowlist.ts:100–133`).

The trusted-workspace path (`allowedSlugPrefixes`, v0.23) overrides the
default namespace and is only available when the job is submitted via
`PROTECTED_JOB_NAMES` (the dream cycle, CLI — NOT via MCP).

### Tools NOT available to subagents

Tools conspicuously absent from the allow-list:

- `get_recent_transcripts` — deliberately excluded because subagent calls always
  run with `ctx.remote === true` and the v0.29 trust gate rejects remote callers.
  Adding it would produce `permission_denied` at runtime (`brain-allowlist.ts:61–64`).
- `submit_job`, `file_upload`, `sync_brain` — these are admin/local-only ops.
- Shell execution — there is no shell tool available to subagents (see next section).

---

## Calling shell from a subagent

Source: `src/core/minions/handlers/shell.ts` (built-in handler).
Guide:  `docs/guides/plugin-authors.md` lines 67–74.

**Subagents cannot call shell directly.** Shell execution is a separate Minion
handler (`shell`), not a tool in the brain allow-list. A subagent's `allowed_tools`
is constrained to the 13 brain ops above.

To run shell commands from a workflow, submit a separate `shell` job (from the
CLI or a parent orchestrator, not from inside a subagent). The shell handler
requires `GBRAIN_ALLOW_SHELL_JOBS=1` on the worker and uses a restricted env
allowlist: `PATH, HOME, USER, LANG, TZ, NODE_ENV` plus any `env:` overrides in
the job params.

If our `personal-rss` subagents need to fetch RSS feeds, they must do so via
brain tools (e.g., store a URL and have the orchestrator fetch externally), or
the fetch must be done by a sibling `shell` job. Subagents themselves have no
network-fetch capability beyond what brain tools provide.

---

## Trust boundary notes

Source: `src/core/minions/plugin-loader.ts` lines 22–30.
Source: `src/core/minions/tools/brain-allowlist.ts` lines 188–197.
Source: `docs/guides/plugin-authors.md` lines 121–134.

### `OperationContext.remote` is always `true` for subagents

```ts
// brain-allowlist.ts:188
remote: true,   // match MCP trust boundary for auto-link skip
```

This is hardcoded and cannot be overridden by a plugin. It means:

- **`put_page` auto-link is skipped.** Auto-link only fires when `remote === false`
  (trusted local caller). Subagent page writes do not auto-extract links.
- **`file_upload` strict confinement applies.** Even though we are "local", the
  subagent runs as `remote=true` and gets filesystem confinement.
- **`put_page` namespace check fires.** `viaSubagent: true` is set alongside
  `remote: true`, so the slug must match `wiki/agents/<id>/...` or the
  `allowedSlugPrefixes` list.

### `ctx.remote === true` vs `ctx.remote === false` semantics

As of v0.26.9 D12, `OperationContext.remote` is a REQUIRED field typed as a
boolean (not optional). The compiler enforces it. The trust boundary uses
fail-closed semantics: anything that is not strictly `false` is treated as
remote/untrusted.

```ts
// Trusted-only sites check: ctx.remote === false
// Untrusted sites check:    ctx.remote !== false
```

### Operations gated by `remote: true`

From the CLAUDE.md commentary on `src/core/operations.ts`:

- `get_recent_transcripts` — rejects `ctx.remote === true` callers. Not in
  the subagent allow-list for this reason.
- `file_upload` — tightens filesystem confinement to the working directory
  when `remote=true`.
- `submit_job` with protected names — rejects `remote=true` callers. Subagents
  cannot submit shell jobs, autopilot-cycle jobs, or other protected names.

### `allowedSlugPrefixes` and the trusted-workspace path

The `allowedSlugPrefixes` field on `BuildBrainToolsOpts` (`brain-allowlist.ts:163–165`)
is set by the caller of the subagent handler (the dream cycle, etc.). Plugins
cannot set this from their subagent definitions. Trust comes from the job being
submitted via `PROTECTED_JOB_NAMES`, which MCP cannot reach.

---

## Examples found

### Example 1: Minimum viable plugin from plugin-authors.md

Source: `/Users/netto/work/hackathons/yc-gbrain/gbrain/docs/guides/plugin-authors.md` lines 19–37.

`gbrain.plugin.json`:
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "plugin_version": "gbrain-plugin-v1"
}
```

`subagents/my-summarizer.md`:
```markdown
---
name: my-summarizer
model: claude-sonnet-4-6
allowed_tools:
  - brain_search
  - brain_get_page
---

You are a brain page summarizer. Given a slug, fetch the page and produce
a 3-sentence summary.
```

### Example 2: Downstream-OpenClaw plugin from plugin-authors.md

Source: `/Users/netto/work/hackathons/yc-gbrain/gbrain/docs/guides/plugin-authors.md` lines 134–163.

```
~/your-openclaw/
└── gbrain-plugin/
    ├── gbrain.plugin.json
    └── subagents/
        ├── meeting-ingestion.md
        ├── signal-detector.md
        └── daily-task-prep.md
```

`gbrain.plugin.json`:
```json
{
  "name": "your-openclaw",
  "version": "2026.4.20",
  "plugin_version": "gbrain-plugin-v1",
  "description": "Your OpenClaw's personal-brain subagents"
}
```

Environment:
```bash
export GBRAIN_PLUGIN_PATH="$HOME/your-openclaw/gbrain-plugin"
```

### Note on `openclaw.plugin.json` in the gbrain repo root

The file `/Users/netto/work/hackathons/yc-gbrain/gbrain/openclaw.plugin.json`
is a **different format** — it is an OpenClaw bundle-plugin manifest (the
`"family": "bundle-plugin"` field), NOT a gbrain subagent plugin. It follows the
OpenClaw plugin API (`>= 2026.4.0`), not the `gbrain-plugin-v1` contract. Do not
use it as a template for `gbrain.plugin.json`.

---

## Summary of what downstream tasks (7–13) must do

### Task 7: Write `gbrain.plugin.json`

```json
{
  "name": "gbrain-personal-rss",
  "version": "0.1.0",
  "plugin_version": "gbrain-plugin-v1",
  "description": "Personal AI-filtered content brief — RSS ingestion + daily digest subagents"
}
```

Place at: `/Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss/gbrain.plugin.json`

### Tasks 8–13: Write subagent `.md` files

Files go in: `/Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss/subagents/`

Each file must:
1. Start with YAML frontmatter (between `---` delimiters)
2. Include `name:` matching the intended `--subagent-def` value
3. Include `allowed_tools:` listing only tools from the allow-list above
4. Use tool names with or without the `brain_` prefix — both are accepted
5. Have a body that is the system prompt

For read-only subagents (RSS fetch, scoring, digest rendering), use:
```yaml
allowed_tools:
  - brain_search
  - brain_get_page
  - brain_list_pages
```

For the digest writer subagent (needs to write pages), use:
```yaml
allowed_tools:
  - brain_search
  - brain_get_page
  - brain_put_page
```

The `brain_put_page` write will be constrained to `wiki/agents/<id>/...` by default.
If the digest needs to write to a custom path (e.g. `daily-brief/`), the job must
be submitted with `allowedSlugPrefixes` from a trusted CLI context, not via MCP.

### Activating the plugin

```bash
export GBRAIN_PLUGIN_PATH="/Users/netto/work/hackathons/yc-gbrain/gbrain-personal-rss"
gbrain jobs work  # worker startup prints: [plugin-loader] loaded plugin gbrain-personal-rss with N subagents
```

---

## Inferred vs verified claims

The following claims are **directly verified** from source:
- `plugin_version` must be `"gbrain-plugin-v1"` (plugin-loader.ts:37,175)
- Path separator is `:` (plugin-loader.ts:83)
- Tool names are prefixed with `brain_` (brain-allowlist.ts:75)
- Bare op names also work in `allowed_tools` (brain-allowlist.ts:256–259)
- All 13 tool names in the allow-list (brain-allowlist.ts:47–66)
- `remote: true` is hardcoded for subagent tool calls (brain-allowlist.ts:188)
- `allowed_tools` is validated at worker startup, not at dispatch time (plugin-loader.ts:205–210)
- `name` defaults to filename without `.md` (plugin-loader.ts:198–200)
- `subagents` directory defaults to `"subagents"` (plugin-loader.ts:181)

The following is **inferred** (no explicit test found but consistent with the code):
- The `model` frontmatter field is stored and consumed by the subagent handler
  (`src/core/minions/handlers/subagent.ts`). The plugin-authors guide lists it
  as a recognized field with example `claude-sonnet-4-6`, but the field name is
  not explicitly named in `plugin-loader.ts`'s parsing loop — the loader stores
  all frontmatter in `SubagentDefinition.frontmatter` and the handler reads it.
  Use `model: claude-sonnet-4-6` as documented in plugin-authors.md.
- `max_turns` similarly — listed in plugin-authors.md, stored via frontmatter,
  consumed by the handler. Not explicitly extracted in the loader.
