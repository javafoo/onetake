import type { Offer, TurnEvent } from "@/agent/v2/types";

/* Reading a turn's stream. The route sends Server-Sent Events, one JSON
   TurnEvent per `data:` line. A network chunk can end in the middle of a
   line, so lines are buffered until their newline arrives. Anything that is
   not a well-formed event is dropped rather than shown: a half-parsed
   object must never reach the chat as words. Pure apart from the reader
   at the bottom, which only decodes bytes. */

const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const OFFER_STATUS = new Set<Offer["status"]>(["open", "accepted", "declined"]);

/** One `data:` payload as a TurnEvent, or null when it is not one. */
export function parseTurnEvent(raw: string): TurnEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case "text":
      return isString(event.delta) ? { type: "text", delta: event.delta } : null;
    case "tool":
      return isString(event.label) ? { type: "tool", label: event.label } : null;
    case "fact":
      return isString(event.text) ? { type: "fact", text: event.text } : null;
    case "error":
      return isString(event.message) ? { type: "error", message: event.message } : null;
    case "done":
      return isString(event.threadId) ? { type: "done", threadId: event.threadId } : null;
    case "job":
      return isString(event.jobId) && isString(event.kind) && isCount(event.credits) ? { type: "job", jobId: event.jobId, kind: event.kind, credits: event.credits } : null;
    case "offer": {
      const offer = event.offer as Record<string, unknown> | null | undefined;
      if (!offer || typeof offer !== "object") return null;
      if (!isString(offer.id) || !isString(offer.label) || !isCount(offer.credits)) return null;
      const status = OFFER_STATUS.has(offer.status as Offer["status"]) ? (offer.status as Offer["status"]) : "open";
      // Only the fields the button needs: a stray `request` is not carried into the browser's state.
      return { type: "offer", offer: { id: offer.id, label: offer.label, credits: offer.credits, status } };
    }
    default:
      return null;
  }
}

/** One complete line of the stream: an event for a `data:` line, null for anything else (comments, `event:`, `id:`, blanks). */
function lineEvent(line: string): TurnEvent | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).replace(/^ /, "");
  return payload ? parseTurnEvent(payload) : null;
}

export type TurnParser = {
  /** Feed decoded text; returns the events whose lines are now complete. */
  push(chunk: string): TurnEvent[];
  /** The stream closed: whatever was left on an unfinished last line. */
  end(): TurnEvent[];
};

export function createTurnParser(): TurnParser {
  let buffer = "";
  const take = (lines: string[]) => lines.map((line) => lineEvent(line.replace(/\r$/, ""))).filter((event): event is TurnEvent => event !== null);
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return take(lines);
    },
    end() {
      const rest = buffer;
      buffer = "";
      return rest ? take([rest]) : [];
    },
  };
}

/** Reads a whole stream, handing each event over as it arrives. True when the turn said it was done. */
export async function readTurnStream(body: ReadableStream<Uint8Array>, onEvent: (event: TurnEvent) => void): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createTurnParser();
  let done = false;
  const hand = (events: TurnEvent[]) => {
    for (const event of events) {
      if (event.type === "done") done = true;
      onEvent(event);
    }
  };
  for (;;) {
    const { value, done: closed } = await reader.read();
    if (closed) break;
    hand(parser.push(decoder.decode(value, { stream: true })));
  }
  hand(parser.push(decoder.decode()));
  hand(parser.end());
  return done;
}
