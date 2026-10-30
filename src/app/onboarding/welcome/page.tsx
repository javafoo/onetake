import { ActionForm } from "@/components/action-form";
import { LanguageSelect } from "@/components/language-select";
import { ChoiceCard } from "@/components/onboarding/choice";
import { Ask } from "@/components/onboarding/progress";
import { SetupScreen } from "@/components/onboarding/screen";
import { Field, Input, Note } from "@/components/ui";

import { startSetupAction } from "../actions";
import { openStage } from "../guard";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const { session } = await openStage("welcome");
  const setup = session?.interview.setup;

  return (
    <SetupScreen stage="welcome">
      <Ask help="About ten minutes, on your phone, and you can stop at any point and come back. Nothing here costs anything.">
        Let&rsquo;s set up your avatar
      </Ask>

      <ActionForm
        action={startSetupAction}
        submitLabel={setup ? "Save and carry on" : "Start"}
        pendingLabel="Saving…"
        size="lg"
        className="space-y-6"
        hint="You can change any of this later."
        actionsClassName="flex flex-col gap-2 pt-1 [&>button]:w-full"
      >
        <Field label="What is she called?" hint="The name on the account. Use your own if that is the plan.">
          <Input name="personaName" defaultValue={setup?.personaName ?? ""} placeholder="Maya" autoComplete="off" required />
        </Field>

        <Field label="What is the account about?" hint="One line. Who it is for and what it is about.">
          <Input
            name="niche"
            defaultValue={setup?.niche ?? ""}
            placeholder="A hair studio for women who want an honest stylist"
            autoComplete="off"
            required
          />
        </Field>

        <LanguageSelect defaultValue={setup?.language} />

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-ink">Whose face is she?</legend>
          <p className="text-xs text-muted">This decides what we can promise about the photos.</p>
          <div className="mt-2 space-y-3">
            <ChoiceCard
              name="avatarKind"
              value="twin"
              title="My own face"
              defaultChecked={setup?.avatarKind === "twin"}
            >
              You will upload photos of yourself, and she will look like you.
            </ChoiceCard>
            <ChoiceCard
              name="avatarKind"
              value="avatar"
              title="A character I already have images of"
              defaultChecked={setup?.avatarKind === "avatar" || !setup}
            >
              You have pictures of her already and you own them or have the right to use them.
            </ChoiceCard>
            <ChoiceCard
              name="avatarKind"
              value="new"
              title="Design a new face from a description"
              note="Coming soon"
              disabled
            >
              Not in this version. For now, start from photos you already have.
            </ChoiceCard>
          </div>
        </fieldset>

        <Note>Next: five to fifteen photos of her. They stay private to your account.</Note>
      </ActionForm>
    </SetupScreen>
  );
}
