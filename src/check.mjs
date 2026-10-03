import {
  MARKETS,
  fetchCategory,
  fetchProductPage,
  parseCategoryDocument,
  parseProductPageDocument,
} from "./hermes.mjs";

export async function checkMarkets(inputState, {
  checkedAt = new Date(), fetchCategory: categoryFetcher = fetchCategory,
  fetchProductPage: productFetcher = fetchProductPage,
} = {}) {
  const state = structuredClone(inputState);
  state.products ||= {};
  state.meta ||= {};
  const now = checkedAt;
  const nowIso = now.toISOString();
  const successfulMarkets = new Set();
  const alerts = [];
  const summaries = [];
  const initializedMarkets = new Set(state.meta.initializedMarkets || []);

  for (const market of MARKETS) {
    try {
      const html = await categoryFetcher(market);
      const products = parseCategoryDocument(html, market);
      const candidates = products.filter((product) => product.target);
      const targets = [];
      const evidence = [];
      const verificationErrors = [];
      const marketIsInitializing = !initializedMarkets.has(market.code);
      const marketUpdates = new Map();
      const marketAlerts = [];

      for (const candidate of candidates) {

        let product;
        try {
          const productDocument = await productFetcher(candidate);
          product = parseProductPageDocument(productDocument, candidate);
          targets.push(product);
          evidence.push({ sku: candidate.sku, url: candidate.url,
            sourceURL: productDocument.metadata?.sourceURL || productDocument.metadata?.url || null,
            available: product.available, purchaseAction: product.purchaseAction,
            purchaseButtonDisabled: product.purchaseButtonDisabled ?? null });
        } catch (error) {
          verificationErrors.push({ sku: candidate.sku, url: candidate.url, error: error.message });
          continue;
        }

        const nextStatus = product.available ? "in_stock" : "out_of_stock";
        const previous = state.products[product.key];

        if (
          !marketIsInitializing &&
          product.available &&
          previous?.status !== "in_stock"
        ) {
          marketAlerts.push(product);
        }

        if (
          !previous ||
          previous.status !== nextStatus ||
          previous.name !== product.name ||
          previous.color !== product.color ||
          previous.material !== product.material ||
          previous.price !== product.price ||
          previous.url !== product.url
        ) {
          marketUpdates.set(product.key, {
            market: product.market,
            sku: product.sku,
            name: product.name,
            color: product.color,
            material: product.material,
            price: product.price,
            url: product.url,
            status: nextStatus,
            changedAt: nowIso,
          });
        }
      }

      if (verificationErrors.length === 0) {
        successfulMarkets.add(market.code);
        initializedMarkets.add(market.code);

        for (const [key, value] of marketUpdates) state.products[key] = value;
        alerts.push(...marketAlerts);
      }

      summaries.push({
        market: market.code,
        products: products.length,
        candidates: candidates.length,
        verifiedTargets: targets.length,
        availableTargets: targets.filter((product) => product.available).length,
        verificationErrors,
        evidence,
        committed: verificationErrors.length === 0,
      });
    } catch (error) {
      summaries.push({ market: market.code, error: error.message, committed: false });
    }
  }

  // Missing links alone do not prove delisting: preserve unseen product states.

  const keepAliveAt = state.meta.keepAliveAt
    ? new Date(state.meta.keepAliveAt).getTime()
    : 0;
  if (!keepAliveAt || now.getTime() - keepAliveAt >= 30 * 24 * 60 * 60 * 1000) {
    state.meta.keepAliveAt = nowIso;
  }
  state.meta.lastSuccessfulMarkets = [...successfulMarkets];
  state.meta.initializedMarkets = [...initializedMarkets];

  state.meta.lastCheckedAt = nowIso;
  state.meta.markets ||= {};
  for (const summary of summaries) {
    const previous = state.meta.markets[summary.market] || {};
    state.meta.markets[summary.market] = {
      lastCheckedAt: nowIso,
      lastSuccessAt: summary.committed ? nowIso : previous.lastSuccessAt || null,
      status: summary.committed ? "ok" : "unknown",
      ...summary,
    };
  }
  return { state, checkedAt: nowIso, summaries, alerts,
    healthy: successfulMarkets.size === MARKETS.length };
}
