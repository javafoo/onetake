import { ActionForm } from "@/components/action-form";
import { Ask } from "@/components/onboarding/progress";
import { SetupScreen } from "@/components/onboarding/screen";
import { Card, Field, Input, Note, Textarea } from "@/components/ui";
import { getAvatar } from "@/data/avatars";
import type { IdentityLock } from "@/identity/build";
import { compile } from "@/onboarding/compile";
import type { AnswerValue } from "@/onboarding/state";
import { step } from "@/onboarding/steps";

import { finishSetupAction, reviseAnswersAction, saveLockAction } from "../actions";
import { openStage } from "../guard";

export const dynamic = "force-dynamic";

/* The last screen: everything she said, written out as the brief the rest of
   the app will read, with the boxes that produced each line underneath it.

   Editing here edits the answer, not a copy of it. A brief you can edit
   separately from the answers it came from is two versions of the truth, and
   within a week they disagree. */

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <p className="eyebrow text-muted">{label}</p>
      <p className="mt-1 text-sm text-pretty text-ink-soft">{children}</p>
    </div>
  );
}

export default async function ReviewPage() {
  const { user, session } = await openStage("review");
  const interview = session!.interview;
  const avatar = await getAvatar(user.id, session!.ui.avatarId ?? "");
  const lock = (avatar?.lock ?? null) as IdentityLock | null;

  let compiled: ReturnType<typeof compile> | null = null;
  let problem = "";
  try {
    compiled = compile(interview);
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }

  const answers = interview.answers;
  const story = answers.story as AnswerValue<"story"> | undefined;
  const offer = answers.offer as AnswerValue<"offer"> | undefined;
  const proof = answers.proof as AnswerValue<"proof"> | undefined;
  const voice = answers.voice as AnswerValue<"voice"> | undefined;

  return (
    <SetupScreen stage="review">
      <Ask help="This is what everything the app writes for you will be built from. Change anything that is not right.">
        Here is what we heard
      </Ask>

      {problem && <Note tone="warn" className="mb-5">{problem}</Note>}

      {compiled && (
        <Card className="mb-6 p-5 sm:p-6">
          <Line label="In one line">{compiled.brief.oneLiner.text}</Line>
          <Line label="Who you talk to">{compiled.profile.audience}</Line>
          <Line label="What they are stuck on">{answers.problem?.text}</Line>
          <Line label="What you sell">{compiled.profile.offer}</Line>
          <Line label="They comment">{compiled.profile.keyword}</Line>
          <Line label="Your story">{compiled.profile.story}</Line>
          <Line label="What you believe">{answers.pov?.text}</Line>
          <Line label="How you sound">{compiled.profile.voice}</Line>
          <Line label="Your proof">
            <span className="block whitespace-pre-line">{compiled.profile.proofPoints.join("\n")}</span>
          </Line>
        </Card>
      )}

      <details className="mb-6 rounded-xl border border-line bg-surface">
        <summary className="flex min-h-12 items-center px-5 text-sm font-medium text-ink">Change an answer</summary>
        <div className="border-t border-line px-5 py-5">
          <ActionForm
            action={reviseAnswersAction}
            submitLabel="Save changes"
            pendingLabel="Saving…"
            className="space-y-6"
          >
            <input type="hidden" name="audience.present" value="1" />
            <Field label={step("audience").title} hint={step("audience").question}>
              <Textarea name="audience.text" rows={3} defaultValue={answers.audience?.text ?? ""} />
            </Field>

            <input type="hidden" name="problem.present" value="1" />
            <Field label={step("problem").title} hint={step("problem").question}>
              <Textarea name="problem.text" rows={3} defaultValue={answers.problem?.text ?? ""} />
            </Field>

            <input type="hidden" name="offer.present" value="1" />
            <Field label={step("offer").title} hint="What it is, and the one word they comment.">
              <Textarea name="offer.text" rows={3} defaultValue={offer?.text ?? ""} />
            </Field>
            <Field label="Comment keyword">
              <Input name="offer.keyword" defaultValue={offer?.keyword ?? ""} className="uppercase" />
            </Field>

            <input type="hidden" name="story.present" value="1" />
            <Field label="Before">
              <Textarea name="story.before" rows={2} defaultValue={story?.before ?? ""} />
            </Field>
            <Field label="What changed">
              <Textarea name="story.turn" rows={2} defaultValue={story?.turn ?? ""} />
            </Field>
            <Field label="Now">
              <Textarea name="story.now" rows={2} defaultValue={story?.now ?? ""} />
            </Field>

            <input type="hidden" name="pov.present" value="1" />
            <Field label={step("pov").title} hint={step("pov").question}>
              <Textarea name="pov.text" rows={3} defaultValue={answers.pov?.text ?? ""} />
            </Field>

            <input type="hidden" name="proof.present" value="1" />
            <Field label={step("proof").title} hint="One per line. These are the only numbers the app may ever use.">
              <Textarea name="proof.points" rows={5} defaultValue={(proof?.points ?? []).join("\n")} />
            </Field>

            <input type="hidden" name="voice.present" value="1" />
            <input type="hidden" name="voice.label" value={voice?.label ?? ""} />
            <input type="hidden" name="voice.is" value={(voice?.is ?? []).join("\n")} />
            <input type="hidden" name="voice.isNot" value={(voice?.isNot ?? []).join("\n")} />
            <Field label={`How you sound: ${voice?.label ?? ""}`} hint="The caption that sets the tone for everything else.">
              <Textarea name="voice.caption" rows={6} defaultValue={voice?.caption ?? ""} />
            </Field>
          </ActionForm>
        </div>
      </details>

      {lock && (
        <details className="mb-8 rounded-xl border border-line bg-surface">
          <summary className="flex min-h-12 items-center px-5 text-sm font-medium text-ink">
            How she looks
            <span className="ml-2 text-xs font-normal text-muted">written from your photos</span>
          </summary>
          <div className="border-t border-line px-5 py-5">
            <p className="mb-5 text-sm text-muted">
              This description goes into every picture we make of her, word for word. Fix anything we got wrong.
            </p>
            <ActionForm action={saveLockAction} submitLabel="Save her description" pendingLabel="Saving…" className="space-y-5">
              <Field label="Who is in the photo">
                <Textarea name="subject" rows={2} defaultValue={lock.subject} />
              </Field>
              <Field label="Hair">
                <Textarea name="hair" rows={2} defaultValue={lock.hair} />
              </Field>
              <Field label="Skin and makeup">
                <Textarea name="skinMakeup" rows={3} defaultValue={lock.skinMakeup} />
              </Field>
              <Field label="What she wears on her">
                <Textarea name="accessories" rows={2} defaultValue={lock.accessories} />
              </Field>
              <Field label="Her expressions">
                <Textarea name="expressions" rows={2} defaultValue={lock.expressions} />
              </Field>
              <Field label="Wardrobe" hint="One per line.">
                <Textarea name="wardrobe" rows={5} defaultValue={lock.wardrobe.join("\n")} />
              </Field>
              <Field label="Places she is photographed" hint="One per line.">
                <Textarea name="scenes" rows={5} defaultValue={lock.scenes.join("\n")} />
              </Field>
            </ActionForm>
          </div>
        </details>
      )}

      <ActionForm
        action={finishSetupAction}
        submitLabel="That is her. Finish"
        pendingLabel="Setting her up…"
        size="lg"
        hint="This saves everything and opens Overview. Nothing here has cost you any credits."
        actionsClassName="flex flex-col gap-2 [&>button]:w-full"
      />
    </SetupScreen>
  );
}
