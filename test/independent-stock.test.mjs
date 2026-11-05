import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCatalogMarkets} from '../src/ant-catalog-check.mjs';
import {mergeMonitorState} from '../src/ant-state-store.mjs';

const now='2026-11-05T10:50:00.000Z',before='2026-11-05T10:40:00.000Z';
const candidate={market:'US',sku:'H12345678',name:'Picotin Lock 18 bag',ecom:true,
  url:'https://www.hermes.com/us/en/product/picotin-lock-18-bag-H12345678/'};
const prior={version:3,markets:{US:{lastCheckedAt:before,lastSuccessAt:before,
  catalogStocks:{old:{ecom:true,seenAt:before}},available:{old:{sku:'old',lastSeenAt:before}},alertedSkus:{old:before}}}};
function incomplete(verified) {
  return {
    fetchCatalog:async(market,_key,options)=>{
      if(market==='US')await options.onCatalogPage({products:[candidate]},market,candidate.url);
      throw new Error('Second category page blocked');
    },
    verifyProducts:async()=>({products:verified,verificationErrors:[],purchaseAttempts:[]}),
  };
}
test('an incomplete catalog can alert only its independently verified purchase page',async()=>{
  const out=await checkCatalogMarkets(prior,null,now,incomplete([{...candidate,purchaseVerified:true}]));
  assert.equal(out.report.healthy,false);assert.equal(out.state.markets.US.status,'unknown');
  assert.equal(out.state.markets.US.lastSuccessAt,before);
  assert.equal(out.alerts.length,1);assert.equal(out.alerts[0].sku,candidate.sku);
  assert.equal(out.state.markets.US.currentStocks[candidate.sku].source,'official-product-purchase');
  assert.deepEqual(out.state.markets.US.catalogStocks.old,prior.markets.US.catalogStocks.old);
  const repeat=await checkCatalogMarkets(out.state,null,'2026-11-05T11:00:00.000Z',incomplete([{...candidate,purchaseVerified:true}]));
  assert.equal(repeat.alerts.length,0);
});
test('unverified positives and partial-category negatives cannot alert or change prior SKU history',async()=>{
  for(const products of [[candidate],[{market:'US',sku:'old',ecom:false,categoryNegativeVerified:true}]]) {
    const out=await checkCatalogMarkets(prior,null,now,incomplete(products));
    assert.equal(out.alerts.length,0);
    assert.deepEqual(out.state.markets.US.catalogStocks,prior.markets.US.catalogStocks);
    assert.equal(out.state.markets.US.alertedSkus.old,before);
    assert.deepEqual(out.state.markets.US.currentStocks,{});
  }
});
test('a wrong-market product cannot use the incomplete-catalog recovery path',async()=>{
  const out=await checkCatalogMarkets(prior,null,now,incomplete([{...candidate,market:'CA',purchaseVerified:true}]));
  assert.equal(out.alerts.length,0);assert.deepEqual(out.state.markets.US.currentStocks,{});
});
test('state persistence retains a fresh verified SKU while full-market coverage remains unknown',()=>{
  const incoming={version:3,markets:{US:{status:'unknown',lastCheckedAt:now,
    catalogStocks:{[candidate.sku]:{ecom:true,seenAt:now,source:'official-product-purchase'}}}}};
  const state=mergeMonitorState(prior,incoming);
  assert.equal(state.markets.US.status,'unknown');assert.equal(state.markets.US.currentStocks[candidate.sku].ecom,true);
  const later=mergeMonitorState(state,{version:3,markets:{US:{status:'unknown',lastCheckedAt:'2026-11-05T11:00:00.000Z'}}});
  assert.deepEqual(later.markets.US.currentStocks,{});
});
