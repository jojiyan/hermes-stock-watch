import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { checkMarkets } from "./check.mjs";

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

const { checkedAt: nowIso, summaries, alerts, healthy, state: nextState } = await checkMarkets(state);
const report = { checkedAt: nowIso, summaries, alerts, healthy };
await writeFile(resolve(here, "../run-report.json"), JSON.stringify(report, null, 2) + "\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY,
    "## Market verification\n\n```json\n" + JSON.stringify(report, null, 2) + "\n```\n");
}
console.log(JSON.stringify({ checkedAt: nowIso, summaries, alerts }, null, 2));

if (dryRun) process.exit(healthy ? 0 : 1);

if (!repository || !token || !repositoryOwner) {
  throw new Error("GitHub repository credentials are missing");
}

for (const product of alerts) {
  await createStockIssue(product);
}

await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");

if (!healthy) {
  throw new Error("Incomplete market verification; inspect run-report.json. Successful market state was preserved.");
}

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
    body: JSON.stringify({
      title: titleParts.join("｜"),
      body,
      assignees: [repositoryOwner],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Unable to create GitHub stock alert (${response.status}): ${detail.slice(0, 500)}`,
    );
  }
}

