"use server";

import { unstable_rethrow } from "next/navigation";

import { affordable, NeedsBillingError } from "@/agent/ask";
import { acceptOffer, declineOffer, type OfferDeps } from "@/agent/v2/offers";
import { forBrowser, type ThreadState } from "@/agent/v2/thread";
import type { ThreadMessage } from "@/agent/v2/types";
import { createThread, getThread, listThreads, mutateThread } from "@/data/threads";
import { requireUser, type User } from "@/data/users";
import { getJobRecord, startJobOnce } from "@/jobs";
import { currentAvatar } from "@/lib/current-avatar";
import { userMessage } from "@/lib/errors";

/* The chat's server actions: start a thread, list and open them, and her tap
   on an offer. Each one checks the session first and reads only her rows; a
   thread id from the browser is looked up as hers before anything else. The
   shapes below are what the chat (`chat-v2.tsx`) relies on. */

/** A thread in the drawer. */
export type ThreadSummary = { id: string; title: string; updatedAt: string };
/** A thread opened from the drawer. */
export type ThreadDetail = { id: string; title: string; messages: ThreadMessage[] };

type Problem = { ok: false; message: string; fix?: { label: string; href: string } };

export type StartThreadResult = { ok: true; threadId: string } | Problem;
export type ListThreadsResult = { ok: true; threads: ThreadSummary[] } | Problem;
export type OpenThreadResult = { ok: true; thread: ThreadDetail } | Problem;
/** An accepted offer: the job it started, polled through /api/jobs/[id]. A second tap gets the same job. */
export type AcceptOfferResult = { ok: true; jobId: string; kind: string; credits: number; draftId?: string } | Problem;
export type DeclineOfferResult = { ok: true } | Problem;

/** Signed in, or the reason in words. */
async function signedIn(where: string): Promise<User | Problem> {
  try {
    return await requireUser();
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: userMessage(where, error) };
  }
}

const isProblem = (value: unknown): value is Problem => typeof value === "object" && value !== null && (value as Problem).ok === false;

function problem(where: string, error: unknown): Problem {
  unstable_rethrow(error);
  if (error instanceof NeedsBillingError) return { ok: false, message: error.message, fix: error.fix };
  return { ok: false, message: userMessage(where, error) };
}

/** A new thread on the avatar she has switched to. */
export async function startThreadAction(): Promise<StartThreadResult> {
  const user = await signedIn("startThreadAction");
  if (isProblem(user)) return user;
  try {
    const avatar = await currentAvatar(user.id);
    if (!avatar) return { ok: false, message: "Finish her setup first.", fix: { label: "Go to setup", href: "/onboarding" } };
    return { ok: true, threadId: (await createThread(user.id, avatar.id)).id };
  } catch (error) {
    return problem("startThreadAction", error);
  }
}

/** The newest ten threads on the avatar she has switched to. */
export async function listThreadsAction(): Promise<ListThreadsResult> {
  const user = await signedIn("listThreadsAction");
  if (isProblem(user)) return user;
  try {
    const avatar = await currentAvatar(user.id);
    if (!avatar) return { ok: true, threads: [] };
    const threads = await listThreads(user.id, avatar.id, 10);
    return { ok: true, threads: threads.map((thread) => ({ id: thread.id, title: thread.title, updatedAt: thread.updatedAt.toISOString() })) };
  } catch (error) {
    return problem("listThreadsAction", error);
  }
}

/**
 * One thread, as the chat draws it. A job's draft is not known when an agent
 * run starts (the run writes it), so it is read off the run here, once there
 * is one, so the chat can heart the set or the reel.
 */
export async function openThreadAction(threadId: string): Promise<OpenThreadResult> {
  const user = await signedIn("openThreadAction");
  if (isProblem(user)) return user;
  try {
    const thread = await getThread(user.id, threadId);
    if (!thread) return { ok: false, message: "That chat is gone." };
    const messages = await Promise.all(
      forBrowser(thread.messages).map(async (message) => {
        if (message.role !== "job" || message.draftId) return message;
        const record = await getJobRecord(user.id, message.jobId);
        const draftId = record?.input.kind === "agent" ? record.input.state?.draftId : undefined;
        return draftId ? { ...message, draftId } : message;
      }),
    );
    return { ok: true, thread: { id: thread.id, title: thread.title ?? "New chat", messages } };
  } catch (error) {
    return problem("openThreadAction", error);
  }
}

function offerDeps(user: User, threadId: string): OfferDeps {
  return {
    load: () => getThread(user.id, threadId),
    mutate: (change: (thread: ThreadState) => ThreadState | null) => mutateThread(user.id, threadId, change),
    affordable: (credits, noun) => affordable(user, credits, noun),
    async startJob(request) {
      const started = await startJobOnce(user, request);
      return { jobId: started.view.id, created: started.created };
    },
    now: () => new Date(),
  };
}

/** Her tap on an offer: the stored work, started once however often it is tapped. */
export async function acceptOfferAction(threadId: string, offerId: string): Promise<AcceptOfferResult> {
  const user = await signedIn("acceptOfferAction");
  if (isProblem(user)) return user;
  if (typeof offerId !== "string" || !offerId) return { ok: false, message: "That offer is gone. Ask again." };
  try {
    const accepted = await acceptOffer(offerDeps(user, String(threadId)), offerId);
    return { ok: true, ...accepted };
  } catch (error) {
    return problem("acceptOfferAction", error);
  }
}

/** She said no: the offer is closed, and the agent sees that next turn. */
export async function declineOfferAction(threadId: string, offerId: string): Promise<DeclineOfferResult> {
  const user = await signedIn("declineOfferAction");
  if (isProblem(user)) return user;
  try {
    if (!(await getThread(user.id, String(threadId)))) return { ok: false, message: "That chat is gone." };
    await declineOffer(offerDeps(user, String(threadId)), String(offerId));
    return { ok: true };
  } catch (error) {
    return problem("declineOfferAction", error);
  }
}
