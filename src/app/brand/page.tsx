import Link from "next/link";

import { saveBrandAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { MemoryCard } from "@/components/brand/memory-card";
import { OfferFields } from "@/components/brand/offer-fields";
import { LanguageSelect } from "@/components/language-select";
import { buttonClass, Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { storyBeatsFor } from "@/brief/sync";
import { getBrief, getProfile } from "@/data/brand";
import { listFacts, MAX_FACT_CHARS } from "@/data/memory";
import { requireUser } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";

export const dynamic = "force-dynamic";

/* A long form is easier to finish when it is four short ones. Each group asks
   about one thing and says, in a line, what the writer does with the answer. */
function Group({ step, title, hint, children }: { step: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-7">
      <p className="eyebrow text-muted">Part {step} of 4</p>
      <h2 className="mt-1.5 font-display text-xl text-ink">{title}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted">{hint}</p>
      <div className="mt-6 space-y-6">{children}</div>
    </Card>
  );
}

export default async function BrandPage() {
  const user = await requireUser();
  const avatar = await currentAvatar(user.id);
  const [profile, brief, facts] = await Promise.all([
    getProfile(user.id, avatar?.id ?? null),
    getBrief(user.id, avatar?.id ?? null),
    avatar ? listFacts(user.id, avatar.id) : Promise.resolve([]),
  ]);
  const story = storyBeatsFor(profile, brief);

  return (
    <>
      <PageHeader
        eyebrow="Brand"
        title="What she is allowed to say"
      >
        <Link href="/brand/rework" className={buttonClass("quiet")}>
          Rework with the coach
        </Link>
      </PageHeader>

      <ActionForm
        action={saveBrandAction}
        submitLabel="Save brand"
        pendingLabel="Saving…"
        size="lg"
        hint="Free."
        className="space-y-6 pb-4"
        actionsClassName="sticky bottom-24 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface/95 p-3 shadow-lift backdrop-blur md:bottom-6"
      >
        <Group step={1} title="Her" hint="Her story is the only personal history the writer may use, and a fact-check pass rewrites anything it invents. Saving this page updates the brief too.">
          <Field label="Persona name" hint="The name on the account. Leave it blank if you use your own.">
            <Input name="personaName" defaultValue={profile.personaName ?? ""} placeholder="Maya" />
          </Field>
          <Field label="Before" hint="Her story, first person. Where she was before this worked. Only things you are happy to see in a caption.">
            <Textarea name="storyBefore" defaultValue={story.before} rows={3} placeholder="My account was dead. I had ideas but filming myself was never going to happen." />
          </Field>
          <Field label="What changed" hint="The decision, the thing she tried, the moment it clicked.">
            <Textarea name="storyTurn" defaultValue={story.turn} rows={2} placeholder="I built an AI avatar so I could post every day without being on camera." />
          </Field>
          <Field label="Now" hint="Only what is true today. No rounding up.">
            <Textarea name="storyNow" defaultValue={story.now} rows={2} placeholder="I post two or three times a day and it takes minutes." />
          </Field>
          <Field label="What she believes" hint="One per line. Something about the niche other people in it do not say.">
            <Textarea
              name="pointOfView"
              defaultValue={(brief?.pointOfView ?? []).map((item) => item.text).join("\n")}
              rows={3}
              placeholder="Building the avatar is the easy part. Nobody teaches what to post with it."
            />
          </Field>
        </Group>

        <Group step={2} title="Who this is for" hint="One person in one situation, not a category. Vague answers make vague hooks.">
          <Field label="Niche" hint="What the account is about, in one line.">
            <Input name="niche" defaultValue={profile.niche} placeholder="A hair studio for women who want an honest stylist" />
          </Field>
          <Field label="Audience" hint="Who she is, what she wants, what stops her.">
            <Textarea name="audience" defaultValue={profile.audience} rows={3} placeholder="Women in a 9-5 who have started an account twice and deleted it both times." />
          </Field>
          <Field label="What they are stuck on" hint="One per line, the way they would say it.">
            <Textarea
              name="problem"
              defaultValue={(brief?.problem ?? []).map((item) => item.text).join("\n")}
              rows={3}
              placeholder="I post every day and get 200 views. I have bought two courses and still do not know what to say."
            />
          </Field>
        </Group>

        <Group
          step={3}
          title="What she sells"
          hint="The call to action in every caption comes from these boxes. With more than one offer, name the offer or its keyword when you ask for a post and it sells that one. Otherwise it sells the first."
        >
          <OfferFields profile={profile} />
        </Group>

        <Group step={4} title="How she sounds" hint="Voice sets the tone. Proof points are the only numbers the writer may use; hooks that worked are patterns it may reuse.">
          <LanguageSelect defaultValue={profile.language} />
          <Field label="Voice" hint="How it should sound, in a few words. Add “Sounds like:” and “Never:” lists, separated by semicolons, to fill those parts of the brief.">
            <Textarea name="voice" defaultValue={profile.voice} rows={2} placeholder="Warm, direct, a little dry. Sounds like: short sentences. Never: hype; exclamation marks." />
          </Field>
          <Field label="Proof points" hint="One per line. The writer may use only these facts and never invents a number.">
            <Textarea name="proofPoints" defaultValue={profile.proofPoints.join("\n")} rows={4} placeholder={"12,000 followers in 5 months\n0 face reveals"} />
          </Field>
          <Field label="Hooks that already worked" hint="One per line. Their structure is reused, never their wording.">
            <Textarea name="winners" defaultValue={(profile.winners ?? []).join("\n")} rows={4} placeholder={"I deleted my account twice before this worked"} />
          </Field>
        </Group>
      </ActionForm>

      {avatar && (
        <div className="mt-6">
          <MemoryCard facts={facts.map(({ id, text, source }) => ({ id, text, source }))} maxChars={MAX_FACT_CHARS} />
        </div>
      )}
    </>
  );
}
