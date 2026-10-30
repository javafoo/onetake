import { scrub } from "../lib/errors";

/* What a model provider's refusal becomes.
 *
 * Seen live on 2026-10-02: Google answered every Gemini call with 402, "Your
 * prepayment credits are depleted", and because that message is written for
 * us it reached nobody — each person saw an opaque reference, the setup
 * interview crashed outright, and the log was the only place that knew the
 * whole product was down. Two things follow. The person gets a sentence that
 * is true and safe to show, and the one failure an operator has to act on —
 * the provider wants money — is handed to whoever installed a sink, so it can
 * be written down and sent, without this module knowing about a database.
 *
 * Pure apart from the sink: no network, no ledger, so it can be tested. */

/** Shown as written. Says nothing about whose account or which provider. */
export const PROVIDER_UNAVAILABLE_MESSAGE =
  "Our AI service is not answering right now. Nothing was charged. Please try again in a little while.";

/** The provider cannot serve us for now: out of credit, over quota, or down. */
export class ProviderUnavailableError extends Error {
  readonly provider: string;
  readonly model: string;
  readonly status: number;
  /** The provider's own words. For the log and the operator, never for a page. */
  readonly detail: string;
  /** True when the provider is refusing over money, which only an operator can fix. */
  readonly billing: boolean;

  constructor(provider: string, model: string, status: number, detail: string) {
    super(PROVIDER_UNAVAILABLE_MESSAGE);
    this.name = "ProviderUnavailableError";
    this.provider = provider;
    this.model = model;
    this.status = status;
    this.detail = detail;
    this.billing = status === 402;
  }
}

type OutageSink = (error: ProviderUnavailableError) => void;
let sink: OutageSink | null = null;

/** Something to tell besides the log when a provider refuses us; nothing is installed by default. */
export function setOutageSink(next: OutageSink | null): void {
  sink = next;
}

/** Statuses that say "not now" rather than "not that": nothing about the request would make them pass. */
function isUnavailable(status: number): boolean {
  return status === 402 || status === 429 || status >= 500;
}

/**
 * The error to throw for a non-2xx answer. A provider that cannot serve us
 * becomes a `ProviderUnavailableError`; anything else keeps the old shape
 * (`Gemini gemini-x 400: ...`), which `src/jobs/runner.ts` already translates
 * and which a developer wants to read whole.
 */
export function providerFailure(provider: string, model: string, status: number, detail: string): Error {
  const words = scrub(detail || "request failed").slice(0, 300);
  if (!isUnavailable(status)) return new Error(`${provider} ${model} ${status}: ${words}`);
  const error = new ProviderUnavailableError(provider, model, status, words);
  // The person is told nothing specific, so the log has to say it all.
  console.error(`${provider} ${model} ${status} (unavailable): ${words}`);
  if (error.billing && sink) {
    try {
      sink(error);
    } catch {
      // A failing alert must never turn a provider outage into a second fault.
    }
  }
  return error;
}
