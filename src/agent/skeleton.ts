import { SKELETONS, type Skeleton } from "@/carousel/write";

/* Which shape a set takes, from the words of the request. Pure and plain: a
   model would do this too, but a person can read a rule, and the four shapes
   are different enough that a few words decide it. */

export type SkeletonPick = { id: Skeleton; label: string; why: string };

const LABEL: Record<Skeleton, string> = {
  list: "a numbered list",
  case_study: "a story with a result",
  statement: "a position, argued",
  tutorial: "a walk-through",
};

export function pickSkeleton(brief: string): SkeletonPick {
  const text = brief.toLowerCase();
  const pick = (id: Skeleton, why: string): SkeletonPick => ({ id, label: LABEL[id], why });
  if (/\b(how to|how i|step|steps|walk ?through|tutorial|set ?up|guide)\b/.test(text)) return pick("tutorial", "You asked how to do something, so each slide is one step.");
  if (/\b(\d+|three|four|five|six|seven|ten)\s+(things|ways|tips|mistakes|lessons|reasons|rules|signs|habits)\b|\b(tips|mistakes|lessons|reasons)\b/.test(text)) {
    return pick("list", "You named a set of things, so each slide is one of them.");
  }
  if (/\b(story|journey|what happened|how i went|before and after|went from|my first)\b/.test(text)) return pick("case_study", "It is a story, so the slides follow what changed.");
  return pick("statement", "It is a point of view, so the slides argue it.");
}

export const SKELETON_IDS = Object.keys(SKELETONS) as Skeleton[];
