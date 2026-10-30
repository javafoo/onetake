import Link from "next/link";

import { WeekStudio } from "@/components/week/week-studio";
import { buttonClass, EmptyState, PageHeader } from "@/components/ui";
import { balance, ensureFreeCredits } from "@/billing/credits";
import { getProfile, profileComplete } from "@/data/brand";
import { latestWeekId } from "@/data/weeks";
import { requireUser } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";
import { DEFAULT_WEEK_BUDGET } from "@/week/form";
import { liveWeekDeps } from "@/week/live";

export const dynamic = "force-dynamic";

/* Your week: the front door. She talks (or types) about her week; the agent
   turns it into finished posts. Prices are shown before she presses. */
export default async function WeekPage() {
  const user = await requireUser();
  const avatar = await currentAvatar(user.id);
  const profile = avatar ? await getProfile(user.id, avatar.id) : null;

  if (!avatar || !profile || !profileComplete(profile)) {
    return (
      <>
        <PageHeader eyebrow="Your week" title="Talk for two minutes. Get your week." />
        <EmptyState
          title="Set up your avatar and brand first"
          action={
            <Link href={avatar ? "/brand" : "/onboarding"} className={buttonClass("primary")}>
              {avatar ? "Fill in your brand" : "Set up your avatar"}
            </Link>
          }
        >
          The posts are made with your face and written in your voice, so the agent needs both first.
        </EmptyState>
      </>
    );
  }

  await ensureFreeCredits(user.id);
  const [credits, latest] = await Promise.all([balance(user.id), latestWeekId(user.id, avatar.id)]);

  return (
    <>
      <PageHeader
        eyebrow="Your week"
        title="Talk for two minutes. Get your week."
        lead="Tell me what happened this week: a client, a win, a number, a lesson, a struggle. I find what is worth posting, check what your niche is talking about, then write, review and make finished posts with your face, in your voice. Nothing is made up."
      />
      <WeekStudio prices={liveWeekDeps.prices()} defaultBudget={DEFAULT_WEEK_BUDGET} credits={credits} latestWeekId={latest} />
    </>
  );
}
