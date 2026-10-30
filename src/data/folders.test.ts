import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { folderChoice, MAX_FOLDER_NAME, NO_FOLDER, normaliseFolderName, totalOf, type FolderCounts } from "./folders";

describe("folder names", () => {
  test("are trimmed and inner whitespace is collapsed", () => {
    assert.equal(normaliseFolderName("  Beach   day \n"), "Beach day");
  });

  test("an empty name is refused with a sentence", () => {
    assert.throws(() => normaliseFolderName("   "), /Give the folder a name/);
    assert.throws(() => normaliseFolderName(undefined), /Give the folder a name/);
  });

  test("a name past the cap is refused, and the cap is said", () => {
    assert.throws(() => normaliseFolderName("x".repeat(MAX_FOLDER_NAME + 1)), new RegExp(String(MAX_FOLDER_NAME)));
    assert.equal(normaliseFolderName("x".repeat(MAX_FOLDER_NAME)).length, MAX_FOLDER_NAME);
  });
});

describe("folderChoice", () => {
  test("nothing means the caller did not say", () => {
    assert.equal(folderChoice(undefined), undefined);
    assert.equal(folderChoice(""), undefined);
    assert.equal(folderChoice(null), undefined);
  });

  test(`"${NO_FOLDER}" means not in a folder`, () => {
    assert.equal(folderChoice(NO_FOLDER), null);
  });

  test("a uuid is passed through, anything else is refused rather than guessed", () => {
    const id = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
    assert.equal(folderChoice(` ${id} `), id);
    assert.throws(() => folderChoice("beach"), /does not exist/);
    assert.throws(() => folderChoice("'; drop table folders; --"), /does not exist/);
  });
});

describe("totalOf", () => {
  test("adds one kind across every folder, including the unfiled bucket", () => {
    const counts: FolderCounts = { "": { image: 3, clip: 1 }, a: { image: 2 }, b: { clip: 4, reel: 1 } };
    assert.equal(totalOf(counts, "image"), 5);
    assert.equal(totalOf(counts, "clip"), 5);
    assert.equal(totalOf(counts, "reel"), 1);
    assert.equal(totalOf({}, "image"), 0);
  });
});
