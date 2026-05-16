import type { ItemKind } from "../src/types";

// Returns the dominant content type of a feed. URL host/path hints first,
// then iTunes/YouTube namespace markers, then enclosure mime types, default text.
export function detectContentType(feedXml: string, feedUrl: string): ItemKind {
  const url = feedUrl.toLowerCase();
  if (/anchor\.fm|libsyn|simplecast|megaphone|art19|podbean|buzzsprout|transistor\.fm/.test(url)) return "audio";
  if (/youtube\.com\/feeds\/videos\.xml|youtube\.com\/channel|youtu\.be/.test(url)) return "video";
  if (/xmlns:itunes=/.test(feedXml)) return "audio";
  if (/xmlns:yt=|<yt:channelId>|<yt:videoId>/.test(feedXml)) return "video";
  if (/<enclosure[^>]*type="audio\//i.test(feedXml)) return "audio";
  if (/<enclosure[^>]*type="video\//i.test(feedXml)) return "video";
  return "text";
}
