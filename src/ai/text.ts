import { ContentBlockedError, generateText as geminiText, generateTurn as geminiTurn, type InlineImage, type TurnResult } from "./gemini";
import { hasImages, nemotronText, nemotronTurn, type Tier } from "./nemotron";

/* The one text call every writer, checker and planner makes.

   Words go to NVIDIA Nemotron on Nebius Token Factory, sized to the job:
   writing that a second pass checks anyway ("low" thinking) goes to Nano, the
   rest to Super, and a caller that needs the deepest reasoning asks for Ultra.
   A call that carries pictures goes to Gemini, because Nemotron's text models
   cannot see. If Nemotron fails, the same call is made on Gemini so a post is
   never lost to one provider's bad minute; the log says it happened. */

export type TextOptions = {
  prompt: string;
  images?: InlineImage[];
  schema?: Record<string, unknown>;
  system?: string;
  thinking?: "default" | "low";
  /** Which Nemotron. Absent: Nano for "low" thinking, Super otherwise. */
  tier?: Tier;
};

/** Which model a call goes to, decided from the call alone. Pure. */
export function routeText(options: Pick<TextOptions, "images" | "thinking" | "tier">, nemotronAvailable: boolean): { provider: "nemotron"; tier: Tier } | { provider: "gemini" } {
  if (options.images?.length || !nemotronAvailable) return { provider: "gemini" };
  return { provider: "nemotron", tier: options.tier ?? (options.thinking === "low" ? "nano" : "super") };
}

export async function generateText<T = string>(options: TextOptions): Promise<T> {
  const route = routeText(options, Boolean(process.env.NEBIUS_API_KEY));
  if (route.provider === "gemini") return geminiText<T>(options);
  try {
    return await nemotronText<T>({ prompt: options.prompt, system: options.system, schema: options.schema, tier: route.tier, reasoning: options.thinking === "low" ? "low" : "default" });
  } catch (error) {
    if (error instanceof ContentBlockedError) throw error;
    console.error(`[text] Nemotron ${route.tier} failed, answering with Gemini: ${error instanceof Error ? error.message : String(error)}`);
    return geminiText<T>(options);
  }
}

/* ---- Agent turns ---------------------------------------------------------- */

type TurnOptions = Parameters<typeof geminiTurn>[0];

/**
 * One agent round, in Gemini's turn shape so the loop does not care who
 * answered. Nemotron Super decides which tool to call; a round that carries a
 * pasted screenshot goes to Gemini, which can see it. If Nemotron fails before
 * it has said anything, the round is asked again of Gemini; once words have
 * reached her, a failure is hers to see and retry.
 */
export async function generateTurn(options: TurnOptions): Promise<TurnResult> {
  if (!process.env.NEBIUS_API_KEY || hasImages(options.contents)) return geminiTurn(options);
  let spoke = false;
  try {
    return await nemotronTurn({
      tier: "super",
      reasoning: options.thinking === "low" ? "low" : "default",
      system: options.system,
      contents: options.contents,
      tools: options.tools,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      onText: (delta) => {
        spoke = true;
        options.onText?.(delta);
      },
    });
  } catch (error) {
    if (spoke || options.signal?.aborted) throw error;
    console.error(`[text] Nemotron turn failed, answering with Gemini: ${error instanceof Error ? error.message : String(error)}`);
    return geminiTurn(options);
  }
}
