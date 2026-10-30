import { approveReferenceAction } from "@/app/actions";
import { editDescriptionAction, replacePhotosAction, setPhotoStyleAction } from "@/app/avatar/actions";
import { ActionForm } from "@/components/action-form";
import Link from "next/link";

import { Badge, buttonClass, Card, EmptyState, Field, Input, MediaTile, PageHeader, Section, Textarea } from "@/components/ui";
import { identityLock, listReferences, type ReferenceRole } from "@/data/avatars";
import { mediaUrl } from "@/data/media";
import { requireUser } from "@/data/users";
import { canSwitchAvatars, currentAvatar } from "@/lib/current-avatar";
import { PHOTO_STYLES, PHOTO_STYLE_LABEL, photoStyleOf, type PhotoStyle } from "@/style/photo-style";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<ReferenceRole, string> = {
  front: "Front",
  three_quarter: "Three-quarter",
  profile: "Side profile",
  full_body: "Full body",
  expression: "Expression",
};

/** The two styles as radio buttons, each with what it means, so the choice is made knowing what it does. */
function StyleChoice({ current }: { current: PhotoStyle }) {
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Photo style</legend>
      {PHOTO_STYLES.map((style) => (
        <label key={style} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong bg-sunken/60 p-3">
          <input type="radio" name="style" value={style} defaultChecked={style === current} className="mt-1 size-4 shrink-0" />
          <span>
            <span className="block text-sm font-medium text-ink">{PHOTO_STYLE_LABEL[style].name}</span>
            <span className="block text-sm text-muted">{PHOTO_STYLE_LABEL[style].blurb}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Order the set the way a casting sheet would: front first, then round the head. */
const ROLE_ORDER: ReferenceRole[] = ["front", "three_quarter", "profile", "full_body", "expression"];

export default async function AvatarPage() {
  const user = await requireUser();
  const avatar = await currentAvatar(user.id);
  const switching = await canSwitchAvatars(user);
  const references = avatar ? await listReferences(user.id, avatar.id) : [];
  const lock = identityLock(avatar);
  const name = avatar?.name?.trim() || "Your avatar";

  if (references.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Avatar" title="Her face, locked in">
          {switching && (
            <Link href="/avatars" className={buttonClass("quiet")}>
              All avatars
            </Link>
          )}
        </PageHeader>
        <EmptyState
          title="No photos of her yet"
          action={
            <Link href="/onboarding" className={buttonClass("primary")}>
              Finish her setup
            </Link>
          }
        >
          Add a few originals: a front shot, a three-quarter, a full body. The rest of the set is built from them. The
          upload screen is next.
        </EmptyState>
      </>
    );
  }

  const sorted = [...references].sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      // Originals lead within an angle; that is the point the page is making.
      Number(a.source !== "original") - Number(b.source !== "original"),
  );
  const originals = sorted.filter((item) => item.source === "original");
  const generated = sorted.filter((item) => item.source === "generated");
  const hero = originals[0] ?? sorted[0];
  const waiting = generated.filter((item) => !item.approved);

  return (
    <>
      <PageHeader eyebrow="Avatar" title="This is her">
        {switching && (
          <Link href="/avatars" className={buttonClass("quiet")}>
            All avatars
          </Link>
        )}
      </PageHeader>

      {/* The hero is the point of this page: one large frame of her, and the
          three lines that describe her, so it reads as a person and not a file list. */}
      <div className="mb-12 grid gap-6 sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-start">
        {/* Her name sits on the photograph: the page is about a person, not a set of files. */}
        <figure className="relative overflow-hidden rounded-xl border border-line bg-sunken">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrl(hero.mediaId)}
            alt={`${name}, ${ROLE_LABEL[hero.role].toLowerCase()} reference`}
            className="aspect-[3/4] w-full object-cover"
          />
          {/* The scrim is heavy enough that the name clears AA over any photo. */}
          <figcaption className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 via-black/55 to-transparent px-4 pt-12 pb-3">
            <span className="font-display text-2xl text-white">{name}</span>
          </figcaption>
        </figure>
        <div className="sm:pt-2">
          <h2 className="sr-only">{name}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone="good">{originals.length} originals</Badge>
            <Badge tone="plain">{generated.length} generated views</Badge>
            {waiting.length > 0 && <Badge tone="warn">{waiting.length} need approval</Badge>}
          </p>
          {lock ? (
            <dl className="mt-6 space-y-4">
              {(
                [
                  ["Who she is", lock.subject],
                  ["Hair", lock.hair],
                  ["Face", lock.skinMakeup],
                ] as const
              ).map(([term, value]) => (
                <div key={term}>
                  <dt className="eyebrow text-muted">{term}</dt>
                  <dd className="mt-1 max-w-prose text-sm text-ink-soft">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-6 rounded-lg border border-warn/25 bg-warn-soft px-4 py-3 text-sm text-warn">
              Her description is not saved yet, so no photos can be generated.{" "}
              <Link href="/onboarding" className="font-semibold underline underline-offset-2">
                Finish her setup
              </Link>
            </p>
          )}
        </div>
      </div>

      <Section
        title="Her reference set"
        description="These are the photos sent with every prompt. Generated views need a look from you before they are used."
        className="mb-12"
      >
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((item) => (
            <li key={item.id}>
              <MediaTile
                kind="image"
                src={mediaUrl(item.mediaId)}
                alt={`${ROLE_LABEL[item.role]} reference of ${name}`}
                ratio="3:4"
                badge={
                  item.source === "original" ? (
                    <Badge tone="good">Original</Badge>
                  ) : (
                    <Badge tone={item.approved ? "plain" : "warn"}>{item.approved ? "Approved" : "Check it"}</Badge>
                  )
                }
                caption={<span className="font-medium text-ink">{ROLE_LABEL[item.role]}</span>}
              />
              {item.source === "generated" && !item.approved && (
                <ActionForm action={approveReferenceAction} submitLabel="Looks like her" variant="quiet" size="sm" className="mt-2">
                  <input type="hidden" name="referenceId" value={item.id} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {lock && avatar && (
        <Section
          title="How her photos look"
          description="Her face always comes from her reference photos. The style is how the photo around her is made: the light, the camera, the setting."
          className="mb-12"
        >
          <Card className="p-5 sm:p-7">
            <ActionForm key={`style-${avatar.id}`} action={setPhotoStyleAction} submitLabel="Save style" pendingLabel="Saving…" hint="Free." className="space-y-4">
              <input type="hidden" name="id" value={avatar.id} />
              <StyleChoice current={photoStyleOf(lock)} />
              <p className="text-sm text-muted">Her next photos use it. The ones she has are not changed.</p>
            </ActionForm>
          </Card>

          <details id="replace-photos" className="group mt-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-6">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
              <span>
                <span className="block font-display text-lg text-ink">Replace her photos</span>
                <span className="block text-sm text-muted">Free. Upload a new set; her description is written again from it.</span>
              </span>
              <svg viewBox="0 0 12 8" aria-hidden="true" className="size-3 shrink-0 text-muted transition-transform group-open:rotate-180">
                <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </summary>
            <ActionForm key={`replace-${avatar.id}`} action={replacePhotosAction} submitLabel="Choose new photos" pendingLabel="Starting…" hint="Free." className="mt-5 space-y-4">
              <input type="hidden" name="id" value={avatar.id} />
              <p className="max-w-prose text-sm text-muted">
                Five to fifteen photos. Use photos that look like the pictures you want to make: if you want a shoot look, use photos
                from a real shoot. Her wardrobe and usual places are rewritten from them, so check them after. Her current photos keep
                working until you save the new set, and you can stop at any point.
              </p>
              <StyleChoice current={photoStyleOf(lock)} />
            </ActionForm>
          </details>
        </Section>
      )}

      {lock && (
        <Section title="Her description" description="Written into every photo prompt, word for word. It overrides whatever a model thinks it sees.">
          <Card className="p-5 sm:p-7">
            <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
              {(
                [
                  ["Accessories", lock.accessories],
                  ["Expressions", lock.expressions],
                ] as const
              ).map(([term, value]) => (
                <div key={term}>
                  <dt className="eyebrow text-muted">{term}</dt>
                  <dd className="mt-1 text-sm text-ink-soft">{value}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="eyebrow text-muted">Wardrobe</dt>
                <dd className="mt-2 flex flex-wrap gap-1.5">
                  {lock.wardrobe.map((item) => (
                    <span key={item} className="rounded-full border border-line-strong bg-sunken px-2.5 py-1 text-xs text-ink-soft">
                      {item}
                    </span>
                  ))}
                </dd>
              </div>
              {lock.scenes.length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="eyebrow text-muted">Usual places</dt>
                  <dd className="mt-2 flex flex-wrap gap-1.5">
                    {lock.scenes.map((item) => (
                      <span key={item} className="rounded-full border border-line-strong bg-sunken px-2.5 py-1 text-xs text-ink-soft">
                        {item}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              <div className="sm:col-span-2">
                <dt className="eyebrow text-muted">Words we never use for her</dt>
                <dd className="mt-1 text-sm text-muted">{lock.bannedWords.join(", ") || "None yet"}</dd>
              </div>
            </dl>
          </Card>

          {/* Editable at any time, not only during setup: if her photos keep
              coming out wrong, this is what to change. Keyed by avatar so a
              switch never shows the last one's words. */}
          <details id="edit-description" className="group mt-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-6">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
              <span>
                <span className="block font-display text-lg text-ink">Edit her description</span>
                <span className="block text-sm text-muted">Free. Her next photos use it; the ones she has are not changed.</span>
              </span>
              <svg viewBox="0 0 12 8" aria-hidden="true" className="size-3 shrink-0 text-muted transition-transform group-open:rotate-180">
                <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </summary>
            <ActionForm key={avatar?.id} action={editDescriptionAction} submitLabel="Save her description" pendingLabel="Saving…" className="mt-5 space-y-4">
              <input type="hidden" name="id" value={avatar?.id ?? ""} />
              <p className="max-w-prose text-sm text-muted">
                Describe what you can see: hair colour and length, makeup, the jewellery she always wears. Never a race, ethnicity or
                nationality; her face comes from her photos.
              </p>
              <Field label="Who she is" hint="Opens every photo prompt. Her age range and build, in a few words.">
                <Input name="subject" defaultValue={lock.subject} required maxLength={400} />
              </Field>
              <Field label="Hair">
                <Input name="hair" defaultValue={lock.hair} required maxLength={400} />
              </Field>
              <Field label="Face" hint="Skin and makeup.">
                <Input name="skinMakeup" defaultValue={lock.skinMakeup} required maxLength={400} />
              </Field>
              <Field label="Accessories">
                <Input name="accessories" defaultValue={lock.accessories} maxLength={400} />
              </Field>
              <Field label="Expressions">
                <Input name="expressions" defaultValue={lock.expressions} maxLength={400} />
              </Field>
              <Field label="Wardrobe" hint="One outfit or piece per line.">
                <Textarea name="wardrobe" rows={4} defaultValue={lock.wardrobe.join("\n")} />
              </Field>
              <Field label="Usual places" hint="One per line. Photos pick from these when no place is named.">
                <Textarea name="scenes" rows={3} defaultValue={lock.scenes.join("\n")} />
              </Field>
            </ActionForm>
          </details>
        </Section>
      )}
    </>
  );
}
