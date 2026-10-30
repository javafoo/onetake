import type { TokenUsage } from "./estimates";

/* How a finished model call gets back to whatever is counting.
 *
 * `src/ai` is a provider client and nothing else — no ledger, no cap — but the
 * one thing only it can see is what a call actually used, because that arrives
 * in the response body and is thrown away a line later. So it reports, and
 * whoever is counting listens. `src/spend` installs the listener; the CLI
 * scripts install none, and reporting into nothing costs nothing.
 */

export interface ObservedCall {
  provider: "gemini" | "nebius" | "tavily";
  model: string;
  kind: "text" | "vision" | "image" | "video" | "embedding" | "search";
  /** What it cost, when the response said enough to work that out. */
  costUsd?: number;
  tokens?: TokenUsage;
}

type Sink = (call: ObservedCall) => void;

let sink: Sink | undefined;

/** Install the listener. Passing undefined removes it. */
export function setUsageSink(next: Sink | undefined): void {
  sink = next;
}

/** Report a finished call. Never throws: bookkeeping must not break a generation. */
export function reportUsage(call: ObservedCall): void {
  try {
    sink?.(call);
  } catch {
    // Deliberately swallowed.
  }
}
