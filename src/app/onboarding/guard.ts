import "server-only";

import { redirect } from "next/navigation";

import { flowStateFor } from "@/data/onboarding";
import { requireUser } from "@/data/users";

import { canVisit, resumePath, type Stage } from "./flow";

/* What every setup screen does before it renders: work out where this account
   actually is, and refuse to draw a screen it has not earned. Going back to
   change an answer is always allowed; jumping to the review screen with three
   questions unanswered is not, and typing that URL lands on the first gap. */

export async function openStage(target: Stage) {
  const user = await requireUser();
  const state = await flowStateFor(user.id);
  if (!canVisit(target, state.flow)) redirect(resumePath(state.flow));
  return { user, ...state };
}
