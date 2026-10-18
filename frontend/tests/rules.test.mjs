import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/lib/rules.js";

const good = { title: "Used bicycle", description: "ok", city: "Lagos", imageUri: "", condition: "used", category: "vehicles", priceWei: 1000n };

test("valid listing has no errors", () => {
  assert.deepEqual(R.validateListing(good), []);
});

test("listing errors are reported per field", () => {
  const errs = R.validateListing({ ...good, title: "ab", condition: "broken", imageUri: "http://x", priceWei: -1n, category: "" });
  assert.equal(errs.length, 5);
});

test("amount must be positive and bounded", () => {
  assert.ok(R.validateAmount(0n));
  assert.equal(R.validateAmount(1n), null);
  assert.ok(R.validateAmount(R.MAX_PRICE_WEI + 1n));
});

test("review stars are 1 to 5", () => {
  assert.ok(R.validateReview(0, ""));
  assert.ok(R.validateReview(6, ""));
  assert.equal(R.validateReview(5, "great"), null);
});

test("contract error tags are stripped and classified", () => {
  assert.deepEqual(R.parseContractError(new Error("[EXPECTED] Only the buyer can confirm")), { kind: "contract", message: "Only the buyer can confirm" });
  assert.equal(R.parseContractError(new Error("[LLM_ERROR] try again")).kind, "llm");
  assert.equal(R.parseContractError(new Error("[TRANSIENT] wait")).kind, "transient");
});

test("address validation", () => {
  assert.equal(R.isValidAddress("0x" + "a".repeat(40)), true);
  assert.equal(R.isValidAddress("0x123"), false);
});
