import Link from "next/link";

import { buttonClass } from "@/components/ui";
import { flowStateFor } from "@/data/onboarding";
import { requireUser } from "@/data/users";
import { progress } from "@/onboarding/state";

import { resumePath } from "../flow";

export const dynamic = "force-dynamic";

/** "Save and finish later" lands here rather than on the dashboard, because the
    dashboard is not hers until setup is done and bouncing her off it would be a
    worse lie than this page. It says what is saved and how to come back. */
export default async function PausedPage() {
  const user = await requireUser();
  const { session, flow } = await flowStateFor(user.id);
  const done = session ? progress(session.interview).done : 0;
  const name = session?.interview.setup.personaName;

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="flex min-h-[70vh] flex-col justify-center">
        <h1 className="font-display text-3xl tracking-tight text-balance text-ink">Saved.</h1>
        <p className="mt-3 text-base text-pretty text-ink-soft">
          {name ? `${name} is waiting for you.` : "Your answers are safe."} Nothing is lost when you close this. Come
          back to the same link on any device and it opens where you stopped.
        </p>
        {done > 0 && (
          <p className="mt-2 text-sm text-muted">
            {done} of 7 questions answered.
          </p>
        )}
        <Link href={resumePath(flow)} className={buttonClass("primary", "lg", "mt-8 w-full")}>
          Carry on
        </Link>
        {user.onboardedAt ? (
          /* A second avatar: the app is already hers, so the way back is Avatars, not a wait. */
          <Link href="/avatars" className={buttonClass("ghost", "sm", "mt-3 w-full")}>
            Back to your avatars
          </Link>
        ) : (
          <p className="mt-4 text-xs text-muted">
            The rest of the app opens once setup is done: it needs her face and her brief before it can write anything.
          </p>
        )}
      </div>
    </div>
  );
}
