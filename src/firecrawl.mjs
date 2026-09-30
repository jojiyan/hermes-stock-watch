export const MARKETS = [
  {
    code: "US",
    name: "Hermès USA",
    categoryUrl:
      "https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
  },
  {
    code: "CA",
    name: "Hermès Canada",
    categoryUrl:
      "https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
  },
];

const TARGET_PATTERNS = [
  /\bneo garden 23\b/i,
  /\bgarden party 30\b/i,
  /\blindy(?: ii)? mini\b/i,
  /\bmini lindy\b/i,
  /\bbirkin\b/i,
  /\bkelly\b/i,
  /\bconstance\b/i,
];

export function isTargetProduct(name) {
  const normalized = String(name || "")
    .normalize("NFKD")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return TARGET_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function parseCategoryMarkdown(markdown, market) {
  if (typeof markdown !== "string" || markdown.length < 10_000) {
    throw new Error(`${market.code}: Firecrawl category page is unexpectedly short`);
  }

  if (
    /attention required|cloudflare|verify you are human|captcha|access denied|sorry, you have been blocked/i.test(
      markdown,
    )
  ) {
    throw new Error(`${market.code}: Firecrawl received a challenge page`);
  }

  const linkPattern =
    /\[([^\]\n]+)\]\((https:\/\/www\.hermes\.com\/(?:us|ca)\/en\/product\/[^\s)"']+)(?:\s+"[^"]*")?\)/gi;
  const matches = [...markdown.matchAll(linkPattern)];
  const products = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const name = normalizeText(match[1]);
    const url = match[2];
    const nextIndex = matches[index + 1]?.index ?? markdown.length;
    let segment = markdown.slice(match.index, nextIndex);
    const imageIndex = segment.indexOf("![](");
    if (imageIndex >= 0) segment = segment.slice(0, imageIndex);

    const sku = skuFromUrl(url);
    if (!sku || !name) continue;

    const color =
      normalizeText(segment.match(/\bColor:\s*([^\n]+?)(?=\n|,\s*Price|$)/i)?.[1]) || "";
    const price =
      normalizeText(segment.match(/\bPrice\s+((?:CA)?\$[\d,]+(?:\.\d{2})?)/i)?.[1]) || "";
    const discoverOnly = /\bDiscover\b/i.test(segment);

    products.push({
      key: `${market.code}:${sku}`,
      market: market.code,
      marketName: market.name,
      sku,
      name,
      color,
      price,
      url,
      target: isTargetProduct(name),
      discoverOnly,
    });
  }

  const unique = [...new Map(products.map((product) => [product.key, product])).values()];
  if (unique.length < 5) {
    throw new Error(
      `${market.code}: Firecrawl category parse found only ${unique.length} products`,
    );
  }
  return unique;
}

export function parseProductRawHtml(rawHtml, candidate) {
  if (typeof rawHtml !== "string" || rawHtml.length < 25_000) {
    throw new Error(`${candidate.market}: Firecrawl product page is unexpectedly short`);
  }

  if (
    /<title>Attention Required! \| Cloudflare<\/title>|verify you are human|captcha|sorry, you have been blocked/i.test(
      rawHtml,
    )
  ) {
    throw new Error(`${candidate.market}: Firecrawl product page is a challenge page`);
  }

  if (!rawHtml.includes(candidate.sku)) {
    throw new Error(
      `${candidate.market}: product page does not contain expected reference ${candidate.sku}`,
    );
  }

  const buttons = [...rawHtml.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  const purchaseButton = buttons.find((match) => {
    const attrs = match[1] || "";
    const label = stripHtml(match[2] || "");
    return (
      /name=["']add-to-cart["']/i.test(attrs) ||
      /data-testid=["']Add to (?:cart|bag)["']/i.test(attrs) ||
      /\bAdd to (?:cart|bag)\b/i.test(label)
    );
  });

  const attrs = purchaseButton?.[1] || "";
  const label = purchaseButton ? stripHtml(purchaseButton[2]) : "";
  const disabled =
    /(?:^|\s)disabled(?:\s|=|$)/i.test(attrs) ||
    /aria-disabled=["']true["']/i.test(attrs);

  const visibleUnavailable =
    /class=["'][^"']*message-info[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*(?:Unfortunately this product is no longer available|This product is currently unavailable|This item is currently unavailable|Sold out)/i.test(
      rawHtml,
    );

  const available =
    Boolean(purchaseButton) &&
    /\bAdd to (?:cart|bag)\b/i.test(label) &&
    !disabled &&
    !visibleUnavailable;

  return {
    ...candidate,
    available,
    purchaseAction: purchaseButton ? normalizeText(label) : "",
    purchaseButtonDisabled: disabled,
    visibleUnavailable,
  };
}

export async function scrapeFirecrawl(url, apiKey, format) {
  const formats = format === "rawHtml" ? ["rawHtml"] : ["markdown"];
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats,
      proxy: "basic",
      maxAge: 0,
      waitFor: 3000,
      onlyMainContent: false,
      removeBase64Images: true,
    }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Firecrawl returned non-JSON HTTP ${response.status}`);
  }

  if (!response.ok || payload?.success === false || !payload?.data) {
    throw new Error(
      `Firecrawl scrape failed HTTP ${response.status}: ${String(payload?.error || text).slice(0, 300)}`,
    );
  }

  const statusCode = payload.data.metadata?.statusCode;
  if (statusCode && statusCode !== 200) {
    throw new Error(`Firecrawl target returned HTTP ${statusCode}`);
  }

  const content = payload.data[format];
  if (typeof content !== "string") {
    throw new Error(`Firecrawl response is missing ${format}`);
  }
  return content;
}

function skuFromUrl(url) {
  return url.match(/-(H[A-Z0-9]+)\/?(?:\?|$)/i)?.[1]?.toUpperCase() || "";
}

function stripHtml(value) {
  return normalizeText(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function normalizeText(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
