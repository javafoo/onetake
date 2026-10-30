import Link from "next/link";

import { Gallery } from "@/components/library/gallery";
import { toGalleryItem } from "@/components/library/library-view";
import { LibraryTabs } from "@/components/library/tabs";
import { buttonClass, EmptyState, PageHeader } from "@/components/ui";
import { listAvatars } from "@/data/avatars";
import { listFolders } from "@/data/folders";
import { listUploads, UPLOAD_CAP } from "@/data/media";
import { requireUser } from "@/data/users";
import {
  avatarFilterFrom,
  UPLOAD_GROUP_EMPTY,
  UPLOAD_GROUP_LABEL,
  UPLOAD_GROUPS,
  uploadGroupFrom,
  uploadsHref,
  uploadsView,
  type UploadGroup,
} from "@/lib/uploads";

export const dynamic = "force-dynamic";

/* "Copy to" reads each file and stores it again inside the request. A press
   is bounded (`MAX_COPY_ITEMS`, `MAX_COPY_BYTES`) so this is room, not a target. */
export const maxDuration = 120;

/* Everything she added from her device, in one place, on every avatar.
 *
 * The Photos tab keeps uploads off its main grid and scopes everything to the
 * avatar that is switched on, so an upload made under another avatar, or a
 * clip among the made ones, was hard to find. This page reads her uploads for
 * the whole account and groups them by what the generators read: places and
 * things, photos of her, clips. With more than one avatar she can narrow to
 * one, and copy a place, a thing or a clip to another. The tiles are the ones
 * every other tab draws. */

const CHIP = "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors";
const CHIP_ON = "border-ink bg-ink text-canvas";
const CHIP_OFF = "border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink";

const SECTION_NOTE: Record<UploadGroup, string> = {
  places: "Half-and-half and four-photo carousels use these, matched to the line they sit under.",
  me: "Used like the photos made here: in carousels, and as a start for a clip.",
  clips: "Put a hook on one to make a reel.",
};

function Chip({ href, on, label, count }: { href: string; on: boolean; label: string; count?: number }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}>
      {label}
      {count !== undefined && <span className={`text-xs tabular-nums ${on ? "text-canvas/70" : "text-muted"}`}>{count}</span>}
    </Link>
  );
}

export default async function LibraryUploadsPage({ searchParams }: PageProps<"/library/uploads">) {
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);

  const user = await requireUser();
  const [rows, avatars, folders] = await Promise.all([listUploads(user.id), listAvatars(user.id), listFolders(user.id)]);

  const group = uploadGroupFrom(one("group"));
  const avatarId = avatars.length > 1 ? avatarFilterFrom(one("avatar"), avatars) : null;
  const { items, counts } = uploadsView(rows, { group, avatarId });
  // The tab's count and the room left are the account's, whatever is filtered: the cap is.
  const total = rows.length;
  const avatarName = avatarId ? avatars.find((avatar) => avatar.id === avatarId)?.name : undefined;

  const folderList = folders.map(({ id, name }) => ({ id, name }));
  const copy = { avatars: avatars.map(({ id, name }) => ({ id, name })), cap: UPLOAD_CAP };
  const shown = UPLOAD_GROUPS.filter((id) => items[id].length > 0);
  const empty = UPLOAD_GROUP_EMPTY[group ?? "all"];

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Uploads"
        lead={
          avatars.length > 1
            ? "Everything you added from your phone, for every avatar. Copy a place, a thing or a clip to another avatar so it can use it too."
            : "Everything you added from your phone: photos of you, places and things, and clips."
        }
      >
        <Link href="/library" className={buttonClass("quiet", "md")}>
          Add your own
        </Link>
      </PageHeader>

      <LibraryTabs tab="uploads" counts={{ uploads: total }} />

      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip href={uploadsHref({ avatarId })} on={group === null} label="All uploads" count={counts.all} />
          {UPLOAD_GROUPS.map((id) => (
            <Chip key={id} href={uploadsHref({ group: id, avatarId })} on={group === id} label={UPLOAD_GROUP_LABEL[id]} count={counts[id]} />
          ))}
        </div>
        {avatars.length > 1 && (
          <div className="flex flex-wrap items-center gap-2" aria-label="Avatar">
            <Chip href={uploadsHref({ group })} on={avatarId === null} label="Every avatar" />
            {avatars.map((avatar) => (
              <Chip key={avatar.id} href={uploadsHref({ group, avatarId: avatar.id })} on={avatarId === avatar.id} label={avatar.name} />
            ))}
          </div>
        )}
        <p className="text-xs text-muted">
          {`You have added ${total} of the ${UPLOAD_CAP} photos and clips there is room for. Photos and clips made here do not count.`}
        </p>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={avatarName && !group ? `Nothing uploaded for ${avatarName} yet` : empty.title}>{empty.body}</EmptyState>
      ) : (
        <div className="space-y-10">
          {shown.map((id) => (
            <section key={id} aria-labelledby={`uploads-${id}`}>
              <h2 id={`uploads-${id}`} className="font-display text-xl text-ink">
                {UPLOAD_GROUP_LABEL[id]} <span className="text-base text-muted tabular-nums">{items[id].length}</span>
              </h2>
              <p className="mb-3 text-sm text-muted">{SECTION_NOTE[id]}</p>
              <Gallery items={items[id].map(toGalleryItem)} folders={folderList} kind={id === "clips" ? "clip" : "image"} copy={copy} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
