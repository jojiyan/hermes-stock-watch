import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCategoryHtml, parseProductPageHtml } from "./hermes.mjs";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const statePath = resolve(here, "../direct-state.json");
const reportPath = resolve(here, "../direct-run-report.json");
const repository = process.env.GITHUB_REPOSITORY || "";
const token = process.env.GITHUB_TOKEN || "";
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER || "";

if (!repository || !token || !repositoryOwner) {
  throw new Error("GitHub repository credentials are missing");
}

const MARKETS = [
  {
    code: "US",
    name: "Hermès USA",
    origin: "https://www.hermes.com",
    categoryUrl: "https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
  },
  {
    code: "CA",
    name: "Hermès Canada",
    origin: "https://www.hermes.com",
    categoryUrl: "https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
  },
];

const TARGET_PATTERNS = [
  /\bneo garden 23\b/i,
  /\bgarden party 30\b/i,
  /\bbolide mini\b/i,
  /\bmini bolide\b/i,
  /\blindy(?: ii)? mini\b/i,
  /\bmini lindy\b/i,
  /\bpicotin\b/i,
  /\bbirkin\b/i,
  /\bkelly\b/i,
  /\bconstance\b/i,
];

const BLOCK_RE = /sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|robot challenge|enable javascript and cookies/i;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const state = JSON.parse(await readFile(statePath, "utf8").catch(() => '{"version":1,"initializedMarkets":[],"products":{},"markets":{}}'));
state.version = 1;
state.initializedMarkets ||= [];
state.products ||= {};
state.markets ||= {};

const initialized = new Set(state.initializedMarkets);
const chrome = await resolveChrome();
const checkedAt = new Date().toISOString();
const summaries = [];
const alerts = [];
let healthyMarkets = 0;

for (const market of MARKETS) {
  const previousMarket = state.markets[market.code] || {};
  try {
    const categoryHtml = await dumpDom(chrome, market.categoryUrl, `${market.code}-category`, 18000);
    validatePage(categoryHtml, market, "category", 25000);

    const parsed = parseCategoryHtml(categoryHtml, market)
      .map((product) => ({ ...product, target: isTarget(product.name) }));
    const candidates = parsed.filter((product) => product.target);
    const categoryAvailable = candidates.filter((product) => product.available);
    const verificationErrors = [];
    const evidence = [];
    const pendingUpdates = new Map();
    const pendingAlerts = [];
    const seenKeys = new Set();
    const marketInitializing = !initialized.has(market.code);

    for (const candidate of candidates) {
      seenKeys.add(candidate.key);

      if (!candidate.available) {
        const previous = state.products[candidate.key];
        pendingUpdates.set(candidate.key, buildState(candidate, "out_of_stock", checkedAt, previous));
        continue;
      }

      try {
        const productHtml = await dumpDom(chrome, candidate.url, `${market.code}-${candidate.sku}`, 14000);
        validatePage(productHtml, market, "product", 5000);
        const verified = parseProductPageHtml(productHtml, candidate);
        const nextStatus = verified.available ? "in_stock" : "out_of_stock";
        const previous = state.products[verified.key];

        evidence.push({
          sku: verified.sku,
          url: verified.url,
          available: verified.available,
          purchaseAction: verified.purchaseAction || "",
          purchaseButtonDisabled: verified.purchaseButtonDisabled ?? null,
        });

        pendingUpdates.set(verified.key, buildState(verified, nextStatus, checkedAt, previous));

        if (!marketInitializing && verified.available && previous?.status !== "in_stock") {
          pendingAlerts.push(verified);
        }
      } catch (error) {
        verificationErrors.push({ sku: candidate.sku, url: candidate.url, error: error.message });
      }
    }

    // If a previously in-stock product disappears from a healthy category, do not
    // immediately declare it sold out. Require two consecutive healthy misses.
    for (const [key, previous] of Object.entries(state.products)) {
      if (previous.market !== market.code || previous.status !== "in_stock" || seenKeys.has(key)) continue;
      const misses = Number(previous.missingHealthyChecks || 0) + 1;
      if (misses >= 2) {
        pendingUpdates.set(key, { ...previous, status: "out_of_stock", changedAt: checkedAt, missingHealthyChecks: 0 });
      } else {
        pendingUpdates.set(key, { ...previous, missingHealthyChecks: misses, lastCheckedAt: checkedAt });
      }
    }

    if (verificationErrors.length === 0) {
      for (const [key, value] of pendingUpdates) state.products[key] = value;
      if (!marketInitializing) alerts.push(...pendingAlerts);
      initialized.add(market.code);
      healthyMarkets += 1;
    }

    state.markets[market.code] = {
      status: verificationErrors.length === 0 ? "ok" : "partial",
      lastCheckedAt: checkedAt,
      lastSuccessAt: verificationErrors.length === 0 ? checkedAt : previousMarket.lastSuccessAt || null,
      products: parsed.length,
      candidates: candidates.length,
      categoryAvailable: categoryAvailable.length,
      verifiedTargets: evidence.length,
      availableTargets: evidence.filter((item) => item.available).length,
      verificationErrors,
      committed: verificationErrors.length === 0,
    };

    summaries.push({
      market: market.code,
      products: parsed.length,
      candidates: candidates.length,
      categoryAvailable: categoryAvailable.length,
      verifiedTargets: evidence.length,
      availableTargets: evidence.filter((item) => item.available).length,
      verificationErrors,
      evidence,
      committed: verificationErrors.length === 0,
    });
  } catch (error) {
    state.markets[market.code] = {
      ...previousMarket,
      status: "unknown",
      lastCheckedAt: checkedAt,
      error: error.message,
    };
    summaries.push({ market: market.code, error: error.message, committed: false });
  }
}

state.initializedMarkets = [...initialized];
state.lastCheckedAt = checkedAt;

const healthy = healthyMarkets === MARKETS.length;
const report = { checkedAt, chrome, healthy, summaries, alerts };
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));

if (healthy) {
  for (const product of alerts) await createStockIssue(product);
}

await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

if (!healthy) {
  throw new Error("Incomplete direct-browser market verification; successful market state was preserved.");
}

function isTarget(name) {
  const normalized = String(name || "").normalize("NFKD").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  return TARGET_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildState(product, status, now, previous) {
  return {
    market: product.market,
    sku: product.sku,
    name: product.name,
    color: product.color || "",
    material: product.material || previous?.material || "",
    price: product.price || previous?.price || "",
    url: product.url,
    status,
    changedAt: previous?.status === status ? previous.changedAt || now : now,
    lastCheckedAt: now,
    missingHealthyChecks: 0,
  };
}

function validatePage(html, market, kind, minLength) {
  if (typeof html !== "string" || html.length < minLength) {
    throw new Error(`${market.code}: ${kind} DOM is unexpectedly short (${html?.length || 0} chars)`);
  }
  if (BLOCK_RE.test(html)) {
    throw new Error(`${market.code}: ${kind} returned an access-block/challenge page`);
  }
  const lower = html.toLowerCase();
  if (!lower.includes("hermes") && !lower.includes("hermès")) {
    throw new Error(`${market.code}: ${kind} DOM does not look like an Hermès page`);
  }
}

async function resolveChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`No usable Chrome/Chromium binary found. Tried: ${candidates.join(", ")}`);
}

async function dumpDom(chromePath, url, label, virtualTimeBudget) {
  const profileDir = await mkdtemp(join(tmpdir(), `hermes-${label}-`));
  try {
    const args = [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--disable-features=TranslateUI",
      "--disable-blink-features=AutomationControlled",
      "--metrics-recording-only",
      "--no-first-run",
      "--mute-audio",
      "--lang=en-US",
      "--window-size=1440,2200",
      `--user-agent=${UA}`,
      `--user-data-dir=${profileDir}`,
      `--virtual-time-budget=${virtualTimeBudget}`,
      "--dump-dom",
      url,
    ];

    const { stdout } = await execFileAsync(chromePath, args, {
      timeout: 90000,
      maxBuffer: 30 * 1024 * 1024,
      env: { ...process.env, HOME: profileDir },
    });
    return stdout;
  } catch (error) {
    const detail = String(error.stderr || error.message || error).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Chrome failed for ${label}: ${detail}`);
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
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
    product.material ? `- 材质：${product.material}` : "",
    product.price ? `- 价格：${product.price}` : "",
    `- SKU：${product.sku}`,
    `- 购买链接：${product.url}`,
    "- 验证：GitHub Actions 本地 Chrome 打开 Hermès 官方商品页，SKU 匹配且存在启用状态 Add to cart / Add to bag",
    `- 检测时间：${checkedAt}`,
    "",
    "同一持续在售状态只提醒一次；售罄后再次补货会重新提醒。",
  ].filter(Boolean).join("\n");

  const response = await fetch(`https://api.github.com/repos/${repository}/issues`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "hermes-stock-watch-direct",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ title, body, assignees: [repositoryOwner] }),
  });

  if (!response.ok) {
    throw new Error(`Unable to create GitHub stock alert (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }
}
