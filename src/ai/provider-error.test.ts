import assert from "node:assert/strict";
import { test } from "node:test";

import { PROVIDER_UNAVAILABLE_MESSAGE, ProviderUnavailableError, providerFailure, setOutageSink } from "./provider-error";

function quietly<T>(body: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return body();
  } finally {
    console.error = original;
  }
}

test("a 402 is an outage the person can read, and the provider's words stay out of the message", () => {
  const error = quietly(() => providerFailure("Gemini", "gemini-3.8-flash", 402, "Your prepayment credits are depleted. Go to https://ai.studio"));
  assert.ok(error instanceof ProviderUnavailableError);
  assert.equal(error.message, PROVIDER_UNAVAILABLE_MESSAGE);
  assert.equal(error.billing, true);
  assert.match(error.detail, /prepayment/);
  assert.doesNotMatch(error.message, /prepayment|Gemini|ai\.studio/);
});

test("429 and 5xx are outages too, but not money", () => {
  for (const status of [429, 500, 503]) {
    const error = quietly(() => providerFailure("Omni", "gemini-omni-1.1-flash", status, "busy"));
    assert.ok(error instanceof ProviderUnavailableError, `${status}`);
    assert.equal(error.billing, false);
  }
});

test("a 400 keeps the developer's message", () => {
  const error = providerFailure("OpenAI", "gpt-image", 400, "Invalid prompt");
  assert.ok(!(error instanceof ProviderUnavailableError));
  assert.equal(error.message, "OpenAI gpt-image 400: Invalid prompt");
});

test("the sink hears about money and nothing else, and its own failure is swallowed", () => {
  const heard: number[] = [];
  setOutageSink((error) => {
    heard.push(error.status);
    throw new Error("the database is down");
  });
  try {
    quietly(() => providerFailure("Gemini", "m", 402, "credits"));
    quietly(() => providerFailure("Gemini", "m", 503, "down"));
    providerFailure("Gemini", "m", 404, "no such model");
  } finally {
    setOutageSink(null);
  }
  assert.deepEqual(heard, [402]);
});

test("a credential in the provider's words never reaches the detail", () => {
  const error = quietly(() => providerFailure("Gemini", "m", 503, "key AIzaSyA1234567890abcdefghij rejected"));
  assert.ok(error instanceof ProviderUnavailableError);
  assert.doesNotMatch(error.detail, /AIza/);
});
