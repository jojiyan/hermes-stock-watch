import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { applyVerifiedStock } from "./ant-stock-state.mjs";
import { afterProductFailure, planProductChecks, seedBackoffFromPreviousErrors } from "./ant-retry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const statePath = resolve(here, "../ant-state.json");
const reportPath = resolve(here, "../ant-run-report.json");
const apiKey = process.env.SCRAPINGANT_API_KEY || "";
const repository = process.env.GITHUB_REPOSITORY || "";
const token = process.env.GITHUB_TOKEN || "";
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER || "";

if (!apiKey) throw new Error("SCRAPINGANT_API_KEY is missing");
if (!repository || !token || !repositoryOwner) throw new Error("GitHub repository credentials are missing");

const TARGET_PATTERNS = [
  /\bneo garden 23\b/i,
  /\bneo garden (?:bredies|pockets) 23\b/i,
  /\b(?:mini garden(?: party)?|garden party (?:mini|23))\b/i,
  /\bgarden party 30\b/i,
  /\blindy(?: ii)? mini\b/i,
  /\bmini lindy\b/i,
  /\bpicotin\b/i,
  /\bbirkin\b/i,
  /\bkelly\b/i,
  /\bconstance\b/i,
];

const MARKETS = [
  {
    code: "US",
    name: "Hermès USA",
    country: "us",
    categoryUrl: "https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
  },
  {
    code: "CA",
    name: "Hermès Canada",
    country: "ca",
    categoryUrl: "https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
  },
];

const BLOCK_RE = /sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|robot challenge/i;
// "Discover" is normal navigation/editorial text, not an out-of-stock signal.
const PRODUCT_UNAVAILABLE_RE = /unfortunately this product is no longer available|we will notify you when this product is back in stock|\bavailable soon\b|\bcurrently unavailable\b|\bsold out\b|\bout of stock\b|\bno longer available\b/i;
const BUY_RE = /\bAdd to (?:cart|bag)\b/i;

const ANT_TARGET_HEADERS = {
  "x-api-key": apiKey,
  "ant-user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "ant-accept-language": "en-US,en;q=0.9",
  "ant-cache-control": "no-cache",
  "ant-pragma": "no-cache",
  "ant-upgrade-insecure-requests": "1",
};

const CHEAP_FETCH_MODES = [
  { browser: false, rawSource: false, proxyType: "datacenter", label: "direct-local-datacenter" },
  { browser: true, rawSource: false, proxyType: "datacenter", label: "browser-local-datacenter" },
];

const PRODUCT_FETCH_MODES = [...CHEAP_FETCH_MODES];

const state = JSON.parse(await readFile(statePath, "utf8").catch(() => '{"version":1,"markets":{}}'));
state.version = 1;
state.markets ||= {};

const nowIso = new Date().toISOString();
const alerts = [];
const summaries = [];
let healthyMarkets = 0;

for (const market of MARKETS) {
  const previousMarket = state.markets[market.code] || { available: {} };
  const previousAvailable = previousMarket.available || {};

  try {
    // The unfiltered category reliably resolves through ScrapingAnt; filtered
    // facet URLs are blocked by the retailer (423), so never make a market
    // depend on an inaccessible facet endpoint.
    const categoryDoc = await fetchAntMarkdown(market.categoryUrl, market, 5);
    const products = parseCategoryMarkdown(categoryDoc.markdown, market, 5);
    const targets = products.filter((product) => product.target);
    // Newly discovered category SKUs are evaluated first; previously known
    // stock is retried later, without monopolizing attempts or blocking alerts.
    const retryState = seedBackoffFromPreviousErrors(previousMarket);
    const scanPlan = planProductChecks(targets, previousAvailable, retryState, nowIso, market.code);
    // Preserve previously confirmed stock until its own product page proves a sell-out.
    const nextAvailable = { ...previousAvailable };
    const verificationErrors = [];
    const evidence = [];
    const marketAlerts = [];

    for (const product of scanPlan.ready) {
      try {
        const productDoc = await fetchAntProductMarkdown(product.url, market);
        const verified = parseProductMarkdown(productDoc.markdown, product);
        delete retryState[product.sku];
        evidence.push({
          sku: product.sku,
          url: product.url,
          available: verified.available,
          purchaseAction: verified.purchaseAction,
          purchaseButtonDisabled: verified.purchaseButtonDisabled,
          productCredits: productDoc.credits,
          productMode: productDoc.mode,
        });

        const newStock = applyVerifiedStock({
          previousAvailable,
          nextAvailable,
          verified,
          checkedAt: nowIso,
        });
        if (newStock) marketAlerts.push(newStock);
      } catch (error) {
        const retry = afterProductFailure(retryState[product.sku], error, nowIso);
        if (retry) retryState[product.sku] = retry;
        else delete retryState[product.sku];
        verificationErrors.push({ sku: product.sku, url: product.url, error: error.message });
      }
    }

    state.markets[market.code] = {
      status: verificationErrors.length === 0 && scanPlan.deferred.length === 0 ? "ok" : "partial",
      lastCheckedAt: nowIso,
      lastSuccessAt: verificationErrors.length === 0 && scanPlan.deferred.length === 0 ? nowIso : previousMarket.lastSuccessAt || null,
      products: products.length,
      targets: targets.length,
      categoryAvailable: scanPlan.total,
      available: nextAvailable,
      retryState,
      deferredProducts: scanPlan.deferred,
      verificationErrors,
    };

    // An unrelated SKU's 423 cannot suppress a newly VERIFIED stock alert.
    alerts.push(...marketAlerts);
    if (verificationErrors.length === 0 && scanPlan.deferred.length === 0) healthyMarkets += 1;

    summaries.push({
      market: market.code,
      products: products.length,
      targets: targets.length,
      categoryAvailable: scanPlan.total,
      attemptedProducts: scanPlan.ready.length,
      deferredProducts: scanPlan.deferred,
      confirmedNewAvailability: marketAlerts.length,
      verificationErrors,
      evidence,
      categoryCredits: categoryDoc.credits,
      committed: true,
      fullyVerified: verificationErrors.length === 0 && scanPlan.deferred.length === 0,
    });
  } catch (error) {
    state.markets[market.code] = {
      ...previousMarket,
      status: "unknown",
      lastCheckedAt: nowIso,
      error: error.message,
    };
    summaries.push({ market: market.code, error: error.message, committed: false });
  }
}

const report = { checkedAt: nowIso, healthy: healthyMarkets === MARKETS.length, summaries, alerts };
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));

for (const product of alerts) await createStockIssue(product);
await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

if (healthyMarkets !== MARKETS.length) {
  throw new Error("Incomplete ScrapingAnt market verification; successful market state was preserved.");
}

function isTargetProduct(name) {
  const normalized = normalize(name);
  return TARGET_PATTERNS.some((pattern) => pattern.test(normalized));
}

function parseCategoryMarkdown(markdown, market, minProducts = 5) {
  if (typeof markdown !== "string" || markdown.length < 1000) {
    throw new Error(`${market.code}: category markdown is unexpectedly short`);
  }
  if (BLOCK_RE.test(markdown)) throw new Error(`${market.code}: category returned an access-block page`);

  const links = [...markdown.matchAll(/\[([^\]\n]+)\]\(((?:https?:\/\/www\.hermes\.com)?\/(?:us|ca)\/en\/product\/[^)\s]+)(?:\s+"[^"]*")?\)/gi)];
  const products = [];

  for (let i = 0; i < links.length; i += 1) {
    const match = links[i];
    const name = normalize(match[1]);
    const url = new URL(match[2], "https://www.hermes.com").href;
    if (!url.includes(`/${market.code.toLowerCase()}/en/product/`)) continue;
    const sku = url.match(/-([A-Z0-9]{6,})\/?(?:\?|$)/i)?.[1]?.toUpperCase() || "";
    if (!name || !sku) continue;

    const end = links[i + 1]?.index ?? Math.min(markdown.length, match.index + 1200);
    const segment = markdown.slice(match.index, end);
    const color = normalize(segment.match(/\bColor\s*:\s*([^\n,]+(?:\s*\/\s*[^\n,]+)?)/i)?.[1]);
    const price = normalize(segment.match(/\bPrice\s+((?:CA|US)?\s*\$\s*[\d,]+(?:\.\d{2})?)/i)?.[1]);
    products.push({
      key: `${market.code}:${sku}`,
      market: market.code,
      marketName: market.name,
      sku,
      name,
      color,
      price,
      url,
      categoryAvailable: true,
      target: isTargetProduct(name),
    });
  }

  const unique = [...new Map(products.map((p) => [p.key, p])).values()];
  if (unique.length < minProducts) throw new Error(`${market.code}: parsed only ${unique.length} products from category (expected ${minProducts})`);
  return unique;
}

function parseProductMarkdown(markdown, candidate) {
  if (typeof markdown !== "string" || markdown.length < 1000) {
    throw new Error(`${candidate.market}: product markdown is unexpectedly short`);
  }
  if (BLOCK_RE.test(markdown)) throw new Error(`${candidate.market}: product returned an access-block page`);

  const pageSku = normalize(
    markdown.match(/Product reference\s*:?\s*([A-Z0-9]+)/i)?.[1] || ""
  ).toUpperCase();
  if (!pageSku) throw new Error(`${candidate.market}: product reference is missing`);
  if (pageSku !== candidate.sku.toUpperCase()) {
    throw new Error(`${candidate.market}: product SKU ${pageSku} did not match ${candidate.sku}`);
  }

  const start = markdown.indexOf("Product information and customization");
  const end = markdown.indexOf("Product description", start);
  if (start < 0 || end < start) {
    throw new Error(`${candidate.market}: missing complete product purchase section`);
  }
  const purchaseSection = markdown.slice(start, end);
  const hasBuy = BUY_RE.test(purchaseSection);
  const unavailable = PRODUCT_UNAVAILABLE_RE.test(purchaseSection);
  const available = hasBuy && !unavailable;

  if (!hasBuy && !unavailable) {
    throw new Error(`${candidate.market}: product purchase state is unknown`);
  }

  return {
    ...candidate,
    available,
    purchaseAction: available ? "Add to cart / Add to bag" : "",
    purchaseButtonDisabled: hasBuy && unavailable,
  };
}

async function fetchAntMarkdown(targetUrl, market, minLinks = 5) {
  const failures = [];

  for (const mode of CHEAP_FETCH_MODES) {
    const params = new URLSearchParams({
      url: targetUrl,
      browser: mode.browser ? "true" : "false",
      proxy_type: mode.proxyType,
      proxy_country: market.country,
      timeout: "60",
    });
    if (mode.rawSource) params.set("return_page_source", "true");
    if (mode.browser) { params.append("block_resource", "image"); params.append("block_resource", "media"); params.append("block_resource", "font"); }

    const response = await fetch(`https://api.scrapingant.com/v2/markdown?${params}`, {
      headers: { ...ANT_TARGET_HEADERS, accept: "application/json" },
    });
    const credits = Number(response.headers.get("ant-credits-cost") || 0) || null;

    if (!response.ok) {
      failures.push(`${mode.label} HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
      continue;
    }

    const data = await response.json();
    if (typeof data?.markdown !== "string" || data.markdown.length < 1000 || BLOCK_RE.test(data.markdown)) {
      failures.push(`${mode.label}: unusable markdown`);
      continue;
    }

    const productLinkCount = (data.markdown.match(/\/(?:us|ca)\/en\/product\//gi) || []).length;
    if (productLinkCount < minLinks) {
      failures.push(`${mode.label}: only ${productLinkCount} product links (expected ${minLinks})`);
      console.log(`[${market.code}] ${mode.label} returned only ${productLinkCount} product links; trying next mode; credits=${credits ?? "unknown"}`);
      continue;
    }

    console.log(`[${market.code}] category fetched via ${mode.label}; productLinks=${productLinkCount}; credits=${credits ?? "unknown"}`);
    return { markdown: data.markdown, url: data.url || targetUrl, credits, mode: mode.label };
  }

  throw new Error(`${market.code}: ScrapingAnt category failed in all local proxy modes: ${failures.join(" | ")}`);
}

async function fetchAntProductMarkdown(targetUrl, market) {
  const modes = [
    { browser: false, proxyType: "datacenter", label: "product-markdown-local-datacenter" },
    { browser: false, proxyType: "residential", label: "product-markdown-local-residential" },
    { browser: true, proxyType: "datacenter", label: "product-markdown-browser-datacenter" },
  ];
  const failures = [];

  for (const mode of modes) {
    const params = new URLSearchParams({
      url: targetUrl,
      browser: mode.browser ? "true" : "false",
      proxy_type: mode.proxyType,
      proxy_country: market.country,
      timeout: "60",
    });
    if (mode.browser) {
      params.append("block_resource", "image");
      params.append("block_resource", "media");
      params.append("block_resource", "font");
    }

    const response = await fetch(`https://api.scrapingant.com/v2/markdown?${params}`, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
    });
    const credits = Number(response.headers.get("ant-credits-cost") || 0) || null;

    if (!response.ok) {
      failures.push(`${mode.label} HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
      continue;
    }

    const data = await response.json();
    const markdown = typeof data?.markdown === "string" ? data.markdown : "";
    if (markdown.length < 1000 || BLOCK_RE.test(markdown)) {
      failures.push(`${mode.label}: unusable markdown`);
      continue;
    }

    try {
      parseProductMarkdown(markdown, {
        market: market.code,
        sku: targetUrl.match(/-([A-Z0-9]{6,})\/?(?:\?|$)/i)?.[1]?.toUpperCase() || "",
      });
    } catch (error) {
      failures.push(`${mode.label}: ${error.message}`);
      continue;
    }

    console.log(`[${market.code}] product fetched via ${mode.label}; credits=${credits ?? "unknown"}`);
    return { markdown, url: data.url || targetUrl, credits, mode: mode.label };
  }

  throw new Error(`${market.code}: ScrapingAnt product markdown verification failed: ${failures.join(" | ")}`);
}

function pickStateFields(product) {
  return {
    market: product.market,
    sku: product.sku,
    name: product.name,
    color: product.color || "",
    price: product.price || "",
    url: product.url,
  };
}

function normalize(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(value) {
  return normalize(String(value || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

async function createStockIssue(product) {
  const title = ["🟠 Hermès 有货", product.market, product.name, product.color].filter(Boolean).join("｜");
  const body = [
    `@${repositoryOwner}`,
    "",
    "Hermès 官网刚刚确认这个目标包可以购买：",
    "",
    `- 地区：${product.marketName}`,
    `- 包款：${product.name}`,
    product.color ? `- 颜色：${product.color}` : "",
    product.price ? `- 价格：${product.price}` : "",
    `- SKU：${product.sku}`,
    `- 购买链接：${product.url}`,
    "- 验证：官方商品页 SKU 一致，购买区显示 Add to cart/Add to bag 且无缺货提示",
    `- 检测时间：${nowIso}`,
    "",
    "同一持续在售状态只提醒一次；离开可售状态后再次补货会重新提醒。",
  ].filter(Boolean).join("\n");

  const response = await fetch(`https://api.github.com/repos/${repository}/issues`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "hermes-stock-watch-ant",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ title, body, assignees: [repositoryOwner] }),
  });

  if (!response.ok) throw new Error(`Unable to create GitHub stock alert (${response.status}): ${(await response.text()).slice(0, 500)}`);
}
