import Link from "next/link";

import { animateAction, freePhotoAction, generateSceneAction, motionIdeasAction, polishMotionAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { PaidActionGate, PaidActionNotice } from "@/components/billing/paid-action-gate";
import { AddYourOwn } from "@/components/library/add-your-own";
import { AnimateForm } from "@/components/library/animate-form";
import { Drawer } from "@/components/library/drawer";
import { FolderBar } from "@/components/library/folder-bar";
import { FreePhotoCard } from "@/components/library/free-photo-card";
import { Gallery, type GalleryItem } from "@/components/library/gallery";
import { LibraryTabs } from "@/components/library/tabs";
import { ScenePicker } from "@/components/scene-picker";
import { EmptyState, Note, PageHeader } from "@/components/ui";
import { spendableBalance } from "@/billing/credits";
import { creditsFor } from "@/billing/pricing";
import { CLIP_MODELS, type ClipModel } from "@/content/clip-options";
import { DEFAULT_IMAGE_MODEL } from "@/content/image-options";
import { cachedMotionIdeas } from "@/content/motion-ideas";
import { identityLock, listAvatars } from "@/data/avatars";
import { folderChoice, folderCounts, listFolders, totalOf } from "@/data/folders";
import { freePhotoState } from "@/data/freebie";
import { countUploads, listMedia, mediaUrl, SHOW_ALL, UPLOAD_CAP, type Media } from "@/data/media";
import { hasVerifiedEmail, requireUser } from "@/data/users";
import { isUuid } from "@/data/ids";
import { suggestedScene } from "@/jobs/free-photo";
import { currentAvatar } from "@/lib/current-avatar";
import { getStorage } from "@/lib/get-storage";
import { isFavorite } from "@/lib/tile-actions";
import { canCopy } from "@/lib/uploads";
import { photoStyleOf, SHOT_LABEL_BY_STYLE } from "@/style/photo-style";
import type { ShotType } from "@/style/shot-types";

import type { LibraryTab } from "./paths";
import { photosFor, photoShelf, SHELF_LABEL, shelfCounts, shelfFrom } from "./shelves";

/* One page, two tabs, any number of folders.
 *
 * The tab is the kind — photos or clips — and the folder rides along in the
 * URL across the switch, so "Beach day" open on Photos is still open on
 * Clips. Both tabs are drawn by this one component so the header, the tabs,
 * the folder row and the grid can never drift apart; the routes under
 * src/app/library only say which tab they are. */

const PHOTO_CREDITS = creditsFor({ kind: "image", model: DEFAULT_IMAGE_MODEL });

/* Every clip price on this page comes from here, and here comes from
   `creditsFor`, by the same arithmetic as every other price in the product. */
const CLIP_CREDITS: Record<ClipModel, number> = Object.fromEntries(
  CLIP_MODELS.map((model) => [model.id, creditsFor({ kind: "clip", model: model.id, seconds: 5 })]),
) as Record<ClipModel, number>;

const MODEL_NAME: Record<string, string> = Object.fromEntries(CLIP_MODELS.map((model) => [model.id, model.name]));

/** The row, said in the words the grid and the viewer show. Also drawn by the Favorites tab. */
export function toGalleryItem(row: Media): GalleryItem {
  const meta = row.meta as { idea?: string; motion?: string; originalName?: string; source?: string; model?: string; subject?: string };
  const uploaded = meta.source === "upload";
  const title = row.kind === "image"
    ? (uploaded ? meta.originalName ?? "" : meta.idea ?? "")
    : (uploaded ? meta.originalName ?? "" : meta.motion ?? "");
  return {
    id: row.id,
    kind: row.kind === "image" ? "image" : "clip",
    src: mediaUrl(row.id),
    createdAt: row.createdAt.toISOString(),
    folderId: row.folderId,
    title,
    uploaded,
    scene: uploaded && meta.subject === "scene",
    words: row.kind === "image" && photoShelf(row.meta) === "words",
    model: !uploaded && meta.model ? MODEL_NAME[meta.model] ?? meta.model : undefined,
    seconds: row.durationSeconds == null ? null : Number(row.durationSeconds),
    favorite: isFavorite(row.meta),
    avatarId: row.avatarId,
    copyable: canCopy(row),
  };
}

export async function LibraryView({
  tab,
  searchParams,
}: {
  tab: LibraryTab;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);

  const user = await requireUser();
  const kind = tab === "photos" ? "image" : "clip";
  // A shelf is a Photos view only; on Clips the parameter means nothing.
  const shelf = tab === "photos" ? shelfFrom(one("shelf")) : null;

  /* A folder id in the URL that is not this account's is treated as "all":
     a stale bookmark should show the library, not an error page. */
  const folders = await listFolders(user.id);
  let folderParam = one("folder");
  let folder: string | null | undefined;
  try {
    folder = folderChoice(folderParam);
  } catch {
    folder = undefined;
  }
  if (typeof folder === "string" && !folders.some((item) => item.id === folder)) folder = undefined;
  // A shelf holds its photos from every folder, so an open shelf has no folder open.
  if (shelf) folder = undefined;
  if (folder === undefined) folderParam = undefined;

  const avatar = await currentAvatar(user.id);
  /* Every item is read, and photos are sorted into shelves here, because
     which shelf a photo is on is worked out from the photo. The grid and the
     counts on the chips come from the same rows. */
  /* Counts are this avatar's, like the grid: the tabs once said "Photos 36"
     over a grid of five, counting every avatar on the account. The account's
     own counts are read too, only to tell an empty folder from one that holds
     another avatar's things. */
  const [listed, counts, accountCounts, credits, freebie, uploaded, avatars] = await Promise.all([
    listMedia(user.id, kind, { folder: tab === "photos" ? undefined : folder, keptOnly: true, avatarId: avatar?.id, orUnassigned: true, limit: SHOW_ALL }),
    folderCounts(user.id, undefined, avatar?.id),
    folderCounts(user.id),
    spendableBalance(user.id),
    freePhotoState(user.id),
    countUploads(user.id),
    listAvatars(user.id),
  ]);
  const lock = identityLock(avatar);
  const items = tab === "photos" ? photosFor(listed, { shelf, folder }) : listed;
  const shelved = tab === "photos" ? shelfCounts(listed) : null;

  /* Clerk is only asked while there is actually a gift to give: it is a
     network call, and on every other visit to this page the answer changes
     nothing that is rendered. */
  const emailVerified = tab === "photos" && freebie.available && lock ? await hasVerifiedEmail(user.id) : false;

  const totals = { photos: totalOf(counts, "image"), videos: totalOf(counts, "clip") };
  /* Folders belong to the account, but a folder whose every item is another
     avatar's is that avatar's folder: it is not shown here. An empty folder is
     shown to all of them, and the open one always is. */
  const hers = (id: string) => Object.values(counts[id] ?? {}).some((n) => (n ?? 0) > 0);
  const empty = (id: string) => !Object.values(accountCounts[id] ?? {}).some((n) => (n ?? 0) > 0);
  const chips = folders
    .filter((item) => hers(item.id) || empty(item.id) || item.id === folderParam)
    .map((item) => ({ id: item.id, name: item.name, count: shelved ? (shelved.byFolder[item.id] ?? 0) : (counts[item.id]?.[kind] ?? 0) }));
  const unfiled = shelved ? shelved.unfiled : (counts[""]?.[kind] ?? 0);
  const folderName = typeof folder === "string" ? folders.find((item) => item.id === folder)?.name : undefined;

  /* Only a real folder is handed to the generators: with "All" or "Not in a
     folder" open, what is made lands unfiled, which is what those views show. */
  const fileUnder = typeof folder === "string" ? folder : undefined;

  /* The photo a link asked to animate: from the viewer's "Animate this photo".
     Those photos are the ones in the open folder, or every photo when none is,
     with the asked-for one first so it is the one that is already ticked. */
  const animateId = one("animate");
  let photos: Media[] = [];
  if (tab === "videos" && lock) {
    photos = await listMedia(user.id, "image", { folder: fileUnder, keptOnly: true, avatarId: avatar?.id, orUnassigned: true, limit: SHOW_ALL });
    if (animateId && isUuid(animateId) && !photos.some((photo) => photo.id === animateId)) {
      photos = await listMedia(user.id, "image", { keptOnly: true, avatarId: avatar?.id, orUnassigned: true, limit: SHOW_ALL });
    }
    if (animateId) photos = [...photos.filter((photo) => photo.id === animateId), ...photos.filter((photo) => photo.id !== animateId)];
    // A photo with words already drawn on it is a finished post: a clip from it would carry those words under the reel's own.
    photos = photos.filter((photo) => photoShelf(photo.meta) !== "words");
  }
  const animateOpen = Boolean(animateId && photos.some((photo) => photo.id === animateId));

  const inFolder = folderName ? ` in ${folderName}` : folder === null ? " not in a folder" : "";

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Everything you can post with"
      />

      {/* A paused or unpaid account should not have to open a generator to find
          out it cannot use it. Priced at zero on purpose: this says only that
          generating is off, and the gates inside each drawer say what a photo
          or a clip costs, so the same sentence is never printed twice. */}
      <PaidActionNotice user={user} balance={credits} cost={0} noun="photo" className="mb-6" />

      {/* Said before the upload room runs out, not after: at four fifths there
          is still room to finish what she is doing and time to tidy. Only her
          own uploads count; what is made here never runs out of room. */}
      {uploaded >= UPLOAD_CAP * 0.8 && (
        <Note tone={uploaded >= UPLOAD_CAP ? "warn" : "plain"} className="mb-6">
          {uploaded >= UPLOAD_CAP
            ? `You have added ${UPLOAD_CAP} photos and clips of your own, the most there is room for. Delete ones you added to add more. Photos and clips made here do not count.`
            : `You can add ${UPLOAD_CAP} photos and clips of your own and you have added ${uploaded}. Photos and clips made here do not count.`}
        </Note>
      )}

      <LibraryTabs tab={shelf === "words" ? "quotes" : tab} folder={folderParam} counts={shelved ? { ...totals, quotes: shelved.words } : totals} />
      <FolderBar
        tab={tab}
        folders={chips}
        current={folderParam}
        all={shelved ? shelved.made : totals[tab]}
        unfiled={unfiled}
        {...(shelved ? { shelves: { uploads: shelved.uploads, words: shelved.words }, shelf } : {})}
      />

      {/* Above the paid drawers, and only until it is spent. An account set up
          before the last step of setup existed never saw the offer, and anyone
          can skip it, so this is where the promise is kept. */}
      {tab === "photos" && freebie.available && lock && (
        <FreePhotoCard suggestion={suggestedScene(lock.scenes)} action={freePhotoAction} emailVerified={emailVerified} />
      )}

      <div className="mb-10 space-y-3">
        {lock ? (
          tab === "photos" ? (
            <Drawer
              title="Generate a photo of her"
              summary={folderName ? `Pick a scene. The photo is filed in ${folderName}.` : "Pick a scene, or say where she is and what she is doing."}
              credits={PHOTO_CREDITS}
            >
              {/* The gate shows the form, or the reason it cannot and the link that fixes it. */}
              <PaidActionGate user={user} balance={credits} cost={PHOTO_CREDITS} noun="photo" quiet>
                <ActionForm
                  action={generateSceneAction}
                  submitLabel="Generate photo"
                  pendingLabel="Writing the prompt and generating…"
                  cost={PHOTO_CREDITS}
                  className="space-y-5"
                >
                  {fileUnder && <input type="hidden" name="folder" value={fileUnder} />}
                  <ScenePicker shots={Object.entries(SHOT_LABEL_BY_STYLE[photoStyleOf(lock)]) as [ShotType, string][]} wardrobe={lock.wardrobe} usualPlaces={lock.scenes} />
                </ActionForm>
              </PaidActionGate>
            </Drawer>
          ) : photos.length > 0 ? (
            <Drawer
              id="animate"
              title="Animate a photo into a short clip"
              summary="A short talking clip: she says one line, with her voice."
              credits={CLIP_CREDITS.omni}
              creditsTo={Math.max(...Object.values(CLIP_CREDITS))}
              open={animateOpen}
            >
              {/* The button prints the price, and the job refuses if it cannot be paid for. */}
              <PaidActionGate user={user} balance={credits} cost={CLIP_CREDITS.omni} noun="clip" quiet>
                <AnimateForm
                  action={animateAction}
                  polish={polishMotionAction}
                  suggest={motionIdeasAction}
                  credits={CLIP_CREDITS}
                  folder={fileUnder}
                  defaultPhotoId={animateOpen ? animateId : undefined}
                  photos={photos.map((image) => ({
                    id: image.id,
                    src: mediaUrl(image.id),
                    width: image.width,
                    height: image.height,
                    /* Suggestions this photo has already been looked at for.
                       Sent with the page so a tile that was tapped before
                       fills in without a round trip — and so a photo that has
                       never been looked at is the only one that costs a call. */
                    ideas: cachedMotionIdeas(image),
                  }))}
                />
              </PaidActionGate>
            </Drawer>
          ) : (
            <Note>
              {folderName
                ? `There are no photos in ${folderName} to animate yet. Generate one on the Photos tab with this folder open.`
                : "Generate a photo on the Photos tab first. A clip is a photo with one small movement added."}
            </Note>
          )
        ) : (
          <Note tone="warn">
            Photos are generated from her reference set, so finish the Avatar step first. Nothing here costs anything
            until then.
          </Note>
        )}

        {/* Last of the drawers and the only free one: her own footage. It does
            not depend on a lock, because nothing is being generated — but it
            does need an avatar to hang the rows off, which is what finishing
            setup produces. */}
        {avatar && (
          <Drawer title="Add your own" summary="Photos and short clips from your phone or camera roll. Everything you add is kept on the Uploads tab.">
            <AddYourOwn
              remaining={Math.max(0, UPLOAD_CAP - uploaded)}
              folder={fileUnder}
              folderName={folderName}
              directUploads={Boolean(getStorage().uploadUrl)}
            />
          </Drawer>
        )}
      </div>

      {/* This shelf is one avatar's photos; the Uploads tab is every upload, clips too, on every avatar. */}
      {shelf === "uploads" && (
        <p className="mb-4 text-sm text-muted">
          These are the photos you added for {avatar?.name ?? "this avatar"}.{" "}
          <Link href="/library/uploads" className="font-medium text-ink underline-offset-4 hover:underline">
            See every upload on the Uploads tab
          </Link>
          , clips and other avatars too.
        </p>
      )}

      {items.length === 0 ? (
        shelf ? (
          <EmptyState title={`Nothing in ${SHELF_LABEL[shelf].name} yet`}>{SHELF_LABEL[shelf].empty}</EmptyState>
        ) : tab === "photos" ? (
          <EmptyState title={folder === undefined ? "No photos yet" : `No photos${inFolder}`}>
            {folder === undefined
              ? "Generate the first one above. It takes about a minute."
              : "Generate one with this folder open and it lands here, or use Select on another folder to move photos in."}
          </EmptyState>
        ) : (
          <EmptyState title={folder === undefined ? "No clips yet" : `No clips${inFolder}`}>
            {folder === undefined
              ? "Animate one of her photos above, or add footage you already have with “Add your own”. A clip is what turns a hook into a reel."
              : "Animate a photo with this folder open and the clip lands here, or use Select on another folder to move clips in."}
          </EmptyState>
        )
      ) : (
        <Gallery
          items={items.map(toGalleryItem)}
          folders={folders.map(({ id, name }) => ({ id, name }))}
          kind={kind}
          folder={folderParam}
          copy={{ avatars: avatars.map(({ id, name }) => ({ id, name })), cap: UPLOAD_CAP }}
        />
      )}
    </>
  );
}
