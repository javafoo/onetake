import { ownMaterial, readyAvatar } from "@/agent/ask";
import { MAX_MATERIAL_PHOTOS, MAX_MESSAGE_CHARS, type Material } from "@/agent/plan";
import type { AskOptions } from "@/agent/options";
import { decodeScreenshots } from "@/agent/screenshots";
import type { InlineImage } from "@/ai/gemini";
import { liveLoopDeps } from "@/agent/v2/live";
import { runTurn } from "@/agent/v2/loop";
import { applyDelta } from "@/agent/v2/thread";
import type { TurnEvent } from "@/agent/v2/types";
import { getBrief } from "@/data/brand";
import { isUuid } from "@/data/ids";
import { claimTurn, getThread, mutateThread } from "@/data/threads";
import { requireUser, type User } from "@/data/users";
import { BudgetExceededError } from "@/jobs/budget";
import { EmailNotVerifiedError } from "@/lib/email-gate";
import { isUserFacing, logUnexpected, userMessage } from "@/lib/errors";
import { RateLimitedError } from "@/lib/rate-limit";
import { withModelSpend } from "@/spend";

/* One chat turn, streamed back as Server-Sent Events (`TurnEvent`, one per
   `data:` line). The session is checked, the thread is looked up as hers, a
   resent message (same request id as the thread's last turn) is answered
   once, and the whole turn runs inside the chat allowance and the global
   cap. Her message is screened before any model reads it (inside the loop).

   A refusal that comes before the stream starts (signed out, no such chat,
   over today's limit) is an ordinary status code, so the chat can say so and
   give her words back. Anything after is an `error` event, then `done`. */

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Body = { threadId: string; message: string; requestId: string; material?: Material; images: InlineImage[]; options?: AskOptions };

/* The pickers in her box, as the first chat sends them. Shapes only: every
   value is checked by name where it is applied (`withOptions`), so an unknown
   model or look is the default rather than an error. */
function parseOptions(raw: unknown): AskOptions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const given = raw as Record<string, unknown>;
  const text = (key: string) => (typeof given[key] === "string" ? (given[key] as string).slice(0, 40) : undefined);
  const options: AskOptions = {
    ...(text("style") ? { style: text("style") as AskOptions["style"] } : {}),
    ...(text("size") ? { size: text("size") as AskOptions["size"] } : {}),
    ...(typeof given.lowercase === "boolean" ? { lowercase: given.lowercase } : {}),
    ...(text("imageModel") ? { imageModel: text("imageModel") as AskOptions["imageModel"] } : {}),
    ...(text("imageAspect") ? { imageAspect: text("imageAspect") as AskOptions["imageAspect"] } : {}),
    ...(text("clipModel") ? { clipModel: text("clipModel") as AskOptions["clipModel"] } : {}),
    ...(given.format === "carousel" || given.format === "story" ? { format: given.format } : {}),
    ...(text("layout") ? { layout: text("layout") } : {}),
    ...(given.aspectPicked === true ? { aspectPicked: true } : {}),
  };
  return Object.keys(options).length ? options : undefined;
}

/** The body, checked. Ids are only shapes here; each is looked up as hers before it is used. */
function parseBody(raw: unknown): Body | string {
  const body = (raw ?? {}) as Record<string, unknown>;
  const threadId = typeof body.threadId === "string" ? body.threadId : "";
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!isUuid(threadId) || !isUuid(requestId)) return "This chat is out of date. Reload the page.";
  if (!message) return "Say what you want made.";
  if (message.length > MAX_MESSAGE_CHARS) return `Keep it under ${MAX_MESSAGE_CHARS} characters.`;
  let images: InlineImage[];
  try {
    images = decodeScreenshots(body.screenshots);
  } catch (error) {
    return userMessage("agent v2 screenshots", error);
  }
  const options = parseOptions(body.options);
  const material = body.material as { photos?: unknown; clip?: unknown } | undefined;
  if (!material) return { threadId, requestId, message, images, ...(options ? { options } : {}) };
  const photos = Array.isArray(material.photos) ? material.photos.filter((id): id is string => typeof id === "string" && isUuid(id)).slice(0, MAX_MATERIAL_PHOTOS) : [];
  const clip = typeof material.clip === "string" && isUuid(material.clip) ? material.clip : undefined;
  return { threadId, requestId, message, images, ...(options ? { options } : {}), ...(photos.length || clip ? { material: { photos, ...(clip ? { clip } : {}) } } : {}) };
}

const encoder = new TextEncoder();
const frame = (event: TurnEvent) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
const SSE_HEADERS = { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" };

export async function POST(request: Request): Promise<Response> {
  let user: User;
  try {
    user = await requireUser();
  } catch {
    return json({ error: "Not signed in" }, 401);
  }

  const body = parseBody(await request.json().catch(() => null));
  if (typeof body === "string") return json({ error: body }, 400);
  const thread = await getThread(user.id, body.threadId);
  if (!thread) return json({ error: "That chat is gone." }, 404);

  // A delivery of the turn already taken gets an empty answer, not a second reply.
  if (!(await claimTurn(user.id, thread.id, body.requestId))) {
    return new Response(new Blob([frame({ type: "done", threadId: thread.id })]).stream(), { headers: SSE_HEADERS });
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    // She left: the turn still finishes and is saved, so the chat shows it when she comes back.
    cancel() {
      controller = null;
    },
  });
  const send = (event: TurnEvent) => {
    try {
      controller?.enqueue(frame(event));
    } catch {
      controller = null;
    }
  };
  const close = () => {
    try {
      controller?.close();
    } catch {
      // Already closed.
    }
  };

  let opened: () => void = () => {};
  const open = new Promise<"open">((resolve) => (opened = () => resolve("open")));

  const work = withModelSpend(user, { limit: "chat", shape: "agent_turn" }, async () => {
    opened();
    let ready;
    let material: Material | undefined;
    try {
      ready = await readyAvatar(user, thread.avatarId);
      material = body.material ? ((await ownMaterial(user.id, ready.avatar.id, body.material)).material ?? undefined) : undefined;
      /* Screenshots are screened before anything reads them, under the same
         rule as an upload: a refused one stops here, and the message is not
         kept. The vision allowance counts them, not the chat one. */
      if (body.images.length) {
        await withModelSpend(user, { limit: "vision", shape: "screen_photo", cost: body.images.length }, async () => {
          const { screenPhoto } = await import("@/safety/screen");
          const { refuse } = await import("@/safety/refusals");
          for (const image of body.images) {
            const verdict = await screenPhoto(image);
            if (!verdict.ok) await refuse(user.id, "upload", verdict);
          }
        });
      }
    } catch (error) {
      send({ type: "error", message: userMessage("agent v2 turn", error) });
      send({ type: "done", threadId: thread.id });
      return;
    }
    const brief = await getBrief(user.id, ready.avatar.id);
    const deps = liveLoopDeps(user, ready.avatar, ready.profile, brief, thread.id);
    const delta = await runTurn(deps, thread, { message: body.message, requestId: body.requestId, at: new Date().toISOString(), ...(material ? { material } : {}), ...(body.images.length ? { images: body.images } : {}), ...(body.options ? { options: body.options } : {}) }, send);
    if (delta.messages.length || delta.offers.length || delta.spent || delta.budget !== undefined) {
      await mutateThread(user.id, thread.id, (current) => applyDelta(current, delta));
    }
  });

  const first = await Promise.race([open, work.then(() => "open" as const, (error: unknown) => error)]);
  if (first !== "open") return refused(first);

  work
    .catch((error: unknown) => {
      send({ type: "error", message: isUserFacing(error) ? (error as Error).message : userMessage("agent v2 turn", error) });
      send({ type: "done", threadId: thread.id });
    })
    .finally(close);

  return new Response(stream, { headers: SSE_HEADERS });
}

/** A turn refused before it began: the limit, an unconfirmed email, our own cap. */
function refused(error: unknown): Response {
  if (error instanceof RateLimitedError) return json({ error: error.message }, 429);
  if (error instanceof EmailNotVerifiedError) return json({ error: error.message }, 403);
  if (error instanceof BudgetExceededError) return json({ error: error.message }, 503);
  if (isUserFacing(error)) return json({ error: (error as Error).message }, 400);
  logUnexpected("agent v2 turn", error);
  return json({ error: "The agent could not answer just now. Try again in a moment." }, 500);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
