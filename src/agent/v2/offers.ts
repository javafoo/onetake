import type { StartJobRequest } from "@/jobs";
import { InvalidRequestError } from "@/lib/errors";

import { agentNoun } from "../plan";

import { settleOffer, type ThreadState } from "./thread";
import { jobRecord, offerRequestId } from "./tools";
import type { Offer } from "./types";

/* Her tap on an offer. The model can only offer; this is the one place an
   offer becomes a job, and only from her press. The job is started under a
   request id made from the thread and the offer, so a double tap, a retry or
   two tabs all find the one job, and the thread counts its credits once. */

export interface OfferDeps {
  load(): Promise<ThreadState | null>;
  /** Apply a change to the newest stored thread (see `mutateThread`). */
  mutate(change: (thread: ThreadState) => ThreadState | null): Promise<ThreadState | null>;
  affordable(credits: number, noun: string): Promise<void>;
  startJob(request: StartJobRequest): Promise<{ jobId: string; created: boolean }>;
  now(): Date;
}

export type AcceptedOffer = { jobId: string; kind: string; credits: number; draftId?: string };

function requestOf(offer: Offer) {
  const input = offer.request.input;
  if (input.kind !== "agent") throw new Error("An offer holds an agent run.");
  return input.request;
}

export async function acceptOffer(deps: OfferDeps, offerId: string): Promise<AcceptedOffer> {
  const thread = await deps.load();
  if (!thread) throw new InvalidRequestError("That chat is gone.");
  const offer = thread.offers.find((item) => item.id === offerId);
  if (!offer) throw new InvalidRequestError("That offer is gone. Ask again.");
  if (offer.status === "declined") throw new InvalidRequestError("You said no to that one. Ask again to make it.");

  // The id is rebuilt here rather than read off the row: it is what makes the second tap free.
  const requestId = offerRequestId(thread.id, offer.id);
  const at = deps.now().toISOString();
  const request = requestOf(offer);
  // An accepted offer was priced and paid for on the first tap; a second tap only finds its job.
  if (offer.status === "open") await deps.affordable(offer.credits, agentNoun(request));
  const started = await deps.startJob({ ...offer.request, requestId });
  const message = jobRecord(started.jobId, request, offer.credits, at).message;

  await deps.mutate((current) => {
    const fresh = current.offers.find((item) => item.id === offerId);
    if (!fresh) return null;
    const settled = settleOffer(current, offerId, "accepted", message);
    // Counted by the write that moved it from open, whichever tap that was.
    return fresh.status === "open" ? { ...settled, spentCredits: settled.spentCredits + offer.credits } : settled;
  });
  return { jobId: message.jobId, kind: message.kind, credits: offer.credits, ...(message.draftId ? { draftId: message.draftId } : {}) };
}

export async function declineOffer(deps: Pick<OfferDeps, "mutate">, offerId: string): Promise<void> {
  await deps.mutate((current) => {
    const offer = current.offers.find((item) => item.id === offerId);
    if (!offer || offer.status !== "open") return null;
    return settleOffer(current, offerId, "declined");
  });
}
