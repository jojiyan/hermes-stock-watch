// Per-SKU retry policy. A blocked old SKU must never delay the first
// verification attempt for a newly discovered SKU.
const MAX_DELAY_MINUTES = 60;
const BASE_DELAY_MINUTES = 10;

export function isAntibotError(error) {
  return /\\bHTTP 423\\b|browser was detected by target site|antibot|anti-bot/i.test(String(error?.message || error || ""));
}

export function afterProductFailure(previousRetry, error, nowIso) {
  if (!isAntibotError(error)) return null; // Retry non-423 errors next scheduled run.
  const attempts = Math.min(20, Math.max(0, Number(previousRetry?.attempts) || 0) + 1);
  const delayMinutes = Math.min(MAX_DELAY_MINUTES, BASE_DELAY_MINUTES * Math.pow(2, attempts - 1));
  return {
    attempts,
    lastFailureAt: nowIso,
    retryAfter: new Date(Date.parse(nowIso) + delayMinutes * 60_000).toISOString(),
    reason: "HTTP 423 (Hermès anti-bot)",
  };
}

export function seedBackoffFromPreviousErrors(previousMarket) {
  if (previousMarket?.retryState && typeof previousMarket.retryState === "object") {
    return { ...previousMarket.retryState };
  }
  // Older builds retried these two blocked SKUs in every run for hours.
  // Give them an initial cooldown, without delaying NEW SKU discovery.
  const nowIso = previousMarket?.lastCheckedAt;
  if (!Number.isFinite(Date.parse(nowIso || ""))) return {};
  const retry = {};
  for (const e of previousMarket?.verificationErrors || []) {
    if (!e.sku || !isAntibotError(e.error)) continue;
    const attempts = 3;
    retry[e.sku] = {
      attempts,
      lastFailureAt: nowIso,
      retryAfter: new Date(Date.parse(nowIso) + 40 * 60_000).toISOString(),
      reason: "HTTP 423 (Hermès anti-bot)",
    };
  }
  return retry;
}

export function planProductChecks(targets, previousAvailable, retryState, nowIso, marketCode) {
  const bySku = new Map();
  // Category-discovered targets come first. Old known-available products
  // absent from the current catalog get an independent lower-priority retry.
  for (const p of targets) {
    if (!p?.sku || p.market !== marketCode || !p.url) continue;
    bySku.set(p.sku, p);
  }
  for (const p of Object.values(previousAvailable || {})) {
    if (!p?.sku || p.market !== marketCode || !p.url || bySku.has(p.sku)) continue;
    bySku.set(p.sku, { ...p, marketName: marketCode === "US" ? "Hermès USA" : "Hermès Canada" });
  }

  const ready = [];
  const deferred = [];
  for (const p of bySku.values()) {
    const retryAfter = retryState?.[p.sku]?.retryAfter;
    if (retryAfter && Number.isFinite(Date.parse(retryAfter)) && Date.parse(retryAfter) > Date.parse(nowIso)) {
      deferred.push({ sku: p.sku, retryAfter, reason: "Previous HTTP 423; stock unverified" });
    } else {
      ready.push(p);
    }
  }
  return { ready, deferred, total: bySku.size };
}
