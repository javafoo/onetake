import assert from "node:assert/strict";
import { test } from "node:test";

import { carriedFavorite, deleteQuestion, favoriteLabel, favoriteSections, favoritesOnly, favoriteTotal, isFavorite } from "./tile-actions";

test("only a literal true is a favorite", () => {
  assert.equal(isFavorite({ favorite: true }), true);
  assert.equal(isFavorite({ favorite: false }), false);
  assert.equal(isFavorite({ favorite: "true" }), false);
  assert.equal(isFavorite({ favorite: 1 }), false);
  assert.equal(isFavorite({}), false);
  assert.equal(isFavorite(null), false);
  assert.equal(isFavorite(undefined), false);
  assert.equal(isFavorite("favorite"), false);
});

test("a rebuilt row keeps the favorite of the row it replaces, and adds nothing otherwise", () => {
  assert.deepEqual(carriedFavorite({ favorite: true, draftId: "x" }), { favorite: true });
  assert.deepEqual(carriedFavorite({ favorite: false }), {});
  assert.deepEqual(carriedFavorite(null), {});
});

test("the favorite button says what pressing it does", () => {
  assert.equal(favoriteLabel(false), "Add to favorites");
  assert.equal(favoriteLabel(true), "Remove from favorites");
});

test("every delete question says what goes", () => {
  assert.equal(deleteQuestion("photo").question, "Delete this photo?");
  assert.match(deleteQuestion("clip").note, /Reels made from it are kept/);
  assert.match(deleteQuestion("reel").note, /hook goes back to Hooks/);
  assert.match(deleteQuestion("set").note, /slides go with it/);
});

test("the favorites filter keeps only favorites, and everything when off", () => {
  const items = [{ id: "a", favorite: true }, { id: "b", favorite: false }, { id: "c" }];
  assert.deepEqual(favoritesOnly(items, true).map((item) => item.id), ["a"]);
  assert.deepEqual(favoritesOnly(items, false).map((item) => item.id), ["a", "b", "c"]);
});

test("the Favorites tab draws only the kinds with something hearted, in library order", () => {
  const counts = { photos: 2, clips: 0, reels: 1, sets: 3 };
  assert.deepEqual(favoriteSections(counts), [
    { id: "photos", label: "Photos", count: 2 },
    { id: "reels", label: "Reels", count: 1 },
    { id: "sets", label: "Carousels", count: 3 },
  ]);
  assert.equal(favoriteTotal(counts), 6);
  assert.deepEqual(favoriteSections({ photos: 0, clips: 0, reels: 0, sets: 0 }), []);
  assert.equal(favoriteTotal({ photos: 0, clips: 0, reels: 0, sets: 0 }), 0);
});
