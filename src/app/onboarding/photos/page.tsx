import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Ask } from "@/components/onboarding/progress";
import { PhotoUploader } from "@/components/onboarding/photo-uploader";
import { SetupScreen } from "@/components/onboarding/screen";
import { buttonClass, Card, Note } from "@/components/ui";
import { cancelReplacePhotosAction } from "@/app/avatar/actions";
import { mediaUrl } from "@/data/media";
import { PRODUCT_NAME } from "@/lib/product";
import { PHOTO_STYLE_LABEL } from "@/style/photo-style";

import { recordConsentAction, removePhotoFormAction } from "../actions";
import { MAX_PHOTOS, MIN_PHOTOS, photoCountMessage } from "../photos";
import { openStage } from "../guard";

export const dynamic = "force-dynamic";

const CONSENT = {
  twin: `I am the person in these photos. I agree to ${PRODUCT_NAME} using them to generate new photos and videos of my face.`,
  avatar: "I own these images or have the right to use them, and if they show a real person I have that person's permission.",
} as const;

export default async function PhotosPage() {
  const { session, uploads } = await openStage("photos");
  const kind = session?.interview.setup.avatarKind ?? "avatar";
  const name = session?.interview.setup.personaName ?? "her";
  const consented = Boolean(session?.ui.consent);
  const enough = uploads.length >= MIN_PHOTOS;
  const replacing = session?.ui.replacing ?? null;

  return (
    <SetupScreen stage="photos">
      <Ask
        help={
          replacing
            ? `Five to fifteen new photos of ${kind === "twin" ? "your face" : name}, in the ${PHOTO_STYLE_LABEL[replacing.style].name.toLowerCase()} style you chose. Her current photos keep working until you save the new set.`
            : kind === "twin"
            ? "Five to fifteen photos of your own face. Different angles, real light, no filters. They stay private to your account."
            : `Five to fifteen photos of ${name}. Different angles, real light, no filters. They stay private to your account.`
        }
      >
        {replacing ? "Her new photos" : kind === "twin" ? "Now your face" : "Now her face"}
      </Ask>

      {!consented ? (
        <Card className="p-5 sm:p-6">
          <h2 className="font-display text-lg text-ink">One thing first</h2>
          <p className="mt-2 text-sm text-ink-soft">
            {kind === "twin"
              ? "A face we generate has to be a face you are allowed to use. Tick this and we will record the date."
              : "We only build a character from pictures you are allowed to use. Tick this and we will record the date."}
          </p>
          <ActionForm
            action={recordConsentAction}
            submitLabel="I agree"
            pendingLabel="Saving…"
            size="lg"
            className="mt-4"
            actionsClassName="flex flex-col gap-2 [&>button]:w-full"
          >
            <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong bg-sunken/60 p-4">
              <input type="checkbox" name="agree" required className="mt-0.5 size-5 shrink-0" />
              <span className="text-sm text-ink">{CONSENT[kind]}</span>
            </label>
          </ActionForm>
        </Card>
      ) : (
        <>
          <p className="mb-4 text-sm font-medium text-ink">{photoCountMessage(uploads.length)}</p>

          {uploads.length > 0 && (
            <ul className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {uploads.map((photo, index) => (
                <li key={photo.id} className="relative">
                  <div className="aspect-[3/4] w-full overflow-hidden rounded-lg border border-line bg-sunken">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaUrl(photo.id)}
                      alt={`Photo ${index + 1} of ${name}`}
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  </div>
                  <form action={removePhotoFormAction}>
                    <input type="hidden" name="mediaId" value={photo.id} />
                    <button
                      type="submit"
                      className="absolute top-1 right-1 grid size-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                      <span className="sr-only">Remove photo {index + 1}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {/* Once there are enough photos, adding more stops being the thing to
              do next, so it stops looking like it. Only one black button on a
              screen, and it is always the way forward. */}
          <PhotoUploader remaining={MAX_PHOTOS - uploads.length} quiet={enough} />

          <Note className="mt-5">
            {replacing?.style === "editorial" && (
              <>
                For the editorial style, use photos from a real shoot: good light, a plain background, a tailored outfit. The more
                they look like what you want to make, the closer her new photos will be.{" "}
              </>
            )}
            What works: her face clearly visible, a few angles, one full-body shot, one where she is laughing or
            talking. What does not: sunglasses, heavy filters, anyone else in the frame.
          </Note>

          <div className="mt-6">
            {enough ? (
              <Link href="/onboarding/photos/roles" className={buttonClass("primary", "lg", "w-full")}>
                Continue
              </Link>
            ) : (
              <p className="text-center text-sm text-muted">
                {MIN_PHOTOS - uploads.length} more and you can carry on.
              </p>
            )}
          </div>
        </>
      )}

      {replacing && (
        <form action={cancelReplacePhotosAction} className="mt-4 text-center">
          <button type="submit" className="text-sm text-muted underline underline-offset-2 hover:text-ink">
            Keep her current photos instead
          </button>
        </form>
      )}
    </SetupScreen>
  );
}
