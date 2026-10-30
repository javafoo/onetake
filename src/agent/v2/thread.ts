import { stripNotes } from "./notes";
import type { Content, Part } from "@/ai/gemini";

import type { Offer, ThreadMessage } from "./types";

/* A thread as plain data, and what the model is shown of it. Pure: no
   database, no network, so every rule here is tested without either.

   The stored messages are what the chat draws. The model sees the same
   messages turned into Gemini's shape: her words as user text, the agent's
   as model text, each tool call as a function call (with the signature
   Gemini gave it) followed by its answer, and offers and jobs as short model
   notes, so it knows what it already offered and what is being made. */

/** What the model is shown of a long thread: the newest this many messages, the rest folded into one note. */
export const MAX_THREAD_MESSAGES = 60;
/** A thread title: her first message on one line, cut. */
export const TITLE_CHARS = 40;

export type ThreadState = {
  id: string;
  avatarId: string;
  title: string | null;
  messages: ThreadMessage[];
  budgetCredits: number;
  spentCredits: number;
  offers: Offer[];
  lastRequestId: string | null;
};

/** What one turn adds to a thread. Applied to the newest stored row, so a tap on an offer during the turn is not lost. */
export type TurnDelta = {
  messages: ThreadMessage[];
  offers: Offer[];
  spent: number;
  /** Set when her message stated a budget for this thread. */
  budget?: number;
  title?: string;
};

export const emptyDelta = (): TurnDelta => ({ messages: [], offers: [], spent: 0 });

/** The thread with the turn's delta applied. Pure, and the one way a turn's work lands on a thread. */
export function applyDelta(thread: ThreadState, delta: TurnDelta): ThreadState {
  return {
    ...thread,
    title: thread.title ?? delta.title ?? null,
    messages: [...thread.messages, ...delta.messages],
    offers: [...thread.offers, ...delta.offers.filter((offer) => !thread.offers.some((had) => had.id === offer.id))],
    spentCredits: thread.spentCredits + delta.spent,
    budgetCredits: delta.budget ?? thread.budgetCredits,
  };
}

/** Credits she said this thread may spend without asking, less what it spent. Never below zero. */
export function budgetLeft(thread: Pick<ThreadState, "budgetCredits" | "spentCredits">): number {
  return Math.max(0, thread.budgetCredits - thread.spentCredits);
}

export function openOffers(thread: Pick<ThreadState, "offers">): Offer[] {
  return thread.offers.filter((offer) => offer.status === "open");
}

/** Her messages so far: the turn number of the next one is this plus one. */
export function turnsSoFar(messages: ThreadMessage[]): number {
  return messages.filter((message) => message.role === "her").length;
}

/** Her first message on one line, cut to 40 characters at a word where it can be. Matches the chat's own. */
export function threadTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= TITLE_CHARS) return line || "New chat";
  const cut = line.slice(0, TITLE_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * An offer's new status, on the offers list and on the offer message the chat
 * draws, and the job it started placed after it once (a second tap that found
 * the same job adds nothing).
 */
export function settleOffer(
  thread: ThreadState,
  offerId: string,
  status: Offer["status"],
  job?: Extract<ThreadMessage, { role: "job" }>,
): ThreadState {
  const offers = thread.offers.map((offer) => (offer.id === offerId ? { ...offer, status } : offer));
  let messages = thread.messages.map((message) =>
    message.role === "offer" && message.offer.id === offerId ? { ...message, offer: { ...message.offer, status } } : message,
  );
  if (job && !messages.some((message) => message.role === "job" && message.jobId === job.jobId)) {
    const at = messages.findIndex((message) => message.role === "offer" && message.offer.id === offerId);
    messages = at < 0 ? [...messages, job] : [...messages.slice(0, at + 1), job, ...messages.slice(at + 1)];
  }
  return { ...thread, offers, messages };
}

/** What the browser may see of a stored thread: tool lines as labels only, nothing the model was told or found. */
export function forBrowser(messages: ThreadMessage[]): ThreadMessage[] {
  return messages.map((message) => {
    if (message.role === "tool") return { role: "tool", name: message.name, label: message.label, args: {}, result: {}, at: message.at };
    if (message.role === "offer") {
      // The stored job request is the server's; the chat needs the button only.
      const { request: _request, ...offer } = message.offer;
      void _request;
      return { role: "offer", offer: offer as Offer, at: message.at };
    }
    if (message.role === "agent") return { ...message, text: stripNotes(message.text) };
    return message;
  });
}

/** Her message as the model reads it: her words, then the library items she attached, by id, so a tool can use them. */
export function herText(message: Extract<ThreadMessage, { role: "her" }>): string {
  const photos = message.material?.photos ?? [];
  const clip = message.material?.clip;
  const attached = [photos.length ? `photo ids ${photos.join(", ")}` : "", clip ? `clip id ${clip}` : ""].filter(Boolean).join("; ");
  const notes = [
    attached ? `[Attached from her library: ${attached}]` : "",
    // The pictures themselves were on the message only in the turn she sent them.
    message.screenshots ? `[She pasted ${message.screenshots === 1 ? "a screenshot" : `${message.screenshots} screenshots`} with this message, shown to you at the time and not kept.]` : "",
  ].filter(Boolean);
  return notes.length ? `${message.text}\n\n${notes.join("\n")}` : message.text;
}

function offerNote(offer: Offer): string {
  const state = offer.status === "open" ? "waiting for her tap" : offer.status === "accepted" ? "she accepted it" : "she said no";
  return `[Offered: ${offer.label}, ${offer.credits} credits. ${state}. Offer id ${offer.id}.]`;
}

function jobNote(message: Extract<ThreadMessage, { role: "job" }>): string {
  return `[Started: ${message.kind}, ${message.credits} credits, job ${message.jobId}${message.draftId ? `, draft ${message.draftId}` : ""}.]`;
}

/** One message as Gemini contents. A tool message is two: the call (model) and its answer (user). */
function messageContents(message: ThreadMessage): Content[] {
  switch (message.role) {
    case "her":
      return [{ role: "user", parts: [{ text: herText(message) }] }];
    case "agent":
      // Notes an earlier reply copied in (see notes.ts) are not read again, or the model keeps the habit.
      return stripNotes(message.text).trim() ? [{ role: "model", parts: [{ text: stripNotes(message.text) }] }] : [];
    case "tool": {
      const call: Part = {
        functionCall: { name: message.name, args: (message.args ?? {}) as Record<string, unknown> },
        ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}),
      };
      return [
        { role: "model", parts: [call] },
        { role: "user", parts: [{ functionResponse: { name: message.name, response: asResponse(message.result) } }] },
      ];
    }
    case "offer":
      return [{ role: "model", parts: [{ text: offerNote(message.offer) }] }];
    case "job":
      return [{ role: "model", parts: [{ text: jobNote(message) }] }];
  }
}

/** Gemini wants a function response to be an object. */
export function asResponse(result: unknown): Record<string, unknown> {
  return result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : { result };
}

const isCall = (part: Part) => "functionCall" in part;
const isAnswer = (part: Part) => "functionResponse" in part;

/**
 * Neighbouring contents of one role joined into one, the way Gemini wrote
 * them: a step's words and its calls are one model turn, and the answers to
 * several calls are one user turn. Two exceptions keep the pairing right: a
 * call that carries a signature starts a new model turn (Gemini signs the
 * first call of each step), and answers are never joined to her words.
 */
export function mergeAdjacent(contents: Content[]): Content[] {
  const merged: Content[] = [];
  for (const content of contents) {
    const last = merged[merged.length - 1];
    const joinable =
      last &&
      last.role === content.role &&
      !(content.role === "model" && content.parts.some((part) => isCall(part) && part.thoughtSignature) && last.parts.some(isCall)) &&
      !(content.role === "model" && last.parts.some(isCall) && content.parts.some((part) => !isCall(part))) &&
      !(content.role === "user" && last.parts.some(isAnswer) !== content.parts.some(isAnswer));
    if (joinable) merged[merged.length - 1] = { ...last, parts: [...last.parts, ...content.parts] };
    else merged.push({ ...content, parts: [...content.parts] });
  }
  return merged;
}

/**
 * Tool messages of one step back in order: every call of the step, then
 * every answer. Stored one tool message at a time, a step of two calls would
 * otherwise come back as call, answer, call, answer, which Gemini refuses.
 */
function stepContents(messages: ThreadMessage[]): Content[] {
  const out: Content[] = [];
  let calls: Content[] = [];
  let answers: Content[] = [];
  const flush = () => {
    out.push(...calls, ...answers);
    calls = [];
    answers = [];
  };
  for (const message of messages) {
    if (message.role !== "tool") {
      flush();
      out.push(...messageContents(message));
      continue;
    }
    // A signed call is the first of a new step.
    if (message.thoughtSignature && calls.length) flush();
    const [call, answer] = messageContents(message);
    calls.push(call);
    answers.push(answer);
  }
  flush();
  return out;
}

/** A short line per folded message, so the model keeps the gist of what came before. */
function foldedNote(messages: ThreadMessage[]): string {
  const lines = messages.flatMap((message) => {
    if (message.role === "her") return [`She said: ${message.text.replace(/\s+/g, " ").slice(0, 160)}`];
    if (message.role === "agent" && message.text.trim()) return [`You said: ${message.text.replace(/\s+/g, " ").slice(0, 160)}`];
    if (message.role === "offer") return [offerNote(message.offer)];
    if (message.role === "job") return [jobNote(message)];
    return [];
  });
  return `[Earlier in this chat, folded:\n${lines.join("\n")}]`;
}

/**
 * The thread as Gemini contents. Past the cap, the oldest messages are folded
 * into one model note. The fold never splits a step: it moves forward past
 * any tool message so a call is never left without its answer.
 */
export function toContents(messages: ThreadMessage[], cap = MAX_THREAD_MESSAGES): Content[] {
  let start = Math.max(0, messages.length - cap);
  while (start > 0 && start < messages.length && messages[start].role === "tool") start++;
  const folded = start > 0 ? [{ role: "model" as const, parts: [{ text: foldedNote(messages.slice(0, start)) }] }] : [];
  return mergeAdjacent([...folded, ...stepContents(messages.slice(start))]);
}
