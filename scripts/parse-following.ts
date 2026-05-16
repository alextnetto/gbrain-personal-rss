import type { FollowingEntry } from "../src/types";

// Parse the content of personal-rss/following.md.
// Format: one entry per line, "<url> - <description>".
// - URL is everything up to the first " - ".
// - Description is whatever follows (may itself contain " - ").
// - Lines starting with "#" and blank lines are skipped.
// - Lines that don't start with "http" are skipped.
export function parseFollowing(src: string): FollowingEntry[] {
  const out: FollowingEntry[] = [];
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (!/^https?:\/\//i.test(line)) continue;
    const sep = line.indexOf(" - ");
    if (sep === -1) {
      out.push({ url: line, description: "" });
    } else {
      out.push({ url: line.slice(0, sep).trim(), description: line.slice(sep + 3).trim() });
    }
  }
  return out;
}
