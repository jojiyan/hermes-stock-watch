import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TARGET_PATTERNS = [
  /\bneo garden 23\b/i,
  /\bgarden party 30\b/i,
  /\blindy(?: ii)? mini\b/i,
  /\bmini lindy\b/i,
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
    /sorry, you have been blocked|access denied|verify you are human|captcha/i.test(
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
      url: new URL(href, market.origin).href,
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
  if (/grid-product-/i.test(document)) {
    return parseCategoryHtml(document, market);
  }

  return parseCategoryMarkdown(document, market);
}

export function parseCategoryMarkdown(markdown, market) {
  if (typeof markdown !== "string" || markdown.length < 1_000) {
    throw new Error(`${market.code}: Reader category response is unexpectedly short`);
  }

  if (/sorry, you have been blocked|access denied|verify you are human|captcha/i.test(markdown)) {
    throw new Error(`${market.code}: Reader received an access-block page`);
  }

  const links = [...markdown.matchAll(/\[([^\]\n]+)\]\((https?:\/\/www\.hermes\.com\/(?:us|ca)\/en\/product\/[^)\s]+)(?:\s+"[^"]*")?\)/gi)];
  const products = [];

  for (let index = 0; index < links.length; index += 1) {
    const match = links[index];
    const name = normalizeDetail(match[1]);
    const url = match[2];
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
    throw new Error(`${market.code}: Reader parsed only ${uniqueProducts.length} products`);
  }
  return uniqueProducts;
}

export function parseProductPageHtml(html, candidate) {
  if (typeof html !== "string" || html.length < 5_000) {
    throw new Error(`${candidate.market}: product response is unexpectedly short`);
  }

  if (
    /sorry, you have been blocked|access denied|verify you are human|captcha/i.test(
      html,
    )
  ) {
    throw new Error(`${candidate.market}: Hermès returned an access-block page`);
  }

  const text = htmlToText(html);
  const pageSku =
    text.match(/Product reference\s*:\s*([A-Z0-9]+)/i)?.[1]?.trim() || "";

  if (pageSku && candidate.sku && pageSku !== candidate.sku) {
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
  const hasPurchaseAction = /\bAdd to (?:cart|bag)\b/i.test(text);

  return {
    ...candidate,
    sku: pageSku || candidate.sku,
    name,
    color,
    material,
    price,
    available: hasPurchaseAction && !unavailable,
    purchaseAction: hasPurchaseAction ? "Add to cart / Add to bag" : "",
  };
}

export async function fetchCategory(market, fetchImpl = fetch, now = Date.now()) {
  const url = new URL(market.categoryUrl);
  const tenMinuteBucket = Math.floor(now / (10 * 60 * 1000));
  url.searchParams.set("_hwatch", String(tenMinuteBucket));

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

  return fetchHtml(url, `${product.market}: product page`, fetchImpl);
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

  if (response.ok) return response.text();

  if (
    fetchImpl === fetch &&
    process.env.GITHUB_ACTIONS === "true" &&
    [403, 429].includes(response.status)
  ) {
    try {
      return await fetchWithChrome(url, label);
    } catch (chromeError) {
      return fetchWithReader(url, label, fetchImpl, chromeError);
    }
  }

  throw new Error(`${label} returned HTTP ${response.status}`);
}

async function fetchWithReader(url, label, fetchImpl, chromeError) {
  const readerUrl = `https://r.jina.ai/${url.href}`;
  const response = await fetchImpl(readerUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
    headers: {
      accept: "application/json",
      "x-no-cache": "true",
      "x-cache-tolerance": "0",
      "x-retain-links": "all",
      "x-timeout": "45",
      "x-user-agent": CHROME_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`${label} fallbacks failed: ${chromeError.message}; Reader HTTP ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.data?.content || payload?.content || "";
  if (typeof content !== "string" || content.length < 1_000) {
    throw new Error(`${label} Reader returned only ${content?.length || 0} characters`);
  }
  return content;
}

async function fetchWithChrome(url, label) {
  const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
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
