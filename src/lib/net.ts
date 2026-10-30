import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { pipeline, type Readable, type Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { PRODUCT_NAME } from "./product";

/* Where an outbound request is allowed to go.
 *
 * Two different problems live here and they need different answers.
 *
 * The first is the API key. `api()` in src/ai/higgsfield.ts attached the
 * Authorization header to whatever URL it was handed, and one of those URLs
 * came out of `jobs.input` — a value the provider chose and we stored. An
 * origin allow-list fixes that, and it has to be an exact origin: the string
 * "https://api.higgsfield.ai.evil.com" starts with the right characters and
 * is a completely different company.
 *
 * The second is the download. `downloadClip` fetched an arbitrary URL from
 * inside our network, which is the whole of SSRF: 169.254.169.254 is the
 * cloud metadata service, 127.0.0.1 is whatever else is listening, and a name
 * that resolves to either is the same request wearing a hat. So the hostname
 * is resolved first and every address it resolves to is checked, because a
 * name with two A records only needs one of them to be interesting.
 *
 * Everything except the resolution itself is pure, so the refusals are tested
 * with no network.
 */

/** An outbound request that was refused before it was made. */
export class BlockedRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedRequestError";
  }
}

/* ------------------------------------------------------------------ */
/* Origins                                                             */
/* ------------------------------------------------------------------ */

/**
 * True only when `url` is on exactly this origin.
 *
 * Compared as parsed origins, never as string prefixes: scheme, host and port
 * all have to agree, so neither `api.higgsfield.ai.evil.com` nor
 * `http://api.higgsfield.ai` nor `https://api.higgsfield.ai:8443` passes for
 * `https://api.higgsfield.ai`.
 */
export function isOrigin(url: string, origin: string): boolean {
  let parsed: URL;
  let expected: URL;
  try {
    parsed = new URL(url);
    expected = new URL(origin);
  } catch {
    return false;
  }
  return parsed.protocol === expected.protocol && parsed.host === expected.host;
}

/* ------------------------------------------------------------------ */
/* Addresses                                                           */
/* ------------------------------------------------------------------ */

function ipv4Private(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // "this network", and 0.0.0.0
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback, the whole /8
  if (a === 169 && b === 254) return true; // link-local, which is where the metadata service lives
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 and the 192.0.2.0/24 doc range
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** An IPv6 address as its eight 16-bit groups, or null when it is not one. A dotted IPv4 tail ("::ffff:1.2.3.4") is read as its two groups. */
export function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (dotted) {
    const bytes = dotted.slice(2).map(Number);
    if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
    value = `${dotted[1]}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
    return groups.some(Number.isNaN) ? null : groups;
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  if (head.length + tail.length > 7) return null;
  return [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

function ipv4Of(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/* IPv6 is judged the other way round from IPv4: only global unicast
   (2000::/3) may be reached, and inside it the ranges that are not really
   somebody's public host are refused too. Anything else (loopback, the
   unspecified address, unique local fc00::/7, the old site-local fec0::/10,
   link-local fe80::/10, multicast) is outside 2000::/3 and refused by that
   alone, so a range nobody listed here is refused rather than let through.

   An IPv6 address that carries an IPv4 address reaches that IPv4 host, and
   is judged as it: IPv4-compatible (::/96, "::7f00:1"), IPv4-mapped
   (::ffff:0:0/96), the SIIT form (::ffff:0:0:0/96), NAT64 (64:ff9b::/96)
   and 6to4 (2002::/16), in any spelling, compressed or not. */
function ipv6Private(address: string): boolean {
  const g = ipv6Groups(address);
  if (!g) return true;
  const zero = (from: number, to: number) => g.slice(from, to).every((group) => group === 0);

  if (zero(0, 6)) return ipv4Private(ipv4Of(g[6], g[7])); // ::/96, which holds :: and ::1 as 0.0.0.0 and 0.0.0.1
  if (zero(0, 5) && g[5] === 0xffff) return ipv4Private(ipv4Of(g[6], g[7])); // IPv4-mapped
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return ipv4Private(ipv4Of(g[6], g[7])); // SIIT
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return ipv4Private(ipv4Of(g[6], g[7])); // NAT64, well-known prefix
  if (g[0] === 0x2002) return ipv4Private(ipv4Of(g[1], g[2])); // 6to4

  if ((g[0] & 0xe000) !== 0x2000) return true; // not global unicast
  if (g[0] === 0x2001 && g[1] < 0x200) return true; // 2001::/23, IETF special purpose: Teredo, benchmarking, ORCHID
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32, documentation
  if (g[0] === 0x3fff && g[1] < 0x1000) return true; // 3fff::/20, documentation
  return false;
}

/**
 * True when this address is somewhere an outbound request must never reach.
 *
 * Anything unparseable is private: this is an allow-list in disguise, and the
 * safe answer to "I do not recognise this" is no.
 */
export function isPrivateAddress(address: string): boolean {
  const value = address.trim();
  if (!value) return true;
  if (value.includes(":")) return ipv6Private(value);
  return ipv4Private(value);
}

/* ------------------------------------------------------------------ */
/* The whole check                                                     */
/* ------------------------------------------------------------------ */

/**
 * Parse a URL and refuse it unless it is https to a public address.
 *
 * `resolve` is injectable so the tests can pretend a name resolves somewhere
 * without asking a real resolver.
 */
export async function requirePublicHttpsUrl(
  url: string,
  resolve: (hostname: string) => Promise<string[]> = defaultResolve,
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockedRequestError("That download address is not a URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new BlockedRequestError(`Downloads must be https, not ${parsed.protocol.replace(":", "")}.`);
  }

  /* WHATWG parsing already turns 2130706433, 0x7f000001 and 127.1 into
     127.0.0.1, so a literal address arrives here in one canonical shape and
     this check sees it whichever way it was written. */
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isLiteralAddress(hostname)) {
    if (isPrivateAddress(hostname)) throw new BlockedRequestError("That download address is not reachable from here.");
    return parsed;
  }

  const addresses = await resolve(hostname);
  if (addresses.length === 0) throw new BlockedRequestError("That download address could not be resolved.");
  /* Every address, not the first: a name with two A records only needs one of
     them to point somewhere interesting, and we do not get to choose which one
     the socket eventually uses. */
  if (addresses.some(isPrivateAddress)) {
    throw new BlockedRequestError("That download address is not reachable from here.");
  }
  return parsed;
}

function isLiteralAddress(hostname: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":");
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  return records.map((record) => record.address);
}

/* ------------------------------------------------------------------ */
/* Bounded download                                                    */
/* ------------------------------------------------------------------ */

export interface BoundedFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  /** Magic bytes the body must start with, or the download is refused. */
  expect?: { label: string; matches: (head: Buffer) => boolean };
  resolve?: (hostname: string) => Promise<string[]>;
}

/* Why the download does not simply call `fetch` after the check above.

   `requirePublicHttpsUrl` resolves the name and judges the answer; `fetch`
   would then resolve the same name again, on its own, to open the socket.
   Two lookups are two answers. A name whose DNS answers a public address the
   first time and 169.254.169.254 the second (a rebinding attack, which needs
   nothing more than a zero TTL) passes the check and reaches the metadata
   service. So the download makes exactly one lookup, inside the socket's own
   connect, and judges it there: the address connected to is the address
   checked. TLS still names the host, so the certificate is verified against
   the name in the URL, as it would be by `fetch`. */

/**
 * A `lookup` for a socket that answers only with public addresses.
 *
 * Every address the name resolves to is judged, not only the one used, for
 * the same reason as in `requirePublicHttpsUrl`. Exported for its test.
 */
export function publicOnlyLookup(resolve: (hostname: string) => Promise<string[]> = defaultResolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (found) => {
        const wanted = options.family === 4 || options.family === 6 ? found.filter((address) => familyOf(address) === options.family) : found;
        if (wanted.length === 0) return callback(blocked("That download address could not be resolved."), "", 4);
        if (found.some(isPrivateAddress)) return callback(blocked("That download address is not reachable from here."), "", 4);
        if (options.all) return callback(null, wanted.map((address) => ({ address, family: familyOf(address) })));
        return callback(null, wanted[0], familyOf(wanted[0]));
      },
      () => callback(blocked("That download address could not be resolved."), "", 4),
    );
  };
}

function familyOf(address: string): 4 | 6 {
  return address.includes(":") ? 6 : 4;
}

/** A refusal in the shape a socket's lookup callback expects. It stays a `BlockedRequestError`. */
function blocked(message: string): NodeJS.ErrnoException {
  return Object.assign(new BlockedRequestError(message), { code: "EBLOCKED" });
}

/** The pure half of `requirePublicHttpsUrl`: https, and a literal address must be public. A name is judged when it is connected to. */
function httpsTarget(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockedRequestError("That download address is not a URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new BlockedRequestError(`Downloads must be https, not ${parsed.protocol.replace(":", "")}.`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  // A literal address opens no lookup, so it is judged here, once, as written.
  if (isLiteralAddress(hostname) && isPrivateAddress(hostname)) throw new BlockedRequestError("That download address is not reachable from here.");
  return parsed;
}

/**
 * Fetch a public https URL with a size limit, a time limit and a shape check.
 *
 * The body is read in chunks and abandoned the moment it passes `maxBytes`,
 * so a URL that answers with an endless stream costs us that many bytes and
 * not one more. Content-Length is checked first when it is offered, but it is
 * the provider's claim, not a fact. A redirect is refused: it would be a
 * second URL nobody checked.
 */
export async function fetchBounded(url: string, options: BoundedFetchOptions): Promise<Buffer> {
  const target = httpsTarget(url);
  const signal = AbortSignal.timeout(options.timeoutMs);
  const late = (error: unknown): never => {
    if (error instanceof BlockedRequestError) throw error;
    if (signal.aborted) throw new BlockedRequestError("That download took too long.");
    throw error;
  };

  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpsRequest(
      target,
      {
        method: "GET",
        lookup: publicOnlyLookup(options.resolve),
        signal,
        // Identity asked for; a server that compresses anyway is decoded, and counted decoded (`readBounded`).
        headers: { "accept-encoding": "identity", "user-agent": `${PRODUCT_NAME}/1.0` },
      },
      resolve,
    );
    request.on("error", reject);
    request.end();
  }).catch(late);

  const status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    response.destroy();
    if (status >= 300 && status < 400) throw new BlockedRequestError("That download address redirects somewhere else. Use the direct link to the file.");
    throw new BlockedRequestError(`That download answered ${status}.`);
  }

  const declared = Number(response.headers["content-length"] ?? NaN);
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    response.destroy();
    throw new BlockedRequestError(`That download says it is ${declared} bytes; the limit is ${options.maxBytes}.`);
  }

  let body: Buffer = Buffer.alloc(0);
  try {
    body = await readBounded(response, response.headers["content-encoding"], options.maxBytes);
  } catch (error) {
    late(error);
  }

  if (options.expect && !options.expect.matches(body)) {
    throw new BlockedRequestError(`That download is not ${options.expect.label}.`);
  }
  return body;
}

/* Reading the body.

   The request asks for the bytes as they are ("identity"), but a server may
   compress anyway, and `fetch`, which the provider's clip downloads used
   before this, undid gzip and brotli without being asked. Stored raw, a
   compressed clip would be a file nothing can play. So a compressed body is
   decoded here, and the ceiling is on the decoded bytes: a small compressed
   body that unpacks to gigabytes (a "zip bomb") is stopped at the ceiling,
   having cost that many bytes and not one more. An encoding that is not
   gzip, deflate or brotli is refused rather than stored as it came. */

function decoderFor(encoding: string | string[] | undefined): Transform | null {
  const coding = (Array.isArray(encoding) ? encoding.join(",") : encoding ?? "").trim().toLowerCase();
  if (coding === "" || coding === "identity" || coding === "none") return null;
  if (coding === "gzip" || coding === "x-gzip") return createGunzip();
  if (coding === "deflate") return createInflate();
  if (coding === "br") return createBrotliDecompress();
  throw new BlockedRequestError("That download is packed in a way that cannot be read. Use the direct link to the file.");
}

/**
 * The whole body of `source`, decoded per `encoding` (a Content-Encoding
 * header), refused the moment the decoded bytes pass `maxBytes`. Exported for
 * its test, which feeds it streams without a network.
 */
export async function readBounded(source: Readable, encoding: string | string[] | undefined, maxBytes: number): Promise<Buffer> {
  let decoder: Transform | null;
  try {
    decoder = decoderFor(encoding);
  } catch (error) {
    source.destroy();
    throw error;
  }
  const stream: Readable = decoder ?? source;
  if (decoder) {
    // Errors on either side end the other: a dropped connection fails the read, a corrupt body ends the download.
    pipeline(source, decoder, () => undefined);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += part.byteLength;
      if (total > maxBytes) throw new BlockedRequestError(`That download is larger than ${maxBytes} bytes.`);
      chunks.push(part);
    }
  } catch (error) {
    source.destroy();
    decoder?.destroy();
    if (decoder && !(error instanceof BlockedRequestError) && !source.errored && (error as NodeJS.ErrnoException).code?.startsWith("Z_")) {
      throw new BlockedRequestError("That download could not be unpacked.");
    }
    throw error;
  }
  return Buffer.concat(chunks);
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/**
 * True when these bytes are an ISO base media file (MP4 and its relatives).
 *
 * The first box is a file-type box: four bytes of size, then "ftyp". Checking
 * it costs nothing and means a clip that is really an HTML page, a script or
 * a zip never reaches storage under a video content type.
 */
export function looksLikeMp4(data: Buffer): boolean {
  if (data.length < 12) return false;
  const box = data.subarray(4, 8).toString("ascii");
  if (box !== "ftyp") return false;
  const size = data.readUInt32BE(0);
  return size >= 8 && size <= data.length;
}

export const MP4_SHAPE = { label: "an MP4 video", matches: looksLikeMp4 };
