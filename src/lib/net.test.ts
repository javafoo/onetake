import assert from "node:assert/strict";
import { test } from "node:test";

import type { LookupAddress } from "node:dns";

import { Readable } from "node:stream";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";

import { BlockedRequestError, fetchBounded, ipv6Groups, isOrigin, isPrivateAddress, looksLikeMp4, publicOnlyLookup, readBounded, requirePublicHttpsUrl } from "./net";

const HIGGSFIELD = "https://api.higgsfield.ai";

/** A resolver that answers whatever a case needs, without touching DNS. */
const resolving = (...addresses: string[]) => async () => addresses;

test("the key goes to exactly one origin", () => {
  assert.equal(isOrigin("https://api.higgsfield.ai/files/generate-upload-url", HIGGSFIELD), true);
  assert.equal(isOrigin("https://api.higgsfield.ai/kling-video/v3.0/std/image-to-video/abc", HIGGSFIELD), true);
});

test("a name that merely starts the same way is a different company", () => {
  for (const url of [
    "https://api.higgsfield.ai.evil.com/status",
    "https://api.higgsfield.ai@evil.com/status",
    "https://evil.com/https://api.higgsfield.ai",
    "https://api.higgsfield.ai.",
    "https://apixhiggsfield.ai/",
    "https://sub.api.higgsfield.ai/",
    // Right host, wrong scheme or port: the key would travel in clear, or to
    // something else listening on the same name.
    "http://api.higgsfield.ai/status",
    "https://api.higgsfield.ai:8443/status",
    "not a url at all",
    "",
  ]) {
    assert.equal(isOrigin(url, HIGGSFIELD), false, url);
  }
});

test("loopback, link-local and private ranges are all refused", () => {
  for (const address of [
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.0.0.7",
    "172.16.5.4",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // the cloud metadata service
    "169.254.170.2",
    "100.64.0.1",
    "192.0.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "fc00::abcd",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // the same address, the way Node spells it back
    "::ffff:169.254.169.254",
    "fe80::1%eth0",
    "",
    "not an address",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
});

test("ordinary public addresses are allowed", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "104.18.0.1", "172.32.0.1", "192.167.1.1", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test("a decimal, hex or octal address is the same address", async () => {
  /* The URL parser canonicalises all of these to 127.0.0.1 before we see
     them, which is why the check is on the parsed hostname and not on the
     string somebody typed. */
  for (const url of ["https://2130706433/clip.mp4", "https://0x7f000001/clip.mp4", "https://017700000001/clip.mp4", "https://127.1/clip.mp4"]) {
    await assert.rejects(() => requirePublicHttpsUrl(url, resolving("8.8.8.8")), BlockedRequestError, url);
  }
});

test("the metadata service is refused however it is reached", async () => {
  // Directly...
  await assert.rejects(() => requirePublicHttpsUrl("https://169.254.169.254/latest/meta-data", resolving()), BlockedRequestError);
  // ...and behind a name that resolves to it.
  await assert.rejects(
    () => requirePublicHttpsUrl("https://metadata.example.com/x", resolving("169.254.169.254")),
    BlockedRequestError,
  );
});

test("http is refused outright", async () => {
  await assert.rejects(() => requirePublicHttpsUrl("http://169.254.169.254/", resolving()), (error: unknown) => {
    assert.ok(error instanceof BlockedRequestError);
    assert.match(error.message, /must be https/);
    return true;
  });
  await assert.rejects(() => requirePublicHttpsUrl("http://example.com/clip.mp4", resolving("8.8.8.8")), BlockedRequestError);
  await assert.rejects(() => requirePublicHttpsUrl("file:///etc/passwd", resolving()), BlockedRequestError);
  await assert.rejects(() => requirePublicHttpsUrl("gopher://example.com/", resolving()), BlockedRequestError);
});

test("IPv6 loopback is refused in every spelling", async () => {
  for (const url of ["https://[::1]/clip.mp4", "https://[::ffff:127.0.0.1]/clip.mp4", "https://[0:0:0:0:0:0:0:1]/clip.mp4"]) {
    await assert.rejects(() => requirePublicHttpsUrl(url, resolving()), BlockedRequestError, url);
  }
});

test("one bad answer out of several is enough to refuse the name", async () => {
  /* A DNS rebinding attempt only needs one of its records to be interesting,
     and we do not choose which one the socket uses. */
  await assert.rejects(
    () => requirePublicHttpsUrl("https://clips.example.com/x.mp4", resolving("104.18.0.1", "127.0.0.1")),
    BlockedRequestError,
  );
  await assert.rejects(() => requirePublicHttpsUrl("https://clips.example.com/x.mp4", resolving()), BlockedRequestError);
});

test("a genuine provider URL still passes", async () => {
  const url = await requirePublicHttpsUrl("https://cdn.higgsfield.ai/clips/abc.mp4", resolving("104.18.0.1"));
  assert.equal(url.hostname, "cdn.higgsfield.ai");
  assert.equal((await requirePublicHttpsUrl("https://104.18.0.1/x.mp4", resolving())).hostname, "104.18.0.1");
});

test("only an MP4 is stored as one", () => {
  const ftyp = (brand: string) => {
    const out = Buffer.alloc(16);
    out.writeUInt32BE(16, 0);
    out.write("ftyp", 4, "ascii");
    out.write(brand, 8, "ascii");
    return out;
  };
  assert.equal(looksLikeMp4(ftyp("isom")), true);
  assert.equal(looksLikeMp4(ftyp("mp42")), true);

  assert.equal(looksLikeMp4(Buffer.from("<!doctype html><script>alert(1)</script>")), false);
  assert.equal(looksLikeMp4(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])), false, "a zip");
  assert.equal(looksLikeMp4(Buffer.alloc(4)), false, "too short to be anything");
  // "ftyp" in the right place but a size that lies about the file.
  const lying = ftyp("isom");
  lying.writeUInt32BE(0xffffffff, 0);
  assert.equal(looksLikeMp4(lying), false);
});

/* ------------------------------------------------------------------ */
/* The download: one lookup, judged where the socket connects          */
/* ------------------------------------------------------------------ */

type Answer = { error: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number };

function lookupWith(resolve: (hostname: string) => Promise<string[]>, options: { all?: boolean; family?: number } = {}): Promise<Answer> {
  return new Promise((done) => {
    publicOnlyLookup(resolve)("clips.example.com", { all: options.all ?? false, family: options.family ?? 0 } as never, (error, address, family) =>
      done({ error, address, family }),
    );
  });
}

test("the socket's lookup answers only with public addresses, in either shape the socket asks for", async () => {
  const one = await lookupWith(resolving("104.18.0.1", "2606:4700::1"));
  assert.equal(one.error, null);
  assert.equal(one.address, "104.18.0.1");
  assert.equal(one.family, 4);

  const all = await lookupWith(resolving("104.18.0.1", "2606:4700::1"), { all: true });
  assert.deepEqual(all.address, [{ address: "104.18.0.1", family: 4 }, { address: "2606:4700::1", family: 6 }]);

  const six = await lookupWith(resolving("104.18.0.1", "2606:4700::1"), { family: 6 });
  assert.equal(six.address, "2606:4700::1");
});

test("the socket's lookup refuses a name with any private answer, and a name with none", async () => {
  for (const addresses of [["169.254.169.254"], ["104.18.0.1", "127.0.0.1"], ["::ffff:10.0.0.1"], []]) {
    const answer = await lookupWith(resolving(...addresses), { all: true });
    assert.ok(answer.error instanceof BlockedRequestError, addresses.join(","));
  }
  const failed = await lookupWith(async () => {
    throw new Error("ENOTFOUND");
  });
  assert.ok(failed.error instanceof BlockedRequestError);
});

test("a download resolves its name once, when it connects, so a second answer cannot differ from the checked one", async () => {
  /* A rebinding name answers public to a check and private to the connect.
     Here the only lookup there is answers private: the download is refused
     at the socket, and nothing looked the name up beforehand. */
  const asked: string[] = [];
  const rebinding = async (hostname: string) => {
    asked.push(hostname);
    return asked.length === 1 ? ["169.254.169.254"] : ["104.18.0.1"];
  };
  await assert.rejects(() => fetchBounded("https://rebind.example.com/x.jpg", { maxBytes: 1000, timeoutMs: 5000, resolve: rebinding }), BlockedRequestError);
  assert.deepEqual(asked, ["rebind.example.com"]);
});

test("a download refuses http and private literal addresses before any socket opens", async () => {
  let asked = 0;
  const counting = async () => {
    asked++;
    return ["104.18.0.1"];
  };
  for (const url of ["http://example.com/x.jpg", "https://127.0.0.1/x.jpg", "https://169.254.169.254/latest/meta-data", "https://[::1]/x.jpg", "https://2130706433/x.jpg", "not a url"]) {
    await assert.rejects(() => fetchBounded(url, { maxBytes: 1000, timeoutMs: 5000, resolve: counting }), BlockedRequestError, url);
  }
  assert.equal(asked, 0);
});

test("IPv6 that carries an IPv4 address is judged as that address, in every spelling", async () => {
  for (const address of [
    "::7f00:1", // IPv4-compatible 127.0.0.1
    "::127.0.0.1",
    "0:0:0:0:0:0:7f00:1",
    "64:ff9b::a9fe:a9fe", // NAT64 169.254.169.254
    "64:ff9b:0:0:0:0:a9fe:a9fe",
    "64:ff9b::10.0.0.1",
    "::ffff:0:a9fe:a9fe", // SIIT 169.254.169.254
    "::ffff:0:169.254.169.254",
    "0:0:0:0:0:ffff:a9fe:a9fe", // mapped, uncompressed
    "0000:0000:0000:0000:0000:ffff:7f00:0001",
    "2002:a9fe:a9fe::1", // 6to4 of 169.254.169.254
    "2002:0a00:0001::",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const url of ["https://[::7f00:1]/x.jpg", "https://[64:ff9b::a9fe:a9fe]/x.jpg", "https://[::ffff:0:a9fe:a9fe]/", "https://[0:0:0:0:0:ffff:a9fe:a9fe]/"]) {
    await assert.rejects(() => requirePublicHttpsUrl(url, resolving()), BlockedRequestError, url);
  }
  // The same wrappers around a public IPv4 address are that public address.
  for (const address of ["64:ff9b::808:808", "::ffff:8.8.8.8", "2002:808:808::1"]) assert.equal(isPrivateAddress(address), false, address);
});

test("only global unicast IPv6 is allowed: site-local, documentation and special ranges are refused", () => {
  for (const address of ["fec0::1", "feff::1", "fc00::1", "fe80::1", "ff05::2", "2001:db8::1", "3fff::1", "2001::1", "2001:2::1", "2001:10::1", "4000::1", "100::1", "1::"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["2606:4700::1111", "2a00:1450:4001:80b::200e", "2001:4860:4860::8888"]) assert.equal(isPrivateAddress(address), false, address);
});

test("an IPv6 address is read into its eight groups, and anything malformed is refused", () => {
  assert.deepEqual(ipv6Groups("::7f00:1"), [0, 0, 0, 0, 0, 0, 0x7f00, 1]);
  assert.deepEqual(ipv6Groups("::127.0.0.1"), [0, 0, 0, 0, 0, 0, 0x7f00, 1]);
  assert.deepEqual(ipv6Groups("[fe80::1%eth0]"), [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  for (const bad of ["1::2::3", "12345::", "::1.2.3.256", "g::1", "1:2:3:4:5:6:7:8:9", ":1::"]) {
    assert.equal(ipv6Groups(bad), null, bad);
    assert.equal(isPrivateAddress(bad), true, bad);
  }
});

test("a compressed body is decoded, and the ceiling is on what it decodes to", async () => {
  const clip = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(5000, 7)]);
  assert.deepEqual(await readBounded(Readable.from([clip]), undefined, 10_000), clip);
  assert.deepEqual(await readBounded(Readable.from([clip]), "identity", 10_000), clip);
  assert.deepEqual(await readBounded(Readable.from([gzipSync(clip)]), "gzip", 10_000), clip);
  assert.deepEqual(await readBounded(Readable.from([gzipSync(clip)]), "x-gzip", 10_000), clip);
  assert.deepEqual(await readBounded(Readable.from([deflateSync(clip)]), "deflate", 10_000), clip);
  assert.deepEqual(await readBounded(Readable.from([brotliCompressSync(clip)]), "br", 10_000), clip);
});

test("a body that unpacks past the ceiling is stopped there, however small it arrived", async () => {
  const bomb = gzipSync(Buffer.alloc(50 * 1024 * 1024));
  assert.ok(bomb.byteLength < 100_000, "the packed body is small");
  const before = process.memoryUsage().arrayBuffers;
  await assert.rejects(() => readBounded(Readable.from([bomb]), "gzip", 1024 * 1024), (error: unknown) => error instanceof BlockedRequestError && /larger than 1048576 bytes/.test(error.message));
  assert.ok(process.memoryUsage().arrayBuffers - before < 40 * 1024 * 1024, "nothing near the unpacked size was held");
});

test("an encoding that cannot be read, or a corrupt one, is refused and never stored raw", async () => {
  await assert.rejects(() => readBounded(Readable.from([Buffer.from("abc")]), "compress", 10_000), BlockedRequestError);
  await assert.rejects(() => readBounded(Readable.from([Buffer.from("abc")]), "gzip, br", 10_000), BlockedRequestError);
  await assert.rejects(() => readBounded(Readable.from([Buffer.from("not gzip at all")]), "gzip", 10_000), BlockedRequestError);
});
