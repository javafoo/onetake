import { notFound, redirect } from "next/navigation";

import { AnswerForm, type FieldSpec } from "@/components/onboarding/answer-form";
import { Ask } from "@/components/onboarding/progress";
import { SetupScreen } from "@/components/onboarding/screen";
import { Note } from "@/components/ui";
import { type AnswerValue } from "@/onboarding/state";
import { step, STEP_IDS, STORY_BEATS, type StepId } from "@/onboarding/steps";

import { answerStepAction } from "../../actions";
import { openStage } from "../../guard";

export const dynamic = "force-dynamic";

/* One question per URL, answered in her own words. Coming back to a step shows
   what she wrote. */

export default async function InterviewStepPage(props: PageProps<"/onboarding/interview/[step]">) {
  const { step: slug } = await props.params;
  if (!(STEP_IDS as readonly string[]).includes(slug)) notFound();
  const id = slug as StepId;

  const { session } = await openStage(id);
  if (!session) redirect("/onboarding");
  const interview = session.interview;
  const current = step(id);
  const answer = interview.answers[id];

  let fields: FieldSpec[];

  if (id === "story") {
    const told = answer as AnswerValue<"story"> | undefined;
    fields = STORY_BEATS.map((beat) => {
      const field = current.fields!.find((item) => item.id === beat)!;
      return { id: beat, label: field.question, hint: field.help, placeholder: field.example, rows: 3, value: told?.[beat] ?? "", options: [] };
    });
  } else if (id === "proof") {
    const told = answer as AnswerValue<"proof"> | undefined;
    fields = [
      {
        id: "points",
        label: "One per line",
        hint: "Three to five lines is plenty.",
        placeholder: current.example.split(". ").join(".\n"),
        rows: 6,
        value: (told?.points ?? []).join("\n"),
        options: [],
      },
    ];
  } else if (id === "offer") {
    const told = answer as AnswerValue<"offer"> | undefined;
    const text = current.fields!.find((item) => item.id === "text")!;
    const keyword = current.fields!.find((item) => item.id === "keyword")!;
    fields = [
      { id: "text", label: text.question, hint: text.help, placeholder: text.example, rows: 3, value: told?.text ?? "", options: [] },
      { id: "keyword", label: keyword.question, hint: keyword.help, placeholder: keyword.example, rows: 0, value: told?.keyword ?? "", options: [] },
    ];
  } else if (id === "voice") {
    const told = answer as AnswerValue<"voice"> | undefined;
    const label = current.fields!.find((item) => item.id === "label")!;
    const caption = current.fields!.find((item) => item.id === "caption")!;
    fields = [
      { id: "label", label: label.question, hint: label.help, placeholder: label.example, rows: 0, value: told?.label ?? "", options: [] },
      { id: "caption", label: caption.question, hint: caption.help, placeholder: caption.example, rows: 4, value: told?.caption ?? "", options: [] },
    ];
  } else {
    const told = answer as { text: string } | undefined;
    fields = [{ id: "text", placeholder: current.example, rows: 4, value: told?.text ?? "", options: [] }];
  }

  return (
    <SetupScreen stage={id}>
      <Ask help={current.help}>{current.question}</Ask>
      {id === "proof" && (
        <Note tone="warn" className="mb-5">
          Nothing this app ever writes will use a number that is not on this list.
        </Note>
      )}
      <AnswerForm step={id} fields={fields} action={answerStepAction} />
    </SetupScreen>
  );
}
