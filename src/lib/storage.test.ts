import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { mediaPathname, userPrefix } from "./storage";
import { fsStorage } from "./storage-fs";
import { readAll } from "./stream";

describe("filesystem storage", () => {
  let root = "";
  let storage = fsStorage(tmpdir());

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "storage-test-"));
    storage = fsStorage(root);
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const body = Buffer.from("the quick brown fox jumps over the lazy dog");
  const path = mediaPathname("user_a", "image", "abc", "png");

  test("put reports what was stored", async () => {
    const stored = await storage.put(path, body, "image/png");
    assert.deepEqual(stored, { pathname: path, contentType: "image/png", bytes: body.byteLength });
  });

  test("get returns the whole object with its content type", async () => {
    const result = await storage.get(path);
    assert.equal(result.contentType, "image/png");
    assert.equal(result.bytes, body.byteLength);
    assert.equal((await readAll(result.stream)).toString(), body.toString());
  });

  test("get honours a byte range", async () => {
    const result = await storage.get(path, { start: 4, end: 8 });
    assert.equal(result.bytes, 5);
    assert.equal((await readAll(result.stream)).toString(), "quick");
  });

  test("a range past the end is clamped, not padded", async () => {
    const result = await storage.get(path, { start: body.byteLength - 3, end: body.byteLength + 100 });
    assert.equal(result.bytes, 3);
    assert.equal((await readAll(result.stream)).toString(), "dog");
  });

  test("a range that starts past the end is refused", async () => {
    await assert.rejects(() => storage.get(path, { start: body.byteLength, end: body.byteLength + 1 }));
  });

  test("cancelling the stream does not throw", async () => {
    const result = await storage.get(path);
    await result.stream.cancel();
  });

  test("signedUrl points at the stored bytes", async () => {
    const url = await storage.signedUrl(path, 60);
    assert.match(url, /^file:\/\//);
  });

  test("a pathname may not escape the root", async () => {
    await assert.rejects(() => storage.put("../escaped.png", body, "image/png"));
    await assert.rejects(() => storage.get("../../etc/passwd"));
  });

  test("delete removes the object and its content type", async () => {
    await storage.delete(path);
    await assert.rejects(() => storage.get(path));
  });

  test("deletePrefix removes everything under one user and nothing else", async () => {
    await storage.put(mediaPathname("user_a", "image", "1", "png"), body, "image/png");
    await storage.put(mediaPathname("user_a", "clip", "2", "mp4"), body, "video/mp4");
    const other = mediaPathname("user_b", "image", "3", "png");
    await storage.put(other, body, "image/png");

    await storage.deletePrefix(userPrefix("user_a"));

    await assert.rejects(() => storage.get(mediaPathname("user_a", "image", "1", "png")));
    await assert.rejects(() => storage.get(mediaPathname("user_a", "clip", "2", "mp4")));
    assert.equal((await storage.get(other)).bytes, body.byteLength);
  });
});
