import { expect, test, describe } from "bun:test";
import { readFileSync } from "fs";
import { parseRssItems } from "../scripts/fetch-rss";

const fx = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");

describe("parseRssItems", () => {
  test("RSS 2.0: returns one item per <item>", () => {
    const items = parseRssItems(fx("blog-feed.xml"));
    expect(items.length).toBe(1);
    expect(items[0].url).toBe("https://example.com/posts/a-post");
    expect(items[0].title).toBe("A Post");
  });
  test("Atom: returns one item per <entry>", () => {
    const items = parseRssItems(fx("arxiv-feed.xml"));
    expect(items.length).toBe(1);
    expect(items[0].url).toBe("http://arxiv.org/abs/2601.00001v1");
  });
  test("extracts enclosure URL and duration for podcast items", () => {
    const items = parseRssItems(fx("podcast-feed.xml"));
    expect(items[0].enclosure_url).toBe("https://example.com/ep42.mp3");
    expect(items[0].duration).toBe(1834);
  });
  test("ids are slug-safe (hashes URL-shaped guids)", () => {
    const items = parseRssItems(fx("blog-feed.xml"));
    expect(items[0].id).toMatch(/^[a-zA-Z0-9_-]{1,80}$/);
    expect(items[0].id.length).toBeGreaterThan(8);
  });
});
