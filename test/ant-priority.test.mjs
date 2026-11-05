import test from 'node:test';
import assert from 'node:assert/strict';
import {stockPriority, prioritizeProducts, priorityWatchCandidates} from '../src/ant-priority.mjs';
import {checkCatalogMarkets} from '../src/ant-catalog-check.mjs';

test('Garden 23 favourite colours match exact selected names, including accents and two-tone versions',()=>{
  for(const color of ['Bleu Paradis','bleu paradis/bleu paradis','天堂蓝'])
    assert.equal(stockPriority({name:'Neo Garden 23 bag',color}).rank,1);
  for(const color of ['Bleu Zéphyr','Bleu Zephyr','微风蓝'])
    assert.equal(stockPriority({name:'Neo Garden 23 bag',color}).rank,2);
  for(const color of ['Blue','Bleu Brume','Bleu Hydra','Not Bleu Paradis','Bleu Paradis-like'])
    assert.equal(stockPriority({name:'Neo Garden 23 bag',color}).label,'');
  for(const name of ['Garden Party 30 bag','Neo Garden Voyage 41 bag','Picotin 18 bag'])
    assert.equal(stockPriority({name,color:'Bleu Paradis'}).label,'');
});

test('favourite Garden colours are checked and sent first while other targets remain',()=>{
  const products=[{name:'Picotin 18 bag',color:'Blue'},
    {name:'Neo Garden 23 bag',color:'Blue'},
    {name:'Neo Garden 23 bag',color:'Bleu Zéphyr'},
    {name:'Garden Party Mini bag',color:'Bleu Paradis'}];
  assert.deepEqual(prioritizeProducts(products),[products[3],products[2],products[1],products[0]]);
  assert.equal(products[0].name,'Picotin 18 bag');
});

test('direct-watch candidates contain no claimed colour or stock and stay within each market',()=>{
  for(const market of ['US','CA']) {
    const [p]=priorityWatchCandidates(market);
    assert.equal(p.color,'');assert.equal(p.ecom,undefined);assert.equal(p.purchaseVerified,undefined);
    assert.ok(p.url.startsWith('https://www.hermes.com/'+market.toLowerCase()+'/en/product/'));
  }
  assert.throws(()=>priorityWatchCandidates('UK'));
});

test('an unlisted priority URL is still checked, and its failure is unknown rather than sold out',async()=>{
  const out=await checkCatalogMarkets({version:3,markets:{}},null,'2026-11-05T23:40:00Z',{
    priorityWatch:true,verifyAllTargets:true,
    fetchCatalog:async()=>({parsed:{products:[],pageItems:20,reportedTotal:20,coverage:'complete'},attempts:[]}),
    officialFetcher:async url=>({url,status:404,html:'Not found'}),
  });
  assert.equal(out.report.healthy,true);assert.equal(out.alerts.length,0);
  for(const market of ['US','CA']) {
    const m=out.state.markets[market];
    assert.equal(m.priorityWatch.errors.length,1);assert.deepEqual(m.currentStocks,{});
    assert.equal(m.priorityWatch.verified.length,0);
  }
});

test('a priority product can be independently verified even when the entire catalog is blocked',async()=>{
  const out=await checkCatalogMarkets({version:3,markets:{}},null,'2026-11-05T23:40:00Z',{
    priorityWatch:true,
    fetchCatalog:async()=>{throw new Error('Catalog blocked');},
    verifyProducts:async parsed=>({...parsed,products:parsed.products.map(p=>({...p,
      color:p.market==='US'?'Bleu Zéphyr':'Bleu Paradis',ecom:true,purchaseVerified:true})),verificationErrors:[]}),
  });
  assert.equal(out.report.healthy,false);assert.equal(out.alerts.length,2);
  assert.equal(out.alerts[0].market,'CA');
  for(const market of ['US','CA'])assert.equal(out.state.markets[market].currentStocks.H088612CKAQ.ecom,true);
});
