/* What a writer is handed beside her profile: what the agent remembers about
   her (`memoryLines`), and an optional `knowledge` block of reference material.
   Callers fetch it here and pass it in, so the writers stay pure.

   Two rules live here so no caller can get them wrong:
   - Reference material is a help, never a requirement. A memory read that
     fails is logged and the post is written without it.
   - Brand off hides what is hers: no memory. */

export type WriterContext = { knowledge?: string; memory?: string[] };

export interface WriterContextDeps {
  /** Her remembered facts as writer lines (`memoryLines(await listFacts(...))`). */
  facts(userId: string, avatarId: string): Promise<string[]>;
  log(where: string, error: unknown): void;
}

/** The query a writer's reference lookup runs on: the parts that say what is being written, joined. */
export function referenceQuery(...parts: (string | null | undefined)[]): string {
  return parts.map((part) => part?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean).join(" ").slice(0, 1_000);
}

/** Only the fields that have something in them, so a prompt without either stays byte for byte what it was. */
export function contextOptions(knowledge: string, memory: string[]): WriterContext {
  return { ...(knowledge.trim() ? { knowledge } : {}), ...(memory.length ? { memory } : {}) };
}

export async function writerContext(
  userId: string,
  avatarId: string,
  query: string,
  brand: boolean,
  deps: WriterContextDeps,
): Promise<WriterContext> {
  void query;
  const memory = brand
    ? await deps.facts(userId, avatarId).catch((error: unknown) => {
        deps.log("writerContext.memory", error);
        return [] as string[];
      })
    : [];
  return contextOptions("", memory);
}

/**
 * The live context: `brand_memory`. Imported lazily so modules the unit tests
 * load (the job machine, the hook batch) can hold a reference to this without
 * pulling server-only code into the test.
 */
export async function liveWriterContext(userId: string, avatarId: string, query: string, brand: boolean): Promise<WriterContext> {
  let deps: WriterContextDeps;
  try {
    deps = await liveWriterContextDeps();
  } catch (error) {
    // Not reachable from here (no database, or a bundle without the server code): write without it.
    console.error("[writerContext] unavailable —", error instanceof Error ? error.message : String(error));
    return {};
  }
  return writerContext(userId, avatarId, query, brand, deps);
}

async function liveWriterContextDeps(): Promise<WriterContextDeps> {
  const [{ listFacts, memoryLines }, { logUnexpected }] = await Promise.all([import("@/data/memory"), import("@/lib/errors")]);
  return {
    facts: async (userId, avatarId) => memoryLines(await listFacts(userId, avatarId)),
    log: (where, error) => void logUnexpected(where, error),
  };
}
