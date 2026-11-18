import test from "node:test";
import assert from "node:assert/strict";
import { followerRange, withinFollowerRange } from "../lib/follower-range.ts";

test("follower range includes boundaries and excludes missing counts", () => {
  const range = followerRange("100", "500");
  for (const count of [100, 250, 500]) assert.equal(withinFollowerRange(count, range), true);
  for (const count of [99, 501, null, undefined, NaN, "200"]) assert.equal(withinFollowerRange(count, range), false);
  assert.equal(withinFollowerRange(0, followerRange("0", "0")), true);
  assert.equal(withinFollowerRange(10000, followerRange("100", "")), true);
  assert.equal(withinFollowerRange(0, followerRange("", "500")), true);
  assert.equal(followerRange("", "").active, false);
});
test("invalid ranges cannot start lookups", () => {
  for (const pair of [["501", "500"], ["-1", ""], ["", "2.5"], ["abc", ""], ["", "Infinity"]]) {
    assert.throws(() => followerRange(...pair));
  }
});
