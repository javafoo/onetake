import { Ask } from "@/components/onboarding/progress";
import { FirstPhotoStudio } from "@/components/onboarding/first-photo";
import { SetupScreen } from "@/components/onboarding/screen";
import { Note } from "@/components/ui";
import { getAvatar, identityLock } from "@/data/avatars";
import { freePhotoState } from "@/data/freebie";
import { hasVerifiedEmail } from "@/data/users";
import { suggestedScene } from "@/jobs/free-photo";

import { generateFirstPhotoAction, openOverviewAction } from "../actions";
import { openStage } from "../guard";

export const dynamic = "force-dynamic";

/* Photo jobs keep working after the response, inside this route's time limit.
   A photo takes about a minute; without this Vercel would stop the job early
   and it would be written off instead of finished. */
export const maxDuration = 300;

/* The last screen of setup, and the first thing the product actually does for
   her. Everything before this was her describing an avatar; this is the avatar.

   One photo, free, once per account for the lifetime of the account. The screen
   is deliberately thin: a suggested scene she can edit, one button, and a skip.
   Whether she still has the freebie is read here for the rendering and claimed
   again atomically inside the action, because a page read is a snapshot and the
   claim is what has to be true. */

export default async function FirstPhotoPage() {
  const { user, session } = await openStage("first-photo");
  const avatar = await getAvatar(user.id, session?.ui.avatarId ?? "");
  const lock = identityLock(avatar);
  const [freebie, emailVerified] = await Promise.all([freePhotoState(user.id), hasVerifiedEmail(user.id)]);

  return (
    <SetupScreen stage="first-photo">
      <Ask help="No card, no credits. One photo, so you can see what the rest of this looks like before you spend a credit.">
        Her first photo
      </Ask>

      {!lock ? (
        <Note tone="warn">
          Photos are made from her description and her reference set, and one of them is missing. Go back a step and
          save her description, then come here.
        </Note>
      ) : (
        <FirstPhotoStudio
          suggestion={suggestedScene(lock.scenes)}
          generate={generateFirstPhotoAction}
          openOverview={openOverviewAction}
          blocked={!freebie.available ? "already_used" : emailVerified ? null : "unverified_email"}
        />
      )}
    </SetupScreen>
  );
}
