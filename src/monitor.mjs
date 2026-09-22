import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  MARKETS,
  fetchCategory,
  fetchProductPage,
  parseCategoryHtml,
  parseProductPageHtml,
} from "./hermes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const statePath = resolve(here, "../state.json");
const dryRun = /^(1|true|yes)$/i.test(process.env.DRY_RUN || "");
const repository = process.env.GITHUB_REPOSITORY || "";
const token = process.env.GITHUB_TOKEN || "";
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER || "";

const state = JSON.parse(await readFile(statePath, "utf8"));
state.version = 1;
state.products ||= {};
state.meta ||= {};

const now = new Date();
const nowIso = now.toISOString();
const successfulMarkets = new Set();
const seenTargetKeys = new Set();
const alerts = [];
const summaries = [];
const initializedMarkets = new Set(state.meta.initializedMarkets || []);

for (const market of MARKETS) {
  try {
    const html = await fetchCategory(market);
    const products = parseCategoryHtml(html, market);
    const candidates = products.filter((product) => product.target);
    const targets = [];
    const verificationErrors = [];
    const marketIsInitializing = !initializedMarkets.has(market.code);
    successfulMarkets.add(market.code);

    for (const candidate of candidates) {
      seenTargetKeys.add(candidate.key);

      let product;
      try {
        const productHtml = await fetchProductPage(candidate);
        product = parseProductPageHtml(productHtml, candidate);
        targets.push(product);
      } catch (error) {
        verificationErrors.push({ sku: candidate.sku, error: error.message });
        continue;
      }

      const nextStatus = product.available ? "in_stock" : "out_of_stock";
      const previous = state.products[product.key];

      if (
        !marketIsInitializing &&
        product.available &&
        previous?.status !== "in_stock"
      ) {
        alerts.push(product);
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
        state.products[product.key] = {
          market: product.market,
          sku: product.sku,
          name: product.name,
          color: product.color,
          material: product.material,
          price: product.price,
          url: product.url,
          status: nextStatus,
          changedAt: nowIso,
        };
      }
    }

    if (verificationErrors.length === 0) {
      initializedMarkets.add(market.code);
    }

    summaries.push({
      market: market.code,
      products: products.length,
      candidates: candidates.length,
      verifiedTargets: targets.length,
      availableTargets: targets.filter((product) => product.available).length,
      verificationErrors,
    });
  } catch (error) {
    summaries.push({ market: market.code, error: error.message });
  }
}

for (const [key, product] of Object.entries(state.products)) {
  if (!successfulMarkets.has(product.market) || seenTargetKeys.has(key)) continue;
  if (product.status !== "not_listed") {
    product.status = "not_listed";
    product.changedAt = nowIso;
  }
}

const keepAliveAt = state.meta.keepAliveAt
  ? new Date(state.meta.keepAliveAt).getTime()
  : 0;
if (!keepAliveAt || now.getTime() - keepAliveAt >= 30 * 24 * 60 * 60 * 1000) {
  state.meta.keepAliveAt = nowIso;
}
state.meta.lastSuccessfulMarkets = [...successfulMarkets];
state.meta.initializedMarkets = [...initializedMarkets];

console.log(JSON.stringify({ checkedAt: nowIso, summaries, alerts }, null, 2));

if (dryRun) process.exit(0);

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
  const titleParts = [
    "🟠 Hermès 有货",
    product.market,
    product.name,
    product.color,
  ].filter(Boolean);

  const body = [
    `@${repositoryOwner}`,
    "",
    "Hermès 官网刚刚显示这个包可以购买：",
    "",
    `- 地区：${product.marketName}`,
    `- 包款：${product.name}`,
    product.color ? `- 颜色：${product.color}` : "",
    product.material ? `- 材质：${product.material}` : "",
    product.price ? `- 价格：${product.price}` : "",
    `- SKU：${product.sku}`,
    `- 购买链接：${product.url}`,
    `- 检测时间：${nowIso}`,
    "",
    "同一库存状态只提醒一次；售罄后再次补货会重新提醒。",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(`https://api.github.com/repos/${repository}/issues`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "hermes-stock-watch",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ title: titleParts.join("｜"), body }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Unable to create GitHub stock alert (${response.status}): ${detail.slice(0, 500)}`,
    );
  }
}
