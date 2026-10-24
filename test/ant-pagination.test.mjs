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
 assert.equal(x.credits,3);assert.equal(x.mode,'paginated');
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
test('a cross-market redirect or wrong-page canonical is rejected even with valid stock fields',async()=>{
 for(const bad of [first.replace('/ca/en/','/us/en/'),first.replace('rel="canonical" href="https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/"','rel="canonical" href="https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/"')])
  await assert.rejects(fetchOfficialCatalog('CA','key',opts({'1':bad,'2':second})),/canonical URL\/market\/page mismatch/);
});
test('blocked ScrapingAnt pagination may recover only through the same verified official HTML',async()=>{
 const x=await fetchOfficialCatalog('CA','key',{
  wait:async()=>{},fetcher:async url=>new Response(new URL(new URL(url).searchParams.get('url')).search?'blocked':first,{status:new URL(new URL(url).searchParams.get('url')).search?423:200}),
  directFetcher:async url=>{assert.equal(url,categoryUrl('CA')+'?page=2');return new Response(second)},
 });
 assert.equal(x.parsed.pageItems,43);assert.equal(x.attempts.at(-2).mode,'direct-official');
 assert.equal(x.attempts.filter(a=>a.status===423).length,4);
 await assert.rejects(fetchOfficialCatalog('CA','key',{
  wait:async()=>{},fetcher:async()=>new Response('blocked',{status:423}),directFetcher:async()=>new Response('blocked',{status:403}),
 }),/Direct official HTTP 403/);
});
test('equivalent official page delimiter still reconciles the original canonical page',async()=>{
 const x=await fetchOfficialCatalog('CA','key',{wait:async()=>{},fetcher:async url=>{
  const target=new URL(url).searchParams.get('url');
  if(!target.includes('?'))return new Response(first);
  return target.endsWith('&')?new Response(second):new Response('blocked',{status:423});
 }});
 assert.equal(x.parsed.pageItems,43);assert.equal(x.parsed.pages[1].mode,'low-credit-page-delimiter');
 assert.equal(x.attempts.at(-2).url,categoryUrl('CA')+'?page=2&');
});


test('US incomplete 43/44 restarts at page one and accepts only a fresh complete scan',async()=>{
 let scan=0; const urls=[];
 const result=await fetchOfficialCatalog('US','key',{
  wait:async()=>{},parser:JSON.parse,fetcher:async url=>{
   const target=new URL(new URL(url).searchParams.get('url'));
   const page=Number(target.searchParams.get('page')||1);urls.push(page);
   if(page===1)scan++;
   const partial=scan===1;
   const start=page===1?0:40, end=page===1?(partial?39:40):44;
   return new Response(JSON.stringify({products:[],pageItems:end-start,reportedTotal:44,
    skus:Array.from({length:end-start},(_,i)=>`sku${start+i}`),next:page===1?'?page=2':null}));
  },
 });
 assert.deepEqual(urls,[1,2,1,2,1]);
 assert.equal(result.parsed.pageItems,44);assert.equal(result.parsed.skus.length,44);
 assert.deepEqual(result.scans.map(s=>s.status),['unknown','verified']);
});
test('persistent incomplete scans stop after three and retain all attempt evidence',async()=>{
 let calls=0;
 await assert.rejects(fetchOfficialCatalog('US','key',{wait:async()=>{},parser:JSON.parse,
  fetcher:async()=>{calls++;return new Response(JSON.stringify({products:[],pageItems:43,reportedTotal:44,next:null}));},
 }),e=>{assert.equal(e.scans.length,3);assert.equal(e.attempts.length,3);return /43 of 44/.test(e.message);});
 assert.equal(calls,3);
});
test('closing first-page total drift forces a whole fresh scan',async()=>{
 let calls=0;const totals=[2,2,3,2,2,2];
 const result=await fetchOfficialCatalog('US','key',{wait:async()=>{},parser:JSON.parse,
  fetcher:async url=>{
   const secondPage=new URL(new URL(url).searchParams.get('url')).searchParams.has('page');
   return new Response(JSON.stringify({products:[],pageItems:1,reportedTotal:totals[calls++],
    skus:[secondPage?'second':'first'],next:secondPage?null:'?page=2'}));
  },
 });
 assert.equal(calls,6);assert.equal(result.scans.length,2);assert.equal(result.parsed.reportedTotal,2);
});
test('US partial purchase failure suppresses all US alerts, preserves history and leaves CA independent',async()=>{
 const prior={version:2,markets:{US:{lastSuccessAt:'before',catalogStocks:{old:{ecom:false,seenAt:'before'}},alertedSkus:{old:'before'},available:{}}}};
 const out=await checkCatalogMarkets(prior,'key','now',{
  fetchCatalog:async market=>({parsed:{products:[{market,sku:'new',ecom:true,purchaseVerified:true}],pageItems:1,reportedTotal:1}}),
  verifyProducts:async p=>({...p,verificationErrors:p.products[0].market==='US'?[{error:'blocked'}]:[]}),
 });
 assert.equal(out.state.version,3);assert.equal(out.state.markets.US.status,'unknown');
 assert.deepEqual(out.state.markets.US.catalogStocks,prior.markets.US.catalogStocks);
 assert.deepEqual(out.state.markets.US.alertedSkus,prior.markets.US.alertedSkus);
 assert.deepEqual(out.state.markets.US.currentStocks,{});
 assert.equal(out.state.markets.US.lastSuccessAt,'before');
 assert.deepEqual(out.alerts.map(p=>p.market),['CA']);
 assert.equal(out.report.executionStatus,'completed');assert.equal(out.report.verificationStatus,'unverified');
 assert.equal(prior.version,2);
});
