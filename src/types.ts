// Shared types for the v2-minimal pipeline.

export interface FollowingEntry {
  url: string;
  description: string;
}

export interface BriefItem {
  url: string;
  title: string;
  source: string;             // following.md URL this came from
  source_description: string; // per-source description
  body: string;               // ≤ 4000 chars of stripped article text
}
