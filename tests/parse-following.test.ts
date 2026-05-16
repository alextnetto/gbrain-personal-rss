import { expect, test, describe } from "bun:test";
import { parseFollowing } from "../scripts/parse-following";

describe("parseFollowing", () => {
  test("parses a single URL + description line", () => {
    const out = parseFollowing("https://example.com/feed - blogs about X");
    expect(out).toEqual([{ url: "https://example.com/feed", description: "blogs about X" }]);
  });
  test("parses multiple lines", () => {
    const src = `https://a.example/feed - aaa
https://b.example/feed - bbb`;
    const out = parseFollowing(src);
    expect(out.length).toBe(2);
    expect(out[0].url).toBe("https://a.example/feed");
    expect(out[1].description).toBe("bbb");
  });
  test("skips blank lines and # comments", () => {
    const src = `# this is a comment
https://a.example/feed - aaa

https://b.example/feed - bbb
# end`;
    const out = parseFollowing(src);
    expect(out.length).toBe(2);
  });
  test("description is empty string when missing", () => {
    const out = parseFollowing("https://example.com/feed");
    expect(out[0].description).toBe("");
  });
  test("URL with embedded dash in description preserved", () => {
    const out = parseFollowing("https://example.com/feed - long-form interviews - top quality");
    expect(out[0].url).toBe("https://example.com/feed");
    expect(out[0].description).toBe("long-form interviews - top quality");
  });
  test("skips lines that don't start with http", () => {
    const src = `not a url
https://example.com/feed - real
also not a url`;
    const out = parseFollowing(src);
    expect(out.length).toBe(1);
    expect(out[0].url).toBe("https://example.com/feed");
  });
});
