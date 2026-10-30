import { providerFailure } from "./provider-error";
import { reportUsage } from "./usage";

/* Tavily web search, and nothing else. The agent asks it what is being talked
   about in her niche this week, so a post can meet the moment instead of
   repeating last month's advice. Every result keeps its link: a trend the
   agent uses is shown to her with where it came from. */

const BASE = "https://api.tavily.com";
export const TAVILY_TIMEOUT_MS = 30_000;

export type SearchResult = { title: string; url: string; content: string; publishedDate?: string };
export type SearchAnswer = { answer?: string; results: SearchResult[] };

type TavilyResponse = {
  answer?: string | null;
  results?: { title?: string; url?: string; content?: string; published_date?: string }[];
  detail?: { error?: string } | string;
};

/** The request body for one search. Pure. */
export function searchRequestBody(options: {
  query: string;
  topic?: "general" | "news";
  timeRange?: "day" | "week" | "month";
  maxResults?: number;
}): Record<string, unknown> {
  return {
    query: options.query.slice(0, 400),
    topic: options.topic ?? "news",
    time_range: options.timeRange ?? "week",
    max_results: Math.min(Math.max(options.maxResults ?? 5, 1), 10),
    search_depth: "basic",
    include_answer: "basic",
  };
}

/** A response as results we can show, dropping any without a link. Pure. */
export function readSearch(json: TavilyResponse): SearchAnswer {
  const results = (json.results ?? [])
    .filter((result): result is { title?: string; url: string; content?: string; published_date?: string } => typeof result.url === "string" && result.url.startsWith("http"))
    .map((result) => ({
      title: (result.title ?? result.url).trim(),
      url: result.url,
      content: (result.content ?? "").trim().slice(0, 600),
      ...(result.published_date ? { publishedDate: result.published_date } : {}),
    }));
  return { ...(json.answer ? { answer: json.answer.trim() } : {}), results };
}

export async function search(options: Parameters<typeof searchRequestBody>[0] & { fetch?: typeof fetch }): Promise<SearchAnswer> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("Missing TAVILY_API_KEY");
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${BASE}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(searchRequestBody(options)),
      signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`Tavily did not answer within ${TAVILY_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  }
  const json = (await response.json().catch(() => null)) as TavilyResponse | null;
  if (!response.ok || !json) {
    const detail = json?.detail;
    throw providerFailure("Tavily", "search", response.status, (typeof detail === "string" ? detail : detail?.error) ?? "request failed");
  }
  reportUsage({ provider: "tavily", model: "search", kind: "search" });
  return readSearch(json);
}
