import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fetchOfficialCatalog,categoryUrl} from '../src/ant-catalog-fetch.mjs';
import {parseHermesCatalog,reconcileCatalog} from '../src/ant-catalog.mjs';
import {checkCatalogMarkets} from '../src/ant-catalog-check.mjs';
const first=readFileSync(new URL('fixtures/ca-page1.html',import.meta.url),'utf8');
const second=readFileSync(new URL('fixtures/ca-page2.html',import.meta.url),'utf8');
const opts=(pages)=>({wait:async()=>{},fetcher:async url=>{
 const target=new URL(new URL(url).searchParams.get('url'));
 return new Response(pages[target.searchParams.get('page')||'1'],{status:200,headers:{'ant-credits-cost':'1'}});
}});
test('captured CA official 40 + 3 pagination reconciles 43 distinct SKUs',async()=>{
 assert.throws(()=>parseHermesCatalog(first,'CA'),/40 of 43/);
 const x=await fetchOfficialCatalog('CA','key',opts({'1':first,'2':second}));
 assert.equal(x.parsed.pageItems,43);assert.equal(x.parsed.skus.length,43);
 assert.deepEqual(x.parsed.pages.map(p=>p.pageItems),[40,3]);
 assert.equal(x.credits,2);assert.equal(x.mode,'paginated');
 assert.equal(x.parsed.products.length,0);
});
test('short final page is valid only as part of the complete catalog',()=>{
 assert.equal(parseHermesCatalog(second,'CA',{partial:true}).pageItems,3);
 assert.throws(()=>parseHermesCatalog(second,'CA'),/Incomplete category/);
});
test('missing next link, failed page, repeats, and total drift never verify a scan',async()=>{
 const variants=[
  {'1':first.replace(/<link rel="next"[^>]*>/,''),'2':second},
  {'1':first,'2':'blocked'},
  {'1':first,'2':first},
  {'1':first,'2':second.replace('"total":43','"total":44')},
 ];
 for(const pages of variants)await assert.rejects(fetchOfficialCatalog('CA','key',opts(pages)));
});
test('pagination cannot leave official market/category or loop',async()=>{
 for(const href of ['https://example.com/?page=2',categoryUrl('US')+'?page=2',categoryUrl('CA')+'?page=1',categoryUrl('CA')+'?page=2&page=2']){
 const bad=first.replace(/(<link rel="next" href=")[^"]+/,(_,p)=>p+href);
 await assert.rejects(fetchOfficialCatalog('CA','key',opts({'1':bad,'2':second})),/pagination/);
 }
});
test('category metadata alone never changes stock or alerts',()=>{
 const prev={available:{H12345678:{sku:'H12345678'}},catalogStocks:{H12345678:{ecom:true}},alertedSkus:{H12345678:'old'}};
 const out=reconcileCatalog(prev,{products:[{sku:'H12345678',ecom:false},{sku:'H87654321',ecom:true}]},'now');
 assert.deepEqual(out.available,prev.available);assert.deepEqual(out.catalogStocks,prev.catalogStocks);assert.equal(out.alerts.length,0);
});
test('CA incomplete failure preserves observations and does not suppress verified US alert',async()=>{
 const previous={markets:{CA:{available:{old:{sku:'old'}},catalogStocks:{old:{ecom:true}},alertedSkus:{old:'before'}}}};
 const result=await checkCatalogMarkets(previous,'key','now',{
  fetchCatalog:async market=>{if(market==='CA')throw new Error('40 of 43');return {parsed:{products:[{market:'US',sku:'H12345678',ecom:true,purchaseVerified:true}],pageItems:40,reportedTotal:40}};},
  verifyProducts:async p=>({...p,verificationErrors:[]}),
 });
 assert.equal(result.report.healthy,false);assert.equal(result.state.markets.US.status,'ok');
 assert.equal(result.state.markets.CA.status,'unknown');assert.deepEqual(result.state.markets.CA.available,previous.markets.CA.available);
 assert.deepEqual(result.state.markets.CA.catalogStocks,previous.markets.CA.catalogStocks);assert.equal(result.alerts.length,1);
});
test('unknown product preserves prior stock and cannot rearm alerts',async()=>{
 const prev={markets:{US:{available:{old:{sku:'old'}},catalogStocks:{old:{ecom:true}},alertedSkus:{old:'before'}}}};
 const result=await checkCatalogMarkets(prev,'key','now',{
  fetchCatalog:async()=>({parsed:{products:[{sku:'old',ecom:false}],pageItems:40,reportedTotal:40}}),
  verifyProducts:async p=>({...p,products:[],verificationErrors:[{sku:'old',error:'blocked'}]}),
 });
 assert.equal(result.report.healthy,false);assert.deepEqual(result.state.markets.US.available,prev.markets.US.available);
 assert.deepEqual(result.state.markets.US.catalogStocks,prev.markets.US.catalogStocks);assert.equal(result.alerts.length,0);
});
