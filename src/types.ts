// One source of truth for the page frontmatter shapes used across orchestrator + subagents.

// ---------- Inputs (user-authored, plain markdown) ----------

// A single parsed line from personal-rss/following.md
export interface FollowingEntry {
  url: string;            // feed URL or page URL (auto-discover applies)
  description: string;    // per-source interest context, e.g. "model releases, day-one"
}

// ---------- Items (machine-written into media/articles/, media/podcasts/) ----------

export type ItemKind = "text" | "audio" | "video";

export interface ItemFrontmatter {
  source_url: string;                 // URL of the item itself (the link)
  source: string;                     // following.md URL it came from, OR literal "inbox"
  title: string;
  published_at: string | null;        // ISO 8601; null if feed didn't provide one
  fetched_at: string;                 // ISO 8601
  kind: ItemKind;
  duration?: number;                  // seconds, for audio/video
  transcript_chunks?: TranscriptChunk[];
  score?: number;                     // 0–100, filled by score-item
  why_it_matters?: string;            // filled by score-item
  transcription_failed?: boolean;
  extraction_failed?: boolean;
}

export interface TranscriptChunk {
  start: number;                      // seconds
  end: number;
  text: string;
}

// ---------- Briefs (machine-written into personal-rss/daily/) ----------

export interface BriefFrontmatter {
  date: string;                       // YYYY-MM-DD
  items_considered: number;
  items_included_new: number;
  items_included_archive: number;
  items_from_inbox: number;
  scoring_model: string;
  estimated_total_minutes: number;
  generated_at: string;               // ISO 8601
}

// ---------- Subagent outputs (parsed from final message) ----------

export interface ScoreResult {
  score: number;
  why_it_matters: string;
}

export interface ArchiveCandidate {
  item_slug: string;                  // hash-based slug under media/
  newly_relevant_because: string;
  triggered_by_new_item_slug: string;
}
