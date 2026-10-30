import type { AgentView } from "@/agent/view";
import type { Offer, ThreadMessage, TurnEvent } from "@/agent/v2/types";
import type { JobStatusValue } from "@/components/job-status";

/* What the chat draws, worked out from the thread. Her message is a bubble;
   everything the agent did until her next message is one card made of parts
   in the order they happened: tool lines (consecutive ones grouped), its
   words, offers, jobs, things it remembered, a problem. A stored thread and
   a streamed turn go through the same shapes, so a reload draws exactly what
   the stream drew. Pure. */

export type OfferView = Omit<Offer, "request">;
/** A job card: the job, what it makes, its price, and its draft once known (to heart a set or a day of stories). */
export type JobRef = { jobId: string; kind: string; credits: number; draftId?: string };

const jobRef = ({ jobId, kind, credits, draftId }: { jobId: string; kind: string; credits: number; draftId?: string }): JobRef => ({ jobId, kind, credits, ...(draftId ? { draftId } : {}) });

export type TurnPart =
  | { kind: "tools"; labels: string[] }
  | { kind: "text"; text: string }
  | { kind: "offer"; offer: OfferView }
  | { kind: "job"; job: JobRef }
  | { kind: "fact"; text: string }
  | { kind: "error"; message: string };

export type HerCard = { kind: "her"; key: string; text: string; photos: number; clip: boolean; /** Screenshots she pasted with it, read once and not kept. */ screenshots: number };
export type TurnCard = { kind: "turn"; key: string; parts: TurnPart[] };
export type ThreadCard = HerCard | TurnCard;

/** The longest thread title: her first message, cut. */
export const TITLE_CHARS = 40;

/** A thread's title: her first message on one line, cut to 40 characters at a word where it can be. */
export function threadTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= TITLE_CHARS) return line || "New chat";
  const cut = line.slice(0, TITLE_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The parts with one more on the end: tool lines join the group before them, words join the words before them. */
function withPart(parts: TurnPart[], part: TurnPart): TurnPart[] {
  const last = parts[parts.length - 1];
  if (part.kind === "tools" && last?.kind === "tools") return [...parts.slice(0, -1), { kind: "tools", labels: [...last.labels, ...part.labels] }];
  if (part.kind === "text" && last?.kind === "text") return [...parts.slice(0, -1), { kind: "text", text: last.text + part.text }];
  return [...parts, part];
}

/** The cards with a part added to the agent's card at the end, starting one if her message is last. */
function addToTurn(cards: ThreadCard[], part: TurnPart, key: string): ThreadCard[] {
  const last = cards[cards.length - 1];
  if (last?.kind === "turn") return [...cards.slice(0, -1), { ...last, parts: withPart(last.parts, part) }];
  return [...cards, { kind: "turn", key, parts: withPart([], part) }];
}

const offerView = ({ id, label, credits, status }: Offer | OfferView): OfferView => ({ id, label, credits, status });

/** A stored thread as cards. */
export function threadCards(messages: ThreadMessage[]): ThreadCard[] {
  let cards: ThreadCard[] = [];
  messages.forEach((message, index) => {
    const key = `m${index}`;
    if (message.role === "her") {
      cards = [...cards, { kind: "her", key: message.requestId || key, text: message.text, photos: message.material?.photos.length ?? 0, clip: Boolean(message.material?.clip), screenshots: message.screenshots ?? 0 }];
      return;
    }
    // Two stored replies in a row are two paragraphs, not one run-on sentence.
    const last = cards[cards.length - 1];
    const lastPart = last?.kind === "turn" ? last.parts[last.parts.length - 1] : undefined;
    const part: TurnPart =
      message.role === "agent"
        ? { kind: "text", text: lastPart?.kind === "text" && message.text ? `\n\n${message.text}` : message.text }
        : message.role === "tool"
          ? { kind: "tools", labels: [message.label] }
          : message.role === "offer"
            ? { kind: "offer", offer: offerView(message.offer) }
            : { kind: "job", job: jobRef(message) };
    cards = addToTurn(cards, part, key);
  });
  return cards;
}

/** Her message, added the moment she sends it. */
export function withHerMessage(cards: ThreadCard[], key: string, text: string, material: { photos: number; clip: boolean; screenshots: number }): ThreadCard[] {
  return [...cards, { kind: "her", key, text, ...material }];
}

/** One streamed event applied to the cards. `done` changes nothing here; the caller keeps the thread id. */
export function applyEvent(cards: ThreadCard[], event: TurnEvent, key: string): ThreadCard[] {
  switch (event.type) {
    case "text":
      return event.delta ? addToTurn(cards, { kind: "text", text: event.delta }, key) : cards;
    case "tool":
      return addToTurn(cards, { kind: "tools", labels: [event.label] }, key);
    case "offer":
      return addToTurn(cards, { kind: "offer", offer: offerView(event.offer) }, key);
    case "job":
      return addToTurn(cards, { kind: "job", job: jobRef(event) }, key);
    case "fact":
      return addToTurn(cards, { kind: "fact", text: factText(event.text) }, key);
    case "error":
      return addToTurn(cards, { kind: "error", message: event.message }, key);
    case "done":
      return cards;
  }
}

/** The fact itself: the stream may or may not lead with "Remembered:", and the line adds its own. */
export function factText(text: string): string {
  return text.replace(/^\s*remembered:\s*/i, "").trim();
}

/** Every card with this offer's status changed, and, once accepted, its job placed right after it. */
export function settleOffer(cards: ThreadCard[], offerId: string, status: OfferView["status"], job?: JobRef): ThreadCard[] {
  return cards.map((card) => {
    if (card.kind !== "turn" || !card.parts.some((part) => part.kind === "offer" && part.offer.id === offerId)) return card;
    const parts = card.parts.flatMap((part): TurnPart[] => {
      if (part.kind !== "offer" || part.offer.id !== offerId) return [part];
      const settled: TurnPart = { kind: "offer", offer: { ...part.offer, status } };
      // A second tap that found the same job must not draw it twice.
      const shown = job && card.parts.some((other) => other.kind === "job" && other.job.jobId === job.jobId);
      return job && !shown ? [settled, { kind: "job", job }] : [settled];
    });
    return { ...card, parts };
  });
}

/** True while the agent's card at the end has nothing in it to read yet. */
export function waitingForWords(cards: ThreadCard[]): boolean {
  const last = cards[cards.length - 1];
  return last?.kind === "her" || (last?.kind === "turn" && !last.parts.some((part) => part.kind === "text" && part.text.trim()));
}

/* Where a job card asks. Everything the chat starts is an agent run except a
   day of stories, which is a job of its own. A run must be asked through
   /api/agent/[id]: it starts its children inside the poll, and that route has
   the time for it (300 seconds against the job poll's minute or two). */
export function jobPollUrl(job: Pick<JobRef, "jobId" | "kind">): string {
  return job.kind === "stories" ? `/api/jobs/${job.jobId}` : `/api/agent/${job.jobId}`;
}

/** An agent run's poll answer as the job card reads it. A run holds no credits itself; its children refund their own. */
export function agentJobStatus(view: AgentView, kind: string): JobStatusValue {
  return {
    id: view.id,
    kind,
    status: view.status,
    error: view.error,
    mediaIds: view.mediaIds,
    message: view.status === "completed" ? (view.summary ?? "Done.") : null,
    credits: view.estimatedCredits,
    creditsCharged: view.creditsSpent,
    creditsRefunded: 0,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    draftId: view.draftId,
  };
}
