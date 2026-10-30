import assert from "node:assert/strict";
import { test } from "node:test";

import {
  InvalidRequestError,
  UserFacingError,
  isUserFacing,
  opaqueMessage,
  referenceId,
  scrub,
  userMessage,
} from "./errors";

/** An error class defined elsewhere, recognised by name rather than identity. */
class NotEnoughCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotEnoughCreditsError";
  }
}

/** The same trick used against us: a name we do not know. */
class DriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriverError";
  }
}

function captureConsole<T>(body: () => T): { value: T; logged: string[] } {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    return { value: body(), logged };
  } finally {
    console.error = original;
  }
}

test("a message written for a person passes through untouched", () => {
  const { value, logged } = captureConsole(() =>
    userMessage("writeDraftsAction", new InvalidRequestError("Pick a clip from the library.")),
  );
  assert.equal(value, "Pick a clip from the library.");
  assert.deepEqual(logged, [], "nothing to log: this was deliberate");
});

test("classes from other modules are recognised by name", () => {
  assert.equal(isUserFacing(new NotEnoughCreditsError("This costs 45 credits and you have 10.")), true);
  assert.equal(isUserFacing(new UserFacingError("x")), true);
  assert.equal(isUserFacing(new DriverError("relation \"jobs\" does not exist")), false);
  assert.equal(isUserFacing("a string"), false);
  assert.equal(isUserFacing(null), false);
});

test("anything else becomes a reference, and the detail stays in the log", () => {
  const { value, logged } = captureConsole(() =>
    userMessage("assembleAction", new DriverError('relation "jobs" does not exist')),
  );
  const reference = /ref ([A-Z2-9]{6})\)/.exec(value);
  assert.ok(reference, `expected a reference in ${JSON.stringify(value)}`);
  assert.equal(value, opaqueMessage(reference[1]));
  assert.doesNotMatch(value, /relation/, "the internal wording never reaches the user");
  assert.equal(logged.length, 1);
  assert.match(logged[0], new RegExp(`^\\[${reference[1]}\\] assembleAction: DriverError: relation`));
});

test("a reference is readable aloud and unique enough to find", () => {
  const ids = new Set(Array.from({ length: 500 }, () => referenceId()));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
});

test("nothing that could be a credential is logged", () => {
  assert.doesNotMatch(scrub("Stripe said sk_live_51Abcdefghijklmnop is invalid"), /sk_live_51Abcdefg/);
  assert.doesNotMatch(scrub("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc"), /eyJhbGciOiJ/);
  assert.doesNotMatch(scrub("x-goog-api-key: AIzaSyC0ffeeBeefBadF00dBadF00dBadF00d"), /AIzaSyC0ffee/);
  assert.doesNotMatch(scrub(`inlineData ${"QUJDREVG".repeat(40)}`), /QUJDREVGQUJDREVG/);
  assert.match(scrub("api_key=0123456789abcdef"), /\[redacted\]/);
});

test("a log line is bounded, so a megabyte of base64 cannot be logged by accident", () => {
  assert.ok(scrub("A".repeat(50_000)).length <= 601);
});

test("a provider that cannot serve us is shown as written, by name", () => {
  class ProviderUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ProviderUnavailableError";
    }
  }
  const { value, logged } = captureConsole(() => userMessage("askAgentAction", new ProviderUnavailableError("Our AI service is not answering right now.")));
  assert.equal(value, "Our AI service is not answering right now.");
  assert.deepEqual(logged, []);
});
