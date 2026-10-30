import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { libraryHref } from "./paths";

describe("libraryHref", () => {
  test("the two tabs, with nothing else", () => {
    assert.equal(libraryHref("photos"), "/library");
    assert.equal(libraryHref("videos"), "/library/videos");
  });

  test("a folder rides along, and 'none' is a folder choice too", () => {
    assert.equal(libraryHref("videos", "abc"), "/library/videos?folder=abc");
    assert.equal(libraryHref("photos", "none"), "/library?folder=none");
    assert.equal(libraryHref("photos", null), "/library");
    assert.equal(libraryHref("photos", undefined), "/library");
  });

  test("extra parameters are appended and encoded", () => {
    assert.equal(libraryHref("videos", "abc", { animate: "x y" }), "/library/videos?folder=abc&animate=x+y");
    assert.equal(libraryHref("videos", undefined, { animate: "id" }), "/library/videos?animate=id");
  });
});
