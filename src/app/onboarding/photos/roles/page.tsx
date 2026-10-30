import { toReference, type InlineImage } from "@/ai/gemini";
import { ActionForm } from "@/components/action-form";
import { Ask } from "@/components/onboarding/progress";
import { RolePicker } from "@/components/onboarding/role-picker";
import { SetupScreen } from "@/components/onboarding/screen";
import { Note } from "@/components/ui";
import { listReferences } from "@/data/avatars";
import { withLocalFile } from "@/data/media";
import { saveSession } from "@/data/onboarding";
import { withModelSpend } from "@/spend";

import { saveRolesAction } from "../../actions";
import { proposeRoles } from "../../curate";
import { openStage } from "../../guard";
import { assignRoles, cleanProposals, ROLE_ORDER, type RoleProposal } from "../../roles";
import { isUserFacing, userMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/* Judging a head angle needs a thumbnail, not a photograph. 768px keeps the
   whole vision call under a megabyte even with fifteen photos in it. */
const JUDGE_SIDE = 768;

export default async function RolesPage() {
  const { user, session, uploads } = await openStage("roles");
  const avatarId = session?.ui.avatarId ?? null;
  const ids = uploads.map((photo) => photo.id);

  /* The curation pass runs once per set of photos. Its answer is stored, so
     coming back to this screen shows the same proposal rather than quietly
     rearranging a set she has already tapped. */
  const stored = session?.ui.proposals ?? [];
  const covered = new Set(stored.map((item) => item.mediaId));
  let proposals: RoleProposal[] = cleanProposals(stored, ids);
  let paused: string | null = null;
  if (session && ids.some((id) => !covered.has(id))) {
    const images: { mediaId: string; image: InlineImage }[] = [];
    for (const photo of uploads) {
      images.push({ mediaId: photo.id, image: await withLocalFile(user.id, photo.id, (path) => toReference(path, JUDGE_SIDE)) });
    }
    /* A model call inside a page render, which means a reload is a call. The
       answer is stored (below) so the normal path makes one per set of photos,
       and the limiter is what makes a reload loop bounded rather than free. */
    try {
      const fresh = await withModelSpend(
        user,
        { limit: "onboarding", shape: "onboarding_curate", cost: images.length },
        () => proposeRoles(images),
      );
      proposals = cleanProposals(fresh, ids);
      await saveSession(user.id, {
        stage: "roles",
        interview: session.interview,
        ui: { ...session.ui, proposals },
      });
    } catch (error) {
      /* A limit or the daily cap is a message, not a broken page: she can still
         assign the roles by hand, and the model's guess is only a convenience. */
      paused = isUserFacing(error) ? error.message : userMessage("onboarding roles", error);
    }
  }

  /* Coming back after saving: what she chose wins over what the model thought. */
  /* A replacing run is choosing a new set: the old set is not her choice here. */
  const existing = avatarId && !session?.ui.replacing ? await listReferences(user.id, avatarId) : [];
  const chosen = existing.length
    ? existing.map((item) => ({ mediaId: item.mediaId, role: item.role }))
    : assignRoles(proposals, ids);
  const selected = new Map(chosen.map((item) => [item.role, item.mediaId]));
  const notes = new Map(proposals.map((item) => [item.mediaId, item]));
  const photos = uploads.map((photo, index) => ({ id: photo.id, index }));

  return (
    <SetupScreen stage="roles">
      <Ask help="We looked at your photos and picked one for each angle. Tap a different photo to change any of them.">
        Which photo is which
      </Ask>
      {paused && (
        <Note tone="warn" className="mt-4">
          We could not sort them for you just now: {paused} Pick each one yourself below; it works the same.
        </Note>
      )}

      <ActionForm
        action={saveRolesAction}
        submitLabel="These are right"
        pendingLabel="Writing her description…"
        size="lg"
        className="space-y-7"
        hint="Free."
        actionsClassName="flex flex-col gap-2 pt-2"
      >
        {ROLE_ORDER.map((role) => (
          <RolePicker key={role} role={role} photos={photos} selected={selected.get(role)} notes={notes} />
        ))}

        <Note>
          These five are the photos sent with every picture we make of her, in this order. The first one does the most
          work, so it should be the clearest.
        </Note>
      </ActionForm>
    </SetupScreen>
  );
}
