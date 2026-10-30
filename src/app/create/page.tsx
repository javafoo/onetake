import Link from "next/link";

import { agentCredits } from "@/agent/plan";
import { spendableBalance } from "@/billing/credits";
import { PHOTO_CREDITS, creditsWord, formatCredits } from "@/billing/gate";
import { listThreadsAction } from "@/app/create/v2-actions";
import { ChatV2 } from "@/components/agent/chat-v2";
import { PaidActionNotice } from "@/components/billing/paid-action-gate";
import { buttonClass, EmptyState, PageHeader } from "@/components/ui";
import { identityLock } from "@/data/avatars";
import { getProfile, profileComplete } from "@/data/brand";
import { requireUser } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";

export const dynamic = "force-dynamic";

/* The run's first step (writing the hook) runs after the response that started
   it, inside this route's time limit. */
export const maxDuration = 300;

const REEL_CREDITS = agentCredits({ kind: "reel", brief: "", footage: "auto", cue: "auto", talking: false });

/* Create: the agent's chat. One message can become a whole run of photos,
   reels and carousels; anything that costs credits is offered with its price
   before it starts. */
export default async function CreatePage() {
  const user = await requireUser();
  const avatar = await currentAvatar(user.id);
  const [profile, credits, listed] = await Promise.all([
    getProfile(user.id, avatar?.id ?? null),
    spendableBalance(user.id),
    listThreadsAction(),
  ]);
  const ready = Boolean(avatar) && profileComplete(profile) && Boolean(identityLock(avatar));

  return (
    <>
      <PageHeader eyebrow="Create" title="Say what you want made" />

      {!ready ? (
        <EmptyState
          title="Two things first"
          action={
            <Link href={avatar && profileComplete(profile) ? "/onboarding" : "/brand"} className={buttonClass("primary")}>
              {avatar && profileComplete(profile) ? "Finish her setup" : "Open the Brand page"}
            </Link>
          }
        >
          The agent writes in your voice from the Brand page and keeps her face from her setup, so both need to be done before it can make anything.
        </EmptyState>
      ) : (
        <>
          {/* Gated at a photo, the cheapest thing the agent makes, so a balance
              that still covers photos and carousels is not stopped early. */}
          <PaidActionNotice
            user={user}
            balance={credits}
            cost={PHOTO_CREDITS}
            noun="photo"
            lowCreditsDetail={`A photo costs ${creditsWord(PHOTO_CREDITS)} and a reel about ${creditsWord(REEL_CREDITS)}. You have ${formatCredits(credits)} left.`}
            className="mb-6"
          />
          <ChatV2 threads={listed.ok ? listed.threads : []} />
        </>
      )}
    </>
  );
}
