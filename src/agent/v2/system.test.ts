import assert from "node:assert/strict";
import { test } from "node:test";

import { contextText, countPromptWords, SYSTEM_PROMPT } from "./system";
import { TOOLS } from "./tools";

test("the system prompt stays under 600 words and names only tools that exist", () => {
  assert.ok(countPromptWords(SYSTEM_PROMPT) < 600, `${countPromptWords(SYSTEM_PROMPT)} words`);
  const named = [...SYSTEM_PROMPT.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map((match) => match[1]);
  for (const name of named) assert.ok(TOOLS.some((tool) => tool.name === name), `${name} is a tool`);
});

test("who she is goes in the first message, not the system prompt", () => {
  const text = contextText({
    avatarName: "Maya",
    profile: { niche: "slow mornings", audience: "tired mums", offer: "a guide", keyword: "SLOW", voice: "warm", proofPoints: ["Sold 40 guides"] },
    brief: null,
    memory: ["She has two kids."],
    today: "2026-10-06",
    budgetLeft: 0,
  });
  assert.match(text, /Niche: slow mornings/);
  assert.match(text, /- Sold 40 guides/);
  assert.match(text, /- She has two kids\./);
  assert.match(text, /no budget/);
  assert.ok(!SYSTEM_PROMPT.includes("slow mornings"));
});
