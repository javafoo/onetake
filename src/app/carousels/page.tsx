import Link from "next/link";

import { kitOwnerSlug } from "@/carousel/owners";
import { SetTile } from "@/components/carousel/set-tile";
import { LibraryTabs } from "@/components/library/tabs";
import { buttonClass, EmptyState, PageHeader } from "@/components/ui";
import { draftsWithPendingJob, listCarousels } from "@/data/carousels";
import { requireUser } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";

export const dynamic = "force-dynamic";

export default async function CarouselsPage() {
  const user = await requireUser();
  const avatar = await currentAvatar(user.id);
  const [sets, working] = await Promise.all([listCarousels(user.id, { avatarId: avatar?.id }), draftsWithPendingJob(user.id)]);
  const slug = kitOwnerSlug(user.id);

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Sets you can post without filming"
      >
        {/* The form with every choice laid out. Create's Slides tab makes one from a line too. */}
        <Link href="/carousels/new" className={buttonClass("primary")}>
          Make a carousel
        </Link>
      </PageHeader>

      <LibraryTabs tab="carousels" counts={{ carousels: sets.length }} />

      {sets.length === 0 ? (
        <EmptyState
          title="No sets yet"
          action={
            <Link href="/carousels/new" className={buttonClass("primary")}>
              Make your first set
            </Link>
          }
        >
          Pick a topic and a look, and the writer turns your brief into slides. Nothing is invented: every number has to
          come from your proof points, or the set is not made.
        </EmptyState>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {sets.map((set) => (
              <SetTile key={set.draft.id} set={set} busy={working.has(set.draft.id)} slug={slug} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
