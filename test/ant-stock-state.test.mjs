import test from "node:test";
import assert from "node:assert/strict";
import { applyVerifiedStock } from "../src/ant-stock-state.mjs";

const checkedAt = "2026-10-08T22:15:00.000Z";
const make = (sku, available) => ({
  market: "US", sku, name: "Neo Garden 23 bag", color: "Black",
  price: "$4,475", url: `https://www.hermes.com/us/en/product/neo-garden-23-bag-${sku}/`,
  available,
});

test("423 on an old SKU cannot suppress a new confirmed stock alert", () => {
  const previousAvailable = {
    H086422CK37: {
      ...make("H086422CK37", true),
      firstSeenAt: "2026-10-08T13:40:17.000Z",
    },
  };
  const nextAvailable = { ...previousAvailable };
  // A 423 on H086422CK37 deliberately does NOT call applyVerifiedStock.
  const alert = applyVerifiedStock({
    previousAvailable, nextAvailable,
    verified: make("H086422CK99", true), checkedAt,
  });
  assert.equal(alert.sku, "H086422CK99");
  assert.ok(nextAvailable.H086422CK37, "unknown stock state must be preserved");
  assert.equal(nextAvailable.H086422CK99.firstSeenAt, checkedAt);
});

test("known available SKU does not send a duplicate alert", () => {
  const previousAvailable = {
    H086422CK37: { ...make("H086422CK37", true), firstSeenAt: "2026-10-08T13:40:17.000Z" },
  };
  const nextAvailable = { ...previousAvailable };
  const alert = applyVerifiedStock({
    previousAvailable, nextAvailable,
    verified: make("H086422CK37", true), checkedAt,
  });
  assert.equal(alert, null);
  assert.equal(nextAvailable.H086422CK37.firstSeenAt, "2026-10-08T13:40:17.000Z");
  assert.equal(nextAvailable.H086422CK37.lastSeenAt, checkedAt);
});

test("only a successfully verified sold-out product clears its own state", () => {
  const previousAvailable = {
    H086422CK37: make("H086422CK37", true),
    H056289CC3Y: make("H056289CC3Y", true),
  };
  const nextAvailable = { ...previousAvailable };
  const alert = applyVerifiedStock({
    previousAvailable, nextAvailable,
    verified: make("H056289CC3Y", false), checkedAt,
  });
  assert.equal(alert, null);
  assert.ok(nextAvailable.H086422CK37);
  assert.equal(nextAvailable.H056289CC3Y, undefined);
});
