import Link from "next/link";

import { Badge, DoneDot } from "./badge";
import { ArrowIcon } from "./icons";

/* The step indicator. The sidebar and the phone's bottom bar show the same
   five steps as icons; this is the long form, where each step also says where
   it has got to. "Done" means the same thing in all three places. */

export type StepItem = {
  href: string;
  title: string;
  /** Where this step has got to, in the user's own numbers. */
  status: string;
  done: boolean;
};

export function StepIndicator({ items }: { items: StepItem[] }) {
  return (
    <ol className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      {items.map((item, index) => (
        <li key={item.href} className={index > 0 ? "border-t border-line" : undefined}>
          <Link
            href={item.href}
            className="flex min-h-16 items-center gap-4 px-4 py-3.5 transition-colors hover:bg-sunken/60 sm:px-6"
          >
            <DoneDot done={item.done} label={String(index + 1)} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-display text-lg text-ink">{item.title}</span>
                <Badge tone={item.done ? "good" : "plain"}>{item.done ? "Done" : "To do"}</Badge>
              </span>
              <span className="mt-0.5 block text-sm text-muted">{item.status}</span>
            </span>
            <ArrowIcon className="size-4 shrink-0 text-muted" />
          </Link>
        </li>
      ))}
    </ol>
  );
}
