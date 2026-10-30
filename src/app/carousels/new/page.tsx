import Link from "next/link";

import { listKits } from "@/carousel/kits";
import { DEFAULT_TEXT_STYLE } from "@/content/text-styles";
import { kitOwnerSlug } from "@/carousel/owners";
import { fallbackTopics, suggestTopics, topicsKey } from "@/carousel/topics";
import { NewCarouselForm, type KitChoice, type PhotoChoice } from "@/components/carousel/new-carousel-form";
import { buttonClass, Note, PageHeader } from "@/components/ui";
import type { BrandProfile } from "@/content/hooks";
import type { Brief } from "@/brief/build";
import { EMPTY_PROFILE, getBrand, getTopics, profileComplete, saveTopics } from "@/data/brand";
import { photoOptions } from "@/data/carousels";
import { mediaUrl } from "@/data/media";
import { requireUser } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";
import { withModelSpend } from "@/spend";

export const dynamic = "force-dynamic";

/* Writing a set happens in a job, but the job is started from here, and Vercel
   stops an invocation that returns before its work does. Same limit as the
   Create page, for the same reason. */
export const maxDuration = 300;

export default async function NewCarouselPage() {
  const user = await requireUser();
  const avatar = await currentAvatar(user.id);
  const brand = avatar ? await getBrand(user.id, avatar.id) : null;
  const profile = (brand?.profile as BrandProfile | undefined) ?? EMPTY_PROFILE;

  if (!avatar || !profileComplete(profile)) {
    return (
      <>
        <PageHeader eyebrow="Carousels · New" title="One thing first" />
        <Note tone="warn" className="mb-6">
          A set is written from your brand: the niche, the audience, the offer and the comment keyword. Fill those in and
          come back — nothing here costs anything.
        </Note>
        <Link href="/brand" className={buttonClass("primary")}>
          Go to Brand
        </Link>
      </>
    );
  }

  const brief = (brand?.brief as Brief | null) ?? null;
  // Only the current avatar's photos: a set is about one of them.
  const photos = avatar ? await photoOptions(user.id, avatar.id) : [];

  /* A model call inside a page render, which used to be keyed on the brand
     row's updated_at: saving the Brand page bumped that, saving is free, so
     "save, open this page" was one model call per iteration with nothing
     counting them. The key is now a hash of the fields the prompt reads, the
     answer is kept on the row rather than in a Map, and the call itself is
     behind the limiter. A failure falls back to the offline suggestions,
     because a suggestion must never stop the page from opening. */
  const key = topicsKey(profile, brief);
  let topics = await getTopics(user.id, avatar.id, key);
  if (!topics) {
    topics = await withModelSpend(user, { limit: "vision", shape: "suggest_topics" }, () =>
      suggestTopics({ profile, brief })).catch(() => fallbackTopics(profile, brief));
    await saveTopics(user.id, avatar.id, key, topics).catch(() => undefined);
  }

  const kits: KitChoice[] = listKits(kitOwnerSlug(user.id)).map((kit) => ({
    id: kit.id,
    name: kit.name,
    character: kit.character,
    paper: kit.palette.paper,
    ink: kit.palette.ink,
    accent: kit.palette.accent,
    private: Boolean(kit.private),
  }));

  const choices: PhotoChoice[] = photos.map((photo) => ({
    id: photo.id,
    url: mediaUrl(photo.id),
    kind: photo.kind,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Carousels · New"
        title="Make a set"
      >
        <Link href="/carousels" className={buttonClass("quiet")}>
          Back to sets
        </Link>
      </PageHeader>

      <NewCarouselForm kits={kits} photos={choices} topics={topics} defaultKit={kits.some((kit) => kit.id === DEFAULT_TEXT_STYLE) ? DEFAULT_TEXT_STYLE : (kits[0]?.id ?? "signal")} />
    </>
  );
}
