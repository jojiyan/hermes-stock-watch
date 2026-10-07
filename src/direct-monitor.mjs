import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMarkets } from './check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.env.DRY_RUN === '1';
const statePath = resolve(root, 'direct-state.json');
const repository = process.env.GITHUB_REPOSITORY;
const owner = process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.GITHUB_TOKEN;
if (!dryRun && (!repository || !owner || !token)) throw new Error('Missing GitHub notification configuration');
const oldState = JSON.parse(await readFile(statePath, 'utf8'));
// Preserve the existing stock baseline and last successful market timestamps.
oldState.meta ||= { initializedMarkets: oldState.initializedMarkets || [], markets: oldState.markets || {} };
const worker = spawn(process.env.SCRAPLING_PYTHON || resolve(root, '.venv/bin/python'), [resolve(root, 'src/scrapling_fetch.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
let pending;
let workerError;
let diagnostic = '';
worker.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-3000); });
function fail(error) { workerError = error; if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; } }
worker.on('error', fail);
worker.stdin.on('error', fail);
worker.on('exit', code => fail(new Error(`Scrapling worker exited (${code}): ${diagnostic.slice(-500)}`)));
createInterface({ input: worker.stdout }).on('line', line => {
  if (!pending) return;
  const call = pending; pending = null; clearTimeout(call.timer);
  try { call.resolve(JSON.parse(line)); } catch { call.reject(new Error('Invalid fetcher JSON')); }
});
async function fetchPage(url, code) {
  if (workerError) throw workerError;
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { fail(new Error('Scrapling fetch timed out')); worker.kill(); }, 65000);
    pending = { resolve, reject, timer };
    worker.stdin.write(JSON.stringify({ url }) + '\n');
  });
  if (response.error) throw new Error(`${code}: ${response.error}`);
  const title = response.html?.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.slice(0, 120) || '';
  console.log(JSON.stringify({ market: code, status: response.status, url: response.url, chars: response.html?.length, title }));
  if (response.status !== 200) throw new Error(`${code}: HTTP ${response.status}; ${title}`);
  const final = new URL(response.url);
  if (final.origin !== 'https://www.hermes.com' || !final.pathname.startsWith(`/${code.toLowerCase()}/en/`)) throw new Error(`${code}: unexpected redirect`);
  if (new URL(url).pathname !== final.pathname) throw new Error(`${code}: redirected away from requested page`);
  return response.html;
}
let result;
try {
  result = await checkMarkets(oldState, {
    fetchCategory: market => fetchPage(market.categoryUrl, market.code),
    fetchProductPage: product => fetchPage(product.url, product.market),
  });
} finally { worker.stdin.end(); worker.kill(); }
const { state, ...report } = result;
await writeFile(resolve(root, 'direct-run-report.json'), JSON.stringify({ provider: 'Scrapling (no credits)', ...report }, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\nVerification: **${report.healthy ? 'US + CA verified' : 'INCOMPLETE — stock unknown for failed markets'}**\n\n\`\`\`json\n${JSON.stringify(report.summaries, null, 2)}\n\`\`\`\n`);
if (!dryRun) {
  // An unavailable market must not suppress a verified alert from the other one.
  for (const product of report.alerts) await notifyStock(product);
  state.initializedMarkets = state.meta.initializedMarkets;
  state.markets = state.meta.markets;
  state.lastCheckedAt = report.checkedAt;
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
}
// Stock access failures are recorded as unknown, without routine failure emails.
// Push/manual validation still fails so a deployment cannot appear verified.
if (!report.healthy && process.env.GITHUB_EVENT_NAME !== 'schedule') process.exitCode = 1;

async function notifyStock(product) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'hermes-stock-watch' };
  const marker = `<!-- stock:${product.key}:${oldState.products[product.key]?.changedAt || 'new'} -->`;
  // A retry after an uncertain delivery must not send a second identical alert.
  const prior = await fetch(`https://api.github.com/repos/${repository}/issues?state=all&per_page=100`, { headers });
  if (!prior.ok) throw new Error(`Unable to verify notification deduplication (${prior.status})`);
  if ((await prior.json()).some(issue => issue.body?.includes(marker))) return;
  const response = await fetch(`https://api.github.com/repos/${repository}/issues`, {
    method: 'POST', headers,
    body: JSON.stringify({
      title: ['🟠 Hermès 有货', product.market, product.name, product.color].filter(Boolean).join('｜'),
      body: [`@${owner}`, '', `- 包款：${product.name}`, `- 地区：${product.market}`, `- 颜色：${product.color || ''}`, `- 价格：${product.price || ''}`, `- SKU：${product.sku}`, `- 购买链接：${product.url}`, '- 验证：官网商品页SKU匹配，Add to cart / Add to bag按钮已启用。', `- 检测时间：${report.checkedAt}`, '', marker].join('\n'),
      assignees: [owner],
    }),
  });
  if (!response.ok) throw new Error(`Stock notification failed (${response.status})`);
}
