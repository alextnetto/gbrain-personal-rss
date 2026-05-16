// One source of truth for the page frontmatter shapes used across orchestrator + subagents.

export interface Subscription {
  slug: string;                              // filename stem under subscriptions/
  feed_url: string;
  content_type_hint?: "podcast" | "youtube" | "blog" | "arxiv" | "auto";
  added_at: string;                          // ISO 8601
  last_fetched_at: string | null;
  etag: string | null;
}

export type ItemKind = "text" | "audio" | "video";

export interface ItemFrontmatter {
  source: string;                            // subscription slug
  published_at: string;                      // ISO 8601
  url: string;
  title: string;
  kind: ItemKind;
  duration?: number;                         // seconds, for audio/video
  score?: number;                            // 0–100, filled by score-item subagent
  why_it_matters?: string;                   // filled by score-item subagent
  transcript_chunks?: TranscriptChunk[];     // for audio/video
  transcription_failed?: boolean;
  extraction_failed?: boolean;
}

export interface TranscriptChunk {
  start: number;                             // seconds
  end: number;
  text: string;
}

export interface BriefFrontmatter {
  date: string;                              // YYYY-MM-DD
  items_considered: number;
  items_included_new: number;
  items_included_archive: number;
  scoring_model: string;
  estimated_total_minutes: number;
  generated_at: string;                      // ISO 8601
}

export interface ArchiveCandidate {
  item_slug: string;
  newly_relevant_because: string;
  triggered_by_new_item_slug: string;
}

// Output emitted by the score-item subagent (parsed from its final message).
export interface ScoreResult {
  score: number;
  why_it_matters: string;
}
