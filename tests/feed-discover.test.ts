import { expect, test, describe } from "bun:test";
import { discoverFeedFromUrl, discoverFeedFromHtml } from "../scripts/feed-discover";

describe("discoverFeedFromUrl (pure URL heuristics)", () => {
  test("URL with .xml extension is treated as a feed", () => {
    expect(discoverFeedFromUrl("https://example.com/rss.xml")).toBe("https://example.com/rss.xml");
  });
  test("URL ending in /feed is treated as a feed", () => {
    expect(discoverFeedFromUrl("https://example.com/feed")).toBe("https://example.com/feed");
  });
  test("YouTube channel handle rewrites to feed URL", () => {
    const out = discoverFeedFromUrl("https://www.youtube.com/@DwarkeshPatel");
    expect(out).toBe("https://www.youtube.com/feeds/videos.xml?user=DwarkeshPatel");
  });
  test("YouTube channel id rewrites to feed URL", () => {
    const out = discoverFeedFromUrl("https://www.youtube.com/channel/UCexample");
    expect(out).toBe("https://www.youtube.com/feeds/videos.xml?channel_id=UCexample");
  });
  test("Substack root rewrites to <root>/feed", () => {
    expect(discoverFeedFromUrl("https://anything.substack.com")).toBe("https://anything.substack.com/feed");
    expect(discoverFeedFromUrl("https://anything.substack.com/")).toBe("https://anything.substack.com/feed");
  });
  test("Unknown plain URL returns null (must use HTML discovery)", () => {
    expect(discoverFeedFromUrl("https://example.com/some/article")).toBe(null);
  });
});

describe("discoverFeedFromHtml", () => {
  test("finds <link rel=\"alternate\" type=\"application/rss+xml\">", () => {
    const html = `<html><head><link rel="alternate" type="application/rss+xml" href="https://example.com/rss"></head></html>`;
    expect(discoverFeedFromHtml(html, "https://example.com/")).toBe("https://example.com/rss");
  });
  test("finds Atom link", () => {
    const html = `<head><link rel="alternate" type="application/atom+xml" href="/atom.xml"></head>`;
    expect(discoverFeedFromHtml(html, "https://example.com/post/x")).toBe("https://example.com/atom.xml");
  });
  test("returns null when no feed link present", () => {
    expect(discoverFeedFromHtml(`<html><body>no feed</body></html>`, "https://example.com/")).toBe(null);
  });
});
