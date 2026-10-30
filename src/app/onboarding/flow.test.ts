import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alreadySetUp,
  canVisit,
  gateDecision,
  progressFor,
  resumePath,
  resumeStage,
  STAGES,
  stageFromPath,
  stagePath,
  type FlowState,
} from "./flow";

const flow = (patch: Partial<FlowState> = {}): FlowState => ({
  hasSession: true,
  uploads: 8,
  references: 5,
  nextStep: null,
  ...patch,
});

test("setup reopens at the first thing that is missing", () => {
  assert.equal(resumeStage(flow({ hasSession: false })), "welcome");
  assert.equal(resumeStage(flow({ uploads: 0 })), "photos");
  assert.equal(resumeStage(flow({ uploads: 4 })), "photos", "four photos is not enough to curate");
  assert.equal(resumeStage(flow({ references: 0 })), "roles");
  assert.equal(resumeStage(flow({ nextStep: "offer" })), "offer");
  assert.equal(resumeStage(flow()), "review");
  // The review screen's only lasting effect is the saved brand profile, and
  // that is what moves her on to the free photo, which is the last screen.
  assert.equal(resumeStage(flow({ reviewed: true })), "first-photo");
});

test("the free photo is the last screen, and an unanswered step still wins over it", () => {
  /* A brand profile can exist from before setup was reopened to change an
     answer, so an unanswered step has to beat `reviewed`: otherwise reopening
     setup would skip the question she came back to answer. */
  assert.equal(resumeStage(flow({ reviewed: true, nextStep: "proof" })), "proof");
  assert.equal(resumeStage(flow({ reviewed: true, references: 0 })), "roles");
  assert.equal(resumeStage(flow({ reviewed: true, uploads: 1 })), "photos");
});

test("the free photo screen cannot be reached before the review screen is submitted", () => {
  assert.equal(canVisit("first-photo", flow()), false, "brief not saved yet");
  assert.equal(canVisit("first-photo", flow({ reviewed: true })), true);
  // And going back from it is always allowed, like every other screen.
  assert.equal(canVisit("review", flow({ reviewed: true })), true);
});

test("a missing session wins over everything else", () => {
  // Photos cannot exist without a session, but a half-deleted account might say so.
  assert.equal(resumeStage(flow({ hasSession: false, uploads: 9, references: 5 })), "welcome");
});

test("every stage has its own url", () => {
  const paths = STAGES.map(stagePath);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(stagePath("roles"), "/onboarding/photos/roles");
  assert.equal(stagePath("voice"), "/onboarding/interview/voice");
  assert.equal(resumePath(flow({ nextStep: "audience" })), "/onboarding/interview/audience");
});

test("a url reads back as the screen it is", () => {
  for (const stage of STAGES) assert.equal(stageFromPath(stagePath(stage)), stage);
  assert.equal(stageFromPath("/onboarding/interview/voice/"), "voice");
  assert.equal(stageFromPath("/onboarding"), null);
  assert.equal(stageFromPath("/onboarding/paused"), null);
  assert.equal(stageFromPath("/create"), null);
});

test("going back is allowed, skipping ahead is not", () => {
  const half = flow({ nextStep: "problem" });
  assert.equal(canVisit("welcome", half), true);
  assert.equal(canVisit("photos", half), true);
  assert.equal(canVisit("audience", half), true);
  assert.equal(canVisit("problem", half), true);
  assert.equal(canVisit("offer", half), false);
  assert.equal(canVisit("review", half), false);
});

test("progress counts every screen, and the bar only moves forward", () => {
  let last = 0;
  for (const stage of STAGES) {
    const progress = progressFor(stage);
    assert.ok(progress.ratio > last, `${stage} should be further along`);
    assert.equal(progress.total, STAGES.length);
    last = progress.ratio;
  }
  // The free photo is the last screen, so it is the one that reads as finished.
  assert.equal(progressFor("first-photo").ratio, 1);
  assert.ok(progressFor("review").ratio < 1);
  assert.equal(progressFor("first-photo").label, "Her first photo");
  assert.equal(progressFor("welcome").label, "Name her");
  assert.equal(progressFor("audience", "Who you talk to").label, "Who you talk to");
});

test("an account that predates setup counts as having done it", () => {
  assert.equal(alreadySetUp({ hasLock: true, references: 5, brandComplete: true }), true);
  // One piece missing is a half-built account, which does belong in setup.
  assert.equal(alreadySetUp({ hasLock: false, references: 5, brandComplete: true }), false);
  assert.equal(alreadySetUp({ hasLock: true, references: 0, brandComplete: true }), false);
  assert.equal(alreadySetUp({ hasLock: true, references: 5, brandComplete: false }), false);
  assert.equal(alreadySetUp({ hasLock: false, references: 0, brandComplete: false }), false);
});

test("finishing the review screen leaves an account looking exactly like a legacy one", () => {
  /* The trap this records: submitting the review screen saves the brand
     profile, and from that instant an account has a lock, references and a
     complete profile — which is the whole definition of an account that
     predates setup. `backfillOnboarded` would then mark it onboarded and the
     gate would bounce it off the free-photo screen it was on its way to, so
     nobody would ever see the last step.

     `alreadySetUp` is pure and cannot see the difference, and should not try
     to: the guard belongs in `backfillOnboarded`, which refuses to rescue an
     account whose onboarding session is still open. This assertion is here so
     that whoever changes that guard knows what it is holding up. */
  assert.equal(alreadySetUp({ hasLock: true, references: 5, brandComplete: true }), true);
  // And the flow still puts such an account on the last screen, not past it.
  assert.equal(resumeStage(flow({ reviewed: true })), "first-photo");
});

test("the gate sends a half-set-up account into setup", () => {
  const half = { signedIn: true, onboarded: false };
  assert.equal(gateDecision({ ...half, pathname: "/" }), "/onboarding");
  assert.equal(gateDecision({ ...half, pathname: "/create" }), "/onboarding");
  assert.equal(gateDecision({ ...half, pathname: "/brand" }), "/onboarding");
});

test("the gate lets setup, the account page, the api and the auth screens through", () => {
  const half = { signedIn: true, onboarded: false };
  for (const pathname of [
    "/onboarding",
    "/onboarding/photos/roles",
    "/account",
    "/api/jobs/1",
    "/sign-in",
    "/sign-up/continue",
  ]) {
    assert.equal(gateDecision({ ...half, pathname }), null, pathname);
  }
});

test("a finished account is sent out of setup, unless it is adding another avatar", () => {
  const done = { signedIn: true, onboarded: true };
  assert.equal(gateDecision({ ...done, pathname: "/onboarding/photos" }), "/");
  assert.equal(gateDecision({ ...done, pathname: "/onboarding/photos", setupInProgress: true }), null);
  // Adding an avatar never locks the rest of the app.
  assert.equal(gateDecision({ ...done, pathname: "/create", setupInProgress: true }), null);
  assert.equal(gateDecision({ ...done, pathname: "/create" }), null);
});

test("a prefix match cannot be faked by a similar name", () => {
  const half = { signedIn: true, onboarded: false };
  assert.equal(gateDecision({ ...half, pathname: "/account-history" }), "/onboarding");
  assert.equal(gateDecision({ ...half, pathname: "/onboardingx" }), "/onboarding");
});

test("a finished account is never sent back into setup, and never trapped in it", () => {
  const done = { signedIn: true, onboarded: true };
  assert.equal(gateDecision({ ...done, pathname: "/" }), null);
  assert.equal(gateDecision({ ...done, pathname: "/create" }), null);
  assert.equal(gateDecision({ ...done, pathname: "/onboarding" }), "/");
  assert.equal(gateDecision({ ...done, pathname: "/onboarding/review" }), "/");
});

test("the gate cannot send a page to itself", () => {
  // Following the decision from its own destination must stop, or it is a loop.
  for (const onboarded of [true, false]) {
    let pathname = "/create";
    for (let hop = 0; hop < 5; hop++) {
      const next = gateDecision({ pathname, signedIn: true, onboarded });
      if (next === null) break;
      assert.notEqual(next, pathname, "a redirect to the same path is a loop");
      pathname = next;
      assert.equal(gateDecision({ pathname, signedIn: true, onboarded }), null, `${pathname} redirects again`);
    }
  }
});

test("nothing is decided for a signed-out visitor", () => {
  assert.equal(gateDecision({ pathname: "/", signedIn: false, onboarded: false }), null);
  assert.equal(gateDecision({ pathname: "", signedIn: false, onboarded: false }), null);
});

test("a missing pathname fails safe: the gate still applies", () => {
  /* The header did not arrive, which means the proxy never saw the request.
     Letting that through would make the gate optional for anything the
     matcher misses. */
  for (const pathname of ["", "create", "carousels/x.png"]) {
    assert.equal(
      gateDecision({ pathname, signedIn: true, onboarded: false }),
      "/onboarding",
      `unknown path ${JSON.stringify(pathname)} is gated`,
    );
    // A finished account is not dragged anywhere by a missing header.
    assert.equal(gateDecision({ pathname, signedIn: true, onboarded: true }), null);
  }
});

test("following a missing-header redirect settles immediately", () => {
  const next = gateDecision({ pathname: "", signedIn: true, onboarded: false });
  assert.equal(next, "/onboarding");
  assert.equal(gateDecision({ pathname: next!, signedIn: true, onboarded: false }), null);
});
