import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fetchOfficialCatalog} from '../src/ant-catalog-fetch.mjs';
import {parseHermesCatalog,isRequestedBag} from '../src/ant-catalog.mjs';

const read=name=>readFileSync(new URL('fixtures/'+name,import.meta.url),'utf8');
const first=read('us-gap-page1.html'),second=read('us-gap-page2.html'),facet=read('us-gap-so-medor.html');
function replay(transform=(_kind,html)=>html){
  const calls=[];
  return {calls,options:{wait:async()=>{},fetcher:async url=>{
    const target=new URL(new URL(url).searchParams.get('url'));
    const kind=target.searchParams.has('facet_line')?'facet':target.searchParams.has('page')?'second':'first';
    calls.push(kind);
    return new Response(transform(kind,{first,second,facet}[kind],calls),{headers:{'ant-credits-cost':'1'}});
  }}};
}
function changeState(html,fn){
  return html.replace(/(<script id="hermes-state">)([\s\S]*?)(<\/script>)/,
    (_,start,json,end)=>{const state=JSON.parse(json);fn(state.captured.b);return start+JSON.stringify(state)+end;});
}

test('captured US 39+9 gap recovers missing So Medor via published official facet and verifies all 49 unique SKUs',async()=>{
  const {options,calls}=replay();
  const result=await fetchOfficialCatalog('US','key',options);
  assert.equal(result.parsed.pageItems,49);
  assert.equal(result.parsed.skus.length,49);
  assert.equal(result.parsed.records.length,49);
  assert.equal(result.parsed.records.find(p=>p.sku==='H085054CK37').name,'So Medor bag');
  assert.equal(result.parsed.products.length,3);
  assert.ok(result.parsed.products.every(p=>!p.ecom));
  assert.equal(result.mode,'facet-recovered');
  assert.equal(result.parsed.pages.at(-1).addedSkus,1);
  assert.equal(result.credits,5);
  assert.deepEqual(calls,['first','second','facet','first','facet']);
});

test('a repeated short official facet cannot relax the unfiltered total',async()=>{
  const {options}=replay((kind,html)=>kind==='facet'?changeState(html,b=>b.products.items.pop()):html);
  await assert.rejects(fetchOfficialCatalog('US','key',options),/recovery facet is incomplete/);
});

test('overlapping SKU stock disagreements invalidate recovery',async()=>{
  const {options}=replay((kind,html)=>kind==='facet'?changeState(html,b=>b.products.items[0].stock.ecom=false):html);
  await assert.rejects(fetchOfficialCatalog('US','key',options),/Conflicting SKU metadata/);
});

test('a changed closing recovery page cannot establish a stable inventory',async()=>{
  const {options}=replay((kind,html,calls)=>kind==='facet'&&calls.filter(x=>x==='facet').length%2===0?
    changeState(html,b=>b.products.items[1].stock.ecom=true):html);
  await assert.rejects(fetchOfficialCatalog('US','key',options),/recovery facet changed during closing/);
});

test('external or unpublished facet links never trigger a recovery request',async()=>{
  const {options,calls}=replay((kind,html)=>kind==='first'?html.replaceAll(
    'https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/?facet_line=so_medor',
    'https://example.com/?facet_line=so_medor'):html);
  await assert.rejects(fetchOfficialCatalog('US','key',options),/48 of 49/);
  assert.ok(calls.every(x=>x!=='facet'));
});

test('wrong-market or canonical recovery pages remain unknown',async()=>{
  const {options}=replay((kind,html)=>kind==='facet'?html.replace('<base href="/us/en/">','<base href="/ca/en/">'):html);
  await assert.rejects(fetchOfficialCatalog('US','key',options),/canonical URL\/market\/page mismatch/);
});

test('missing official titles fail instead of silently skipping a potential target',()=>{
  assert.throws(()=>parseHermesCatalog(changeState(first,b=>delete b.products.items[0].title),'US',{partial:true}),
    /Missing official product title/);
});

test('target matching accepts hyphens, Unicode spacing and accents without including excluded sizes',()=>{
  assert.equal(isRequestedBag('Néo-Garden\u00a023 bag'),true);
  assert.equal(isRequestedBag('Lindy-II mini bag'),true);
  assert.equal(isRequestedBag('Garden Party 36 bag'),false);
  assert.equal(isRequestedBag('Neo Garden Voyage 41 bag'),false);
});
