import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  cleanHookText,
  dedupeHookTexts,
  hookFilterSpec,
  hooksHref,
  hookUseLabels,
  isUsedHook,
  likePattern,
  matchesHookFilter,
  normaliseHookText,
  parseHookFilter,
  parseHookQuery,
  hookUseHref,
  type HookMarks,
} from "./hook-rules";

const fresh: HookMarks = { archivedAt: null, usedReelAt: null, usedCarouselAt: null, copiedAt: null };
const now = new Date("2026-09-24T12:00:00Z");

describe("hook filters", () => {
  test("an unknown or missing filter is 'not used yet'", () => {
    assert.equal(parseHookFilter(undefined), "unused");
    assert.equal(parseHookFilter("nonsense"), "unused");
    assert.equal(parseHookFilter(["archived", "used"]), "archived");
  });

  test("a search is trimmed, collapsed and capped", () => {
    assert.equal(parseHookQuery("  never   film "), "never film");
    assert.equal(parseHookQuery("x".repeat(500)).length, 100);
    assert.equal(parseHookQuery(undefined), "");
  });

  test("archived hooks leave the two working views and show in Archived and All", () => {
    const archived = { ...fresh, archivedAt: now };
    assert.equal(matchesHookFilter(archived, "unused"), false);
    assert.equal(matchesHookFilter(archived, "used"), false);
    assert.equal(matchesHookFilter(archived, "archived"), true);
    assert.equal(matchesHookFilter(archived, "all"), true);
    assert.deepEqual(hookFilterSpec("all"), { archived: null, used: null });
  });

  test("a reel, a carousel or a copy each count as used", () => {
    for (const mark of ["usedReelAt", "usedCarouselAt", "copiedAt"] as const) {
      const hook = { ...fresh, [mark]: now };
      assert.equal(isUsedHook(hook), true);
      assert.equal(matchesHookFilter(hook, "used"), true);
      assert.equal(matchesHookFilter(hook, "unused"), false);
    }
    assert.equal(matchesHookFilter(fresh, "unused"), true);
  });

  test("the marks name what the hook became, in a fixed order", () => {
    assert.deepEqual(hookUseLabels(fresh), []);
    assert.deepEqual(hookUseLabels({ ...fresh, copiedAt: now, usedReelAt: now }), ["Reel", "Copied"]);
  });
});

describe("duplicate hooks", () => {
  test("compare trimmed and case-insensitively, like the database index", () => {
    assert.equal(normaliseHookText("  I Stopped Filming "), normaliseHookText("i stopped filming"));
  });

  test("are stored with runs of space made one, and their line breaks kept", () => {
    assert.equal(cleanHookText("  one   two\t three "), "one two three");
    assert.equal(cleanHookText("I stopped \r\n six months ago\n\n\n\nStill here"), "I stopped\nsix months ago\n\nStill here");
  });

  test("a batch keeps each hook once, the first spelling, and drops blanks", () => {
    assert.deepEqual(dedupeHookTexts(["First line", "  first LINE ", "", "   ", "Second"]), ["First line", "Second"]);
  });
});

describe("links and search", () => {
  test("the page's URL leaves the defaults out", () => {
    assert.equal(hooksHref("unused"), "/hooks");
    assert.equal(hooksHref("archived", "gym"), "/hooks?show=archived&q=gym");
  });

  test("Use sends the words, the id and the tab to Create", () => {
    const href = hookUseHref({ id: "abc", text: "I stopped & started" }, "slides");
    const url = new URL(href, "https://example.test");
    assert.equal(url.pathname, "/create");
    assert.equal(url.searchParams.get("hook"), "I stopped & started");
    assert.equal(url.searchParams.get("hookId"), "abc");
    assert.equal(url.searchParams.get("tab"), "slides");
  });

  test("wildcards typed in the search box are matched literally", () => {
    assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%");
  });
});
