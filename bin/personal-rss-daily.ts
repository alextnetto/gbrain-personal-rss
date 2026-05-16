#!/usr/bin/env bun
import { runDaily } from "../src/orchestrator/pipeline";

runDaily().catch(err => {
  console.error("[personal-rss-daily] fatal:", err);
  process.exit(1);
});
