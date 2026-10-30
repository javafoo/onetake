import Link from "next/link";

import { HookList, type HookRow } from "@/components/hooks/hook-list";
import { HookTools } from "@/components/hooks/hook-tools";
import { buttonClass, EmptyState, Input, PageHeader } from "@/components/ui";
import { HOOK_FILTERS, MAX_SAVED_HOOK_WORDS, hooksHref, hookUseLabels, parseHookFilter, parseHookQuery, type HookFilter } from "@/data/hook-rules";
import { countHooks, listHooks } from "@/data/hooks";
import { requireUser } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";

export const dynamic = "force-dynamic";

const CHIP = "inline-flex min-h-10 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-full border px-3.5 text-sm transition-colors";
const CHIP_ON = "border-ink bg-ink text-canvas";
const CHIP_OFF = "border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink";

/* Hooks: the words, saved, and nothing else. No captions here; a caption is
   written for a reel when the reel is made. "Use" sends a hook to Create. */
export default async function HooksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filter = parseHookFilter(params.show);
  const query = parseHookQuery(params.q);

  const user = await requireUser();
  const avatar = await currentAvatar(user.id);

  if (!avatar) {
    return (
      <>
        <PageHeader eyebrow="Hooks" title="Hooks" />
        <EmptyState
          title="Set her up first"
          action={
            <Link href="/onboarding" className={buttonClass("primary")}>
              Finish her setup
            </Link>
          }
        >
          Hooks are written in her voice, so she needs a name and a brand before the first one.
        </EmptyState>
      </>
    );
  }

  const [rows, counts] = await Promise.all([listHooks(user.id, avatar.id, { filter, query }), countHooks(user.id, avatar.id)]);
  const hooks: HookRow[] = rows.map((row) => ({ id: row.id, text: row.text, marks: hookUseLabels(row), archived: Boolean(row.archivedAt) }));

  return (
    <>
      <PageHeader eyebrow="Hooks" title="Hooks" lead="The words for your reels and carousels. Use one to make it on Create." />

      <HookTools maxWords={MAX_SAVED_HOOK_WORDS} />

      {counts.all > 0 && (
        <div className="mb-5 space-y-3">
          {/* Scrolls sideways on a narrow phone rather than wrapping to a second row of chips. */}
          <nav aria-label="Which hooks" className="-mx-gutter overflow-x-auto px-gutter md:mx-0 md:px-0">
            <ul className="flex gap-2">
              {HOOK_FILTERS.map((item) => {
                const active = item.id === filter;
                return (
                  <li key={item.id}>
                    <Link href={hooksHref(item.id, query)} aria-current={active ? "page" : undefined} className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF}`}>
                      {item.label}
                      <span className={`text-xs tabular-nums ${active ? "text-canvas/70" : "text-muted"}`}>{counts[item.id]}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {/* A plain GET form: the search is a URL, so the refresh after every action keeps it. */}
          <form action="/hooks" method="get" role="search" className="flex items-center gap-2 sm:max-w-sm">
            {filter !== "unused" && <input type="hidden" name="show" value={filter} />}
            <Input type="search" name="q" defaultValue={query} placeholder="Search hooks" aria-label="Search hooks" className="min-h-10 py-1.5" />
            {query && (
              <Link href={hooksHref(filter)} className={buttonClass("ghost", "sm", "shrink-0")}>
                Clear
              </Link>
            )}
          </form>
        </div>
      )}

      {hooks.length === 0 ? (
        <Empty filter={filter} query={query} total={counts.all} />
      ) : (
        <HookList key={`${filter}:${query}`} hooks={hooks} filter={filter} maxWords={MAX_SAVED_HOOK_WORDS} />
      )}
    </>
  );
}

function Empty({ filter, query, total }: { filter: HookFilter; query: string; total: number }) {
  if (total === 0) {
    return (
      <EmptyState title="No hooks yet">
        Press Write hooks for a batch in your voice, or add one you wrote. Both are free.
      </EmptyState>
    );
  }
  if (query) {
    return (
      <EmptyState
        title="No hooks match"
        action={
          <Link href={hooksHref(filter)} className={buttonClass("quiet")}>
            Clear the search
          </Link>
        }
      >
        Try fewer words, or another filter.
      </EmptyState>
    );
  }
  const copy: Record<HookFilter, { title: string; body: string }> = {
    unused: { title: "Every hook has been used", body: "Write a new batch above, or look under Used to make another reel from an old one." },
    used: { title: "Nothing used yet", body: "Press Use on a hook to make a reel or a carousel from it." },
    archived: { title: "Nothing archived", body: "Archive a hook to take it out of your list without deleting it." },
    all: { title: "No hooks yet", body: "Press Write hooks for a batch in your voice. It is free." },
  };
  return <EmptyState title={copy[filter].title}>{copy[filter].body}</EmptyState>;
}
