import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMarkets } from '../src/check.mjs';
import { parseProductPageDocument, parseCategoryDocument } from '../src/hermes.mjs';

const source = code => `https://www.hermes.com/${code.toLowerCase()}/en/`;
function category(market, target = true) {
  return { source: 'firecrawl', rawHtml: '', metadata: { statusCode: 200, sourceURL: market.categoryUrl },
    markdown: Array.from({length: 5}, (_, i) => `[${i === 0 && target ? 'Kelly 25 bag' : 'So Medor bag'}](${source(market.code)}product/bag-H12345${i}/)\nPrice $5,000\nDiscover`).join('\n\n') + ' '.repeat(1500) };
}
function product(candidate, enabled = true) {
  return { source: 'firecrawl', markdown: '# Kelly 25 bag\n' + ' '.repeat(1500),
    rawHtml: `<button ${enabled ? '' : 'disabled'}>Add to bag</button>` + ' '.repeat(6000),
    metadata: { statusCode: 200, sourceURL: candidate.url, 'product:retailer_item_id': candidate.sku } };
}
function initial() {
  return { version: 1, products: Object.fromEntries(['US','CA'].map(market => [`${market}:H123450`, {
    market, sku: 'H123450', status: 'out_of_stock', changedAt: 'old'
  }])), meta: { initializedMarkets: ['US','CA'] } };
}
for (const failed of ['US', 'CA']) {
  test(`${failed} category failure preserves its state and allows the other market`, async () => {
    const input = initial();
    const r = await checkMarkets(input, { fetchCategory: async m => {
      if (m.code === failed) throw Error('HTTP 400'); return category(m);
    }, fetchProductPage: async p => product(p) });
    assert.equal(r.healthy, false);
    assert.deepEqual(r.state.products[`${failed}:H123450`], input.products[`${failed}:H123450`]);
    assert.equal(r.alerts.length, 1);
    assert.notEqual(r.alerts[0].market, failed);
    assert.equal(r.state.meta.markets[failed].status, 'unknown');
    assert.equal(input.products['US:H123450'].status, 'out_of_stock');
  });
}
test('both failures remain unhealthy with no product changes or alerts', async () => {
  const input = initial();
  const r = await checkMarkets(input, { fetchCategory: async () => { throw Error('blocked'); } });
  assert.equal(r.healthy, false);
  assert.deepEqual(r.state.products, input.products);
  assert.deepEqual(r.alerts, []);
  assert.deepEqual(r.state.meta.lastSuccessfulMarkets, []);
});
test('a complete category with zero requested targets is a healthy empty result', async () => {
  const input = initial();
  const r = await checkMarkets(input, { fetchCategory: async m => category(m, false) });
  assert.equal(r.healthy, true);
  assert.deepEqual(r.state.products, input.products);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.summaries[0].candidates, 0);
  assert.equal(r.summaries[1].candidates, 0);
});
test('category Discover still fetches each target and detects enabled buttons; repeat is silent', async () => {
  let count = 0;
  const options = { fetchCategory: async m => category(m), fetchProductPage: async p => { count++; return product(p); } };
  const r = await checkMarkets(initial(), options);
  assert.equal(count, 2);
  assert.equal(r.healthy, true);
  assert.equal(r.alerts.length, 2);
  assert.equal(r.summaries[0].evidence[0].purchaseAction, 'Add to cart / Add to bag');
  const repeat = await checkMarkets(r.state, options);
  assert.equal(repeat.alerts.length, 0);
});
test('product failure is not counted as verified or sold out', async () => {
  const input = initial();
  const r = await checkMarkets(input, { fetchCategory: async m => category(m), fetchProductPage: async p => {
    if (p.market === 'CA') throw Error('engines failed'); return product(p, false);
  } });
  assert.equal(r.healthy, false);
  assert.equal(r.summaries[1].verifiedTargets, 0);
  assert.deepEqual(r.state.products['CA:H123450'], input.products['CA:H123450']);
  assert.equal(r.alerts.length, 0);
});
const candidate = { market: 'CA', sku: 'H123450', url: source('CA') + 'product/bag-H123450/' };
test('rejects cross-market, missing source, missing status and wrong product URL', () => {
  for (const patch of [{sourceURL: source('US') + 'product/bag-H123450/'}, {sourceURL: ''}, {statusCode: undefined}, {sourceURL: source('CA') + 'product/other-H123450/'}]) {
    const doc = product(candidate); Object.assign(doc.metadata, patch);
    assert.throws(() => parseProductPageDocument(doc, candidate));
  }
});
test('a product without a button or explicit sold-out message is unknown', () => {
  const doc = product(candidate); doc.rawHtml = '<html>Hermes</html>' + ' '.repeat(6000);
  assert.throws(() => parseProductPageDocument(doc, candidate), /unknown/);
});
test('rejects US product links embedded in CA category', () => {
  const market = { code: 'CA', categoryUrl: source('CA') + 'category/bags/' };
  const doc = category(market); doc.markdown = doc.markdown.replaceAll('/ca/en/', '/us/en/');
  assert.throws(() => parseCategoryDocument(doc, market), /matching official market/);
});

test('CLI exits nonzero after saving healthy-market state; dry run does not save', async () => {
  const { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'hermes-test-'));
  try {
    await mkdir(join(dir, 'src'));
    await mkdir(join(dir, 'bin'));
    for (const file of ['monitor.mjs','check.mjs','hermes.mjs']) {
      await copyFile(new URL('../src/' + file, import.meta.url), join(dir, 'src', file));
    }
    const market = {code:'US',categoryUrl:source('US')+'category/bags/'};
    const doc = product({market:'US',sku:'H123450',url:source('US')+'product/bag-H123450/'}, false);
    await writeFile(join(dir,'bin','firecrawl'), '#!/usr/bin/env node\n' +
      `const url=process.argv[3]; if(url.includes('/ca/')) process.exit(1); console.log(JSON.stringify(url.includes('/category/') ? ${JSON.stringify(category(market))} : ${JSON.stringify(doc)}));`, {mode:0o755});
    const original = JSON.stringify(initial());
    await writeFile(join(dir,'state.json'),original);
    const env = {...process.env, PATH: join(dir,'bin')+':'+process.env.PATH, FIRECRAWL_CLI:'1',
      GITHUB_TOKEN:'test-only',GITHUB_REPOSITORY:'test/test',GITHUB_REPOSITORY_OWNER:'test', GITHUB_STEP_SUMMARY:'', DRY_RUN:'0'};
    const result = spawnSync(process.execPath, [join(dir,'src','monitor.mjs')], {env,encoding:'utf8'});
    assert.equal(result.status,1,result.stderr);
    const saved = JSON.parse(await readFile(join(dir,'state.json'),'utf8'));
    assert.deepEqual(saved.meta.lastSuccessfulMarkets,['US']);
    assert.equal(saved.meta.markets.CA.status,'unknown');
    assert.deepEqual(saved.products['CA:H123450'],initial().products['CA:H123450']);
    assert.equal(JSON.parse(await readFile(join(dir,'run-report.json'),'utf8')).healthy,false);
    await writeFile(join(dir,'state.json'),original);
    const dry = spawnSync(process.execPath,[join(dir,'src','monitor.mjs')],{env:{...env,DRY_RUN:'1'},encoding:'utf8'});
    assert.equal(dry.status,1);
    assert.equal(await readFile(join(dir,'state.json'),'utf8'),original);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
