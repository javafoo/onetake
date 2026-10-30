import type { Content, generateTurn as GenerateTurn, InlineImage, Part } from "@/ai/gemini";
import type { AskOptions } from "@/agent/options";
import type { BrandProfile } from "@/content/hooks";
import { isUserFacing } from "@/lib/errors";

import { toolLabel } from "./labels";
import { SYSTEM_PROMPT } from "./system";
import { createNoteFilter, stripNotes } from "./notes";
import { applyDelta, asResponse, budgetLeft, emptyDelta, threadTitle, toContents, turnsSoFar, type ThreadState, type TurnDelta } from "./thread";
import { runTool, STATEFUL, TOOLS, type ToolContext, type ToolDeps } from "./tools";
import type { ThreadMessage, TurnEvent } from "./types";

/* One turn of the chat: her message in, the agent's reply streamed out.

   Up to six rounds of the model. Each round it may write, call tools, or
   both; its calls are run (the reads side by side, anything that spends one
   at a time and in order), their answers go back, and it is asked again
   until it answers without a call. The model's own turn is appended to the
   contents as Gemini returned it, signatures and all, rather than rebuilt.

   Nothing here touches the database: the turn is read from a snapshot and
   returns what it adds (`TurnDelta`), which the caller applies to the newest
   row. That is also what keeps the thread consistent when something fails:
   whatever finished is in the delta, and nothing half-done is. */

export const MAX_ROUNDS = 6;
/* The route allows 300 seconds. Two slow rounds of the model are 2 minutes on a bad day (seen 2026-10-08),
   so the cap leaves room for them and still ends well before the route does. */
export const TURN_TIMEOUT_MS = 200_000;

export interface LoopDeps {
  generateTurn: typeof GenerateTurn;
  tools: ToolDeps;
  /** Her Brand page, for the tools that need it (the hook writer's query). */
  profile: BrandProfile;
  /** Screens her message; throws a sentence she can read when it is refused. */
  screen(message: string): Promise<void>;
  /** The first user content: who she is and the reference matched to her message, read fresh each turn (`contextText`). */
  context(budgetLeft: number, message: string): Promise<string>;
  /** For errors not written for a person. */
  report?(error: unknown): void;
  /** One line per round and per tool step: how long each took. Never her words. */
  log?(line: string): void;
  timeoutMs?: number;
}

export type TurnInput = {
  message: string;
  requestId: string;
  material?: { photos: string[]; clip?: string };
  /** Screenshots she pasted: shown to the model this turn, screened already, never stored. */
  images?: InlineImage[];
  /** The pickers in her box (text look, models, shape, format, layout), applied to what the tools make. */
  options?: AskOptions;
  at: string;
};

const TOO_MANY_ROUNDS = "I stopped there because that took more steps than one message allows. Tell me what to do next.";
const SLOW_STARTED = "That took too long to write up, but your request is already running. Look for it above or in your Library. Please don't send it again.";
const SLOW_OFFERED = "That took too long, so I stopped. The offer above is ready: tap it to start.";
const SLOW_DONE = "That took too long, so I stopped. What is above is done. Ask again for the rest.";
const SLOW_NOTHING = "That took too long, so I stopped. Nothing was started. Send your message again.";
const BLOCKED = "Google's filter would not read that message. Try saying it another way.";
const FAILED = "Something went wrong on our side. What is above is done. Try again in a moment.";

/**
 * What a turn that ran out of time says. It depends on what already
 * happened: "send it again" is wrong advice once a job has started, because
 * a second message could start a second one.
 */
export function slowMessage(delta: TurnDelta): string {
  if (delta.messages.some((message) => message.role === "job")) return SLOW_STARTED;
  if (delta.offers.length) return SLOW_OFFERED;
  if (delta.messages.some((message) => message.role === "tool")) return SLOW_DONE;
  return SLOW_NOTHING;
}

/** The reply to a turn that ended in an error, in words she can read. */
function turnError(error: unknown, signal: AbortSignal, delta: TurnDelta): string {
  if (signal.aborted) return slowMessage(delta);
  if (error instanceof Error && error.name === "ContentBlockedError") return BLOCKED;
  if (isUserFacing(error)) return (error as Error).message;
  return FAILED;
}

/**
 * Run one turn. `emit` gets every event in order, `done` last. Returns what
 * the turn adds to the thread; it never throws for anything a turn can do.
 */
export async function runTurn(deps: LoopDeps, thread: ThreadState, input: TurnInput, emit: (event: TurnEvent) => void, signal?: AbortSignal): Promise<TurnDelta> {
  const delta = emptyDelta();
  const images = input.images ?? [];
  const her: ThreadMessage = {
    role: "her",
    text: input.message,
    at: input.at,
    requestId: input.requestId,
    ...(input.material ? { material: input.material } : {}),
    ...(images.length ? { screenshots: images.length } : {}),
  };
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? TURN_TIMEOUT_MS);
  const bound = signal ? AbortSignal.any([signal, timeout]) : timeout;
  /* Pulled when the screen says no, so a refused message's round is not waited for. Separate from
     `bound`, which is what says "too slow". */
  const refused = new AbortController();
  let round = 0;

  /* The screen runs beside the first round rather than before it: it is a
     model call of its own and the same seconds as a round. Until it answers,
     the round's words are held back, so nothing from a refused message is
     shown; and a refused message is not written to the thread, so it is
     never sent to a model again. */
  let held: string[] | null = [];
  const screened = deps.screen(input.message).then(
    () => {
      const pieces = held ?? [];
      held = null;
      for (const piece of pieces) emit({ type: "text", delta: piece });
    },
    (error: unknown) => {
      refused.abort();
      throw error;
    },
  );
  screened.catch(() => {});
  const keepHer = () => {
    if (delta.messages.includes(her)) return;
    delta.messages.unshift(her);
    if (!thread.title) delta.title = threadTitle(input.message);
  };

  try {
    const left = () => budgetLeft(applyDelta(thread, delta));
    const context = await deps.context(left(), input.message);
    const contents: Content[] = [
      { role: "user", parts: [{ text: context }] },
      { role: "model", parts: [{ text: "Understood." }] },
      ...toContents([...thread.messages, her]),
    ];
    // The screenshots ride on her message this once; the thread keeps only their number.
    contents[contents.length - 1].parts.push(...images.map((image): Part => ({ inlineData: { mimeType: image.mimeType, data: image.data.toString("base64") } })));
    const turn = turnsSoFar(thread.messages) + 1;
    let calls = 0;

    for (round = 1; round <= MAX_ROUNDS; round++) {
      if (bound.aborted) throw new Error("aborted");
      let streamed = "";
      let result;
      // The model sometimes copies the app's "[Offered: …]" notes into its reply; they are invented there (see notes.ts).
      const notes = createNoteFilter((piece) => {
        streamed += piece;
        if (held) held.push(piece);
        else emit({ type: "text", delta: piece });
      });
      const roundStart = Date.now();
      try {
        result = await deps.generateTurn({
          system: SYSTEM_PROMPT,
          contents,
          tools: TOOLS,
          signal: AbortSignal.any([bound, refused.signal]),
          // The rounds decide which tool to call; the writers behind the tools do the thinking.
          thinking: "low",
          onText: notes.push,
        });
        notes.end();
        await screened;
      } catch (error) {
        // A refused message is the error that counts, whatever the round did.
        await screened;
        keepHer();
        // What she already read stays in the thread, so a reload shows it.
        if (streamed.trim()) delta.messages.push({ role: "agent", text: streamed, at: new Date().toISOString() });
        throw error;
      }
      deps.log?.(`round ${round} model ${Date.now() - roundStart}ms calls ${result.calls.map((call) => call.name).join(",") || "none"}`);
      keepHer();
      const reply = stripNotes(result.text);
      if (reply.trim()) delta.messages.push({ role: "agent", text: reply, at: new Date().toISOString() });
      if (!result.calls.length) break;
      if (round === MAX_ROUNDS) {
        emit({ type: "text", delta: `${result.text ? "\n\n" : ""}${TOO_MANY_ROUNDS}` });
        delta.messages.push({ role: "agent", text: TOO_MANY_ROUNDS, at: new Date().toISOString() });
        break;
      }

      const ctx = (): ToolContext => ({ threadId: thread.id, avatarId: thread.avatarId, turn, message: input.message, profile: deps.profile, budgetLeft: left(), ...(input.options ? { options: input.options } : {}), ...(images.length ? { screenshots: images } : {}) });
      const numbered = result.calls.map((call, index) => ({ call, index, n: ++calls }));
      for (const { call } of numbered) emit({ type: "tool", label: toolLabel(call.name) });

      // Reads run side by side; anything that spends runs alone and in order, so a budget is never spent twice.
      const toolsStart = Date.now();
      const outcomes = new Array<Awaited<ReturnType<typeof runTool>>>(numbered.length);
      await Promise.all(
        numbered
          .filter(({ call }) => !STATEFUL.has(call.name))
          .map(async ({ call, index, n }) => {
            outcomes[index] = await runTool(call, ctx(), deps.tools, n, deps.report);
          }),
      );
      for (const { call, index, n } of numbered.filter(({ call }) => STATEFUL.has(call.name))) {
        const done = await runTool(call, ctx(), deps.tools, n, deps.report);
        // Applied at once, so the next paid call in this round sees what is left.
        delta.spent += done.spent;
        if (done.budget !== undefined) delta.budget = done.budget;
        outcomes[index] = { ...done, spent: 0, budget: undefined };
      }

      deps.log?.(`round ${round} tools ${Date.now() - toolsStart}ms`);
      const at = new Date().toISOString();
      const extras: ThreadMessage[] = [];
      const answers: Part[] = [];
      numbered.forEach(({ call, index }) => {
        const done = outcomes[index];
        delta.messages.push({
          role: "tool",
          name: call.name,
          label: done.label,
          args: call.args,
          result: done.stored ?? done.result,
          at,
          ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
        });
        extras.push(...done.messages);
        delta.offers.push(...done.offers);
        delta.spent += done.spent;
        if (done.budget !== undefined) delta.budget = done.budget;
        for (const event of done.events) emit(event);
        answers.push({ functionResponse: { name: call.name, response: asResponse(done.result) } });
      });
      // Offers and jobs after the step's tool messages, so a stored step reads back as calls then answers.
      delta.messages.push(...extras);
      /* A tool that only starts a job or makes an offer has already said what
         there is to say (the card carries the price and the button), so the
         reply is ours and the model is not asked again: that round took half a
         minute or more for one sentence. Anything else, a refusal included, goes back to the model. */
      const lines = numbered.map(({ index }) => outcomes[index].reply);
      if (lines.every((line): line is string => Boolean(line))) {
        const line = lines.join(" ");
        emit({ type: "text", delta: `${result.text.trim() ? "\n\n" : ""}${line}` });
        delta.messages.push({ role: "agent", text: line, at: new Date().toISOString() });
        break;
      }
      contents.push(result.content, { role: "user", parts: answers });
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === "ContentBlockedError") && !isUserFacing(error) && !bound.aborted) deps.report?.(error);
    // A message Google refused in the first round is not kept, or every later turn would be refused too.
    if (error instanceof Error && error.name === "ContentBlockedError" && round <= 1) {
      delta.messages = delta.messages.filter((message) => message !== her);
      delete delta.title;
    }
    emit({ type: "error", message: turnError(error, bound, delta) });
  }
  emit({ type: "done", threadId: thread.id });
  return delta;
}
