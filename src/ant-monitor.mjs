import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
const NEGATIVE_RE = /\bDiscover\b|\bAvailable soon\b|\bUnavailable\b|\bSold out\b|no longer available|currently unavailable/i;
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
  { browser: false, rawSource: false, proxyType: "datacenter", label: "direct-random-datacenter" },
  { browser: true, rawSource: true, proxyType: "datacenter", label: "browser-raw-random-datacenter" },
  { browser: true, rawSource: false, proxyType: "datacenter", label: "browser-js-random-datacenter" },
];

const PRODUCT_FETCH_MODES = [
  ...CHEAP_FETCH_MODES,
  { browser: false, rawSource: false, proxyType: "residential", label: "direct-random-residential" },
  { browser: true, rawSource: true, proxyType: "residential", label: "browser-raw-random-residential" },
  { browser: true, rawSource: false, proxyType: "residential", label: "browser-js-random-residential" },
];

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
    const categoryDoc = await fetchAntMarkdown(market.categoryUrl, market);
    const products = parseCategoryMarkdown(categoryDoc.markdown, market);
    const targets = products.filter((product) => product.target);
    const categoryAvailable = targets.filter((product) => product.categoryAvailable);
    const nextAvailable = {};
    const verificationErrors = [];
    const evidence = [];

    for (const product of categoryAvailable) {
      if (previousAvailable[product.sku]) {
        nextAvailable[product.sku] = {
          ...previousAvailable[product.sku],
          ...pickStateFields(product),
          lastSeenAt: nowIso,
        };
        continue;
      }

      try {
        const html = await fetchAntHtml(product.url, market);
        const verified = parseProductHtml(html, product);
        evidence.push({
          sku: product.sku,
          url: product.url,
          available: verified.available,
          purchaseAction: verified.purchaseAction,
          purchaseButtonDisabled: verified.purchaseButtonDisabled,
        });

        if (!verified.available) continue;

        nextAvailable[product.sku] = {
          ...pickStateFields(verified),
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
        };
        alerts.push(verified);
      } catch (error) {
        verificationErrors.push({ sku: product.sku, url: product.url, error: error.message });
      }
    }

    state.markets[market.code] = {
      status: verificationErrors.length === 0 ? "ok" : "partial",
      lastCheckedAt: nowIso,
      lastSuccessAt: verificationErrors.length === 0 ? nowIso : previousMarket.lastSuccessAt || null,
      products: products.length,
      targets: targets.length,
      categoryAvailable: categoryAvailable.length,
      available: verificationErrors.length === 0 ? nextAvailable : previousAvailable,
      verificationErrors,
    };

    if (verificationErrors.length === 0) healthyMarkets += 1;

    summaries.push({
      market: market.code,
      products: products.length,
      targets: targets.length,
      categoryAvailable: categoryAvailable.length,
      confirmedNewAvailability: alerts.filter((item) => item.market === market.code).length,
      verificationErrors,
      evidence,
      categoryCredits: categoryDoc.credits,
      committed: verificationErrors.length === 0,
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

if (process.env.GITHUB_EVENT_NAME === "push") {
  const probeCandidate = {
    key: "CA:H087968CC55",
    market: "CA",
    marketName: "Hermès Canada",
    sku: "H087968CC55",
    name: "Le Petit Sac bag",
    color: "",
    price: "",
    url: "https://www.hermes.com/ca/en/product/le-petit-sac-bag-H087968CC55/",
    target: false,
  };
  const probeHtml = await fetchAntHtml(probeCandidate.url, MARKETS.find((item) => item.code === "CA"));
  const probeResult = parseProductHtml(probeHtml, probeCandidate);
  console.log(JSON.stringify({
    validationProbe: true,
    market: probeResult.market,
    sku: probeResult.sku,
    purchaseAction: probeResult.purchaseAction,
    purchaseButtonDisabled: probeResult.purchaseButtonDisabled,
    available: probeResult.available,
  }));
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

function parseCategoryMarkdown(markdown, market) {
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
    const hasBuy = BUY_RE.test(segment);
    const negative = NEGATIVE_RE.test(segment);

    products.push({
      key: `${market.code}:${sku}`,
      market: market.code,
      marketName: market.name,
      sku,
      name,
      color,
      price,
      url,
      categoryAvailable: !negative,
      target: isTargetProduct(name),
    });
  }

  const unique = [...new Map(products.map((p) => [p.key, p])).values()];
  if (unique.length < 5) throw new Error(`${market.code}: parsed only ${unique.length} products from category`);
  return unique;
}

function parseProductHtml(html, candidate) {
  if (typeof html !== "string" || (html.length < 5000 && !html.includes('data-hwatch-probe="true"'))) {
    throw new Error(`${candidate.market}: product HTML is unexpectedly short`);
  }
  if (BLOCK_RE.test(html)) throw new Error(`${candidate.market}: product returned an access-block page`);

  const text = htmlToText(html);
  const metaSku = html.match(/<meta\b[^>]*(?:property|name)=["']product:retailer_item_id["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const textSku = text.match(/Product reference\s*:\s*([A-Z0-9]+)/i)?.[1];
  const pageSku = normalize(metaSku || textSku).toUpperCase();
  if (!pageSku) throw new Error(`${candidate.market}: product reference is missing`);
  if (pageSku !== candidate.sku.toUpperCase()) {
    throw new Error(`${candidate.market}: product SKU ${pageSku} did not match ${candidate.sku}`);
  }

  const unavailable = NEGATIVE_RE.test(text);
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  const purchaseButton = buttons.find((m) => BUY_RE.test(htmlToText(m[2] || "")) || /name=["']add-to-cart["']/i.test(m[1] || ""));
  const attrs = purchaseButton?.[1] || "";
  const label = purchaseButton ? htmlToText(purchaseButton[2] || "") : "";
  const disabled = /(?:^|\s)disabled(?:\s|=|$)/i.test(attrs) || /aria-disabled=["']true["']/i.test(attrs);
  const enabledBuy = Boolean(purchaseButton) && BUY_RE.test(label) && !disabled;

  if (!purchaseButton && !unavailable) throw new Error(`${candidate.market}: product purchase state is unknown`);

  return {
    ...candidate,
    available: enabledBuy && !unavailable,
    purchaseAction: enabledBuy && !unavailable ? "Add to cart / Add to bag" : "",
    purchaseButtonDisabled: disabled,
  };
}

async function fetchAntMarkdown(targetUrl, market) {
  const failures = [];

  for (const mode of CHEAP_FETCH_MODES) {
    const params = new URLSearchParams({
      url: targetUrl,
      browser: mode.browser ? "true" : "false",
      proxy_type: mode.proxyType,
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
    if (productLinkCount < 5) {
      failures.push(`${mode.label}: only ${productLinkCount} product links`);
      console.log(`[${market.code}] ${mode.label} returned only ${productLinkCount} product links; trying next mode; credits=${credits ?? "unknown"}`);
      continue;
    }

    console.log(`[${market.code}] category fetched via ${mode.label}; productLinks=${productLinkCount}; credits=${credits ?? "unknown"}`);
    return { markdown: data.markdown, url: data.url || targetUrl, credits, mode: mode.label };
  }

  throw new Error(`${market.code}: ScrapingAnt category failed in all low-credit datacenter modes: ${failures.join(" | ")}`);
}

async function fetchAntWarmCookies(market, proxyType, sessionId) {
  const params = new URLSearchParams({
    url: market.categoryUrl,
    browser: "false",
    proxy_type: proxyType,
    timeout: "60",
    session: sessionId,
  });

  const response = await fetch(`https://api.scrapingant.com/v2/extended?${params}`, {
    headers: { ...ANT_TARGET_HEADERS, accept: "application/json" },
  });
  const credits = Number(response.headers.get("ant-credits-cost") || 0) || null;

  if (!response.ok) {
    console.log(`[${market.code}] warm-up ${proxyType} failed HTTP ${response.status}; credits=${credits ?? "unknown"}`);
    return "";
  }

  const data = await response.json();
  const cookies = typeof data?.cookies === "string" ? data.cookies : "";
  console.log(`[${market.code}] warm-up ${proxyType} succeeded; cookies=${cookies ? "yes" : "no"}; credits=${credits ?? "unknown"}`);
  return cookies;
}

async function fetchAntHtml(targetUrl, market) {
  const failures = [];
  const warmups = new Map();

  for (const mode of PRODUCT_FETCH_MODES) {
    const sessionId = `hwatch-${market.code.toLowerCase()}-${mode.proxyType}-${Math.floor(Date.now() / (10 * 60 * 1000))}`;
    if (!warmups.has(mode.proxyType)) {
      warmups.set(mode.proxyType, await fetchAntWarmCookies(market, mode.proxyType, sessionId));
    }
    const cookies = warmups.get(mode.proxyType) || "";

    const params = new URLSearchParams({
      url: targetUrl,
      browser: mode.browser ? "true" : "false",
      proxy_type: mode.proxyType,
      timeout: "60",
      session: sessionId,
    });
    if (cookies) params.set("cookies", cookies);
    if (mode.rawSource) params.set("return_page_source", "true");
    if (mode.browser) { params.append("block_resource", "image"); params.append("block_resource", "media"); params.append("block_resource", "font"); }

    const response = await fetch(`https://api.scrapingant.com/v2/general?${params}`, {
      headers: { ...ANT_TARGET_HEADERS, accept: "text/html,*/*" },
    });
    const credits = Number(response.headers.get("ant-credits-cost") || 0) || null;

    if (!response.ok) {
      failures.push(`${mode.label} HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
      continue;
    }

    const html = await response.text();
    if (html.length < 5000 || BLOCK_RE.test(html)) {
      failures.push(`${mode.label}: unusable HTML`);
      continue;
    }

    try {
      const verified = parseProductHtml(html, {
        market: market.code,
        sku: targetUrl.match(/-([A-Z0-9]{6,})\/?(?:\?|$)/i)?.[1]?.toUpperCase() || "",
      });
      console.log(`[${market.code}] product fetched via ${mode.label}; credits=${credits ?? "unknown"}`);
      return html;
    } catch (error) {
      failures.push(`${mode.label}: ${error.message}`);
    }
  }

  try {
    return await fetchProductThroughCategoryBrowser(targetUrl, market);
  } catch (error) {
    failures.push(`category-browser-bridge: ${error.message}`);
  }

  throw new Error(`${market.code}: ScrapingAnt product verification failed in all modes: ${failures.join(" | ")}`);
}

async function fetchProductThroughCategoryBrowser(targetUrl, market) {
  const sku = targetUrl.match(/-([A-Z0-9]{6,})\/?(?:\?|$)/i)?.[1]?.toUpperCase() || "";
  const js = `
    const target = ${JSON.stringify(targetUrl)};
    const response = await fetch(target, { credentials: "include", redirect: "follow" });
    const productHtml = await response.text();
    const doc = new DOMParser().parseFromString(productHtml, "text/html");
    const meta = doc.querySelector('meta[property="product:retailer_item_id"], meta[name="product:retailer_item_id"]');
    const buttons = Array.from(doc.querySelectorAll("button"));
    const button = buttons.find((b) => /Add to (cart|bag)/i.test((b.innerText || b.textContent || "").trim()) || /add-to-cart/i.test(b.getAttribute("name") || ""));
    const label = button ? (button.innerText || button.textContent || "").replace(/\\s+/g, " ").trim() : "";
    const disabled = !!button && (button.disabled || button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true");
    const text = (doc.body?.innerText || doc.body?.textContent || "").replace(/\\s+/g, " ");
    const unavailable = /\\bDiscover\\b|\\bAvailable soon\\b|\\bUnavailable\\b|\\bSold out\\b|no longer available|currently unavailable|back in stock/i.test(text);
    const result = {
      status: response.status,
      sku: (meta?.getAttribute("content") || "").trim(),
      hasButton: !!button,
      label,
      disabled,
      unavailable,
    };
    document.title = "HWATCH:" + btoa(JSON.stringify(result));
  `;
  const snippet = Buffer.from(js, "utf8").toString("base64");
  const attempts = [
    { proxyType: "datacenter", label: "category-browser-datacenter" },
    { proxyType: "residential", label: "category-browser-residential" },
  ];
  const failures = [];

  for (const attempt of attempts) {
    const params = new URLSearchParams({
      url: market.categoryUrl,
      browser: "true",
      proxy_type: attempt.proxyType,
      timeout: "60",
      js_snippet: snippet,
    });
    params.append("block_resource", "image");
    params.append("block_resource", "media");
    params.append("block_resource", "font");

    const response = await fetch(`https://api.scrapingant.com/v2/general?${params}`, {
      headers: { "x-api-key": apiKey, accept: "text/html,*/*" },
    });
    const credits = Number(response.headers.get("ant-credits-cost") || 0) || null;

    if (!response.ok) {
      failures.push(`${attempt.label} HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
      continue;
    }

    const outerHtml = await response.text();
    const payload = outerHtml.match(/<title>HWATCH:([^<]+)<\/title>/i)?.[1];
    if (!payload) {
      failures.push(`${attempt.label}: result marker missing`);
      continue;
    }

    let result;
    try {
      result = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    } catch {
      failures.push(`${attempt.label}: result marker invalid`);
      continue;
    }

    const pageSku = String(result.sku || "").toUpperCase();
    if (result.status !== 200 || !pageSku || pageSku !== sku) {
      failures.push(`${attempt.label}: product fetch status/SKU mismatch`);
      continue;
    }
    if (!result.hasButton && !result.unavailable) {
      failures.push(`${attempt.label}: purchase state unknown`);
      continue;
    }

    console.log(`[${market.code}] product verified via ${attempt.label}; credits=${credits ?? "unknown"}; button=${result.label || "none"}; disabled=${result.disabled}`);

    const unavailableText = result.unavailable ? "<p>Unavailable</p>" : "";
    const buttonHtml = result.hasButton
      ? `<button name="add-to-cart"${result.disabled ? ' disabled aria-disabled="true"' : ""}>${result.label || "Add to cart"}</button>`
      : "";
    return `<html data-hwatch-probe="true"><head><meta property="product:retailer_item_id" content="${pageSku}"></head><body>${unavailableText}${buttonHtml}</body></html>`;
  }

  throw new Error(failures.join(" | "));
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
    "- 验证：类别页出现 Add to cart/Add to bag，并再次打开官方商品页确认购买按钮可用",
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
