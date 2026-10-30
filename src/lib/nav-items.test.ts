import assert from "node:assert/strict";
import { test } from "node:test";

import { bottomBarItems, navItems } from "./nav-items";

const none = () => false;

test("the phone's bottom bar is exactly Home, Week, Create, Library, Brand", () => {
  assert.deepEqual(
    bottomBarItems(navItems(none, false)).map((item) => item.short),
    ["Home", "Week", "Create", "Library", "Brand"],
  );
});

test("the rail lists the daily pages, then the ones set up once", () => {
  const items = navItems(none, false);
  assert.deepEqual(
    items.map((item) => item.label),
    ["Overview", "Your week", "Create", "Hooks", "Library", "Brand", "Avatar"],
  );
  assert.deepEqual([...new Set(items.map((item) => item.group))], ["daily", "setup"]);
});

test("Reels, Carousels, the old Agent page, Calendar and Brief are not in the menu", () => {
  const hrefs = navItems(none, false).map((item) => item.href);
  for (const gone of ["/reels", "/carousels", "/agent", "/calendar", "/brief"]) assert.ok(!hrefs.includes(gone), gone);
});

test("setup steps carry a dot until setup is finished, and no number", () => {
  const during = navItems((href) => href === "/brand", false);
  assert.equal(during.find((item) => item.href === "/brand")?.done, true);
  assert.equal(during.find((item) => item.href === "/avatar")?.done, false);
  assert.equal(during.find((item) => item.href === "/hooks")?.done, undefined);
  assert.ok(during.every((item) => !("step" in item)));
  assert.ok(navItems(() => true, true).every((item) => item.done === undefined));
});
