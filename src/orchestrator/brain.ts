// Wrapper around the gBrain library so the rest of the orchestrator stays clean.
// The `waitForCompletion` import is a deep path — not in gbrain's exports map. If it
// ever breaks we vendor the file (it's ~50 lines).

// @ts-ignore — gbrain types are project-local, install via `bun link gbrain` in install.sh
import { createEngine } from "gbrain/engine-factory";
// @ts-ignore
import { MinionQueue } from "gbrain/minions";
// @ts-ignore
import { operations } from "gbrain/operations";
// @ts-ignore
import { loadConfig } from "gbrain/config";
// @ts-ignore — deep import; see GBRAIN_INTEGRATION.md
import { waitForCompletion } from "gbrain/src/core/minions/wait-for-completion.ts";
import matter from "gray-matter";

let engine: any | null = null;
let queue: any | null = null;
let putPageOp: any | null = null;

const SOURCE_ID = process.env.GBRAIN_SOURCE_ID ?? "default";

async function init() {
  if (engine) return;
  const config = loadConfig();
  if (!config) throw new Error("gBrain config not found. Run `gbrain init` in your brain root first.");
  engine = await createEngine(config);
  await engine.connect({});
  putPageOp = operations.find((o: any) => o.name === "put_page");
  if (!putPageOp) throw new Error("gBrain operations registry missing put_page");
  queue = new MinionQueue(engine);
}

function makeCtx() {
  return { engine, config: loadConfig()!, logger: console, dryRun: false, remote: false, sourceId: SOURCE_ID };
}

export interface PageFrontmatter { [key: string]: unknown }

export async function getPage(slug: string): Promise<{ frontmatter: PageFrontmatter; body: string } | null> {
  await init();
  const page = await engine.getPage(slug, { sourceId: SOURCE_ID });
  if (!page) return null;
  const parsed = matter(page.content);
  return { frontmatter: parsed.data, body: parsed.content };
}

export async function putPage(slug: string, frontmatter: PageFrontmatter, body: string): Promise<void> {
  await init();
  const content = matter.stringify(body, frontmatter);
  await putPageOp.handler(makeCtx() as any, { slug, content });
}

export async function listPages(prefix: string): Promise<string[]> {
  await init();
  const listOp = operations.find((o: any) => o.name === "list_pages");
  if (!listOp) throw new Error("gBrain operations registry missing list_pages");
  const result = await listOp.handler(makeCtx() as any, { prefix });
  // result shape may be { pages: [{slug}, ...] } or [{slug}, ...]; normalize:
  const pages = Array.isArray(result) ? result : result?.pages ?? [];
  return pages.map((p: any) => p.slug ?? p.id ?? p);
}

export interface SubagentInvocation {
  subagent_def: string;          // matches `name:` in subagent .md
  prompt: string;
  allowed_slug_prefixes?: string[];
  timeout_ms?: number;
}

export async function invokeSubagent(opts: SubagentInvocation): Promise<string> {
  await init();
  const data: any = {
    prompt: opts.prompt,
    subagent_def: opts.subagent_def,
  };
  if (opts.allowed_slug_prefixes) data.allowed_slug_prefixes = opts.allowed_slug_prefixes;

  const job = await queue.add(
    "subagent",
    data,
    { max_stalled: 3 },
    { allowProtectedSubmit: true },
  );
  const done = await waitForCompletion(queue, job.id, { timeoutMs: opts.timeout_ms ?? 10 * 60_000 });
  if (done.status !== "completed") {
    throw new Error(`Subagent ${opts.subagent_def} ended in ${done.status}: ${JSON.stringify(done.result)}`);
  }
  // Subagent's final message text is at done.result.result per SubagentResult.
  const result = done.result as { result?: string };
  if (typeof result?.result !== "string") {
    throw new Error(`Subagent ${opts.subagent_def} returned non-string result: ${JSON.stringify(done.result)}`);
  }
  return result.result;
}
