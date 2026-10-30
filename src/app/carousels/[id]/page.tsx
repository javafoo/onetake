import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteCarouselAction, editCaptionAction } from "@/app/carousels/actions";
import { checkSpec } from "@/carousel/check";
import { plainProblem, slideEmphasis, titleLinesText } from "@/carousel/edit";
import { kitName as nameOfKit } from "@/carousel/kits";
import { kitOwnerSlug } from "@/carousel/owners";
import { slidePhotos, slideTitle } from "@/carousel/spec";
import { ActionForm } from "@/components/action-form";
import { SlideDeck, type DeckSlide } from "@/components/carousel/slide-deck";
import { CopyButton } from "@/components/copy-button";
import { JobStatus } from "@/components/job-status";
import { Badge, buttonClass, Card, Note, PageHeader, SkeletonTile, Textarea } from "@/components/ui";
import type { Brief } from "@/brief/build";
import type { BrandProfile } from "@/content/hooks";
import { briefForOffer, offerIndexOfKeyword, withOffer } from "@/content/offers";
import { EMPTY_PROFILE, getBrand } from "@/data/brand";
import { getCarousel, pendingJob, photoOptions } from "@/data/carousels";
import { mediaUrl } from "@/data/media";
import { requireUser } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";

export const dynamic = "force-dynamic";

/* Editing a slide redraws a canvas inside this route's server action, so it
   needs the fonts and the canvas addon that next.config.ts traces in. */
export const maxDuration = 120;

export default async function CarouselPage(props: PageProps<"/carousels/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();
  const set = await getCarousel(user.id, id);
  if (!set) notFound();

  const { draft, doc, slides } = set;
  const story = draft.format === "story";
  const kitName = doc ? (nameOfKit(doc.kit, kitOwnerSlug(user.id)) ?? doc.kit) : null;

  const header = (
    <PageHeader
      eyebrow={
        <>
          <Link href="/carousels" className="underline-offset-4 hover:text-accent hover:underline">
            Carousels
          </Link>
          {" · "}
          {story ? "Story sequence" : "Carousel"}
          {kitName ? ` · ${kitName}` : ""}
        </>
      }
      title={draft.hook}
    >
      {slides.length > 0 && (
        <a href={`/carousels/${draft.id}/zip`} className={buttonClass("primary")} download>
          Download all {slides.length}
        </a>
      )}
    </PageHeader>
  );

  if (!doc || slides.length === 0) {
    const job = await pendingJob(user.id, draft.id);
    return (
      <>
        {header}
        {job ? (
          <>
            <JobStatus
              jobId={job.id}
              workingLabel="Writing the set, checking it against your proof points, then drawing the slides. About half a minute."
            />
            {/* The shape of the page it is about to become, so the wait does not
                look like an empty screen with a sentence on it. */}
            <div className="no-scrollbar mt-6 flex gap-3 overflow-hidden rounded-xl border border-line bg-surface p-3 shadow-card">
              {Array.from({ length: 3 }, (_, index) => (
                <SkeletonTile key={index} ratio={story ? "9:16" : "4:5"} />
              ))}
            </div>
          </>
        ) : (
          <>
            <Note tone="warn">
              This set was never finished. Nothing was charged for it. Start it again from the New page, or delete it
              below.
            </Note>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/carousels/new" className={buttonClass("quiet")}>
                Make another set
              </Link>
            </div>
          </>
        )}
        <DeleteSet id={draft.id} />
      </>
    );
  }

  const avatar = await currentAvatar(user.id);
  const brand = avatar ? await getBrand(user.id, avatar.id) : null;
  const profile = (brand?.profile as BrandProfile | undefined) ?? EMPTY_PROFILE;
  // Checked against the offer the set sells: her keyword on its last slide says which.
  const last = doc.slides[doc.slides.length - 1];
  const offer = last?.type === "keyword" ? offerIndexOfKeyword(profile, last.keyword) : -1;
  const problems = checkSpec(doc, {
    profile: withOffer(profile, offer),
    brief: briefForOffer((brand?.brief as Brief | null) ?? null, profile, offer),
    topic: draft.hook,
    fixedCover: doc.fixedCover,
  }).map(plainProblem);

  // The swap picker offers the set's own avatar's photos only.
  const photos = (await photoOptions(user.id, draft.avatarId)).map((photo) => ({ id: photo.id, url: mediaUrl(photo.id) }));

  /* A redrawn slide is a new media row with a new id, so the URL changes by
     itself and there is never a stale picture to bust out of a cache. */
  const deck: DeckSlide[] = slides.map((slide) => {
    const spec = doc.slides[slide.index];
    return {
      index: slide.index,
      mediaId: slide.id,
      src: mediaUrl(slide.id),
      type: spec?.type ?? "paper",
      titleLines: spec ? titleLinesText(spec) : "",
      accent: spec ? (slideTitle(spec)?.accent ?? "") : "",
      sub: spec?.type === "cover" || spec?.type === "grid" ? (spec.sub ?? "") : "",
      body: spec?.type === "paper" ? spec.body : "",
      keyword: spec?.type === "keyword" ? spec.keyword : "",
      promise: spec?.type === "keyword" ? spec.promise : "",
      top: spec?.type === "split" ? spec.lines[0] : "",
      bottom: spec?.type === "split" ? spec.lines[1] : "",
      text: spec?.type === "line" ? spec.text : "",
      headline: spec?.type === "grid" ? spec.headline : "",
      emphasis: spec ? slideEmphasis(spec) : [],
      photoCount: spec ? slidePhotos(spec).length || (spec.type === "keyword" ? 1 : 0) : 0,
    };
  });

  const fullCaption = [draft.caption, draft.cta].filter(Boolean).join("\n\n");

  return (
    <>
      {header}

      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-muted">
          {slides.length} slides · {story ? "1080 × 1920" : "1080 × 1350"}
        </span>
        <Badge tone={problems.length ? "warn" : "good"}>
          {problems.length ? `${problems.length} to fix` : "Passes every check"}
        </Badge>
      </div>

      {problems.length > 0 && (
        <Card tone="quiet" className="mb-6 border-warn/25 bg-warn-soft p-4">
          <h2 className="text-sm font-semibold text-warn">What still needs a word changed</h2>
          <ul className="mt-2 space-y-2">
            {problems.map((problem, index) => (
              <li key={index} className="text-sm text-warn">
                <span className="font-semibold">{problem.where}:</span> {problem.sentence}
                <span className="mt-0.5 block text-xs opacity-80">{problem.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SlideDeck draftId={draft.id} slides={deck} ratio={story ? "9:16" : "4:5"} photos={photos} />

      <Card className="mt-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="font-display text-lg text-ink">The caption</h2>
          <CopyButton text={fullCaption} label="Copy caption" />
        </div>
        <ActionForm
          action={editCaptionAction}
          submitLabel="Save caption"
          pendingLabel="Saving…"
          variant="quiet"
          size="sm"
          hint="One line, under 180 characters, asking for the keyword."
          className="mt-3 space-y-3"
        >
          <input type="hidden" name="id" value={draft.id} />
          <label className="block">
            <span className="sr-only">Caption</span>
            <Textarea name="caption" rows={2} defaultValue={draft.caption} required maxLength={180} />
          </label>
        </ActionForm>
        {draft.cta && <p className="mt-3 text-sm text-muted">Call to action: {draft.cta}</p>}
      </Card>

      <DeleteSet id={draft.id} />
    </>
  );
}

/** Deleting is behind one deliberate open, because it takes the slides with it. */
function DeleteSet({ id }: { id: string }) {
  return (
    <details className="group mt-10 border-t border-line pt-4">
      <summary className="flex min-h-11 list-none items-center gap-2 text-sm text-muted">
        Delete this set
        <svg viewBox="0 0 12 8" aria-hidden="true" className="size-3 transition-transform group-open:rotate-180">
          <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="mt-3">
        <p className="mb-3 max-w-prose text-sm text-muted">
          The slides are deleted with it and cannot be brought back. Download them first if you want to keep them.
        </p>
        <ActionForm action={deleteCarouselAction} submitLabel="Delete the set and its slides" pendingLabel="Deleting…" variant="quiet" size="sm">
          <input type="hidden" name="id" value={id} />
        </ActionForm>
      </div>
    </details>
  );
}
