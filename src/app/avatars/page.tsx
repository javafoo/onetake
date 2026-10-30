import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { ChoiceCard } from "@/components/onboarding/choice";
import { Badge, buttonClass, Card, Field, Input, PageHeader } from "@/components/ui";
import { identityLock, listAvatars, referenceCount } from "@/data/avatars";
import { listDrafts } from "@/data/drafts";
import { avatarMediaCounts } from "@/data/media";
import { getSession } from "@/data/onboarding";
import { requireUser } from "@/data/users";
import { PRODUCT_NAME } from "@/lib/product";
import { avatarAllowance, canAddAvatar } from "@/lib/avatar-allowance";
import { currentAvatar } from "@/lib/current-avatar";
import { resumePath } from "@/app/onboarding/flow";
import { flowStateFor } from "@/data/onboarding";

import { deleteAvatarAction, newAvatarAction, renameAvatarAction, switchAvatarAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Avatars · ${PRODUCT_NAME}` };

/* Every avatar the account has, which one the pages are about, and the way
   to another. Deleting one is here too, behind her typed name, and says
   exactly what goes with her before anything does. The only avatar cannot
   be deleted on its own; the Account page deletes everything. */

/** "12 photos, 4 clips and 2 reels": what deleting her takes, from her own counts. */
function holdings(counts: Partial<Record<string, number>>, drafts: number): string {
  const photos = (counts.image ?? 0) + (counts.upload ?? 0) + (counts.reference ?? 0);
  const parts = [
    [photos, "photo", "photos"],
    [counts.clip ?? 0, "clip", "clips"],
    [counts.reel ?? 0, "reel", "reels"],
    [counts.slide ?? 0, "carousel slide", "carousel slides"],
    [drafts, "draft", "drafts"],
  ] as const;
  const said = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (!said.length) return "nothing yet";
  return said.length === 1 ? said[0] : `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`;
}
export default async function AvatarsPage() {
  const user = await requireUser();
  const [avatars, current, session] = await Promise.all([listAvatars(user.id), currentAvatar(user.id), getSession(user.id)]);
  const allowance = avatarAllowance(user);
  const canAdd = canAddAvatar(avatars.length, allowance);
  /* An avatar whose setup is still open: the session names it and is not complete. */
  const settingUp = session && !session.completedAt ? session.ui.avatarId : null;
  const resume = settingUp ? resumePath((await flowStateFor(user.id)).flow) : null;

  const rows = await Promise.all(
    avatars.map(async (avatar) => {
      const [references, drafts, counts] = await Promise.all([
        referenceCount(user.id, avatar.id),
        listDrafts(user.id, { avatarId: avatar.id, limit: 200 }),
        avatarMediaCounts(user.id, avatar.id),
      ]);
      return { avatar, references, drafts: drafts.length, counts, locked: Boolean(identityLock(avatar)) };
    }),
  );

  return (
    <>
      <PageHeader eyebrow="Avatars" title="Who you are working on" />

      <ul className="space-y-4">
        {rows.map(({ avatar, references, drafts, counts, locked }) => {
          const isCurrent = avatar.id === current?.id;
          const inSetup = avatar.id === settingUp;
          return (
            <Card as="li" key={avatar.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl text-ink">{avatar.name}</h2>
                    {isCurrent && <Badge tone="good">Current</Badge>}
                    {inSetup && <Badge tone="warn">Setup unfinished</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {avatar.kind === "twin" ? "Your own face" : "A character"} · {references} reference {references === 1 ? "photo" : "photos"} ·{" "}
                    {drafts} {drafts === 1 ? "hook" : "hooks"}
                    {!locked && " · no description yet"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {inSetup && resume && (
                    <Link href={resume} className={buttonClass("primary", "sm")}>
                      Finish setup
                    </Link>
                  )}
                  {!isCurrent && (
                    <ActionForm action={switchAvatarAction} submitLabel="Work on her" pendingLabel="Switching…" variant="quiet" size="sm">
                      <input type="hidden" name="id" value={avatar.id} />
                    </ActionForm>
                  )}
                </div>
              </div>

              <details className="group mt-3 border-t border-line pt-3">
                <summary className="flex min-h-11 list-none items-center gap-2 text-sm font-medium text-ink-soft">
                  Rename
                  <svg viewBox="0 0 12 8" aria-hidden="true" className="size-3 text-muted transition-transform group-open:rotate-180">
                    <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </summary>
                <ActionForm action={renameAvatarAction} submitLabel="Save name" pendingLabel="Saving…" variant="quiet" size="sm" className="mt-2 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={avatar.id} />
                  <label className="block">
                    <span className="block text-xs font-medium text-muted">Name</span>
                    <Input name="name" defaultValue={avatar.name} maxLength={60} required className="mt-1 w-56" />
                  </label>
                </ActionForm>
              </details>

              <details className="group mt-1">
                <summary className="flex min-h-11 list-none items-center gap-2 text-sm font-medium text-ink-soft">
                  Delete {avatar.name}
                  <svg viewBox="0 0 12 8" aria-hidden="true" className="size-3 text-muted transition-transform group-open:rotate-180">
                    <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </summary>
                {rows.length > 1 ? (
                  <ActionForm
                    action={deleteAvatarAction}
                    submitLabel={`Delete ${avatar.name} for good`}
                    pendingLabel="Deleting…"
                    variant="danger"
                    size="sm"
                    className="mt-2 max-w-xl space-y-3"
                  >
                    <input type="hidden" name="id" value={avatar.id} />
                    <p className="text-sm text-ink-soft">
                      This deletes {avatar.name} and everything of hers: {holdings(counts, drafts)}, her reference photos, her brand
                      and brief, and her saved hooks. It cannot be undone. Your account, your credits and your other avatars stay.
                    </p>
                    <label className="block">
                      <span className="block text-xs font-medium text-muted">Type {avatar.name} to confirm</span>
                      <Input name="confirm" autoComplete="off" required className="mt-1 w-56" />
                    </label>
                  </ActionForm>
                ) : (
                  <p className="mt-2 max-w-xl text-sm text-muted">
                    {avatar.name} is your only avatar, so she cannot be deleted on her own. To delete everything, use Delete account on the{" "}
                    <Link href="/account" className="font-medium text-accent underline-offset-4 hover:underline">
                      Account page
                    </Link>
                    .
                  </p>
                )}
              </details>
            </Card>
          );
        })}
      </ul>

      <Card className="mt-8 p-4 sm:p-6">
        <h2 className="font-display text-lg text-ink">Add an avatar</h2>
        <p className="mt-1 text-sm text-muted">
          {allowance === 1 ? "Your plan includes one avatar." : `Your plan includes ${allowance} avatars. You have ${avatars.length}.`}
        </p>
        {canAdd ? (
          <ActionForm
            action={newAvatarAction}
            submitLabel="Start her setup"
            pendingLabel="Creating…"
            hint="Free. Next: her photos, then her brand, the same steps as the first time."
            className="mt-5 max-w-xl space-y-5"
          >
            <Field label="What is she called?">
              <Input name="personaName" placeholder="Maya" autoComplete="off" maxLength={60} required />
            </Field>
            <Field label="What is the account about?" hint="One line. Who it is for and what it is about.">
              <Input name="niche" placeholder="A hair studio for women who want an honest stylist" autoComplete="off" required />
            </Field>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-ink">Whose face is she?</legend>
              <div className="mt-2 space-y-3">
                <ChoiceCard name="avatarKind" value="twin" title="My own face">
                  You will upload photos of yourself, and she will look like you.
                </ChoiceCard>
                <ChoiceCard name="avatarKind" value="avatar" title="A character I already have images of" defaultChecked>
                  You have pictures of her already and you own them or have the right to use them.
                </ChoiceCard>
              </div>
            </fieldset>
          </ActionForm>
        ) : (
          <p className="mt-4 text-sm text-muted">{`Every account can have up to ${allowance} avatars. Delete one to add another.`}</p>
        )}
      </Card>
    </>
  );
}
