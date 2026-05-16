import express from "express";
import { marked } from "marked";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getPage, listPages } from "../src/orchestrator/brain";

const PORT = Number(process.env.PERSONAL_RSS_PORT ?? 7777);
const app = express();

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function render(content: string, dateLabel: string): string {
  const shellPath = join(import.meta.dir, "index.html");
  if (!existsSync(shellPath)) return content;
  return readFileSync(shellPath, "utf8")
    .replace("{{CONTENT}}", content)
    .replace("{{DATE}}", dateLabel);
}

app.get("/", (_req, res) => res.redirect(`/brief/${todayStr()}`));

app.get("/brief/:date", async (req, res) => {
  try {
    const page = await getPage(`personal-rss/daily/${req.params.date}`);
    if (!page) return res.status(404).send(render(`<p>No brief for ${req.params.date}.</p>`, req.params.date));
    res.send(render(marked.parse(page.body) as string, req.params.date));
  } catch (e: any) {
    res.status(500).send(render(`<pre>${e?.message ?? e}</pre>`, req.params.date));
  }
});

app.get("/briefs", async (_req, res) => {
  try {
    const slugs = await listPages("personal-rss/daily/");
    const dates = slugs.map(s => s.replace(/^personal-rss\/daily\//, "")).sort().reverse();
    const list = dates.map(d => `<li><a href="/brief/${d}">${d}</a></li>`).join("");
    res.send(render(`<h1>Briefs</h1><ul>${list || "<li><em>none yet</em></li>"}</ul>`, "index"));
  } catch (e: any) {
    res.status(500).send(render(`<pre>${e?.message ?? e}</pre>`, "index"));
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`gbrain-personal-rss web → http://127.0.0.1:${PORT}`);
});
