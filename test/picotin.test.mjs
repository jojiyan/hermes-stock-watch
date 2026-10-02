import test from "node:test";
import assert from "node:assert/strict";
import { isTargetProduct } from "../src/hermes.mjs";

// Regression coverage for the Hermès "菜篮子" family.
test("Picotin / Picotin Lock variants are target bags", () => {
  for (const name of [
    "Picotin Lock 18 bag",
    "Picotin Lock 22 bag",
    "Picotin Lock 26 bag",
    "Picotin bag",
  ]) {
    assert.equal(isTargetProduct(name), true, name);
  }
});
