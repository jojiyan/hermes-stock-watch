import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  MARKETS,
  parseCategoryMarkdown,
  parseProductRawHtml,
  scrapeFirecrawl,
} from "./firecrawl.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const statePath = resolve(here, "../state.json");
const apiKey = process.env.FIRECRAWL_API_KEY || "";
const repository = process.env.GITHUB_REPOSITORY || "";
const token = process.env.GITHUB_TOKEN || "";
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER || "";

if (!apiKey) {
  console.log("FIRECRAWL_API_KEY is not configured; skipping live stock check.");
  process.exit(0);
}

const state = JSON.parse(await readFile(statePath, "utf8"));
state.version = 2;
state.products ||= {};
state.meta ||= {};

const nowIso = new Date().toISOString();
const initializedMarkets = new Set(state.meta.initializedMarkets || []);
const successfulMarkets = new Set();
const alerts = [];
const summaries = [];

for (const market of MARKETS) {
  try {
    const categoryMarkdown = await scrapeFirecrawl(
      market.categoryUrl,
      apiKey,
      "markdown",
    );
    const products = parseCategoryMarkdown(categoryMarkdown, market);
    const candidates = products.filter((product) => product.target);
    const marketIsInitializing = !initializedMarkets.has(market.code);
    const updates = new Map();
    const seenKeys = new Set();
    const pendingAlerts = [];
    const verificationErrors = [];
    let productPageChecks = 0;

    for (const candidate of candidates) {
      seenKeys.add(candidate.key);
      let verified = {
        ...candidate,
        available: false,
        purchaseAction: "",
        purchaseButtonDisabled: true,
        visibleUnavailable: candidate.discoverOnly,
      };

      if (!candidate.discoverOnly) {
        productPageChecks += 1;
        try {
          const rawHtml = await scrapeFirecrawl(candidate.url, apiKey, "rawHtml");
          verified = parseProductRawHtml(rawHtml, candidate);
        } catch (error) {
          verificationErrors.push({
            sku: candidate.sku,
            error: error.message,
          });
          continue;
        }
      }

      const nextStatus = verified.available ? "in_stock" : "out_of_stock";
      const previous = state.products[candidate.key];

      if (
        !marketIsInitializing &&
        verified.available &&
        previous?.status !== "in_stock"
      ) {
        pendingAlerts.push(verified);
      }

      updates.set(candidate.key, {
        market: candidate.market,
        sku: candidate.sku,
        name: candidate.name,
        color: candidate.color,
        price: candidate.price,
        url: candidate.url,
        status: nextStatus,
        changedAt:
          !previous || previous.status !== nextStatus
            ? nowIso
            : previous.changedAt || nowIso,
      });
    }

    if (verificationErrors.length > 0) {
      summaries.push({
        market: market.code,
        products: products.length,
        candidates: candidates.length,
        productPageChecks,
        verificationErrors,
        committed: false,
      });
      continue;
    }

    for (const [key, value] of updates) state.products[key] = value;

    for (const [key, product] of Object.entries(state.products)) {
      if (product.market !== market.code || seenKeys.has(key)) continue;
      if (product.status !== "not_listed") {
        product.status = "not_listed";
        product.changedAt = nowIso;
      }
    }

    successfulMarkets.add(market.code);
    initializedMarkets.add(market.code);
    alerts.push(...pendingAlerts);

    summaries.push({
      market: market.code,
      products: products.length,
      candidates: candidates.length,
      productPageChecks,
      availableTargets: [...updates.values()].filter(
        (product) => product.status === "in_stock",
      ).length,
      committed: true,
    });
  } catch (error) {
    summaries.push({
      market: market.code,
      error: error.message,
      committed: false,
    });
  }
}

state.meta.initializedMarkets = [...initializedMarkets];
state.meta.lastSuccessfulMarkets = [...successfulMarkets];
state.meta.lastCheckedAt = nowIso;
state.meta.source = "firecrawl-basic";

console.log(
  JSON.stringify(
    {
      checkedAt: nowIso,
      summaries,
      alerts: alerts.map((product) => ({
        market: product.market,
        sku: product.sku,
        name: product.name,
        color: product.color,
        price: product.price,
        url: product.url,
      })),
    },
    null,
    2,
  ),
);

if (successfulMarkets.size === 0) {
  throw new Error("Both Hermès markets failed; state was left unchanged");
}

if (!repository || !token || !repositoryOwner) {
  throw new Error("GitHub repository credentials are missing");
}

for (const product of alerts) {
  await createStockIssue(product);
}

await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

async function createStockIssue(product) {
  const title = [
    "🟠 Hermès 有货",
    product.market,
    product.name,
    product.color,
  ]
    .filter(Boolean)
    .join("｜");

  const body = [
    `@${repositoryOwner}`,
    "",
    "Hermès 官方商品页刚刚确认可以在线购买：",
    "",
    `- 地区：${product.marketName}`,
    `- 包款：${product.name}`,
    product.color ? `- 颜色：${product.color}` : "",
    product.price ? `- 价格：${product.price}` : "",
    `- SKU：${product.sku}`,
    `- 购买页：${product.url}`,
    `- 检测时间：${nowIso}`,
    "",
    "判定规则：官方商品页存在可用的 Add to cart / Add to bag 按钮，按钮不是 disabled/aria-disabled=true，且页面没有明确 unavailable/sold out 状态。",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(
    `https://api.github.com/repos/${repository}/issues`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "hermes-stock-watch",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ title, body }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Unable to create GitHub stock alert (${response.status}): ${detail.slice(0, 500)}`,
    );
  }
}
