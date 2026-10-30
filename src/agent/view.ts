import type { JobRecord } from "@/jobs/types";

import { agentCredits, carryOver, initialState, remainingCredits, type AgentJobInput, type AgentRequest, type AgentState, type Direction, type SceneIdea, type Step } from "./plan";
import type { PostIdea } from "@/content/hooks";

/* What the chat shows for one run. Plain JSON, built from the run's own row:
   no child ids, no provider handles. */

export type AgentView = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  error: string | null;
  createdAt: string;
  updatedAt: string;
  message: string;
  reply: string;
  request: AgentRequest;
  steps: Step[];
  post: PostIdea | null;
  direction: Direction | null;
  scenes: SceneIdea[] | null;
  mediaIds: string[];
  creditsSpent: number;
  /** The most this run can charge, from its request. */
  estimatedCredits: number;
  /** What "Try again from here" would charge: the paid steps not yet done. Zero unless the run failed. */
  retryCredits: number;
  summary: string | null;
  draftId: string | null;
  resumedFrom: string | null;
  attachments: number;
};

export function isAgentRecord(record: JobRecord): record is JobRecord & { input: AgentJobInput } {
  return record.kind === "agent" && record.input.kind === "agent";
}

export function agentView(record: JobRecord & { input: AgentJobInput }): AgentView {
  const input = record.input;
  const state: AgentState = input.state ?? initialState(input.request);
  return {
    id: record.id,
    status: record.status,
    error: record.error,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    message: input.message,
    reply: input.reply,
    request: input.request,
    steps: state.steps,
    post: state.post ?? null,
    direction: state.direction ?? null,
    scenes: state.scenes ?? null,
    mediaIds: record.output?.mediaIds ?? state.mediaIds,
    creditsSpent: state.creditsSpent,
    estimatedCredits: agentCredits(input.request),
    retryCredits: record.status === "failed" ? remainingCredits(input.request, initialState(input.request, carryOver(state))) : 0,
    summary: record.status === "completed" ? (record.output?.message ?? state.summary ?? null) : null,
    draftId: state.draftId ?? null,
    resumedFrom: input.resumedFrom ?? null,
    attachments: input.attachments ?? 0,
  };
}
