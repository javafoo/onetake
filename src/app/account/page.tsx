import type { Metadata } from "next";
import Link from "next/link";

import { spendableBalance } from "@/billing/credits";
import { creditsBuySentence } from "@/billing/gate";
import { FREE_CREDITS } from "@/billing/pricing";
import { recentMovements } from "@/billing/store.db";
import { DeleteAccount } from "@/components/account/delete-account";
import { LedgerList } from "@/components/billing/ledger";
import { buttonClass, Card, Note, PageHeader, Section } from "@/components/ui";
import { listDrafts } from "@/data/drafts";
import { listMedia } from "@/data/media";
import { requireUser } from "@/data/users";
import { PRODUCT_NAME } from "@/lib/product";
import { currentAvatar } from "@/lib/current-avatar";

export const metadata: Metadata = { title: `Your account · ${PRODUCT_NAME}` };
export const dynamic = "force-dynamic";

/* Leaving.
 *
 * It says what is here, what will go, and what will not, before it offers the
 * button — because somebody deleting an account deserves to know they are
 * about to lose fifteen photographs and a month of drafts, and because an
 * honest count is the difference between a decision and a surprise.
 */
export default async function AccountPage() {
  const user = await requireUser();
  const avatar = await currentAvatar(user.id);
  const [uploads, images, clips, reels, slides, drafts, credits, movements] = await Promise.all([
    listMedia(user.id, "upload"),
    listMedia(user.id, "image"),
    listMedia(user.id, "clip"),
    listMedia(user.id, "reel"),
    listMedia(user.id, "slide"),
    listDrafts(user.id),
    spendableBalance(user.id).catch(() => null),
    recentMovements(user.id, 30).catch(() => []),
  ]);

  const files = uploads.length + images.length + clips.length + reels.length + slides.length;

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Your account"
        lead="Your credits, what is stored here, and how to take all of it away."
      >
        <Link href="/create" className={buttonClass("quiet")}>
          Back to Create
        </Link>
      </PageHeader>

      <Section
        id="credits"
        title="Credits"
        description={`Every account starts with ${FREE_CREDITS} free credits. A photo is 1 credit; writing, carousels and putting a reel together are free.`}
        className="mb-10"
      >
        <Card className="mb-4 text-sm text-ink-soft">
          <p>
            <strong className="text-2xl text-ink tabular-nums">{(credits ?? 0).toLocaleString("en-US")}</strong> credits left.{" "}
            {credits !== null && creditsBuySentence(credits)}
          </p>
        </Card>
        <LedgerList movements={movements} />
      </Section>

      <Section title="What we hold" description="Everything on this account, counted now." className="mb-10">
        <Card className="space-y-2 text-sm text-ink-soft">
          <p>
            <strong className="text-ink">{files}</strong> {files === 1 ? "file" : "files"}: {uploads.length} uploaded{" "}
            {uploads.length === 1 ? "photo" : "photos"}, {images.length} generated, {clips.length}{" "}
            {clips.length === 1 ? "clip" : "clips"}, {reels.length} {reels.length === 1 ? "reel" : "reels"},{" "}
            {slides.length} carousel {slides.length === 1 ? "slide" : "slides"}.
          </p>
          <p>
            <strong className="text-ink">{drafts.length}</strong> {drafts.length === 1 ? "draft" : "drafts"}
            {avatar ? `, and the description of ${avatar.name}.` : "."}
          </p>
          <p>
            Your email address, your setup answers and your brand notes.
            {credits !== null && ` A balance of ${credits.toLocaleString("en-US")} credits.`}
          </p>
        </Card>
      </Section>

      <Section
        title="Delete my account and data"
        description="Everything above, gone. This cannot be undone and we keep no copy."
      >
        <Note tone="warn" className="mb-5">
          <p className="font-medium">What happens when you press the button</p>
          <ul className="mt-2 ml-4 list-disc space-y-1">
            <li>Every file is deleted from storage, and every row is deleted from our database.</li>
            <li>
              Your remaining credits
              {credits !== null && credits > 0 ? ` — ${credits.toLocaleString("en-US")} of them — ` : " "}
              go with them.
            </li>
            <li>Your sign-in is deleted and you are signed out everywhere.</li>
          </ul>
          <p className="mt-2">
            We keep one thing: the record of what each generation cost us to run. It carries no name, no email
            address and nothing you wrote.
          </p>
        </Note>

        <Card>
          <DeleteAccount />
        </Card>
      </Section>
    </>
  );
}
