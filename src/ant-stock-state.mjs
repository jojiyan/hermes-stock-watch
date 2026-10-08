/**
 * Apply only a product whose own Hermès product page was successfully verified.
 * Never infer a sell-out from disappearance on a listing page or a failed request.
 */
export function applyVerifiedStock({previousAvailable, nextAvailable, verified, checkedAt}) {
  const sku = verified.sku;
  if (!sku) throw new Error("verified stock requires SKU");
  if (!verified.available) {
    delete nextAvailable[sku];
    return null;
  }
  nextAvailable[sku] = {
    market: verified.market,
    sku,
    name: verified.name,
    color: verified.color || "",
    price: verified.price || "",
    url: verified.url,
    firstSeenAt: previousAvailable[sku]?.firstSeenAt || checkedAt,
    lastSeenAt: checkedAt,
  };
  return previousAvailable[sku] ? null : verified;
}
