import test from "node:test";
import assert from "node:assert/strict";
import {
  afterProductFailure,
  isAntibotError,
  planProductChecks,
  seedBackoffFromPreviousErrors,
} from "../src/ant-retry.mjs";

const base = "2026-10-08T23:30:00.000Z";
const p = (sku, market = "US") => ({
  sku, market, name: "Neo Garden 23 bag",
  url: `https://www.hermes.com/${market.toLowerCase()}/en/product/neo-garden-23-bag-${sku}/`,
});

test("ScrapingAnt 423 is recognized but a generic failure does not trigger backoff", () => {
  assert.equal(isAntibotError("HTTP 423: Our browser was detected by target site"), true);
  assert.equal(isAntibotError("HTTP 500"), false);
  assert.equal(afterProductFailure(null, new Error("HTTP 500"), base), null);
});

test("repeated 423 delays grow to a 60-minute maximum", () => {
  let r = null;
  const dates = [];
  for (let n = 0; n < 6; n++) {
    r = afterProductFailure(r, new Error("HTTP 423"), base);
    dates.push((Date.parse(r.retryAfter) - Date.parse(base)) / 60_000);
  }
  assert.deepEqual(dates, [10, 20, 40, 60, 60, 60]);
});

test("historically blocked SKUs are initially cooled down, but unrelated newly listed SKU is not", () => {
  const retry = seedBackoffFromPreviousErrors({
    lastCheckedAt: base,
    verificationErrors: [
      { sku: "H086422CK37", error: "HTTP 423: browser was detected" },
    ],
  });
  const available = { H086422CK37: p("H086422CK37") };
  const incoming = [p("H086422CK99"), p("H086422CK37")];
  const plan = planProductChecks(incoming, available, retry, base, "US");
  assert.deepEqual(plan.ready.map(x => x.sku), ["H086422CK99"]);
  assert.deepEqual(plan.deferred.map(x => x.sku), ["H086422CK37"]);
  assert.equal(plan.deferred[0].retryAfter, "2026-10-09T00:10:00.000Z");
});

test("retrying after cooldown keeps fresh catalog order and checks previously sold-in products", () => {
  const retry = { H086422CK37: { retryAfter: "2026-10-08T23:31:00.000Z" } };
  const plan = planProductChecks(
    [p("H086422CK99"), p("H056289CKY1")],
    { H086422CK37: p("H086422CK37") },
    retry, "2026-10-08T23:32:00.000Z", "US",
  );
  assert.deepEqual(plan.ready.map(x=>x.sku), ["H086422CK99","H056289CKY1","H086422CK37"]);
  assert.equal(plan.deferred.length, 0);
});

test("catalog SKUs from US never slip into the CA monitor", () => {
  const plan = planProductChecks([p("H086422CK37","US"),p("H085956CCY1","CA")],{
    H056289CC3Y:p("H056289CC3Y","US")
  },{},base,"CA");
  assert.deepEqual(plan.ready.map(x=>x.sku), ["H085956CCY1"]);
});
