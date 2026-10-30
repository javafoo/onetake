import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_AVATARS } from "@/billing/entitlements";

import { avatarAllowance, canAddAvatar } from "./avatar-allowance";

test("every account may have the same number of avatars, never fewer than one", () => {
  assert.equal(avatarAllowance({ id: "user_1" }), MAX_AVATARS);
  assert.ok(MAX_AVATARS >= 1);
});

test("a new avatar fits only while the count is under the allowance", () => {
  assert.equal(canAddAvatar(0, 1), true);
  assert.equal(canAddAvatar(1, 1), false);
  assert.equal(canAddAvatar(MAX_AVATARS - 1, MAX_AVATARS), true);
  assert.equal(canAddAvatar(MAX_AVATARS, MAX_AVATARS), false);
});
