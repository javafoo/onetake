import type { JobRecord, JobStatus } from "@/jobs/types";

import { FORMAT_LABEL, initialWeekState, STAGE_LABEL, STAGES, type Format, type LogEntry, type Stage, type WeekJobInput } from "./plan";

/* What the browser sees of a week: an allow-list, so nothing it was not meant
   to show (prompts, the child job ids, the voice note's path) can leak. Her
   own words and what the agent found in them are hers to read. */

export type WeekPostView = {
  format: Format;
  formatLabel: string;
  why: string;
  status: "planned" | "written" | "held" | "making" | "ready" | "failed";
  hook?: string;
  caption?: string;
  cta?: string;
  spoken?: string;
  score?: number;
  rewritten: boolean;
  change?: string;
  trend?: { title: string; url: string };
  mediaIds: string[];
  /** What to show of the post: the reel, the slides, or the finished photo. Filled by the poll. */
  show: { id: string; video: boolean }[];
  error?: string;
};

export type WeekView = {
  id: string;
  status: JobStatus;
  error: string | null;
  stage: Stage;
  stages: { stage: Stage; label: string; state: "done" | "now" | "later" }[];
  transcript?: string;
  facts: string[];
  log: LogEntry[];
  posts: WeekPostView[];
  summary?: string;
  creditsSpent: number;
  createdAt: string;
};

export function isWeekRecord(record: JobRecord): record is JobRecord & { input: WeekJobInput } {
  return record.kind === "week" && record.input.kind === "week";
}

export function weekView(record: JobRecord & { input: WeekJobInput }): WeekView {
  const state = record.input.state ?? initialWeekState(record.input);
  const at = STAGES.indexOf(state.stage);
  const failed = record.status === "failed";
  return {
    id: record.id,
    status: record.status,
    error: record.error,
    stage: state.stage,
    stages: STAGES.filter((stage) => stage !== "listen" || record.input.audio).map((stage) => {
      const index = STAGES.indexOf(stage);
      const done = index < at || (stage === "done" && record.status === "completed");
      return { stage, label: STAGE_LABEL[stage], state: done ? "done" : index === at && !failed ? "now" : "later" };
    }),
    ...(state.transcript ? { transcript: state.transcript } : {}),
    facts: state.facts.map((fact) => fact.text),
    log: state.log,
    posts: state.posts.map((post) => {
      const trend = post.trend === undefined ? undefined : state.trends[post.trend];
      return {
        format: post.format,
        formatLabel: FORMAT_LABEL[post.format],
        why: post.why,
        status: post.status,
        ...(post.idea ? { hook: post.idea.hook, caption: post.idea.caption, cta: post.idea.cta, ...(post.idea.spoken ? { spoken: post.idea.spoken } : {}) } : {}),
        ...(post.review ? { score: post.review.score } : {}),
        rewritten: Boolean(post.rewritten),
        ...(post.change ? { change: post.change } : {}),
        ...(trend ? { trend: { title: trend.title, url: trend.url } } : {}),
        mediaIds: post.mediaIds,
        show: [],
        ...(post.error ? { error: post.error } : {}),
      };
    }),
    ...(state.summary ? { summary: state.summary } : {}),
    creditsSpent: state.creditsSpent,
    createdAt: record.createdAt.toISOString(),
  };
}

type MediaKind = "upload" | "reference" | "image" | "clip" | "reel" | "slide";

/**
 * Of what a post's run made, the finished thing: the reel for a reel (not the
 * photo and clip it was built from), the slides for a set, and the last photo
 * for a photo post (the copy with the hook on it). Pure.
 */
export function finishedMedia(media: { id: string; kind: MediaKind }[]): { id: string; video: boolean }[] {
  const reels = media.filter((item) => item.kind === "reel");
  if (reels.length) return reels.map(({ id }) => ({ id, video: true }));
  const slides = media.filter((item) => item.kind === "slide");
  if (slides.length) return slides.map(({ id }) => ({ id, video: false }));
  const last = media.filter((item) => item.kind === "image").at(-1);
  return last ? [{ id: last.id, video: false }] : [];
}
