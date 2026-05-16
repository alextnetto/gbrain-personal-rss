import { expect, test, describe } from "bun:test";
import { readFileSync } from "fs";
import { detectContentType } from "../scripts/content-type-detect";

const fx = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");

describe("detectContentType", () => {
  test("iTunes podcast feed → audio", () => {
    expect(detectContentType(fx("podcast-feed.xml"), "https://example.com/podcast.xml")).toBe("audio");
  });
  test("YouTube channel feed → video", () => {
    expect(detectContentType(fx("youtube-channel.xml"), "https://www.youtube.com/feeds/videos.xml?channel_id=UCexample")).toBe("video");
  });
  test("Plain blog RSS → text", () => {
    expect(detectContentType(fx("blog-feed.xml"), "https://example.com/feed.xml")).toBe("text");
  });
  test("arXiv Atom feed → text", () => {
    expect(detectContentType(fx("arxiv-feed.xml"), "http://export.arxiv.org/rss/cs.AI")).toBe("text");
  });
  test("URL hint wins when content is ambiguous", () => {
    const ambiguous = `<?xml version="1.0"?><rss><channel><item><title>x</title></item></channel></rss>`;
    expect(detectContentType(ambiguous, "https://anchor.fm/s/abc/podcast/rss")).toBe("audio");
  });
});
