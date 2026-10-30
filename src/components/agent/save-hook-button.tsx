"use client";

import { useState, useTransition } from "react";

import { saveHookAction } from "@/app/create/actions";
import { Button } from "@/components/ui";

/* Keeps the words on a finished reel or set as a hook of their own. Free; the
   same words twice for the same avatar are refused, and the button says so. */

export function SaveHookButton({ hook }: { hook: string }) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setResult(await saveHookAction(hook));
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="quiet" size="sm" onClick={save} disabled={pending || result?.ok === true}>
        {pending ? "Saving…" : result?.ok ? "Hook saved" : "Save hook"}
      </Button>
      {result && !result.ok && (
        <span role="status" className="text-xs text-danger">
          {result.message}
        </span>
      )}
    </span>
  );
}
