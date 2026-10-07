import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

export const MARKETS = [
  {
    code: "US",
    name: "Hermès USA",
    origin: "https://www.hermes.com",
    categoryUrl:
      "https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
  },
  {
    code: "CA",
    name: "Hermès Canada",
    origin: "https://www.hermes.com",
    categoryUrl:
      "https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
  },
];

const CHROME_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/140.0.0.0 Safari/537.36";

export function isTargetProduct(name) {
  const normalized = decodeHtml(name)
    .normalize("NFKD")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return TARGET_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function parseCategoryHtml(html, market) {
  if (typeof html !== "string" || html.length < 25_000) {
    throw new Error(`${market.code}: category response is unexpectedly short`);
  }

  if (
    /sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|enable javascript and cookies|robot challenge/i.test(
      html,
    )
  ) {
    throw new Error(`${market.code}: Hermès returned an access-block page`);
  }

  const products = [];
  const blockPattern =
    /<div\b[^>]*\bid="grid-product-([^"]+)"[^>]*>([\s\S]*?)<\/h-grid-result-item>\s*<\/div>/gi;
  let match;

  while ((match = blockPattern.exec(html)) !== null) {
    const sku = decodeHtml(match[1]).trim();
    const block = match[2];
    const name = extractText(
      block,
      /class="product-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const anchor =
      block.match(/<a\b[^>]*class="product-item-name[^"]*"[^>]*>/i)?.[0] ||
      "";
    const href = extractAttribute(anchor, "href");
    const fullTitle = extractAttribute(anchor, "title");
    const color = extractColor(fullTitle, name);
    const price = extractText(
      block,
      /class="price[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );

    if (!sku || !name || !href) continue;

    const explicitlyUnavailable =
      /<h-out-of-stock-label\b/i.test(block) ||
      /\btag-unavailable\b/i.test(block) ||
      />\s*Discover\s*</i.test(block);
    const retailOnly = /product-item-retail-only-sticker/i.test(block);

    products.push({
      key: `${market.code}:${sku}`,
      market: market.code,
      marketName: market.name,
      sku,
      name,
      color,
      price,
      url: canonicalizeHermesUrl(href, market.origin),
      available: !explicitlyUnavailable && !retailOnly,
      target: isTargetProduct(name),
    });
  }

  if (products.length < 5) {
    throw new Error(
      `${market.code}: parsed only ${products.length} products; refusing to trust the page`,
    );
  }

  return products;
}

export function parseCategoryDocument(document, market) {
  if (document && typeof document === "object" && document.source === "firecrawl") {
    validateFirecrawlDocument(document, market, "category");
    validateMarketUrl(document.metadata.sourceURL || document.metadata.url, market.code, "category");
    return parseCategoryMarkdown(document.markdown, market);
  }

  return parseCategoryHtml(document, market);
}

export function parseCategoryMarkdown(markdown, market) {
  if (typeof markdown !== "string" || markdown.length < 1_000) {
    throw new Error(`${market.code}: category markdown response is unexpectedly short`);
  }

  if (/sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|enable javascript and cookies|robot challenge/i.test(markdown)) {
    throw new Error(`${market.code}: category markdown is an access-block page`);
  }

  const links = [...markdown.matchAll(/\[([^\]\n]+)\]\((https?:\/\/www\.hermes\.com\/(?:us|ca)\/en\/product\/[^)\s]+)(?:\s+"[^"]*")?\)/gi)];
  const products = [];

  for (let index = 0; index < links.length; index += 1) {
    const match = links[index];
    const name = normalizeDetail(match[1]);
    const url = match[2];
    validateMarketUrl(url, market.code, "product");
    const sku = url.match(/-([A-Z0-9]{6,})\/?(?:\?|$)/i)?.[1]?.toUpperCase() || "";
    if (!name || !sku) continue;

    const segmentEnd = links[index + 1]?.index ?? Math.min(markdown.length, match.index + 800);
    const segment = markdown.slice(match.index, segmentEnd);
    const color = normalizeDetail(segment.match(/\bColor\s*:\s*([^\n,]+(?:\s*\/\s*[^\n,]+)?)/i)?.[1]);
    const price = normalizeDetail(segment.match(/\bPrice\s+((?:CA|US)?\s*\$\s*[\d,]+(?:\.\d{2})?)/i)?.[1]);
    const explicitlyUnavailable = /\bDiscover\b|\bUnavailable\b|\bSold out\b/i.test(segment);

    products.push({
      key: `${market.code}:${sku}`,
      market: market.code,
      marketName: market.name,
      sku,
      name,
      color,
      price,
      url,
      available: !explicitlyUnavailable,
      target: isTargetProduct(name),
    });
  }

  const uniqueProducts = [...new Map(products.map((product) => [product.key, product])).values()];
  if (uniqueProducts.length < 5) {
    throw new Error(`${market.code}: parsed only ${uniqueProducts.length} products from category markdown`);
  }
  return uniqueProducts;
}

export function parseProductPageDocument(document, candidate) {
  if (document && typeof document === "object" && document.source === "firecrawl") {
    return parseProductPageFirecrawl(document, candidate);
  }

  return parseProductPageHtml(document, candidate);
}

export function parseProductPageFirecrawl(document, candidate) {
  validateFirecrawlDocument(document, candidate, "product");

  const markdown = document.markdown || "";
  const rawHtml = document.rawHtml || "";
  const metadata = document.metadata || {};
  const combined = `${markdown}\n${rawHtml}`;

  const pageSku =
    normalizeDetail(metadata["product:retailer_item_id"]) ||
    normalizeDetail(
      rawHtml.match(
        /<meta\b[^>]*(?:property|name)=["']product:retailer_item_id["'][^>]*content=["']([^"']+)["']/i,
      )?.[1],
    );

  if (!pageSku) {
    throw new Error(`${candidate.market}: Firecrawl product page is incomplete; SKU metadata is missing`);
  }

  if (candidate.sku && pageSku.toUpperCase() !== candidate.sku.toUpperCase()) {
    throw new Error(
      `${candidate.market}: Firecrawl product page SKU ${pageSku} did not match ${candidate.sku}`,
    );
  }

  const name =
    normalizeDetail(metadata.name || metadata.ogTitle || metadata["og:title"]) ||
    candidate.name;
  const color =
    normalizeDetail(
      markdown.match(/\bColor\s*:\s*([^\n]+)/i)?.[1] ||
      markdown.match(/\bColor\s*,?\s*([^\n]+?)\s+selected\b/i)?.[1],
    ) || candidate.color;
  const material = normalizeDetail(
    markdown.match(
      /\bBag in\s+(.+?)(?=\s+-\s+|\s+As this product|\s+Made in\b|\s+Metallic finish\b|\s+Dimensions\b|\n)/i,
    )?.[1],
  );
  const amount = normalizeDetail(metadata["product:price:amount"]);
  const currency = normalizeDetail(metadata["product:price:currency"]);
  const price =
    candidate.price ||
    (amount
      ? `${currency === "CAD" ? "CA$" : currency === "USD" ? "$" : currency}${Number(amount).toLocaleString("en-US")}`
      : "");

  const unavailableInMarkdown =
    /Unfortunately this product is no longer available/i.test(markdown) ||
    /This product is currently unavailable/i.test(markdown) ||
    /This item is currently unavailable/i.test(markdown) ||
    /\bSold out\b/i.test(markdown);

  const unavailableMessageBlock =
    /class=["'][^"']*message-info[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*(?:Unfortunately this product is no longer available|This product is currently unavailable|This item is currently unavailable|Sold out)/i.test(
      rawHtml,
    );

  const buttons = [...rawHtml.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  const purchaseButton = buttons.find((match) => {
    const attrs = match[1] || "";
    const label = htmlToText(match[2] || "");
    return (
      /name=["']add-to-cart["']/i.test(attrs) ||
      /data-testid=["']Add to (?:cart|bag)["']/i.test(attrs) ||
      /\bAdd to (?:cart|bag)\b/i.test(label)
    );
  });

  const purchaseAttrs = purchaseButton?.[1] || "";
  const purchaseLabel = purchaseButton ? htmlToText(purchaseButton[2] || "") : "";
  const purchaseButtonDisabled =
    /(?:^|\s)disabled(?:\s|=|$)/i.test(purchaseAttrs) ||
    /aria-disabled=["']true["']/i.test(purchaseAttrs);

  const hasEnabledPurchaseAction =
    Boolean(purchaseButton) &&
    /\bAdd to (?:cart|bag)\b/i.test(purchaseLabel) &&
    !purchaseButtonDisabled;

  const unavailable = unavailableInMarkdown || unavailableMessageBlock;
  if (!purchaseButton && !unavailable) {
    throw new Error(`${candidate.market}: product purchase state is unknown; no button or sold-out evidence`);
  }

  return {
    ...candidate,
    sku: pageSku.toUpperCase(),
    name,
    color,
    material,
    price,
    available: hasEnabledPurchaseAction && !unavailable,
    purchaseAction: hasEnabledPurchaseAction ? "Add to cart / Add to bag" : "",
    purchaseButtonDisabled,
  };
}

export function parseProductPageHtml(html, candidate) {
  if (typeof html !== "string" || html.length < 5_000) {
    throw new Error(`${candidate.market}: product response is unexpectedly short`);
  }

  if (
    /sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|enable javascript and cookies|robot challenge/i.test(
      html,
    )
  ) {
    throw new Error(`${candidate.market}: Hermès returned an access-block page`);
  }

  const text = htmlToText(html);
  const pageSku =
    text.match(/Product reference\s*:\s*([A-Z0-9]+)/i)?.[1]?.trim() || "";

  if (!pageSku) {
    throw new Error(`${candidate.market}: product page is incomplete; product reference is missing`);
  }

  if (candidate.sku && pageSku !== candidate.sku) {
    throw new Error(
      `${candidate.market}: product page SKU ${pageSku} did not match ${candidate.sku}`,
    );
  }

  const name =
    extractText(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || candidate.name;
  const price =
    normalizeDetail(
      text.match(/\bPrice\s+((?:CA|US)?\s*\$\s*[\d,]+(?:\.\d{2})?)/i)?.[1],
    ) || candidate.price;
  const color =
    normalizeDetail(text.match(/\bColor\s*,?\s*(.+?)\s+selected\b/i)?.[1]) ||
    candidate.color;
  const material = normalizeDetail(
    text.match(
      /\bBag in\s+(.+?)(?=\s+-\s+|\s+As this product|\s+Made in\b|\s+Metallic finish\b|\s+Dimensions\b|\s+Product reference\b)/i,
    )?.[1],
  );

  const unavailable =
    /Unfortunately this product is no longer available/i.test(text) ||
    /This product is currently unavailable/i.test(text) ||
    /This item is currently unavailable/i.test(text) ||
    /\bSold out\b/i.test(text);
  const purchaseButton = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]
    .find(match => /\bAdd to (?:cart|bag)\b/i.test(htmlToText(match[2])));
  const attrs = purchaseButton?.[1] || "";
  const purchaseButtonDisabled = /(?:^|\s)disabled(?:\s|=|$)/i.test(attrs) || /aria-disabled=["']true["']/i.test(attrs);
  const hasPurchaseAction = Boolean(purchaseButton) && !purchaseButtonDisabled;
  if (!purchaseButton && !unavailable) throw new Error(`${candidate.market}: product purchase state is unknown`);

  return {
    ...candidate,
    sku: pageSku || candidate.sku,
    name,
    color,
    material,
    price,
    purchaseButtonDisabled,
    available: hasPurchaseAction && !unavailable,
    purchaseAction: hasPurchaseAction ? "Add to cart / Add to bag" : "",
  };
}

export async function fetchCategory(market, fetchImpl = fetch, now = Date.now()) {
  const url = new URL(market.categoryUrl);
  const tenMinuteBucket = Math.floor(now / (10 * 60 * 1000));
  url.searchParams.set("_hwatch", String(tenMinuteBucket));

  if (process.env.FIRECRAWL_CLI === "1" && fetchImpl === fetch) {
    return fetchWithFirecrawlCli(url, `${market.code}: Hermès`, market.code);
  }

  if (process.env.FIRECRAWL_API_KEY && fetchImpl === fetch) {
    return fetchWithFirecrawl(url, `${market.code}: Hermès`, market.code, fetchImpl);
  }

  return fetchHtml(url, `${market.code}: Hermès`, fetchImpl);
}

export async function fetchProductPage(
  product,
  fetchImpl = fetch,
  now = Date.now(),
) {
  const url = new URL(product.url);
  const tenMinuteBucket = Math.floor(now / (10 * 60 * 1000));
  url.searchParams.set("_hwatch", String(tenMinuteBucket));

  if (process.env.FIRECRAWL_CLI === "1" && fetchImpl === fetch) {
    return fetchWithFirecrawlCli(
      url,
      `${product.market}: product page`,
      product.market,
    );
  }

  if (process.env.FIRECRAWL_API_KEY && fetchImpl === fetch) {
    return fetchWithFirecrawl(
      url,
      `${product.market}: product page`,
      product.market,
      fetchImpl,
    );
  }

  return fetchHtml(url, `${product.market}: product page`, fetchImpl);
}

async function fetchWithFirecrawlCli(url, label, marketCode) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "firecrawl",
      [
        "scrape",
        String(url),
        "--format",
        "markdown,rawHtml",
      ],
      {
        timeout: 90_000,
        maxBuffer: 30 * 1024 * 1024,
        env: {
          ...process.env,
          NO_COLOR: "1",
        },
      },
    );

    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      throw new Error(
        `CLI returned invalid JSON: ${stdout.slice(0, 300)}${stderr ? ` | ${stderr.slice(0, 200)}` : ""}`,
      );
    }

    const document = {
      source: "firecrawl",
      markdown: data?.markdown || data?.data?.markdown || "",
      rawHtml: data?.rawHtml || data?.data?.rawHtml || "",
      metadata: data?.metadata || data?.data?.metadata || {},
    };

    validateFirecrawlDocument(
      document,
      { code: marketCode, market: marketCode },
      label,
    );
    return document;
  } catch (error) {
    throw new Error(`${label} Firecrawl CLI failed: ${error.message}`);
  }
}

async function fetchWithFirecrawl(url, label, marketCode, fetchImpl) {
  const response = await fetchImpl("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: String(url),
      formats: ["markdown", "rawHtml"],
      proxy: "basic",
      waitFor: 3000,
      maxAge: 0,
      onlyMainContent: false,
      location: {
        country: marketCode === "CA" ? "CA" : "US",
        languages: ["en"],
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${label} Firecrawl returned HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${label} Firecrawl returned invalid JSON`);
  }

  const data = payload?.data || payload;
  const document = {
    source: "firecrawl",
    markdown: data?.markdown || "",
    rawHtml: data?.rawHtml || "",
    metadata: data?.metadata || {},
  };

  validateFirecrawlDocument(document, { code: marketCode, market: marketCode }, label);
  return document;
}

function validateFirecrawlDocument(document, marketLike, label) {
  const code = marketLike?.code || marketLike?.market || "UNKNOWN";
  const markdown = document?.markdown || "";
  const rawHtml = document?.rawHtml || "";
  const metadata = document?.metadata || {};
  const content = `${markdown}\n${rawHtml}`;

  if (Number(metadata.statusCode) !== 200) {
    throw new Error(`${code}: ${label} Firecrawl page returned HTTP ${metadata.statusCode}`);
  }

  if (
    /sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|enable javascript and cookies|robot challenge|attention required\s*!?\s*\|\s*cloudflare/i.test(
      content,
    )
  ) {
    throw new Error(`${code}: ${label} Firecrawl returned an access/challenge page`);
  }

  if (markdown.length < 1_000 && rawHtml.length < 5_000) {
    throw new Error(`${code}: ${label} Firecrawl response is unexpectedly short`);
  }

  const sourceUrl = metadata.sourceURL || metadata.url || "";
  validateMarketUrl(sourceUrl, code, label === "product" ? "product" : null);
  if (marketLike.url) {
    const actual = new URL(sourceUrl);
    const expected = new URL(marketLike.url);
    if (actual.pathname !== expected.pathname) {
      throw new Error(`${code}: product source URL did not match candidate`);
    }
  }
}

function validateMarketUrl(value, code, kind) {
  let url;
  try { url = new URL(value); } catch {
    throw new Error(`${code}: missing or invalid official source URL`);
  }
  const prefix = `/${code.toLowerCase()}/en/`;
  if (url.protocol !== "https:" || url.hostname !== "www.hermes.com" ||
      !url.pathname.startsWith(prefix) ||
      (kind && !url.pathname.startsWith(`${prefix}${kind}/`))) {
    throw new Error(`${code}: source URL is not the matching official market page`);
  }
}

async function fetchHtml(url, label, fetchImpl) {
  const response = await fetchImpl(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "upgrade-insecure-requests": "1",
      "user-agent": CHROME_USER_AGENT,
    },
  });

  if (response.ok) {
    const html = await response.text();
    validateOfficialHermesHtml(html, label);
    return html;
  }

  if (
    fetchImpl === fetch &&
    process.env.GITHUB_ACTIONS === "true" &&
    [403, 429].includes(response.status)
  ) {
    const html = await fetchWithChrome(url, label);
    validateOfficialHermesHtml(html, label);
    return html;
  }

  throw new Error(`${label} returned HTTP ${response.status}`);
}

function validateOfficialHermesHtml(html, label) {
  if (typeof html !== "string" || html.length < 5_000) {
    throw new Error(`${label} returned only ${html?.length || 0} characters`);
  }

  if (
    /sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|enable javascript and cookies|robot challenge/i.test(
      html,
    )
  ) {
    throw new Error(`${label} returned an access/challenge page`);
  }

  if (!/<html\b/i.test(html) || !/herm[eè]s/i.test(html)) {
    throw new Error(`${label} did not return a recognizable Hermès HTML page`);
  }
}

function canonicalizeHermesUrl(href, origin) {
  const url = new URL(href, origin);
  if (url.hostname.endsWith(".translate.goog")) {
    url.hostname = "www.hermes.com";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("_x_tr_")) url.searchParams.delete(key);
  }
  return url.href;
}

async function fetchWithChrome(url, label) {
  const chromePath =
    process.env.CHROME_PATH ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : "/usr/bin/google-chrome");
  try {
    const { stdout } = await execFileAsync(
      chromePath,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-features=Translate,OptimizationHints,MediaRouter",
        "--window-size=1440,1200",
        "--virtual-time-budget=10000",
        `--user-agent=${CHROME_USER_AGENT}`,
        "--dump-dom",
        String(url),
      ],
      { timeout: 45_000, maxBuffer: 25 * 1024 * 1024 },
    );

    if (!stdout || stdout.length < 5_000) {
      throw new Error(`Chrome returned only ${stdout?.length || 0} characters`);
    }
    return stdout;
  } catch (error) {
    throw new Error(`${label} browser fallback failed: ${error.message}`);
  }
}

function extractText(source, pattern) {
  const value = source.match(pattern)?.[1] || "";
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractAttribute(tag, name) {
  const pattern = new RegExp(`\\b${name}="([^"]*)"`, "i");
  return decodeHtml(tag.match(pattern)?.[1] || "").trim();
}

function extractColor(fullTitle, name) {
  if (!fullTitle) return "";
  const prefix = `${name},`;
  return fullTitle.toLowerCase().startsWith(prefix.toLowerCase())
    ? fullTitle.slice(prefix.length).trim()
    : "";
}

function htmlToText(value) {
  return decodeHtml(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDetail(value) {
  return decodeHtml(value || "")
    .replace(/\s+/g, " ")
    .replace(/\\+$/g, "")
    .trim();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
