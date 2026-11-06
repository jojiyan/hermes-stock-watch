import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialPurchase} from '../src/ant-purchase.mjs';
const p={market:'CA',sku:'H12345678',name:'Picotin 18 bag',url:'https://www.hermes.com/ca/en/product/picotin-18-bag-H12345678/'};
const html=(action)=>`<html><head><base href="/ca/en/"><link rel="canonical" href="${p.url}"></head><body><h1>Picotin 18 bag</h1>${action}<h2>Product description</h2><p>Product reference: H12345678</p>${' '.repeat(6000)}</body></html>`;
test('positive stock requires matching official SKU, market and enabled real purchase button',()=>{
 for(const label of ['Add to cart','Add to bag'])assert.equal(parseOfficialPurchase(html(`<button name="add-to-cart"><span>${label}</span></button>`),p).ecom,true);
});
test('exact product-page colour and price replace broad catalog metadata',()=>{
 const candidate={...p,name:'Neo Garden 23 bag',color:'Blue',price:'$1'};
 const source=html('<p>Price CA$3,650</p><p>Color , Bleu Paradis / Bleu Paradis selected</p><button>Add to bag</button>')
   .replace('<h1>Picotin 18 bag</h1>','<h1>Neo Garden 23 bag</h1>');
 const out=parseOfficialPurchase(source,candidate);
 assert.equal(out.color,'Bleu Paradis / Bleu Paradis');assert.equal(out.price,'CA$3,650');
 assert.equal(out.name,'Neo Garden 23 bag');assert.equal(out.ecom,true);
 assert.throws(()=>parseOfficialPurchase(html('<button>Add to bag</button>'),{...candidate,watchOnly:true}),/model mismatch/);
});
test('disabled actions and explicit sold-out override stock metadata',()=>{
 for(const attr of ['disabled','disabled="false"','aria-disabled="true"']){
  const x=parseOfficialPurchase(html(`<button ${attr}>Add to bag</button>`),p);assert.equal(x.ecom,false);assert.equal(x.purchaseVerified,true);
 }
 assert.equal(parseOfficialPurchase(html('<button>Add to bag</button><p>Unfortunately this product is no longer available</p>'),p).ecom,false);
});

test('the current official unavailable wording verifies a negative for the matching main SKU',()=>{
 for(const message of ['This product is currently not available.','This item is currently not available.']) {
  const out=parseOfficialPurchase(html('<div role="alert">'+message+'</div>'),{...p,ecom:true});
  assert.equal(out.ecom,false);assert.equal(out.purchaseVerified,true);
 }
});
test('unavailable wording in recommendations cannot establish the main SKU state',()=>{
 assert.throws(()=>parseOfficialPurchase(html('You may also like <p>This product is currently not available.</p>'),p));
});
test('missing/hidden/script/recommendation purchase text and wrong region/SKU remain unknown',()=>{
 for(const action of ['stock.ecom=true','<script>Add to bag</script>','<div hidden><button>Add to bag</button></div>','<div style="display:none"><button>Add to bag</button></div>','<button hidden>Add to bag</button>','<template><button>Add to bag</button></template>'])
  assert.throws(()=>parseOfficialPurchase(html(action),p));
 assert.throws(()=>parseOfficialPurchase(html('You may also like <button>Add to bag</button>'),p));
 assert.throws(()=>parseOfficialPurchase(html('<button>Add to bag</button>').replace('/ca/en/','/us/en/'),p));
 assert.throws(()=>parseOfficialPurchase(html('<button>Add to bag</button>').replace('reference: H12345678','reference: H87654321'),p));
});
import {verifyOfficialProducts} from '../src/ant-purchase.mjs';
test('complete category false is negative evidence and never spends product credits or alerts',async()=>{
 const x=await verifyOfficialProducts({products:[{...p,ecom:false}]},'CA','key',{fetcher:async()=>{throw new Error('must not fetch')}});
 assert.equal(x.products[0].ecom,false);assert.equal(x.products[0].categoryNegativeVerified,true);
 assert.equal(x.purchaseAttempts.length,0);assert.equal(x.verificationErrors.length,0);
});

test('production verifies the purchase page even when a cached category says unavailable',async()=>{
 const x=await verifyOfficialProducts({products:[{...p,ecom:false}]},'CA',null,{
  verifyAllTargets:true,officialFetcher:async url=>({url,status:200,html:html('<button>Add to bag</button>')}),
  fetcher:()=>{throw new Error('must not use paid transport')},
 });
 assert.equal(x.products[0].ecom,true);assert.equal(x.products[0].purchaseVerified,true);
 assert.equal(x.verificationErrors.length,0);assert.equal(x.purchaseAttempts[0].credits,0);
});
test('a blocked target page cannot inherit a cached-category negative in production',async()=>{
 const x=await verifyOfficialProducts({products:[{...p,ecom:false}]},'CA',null,{
  verifyAllTargets:true,officialFetcher:async url=>({url,status:403,html:'blocked'}),
 });
 assert.equal(x.products.length,0);assert.equal(x.verificationErrors.length,1);
});

test('an HTTP-200 product shell retries one fully rendered page without credits',async()=>{
 const calls=[];
 const x=await verifyOfficialProducts({products:[{...p,ecom:false}]},'CA',null,{
  verifyAllTargets:true,officialFetcher:async(url,_market,options)=>{
   calls.push(options.browserOnly);
   return {url,status:200,html:options.browserOnly?html('<button>Add to bag</button>'):html('Loading purchase options')};
  },
 });
 assert.deepEqual(calls,[false,true]);assert.equal(x.products[0].ecom,true);
 assert.equal(x.purchaseAttempts.length,2);assert.equal(x.verificationErrors.length,0);
});
test('a rendered page with no verifiable purchase state remains unknown after one retry',async()=>{
 let calls=0;
 const x=await verifyOfficialProducts({products:[{...p,ecom:true}]},'CA',null,{
  officialFetcher:async url=>{calls++;return {url,status:200,html:html('Loading purchase options')};},
 });
 assert.equal(calls,2);assert.equal(x.products.length,0);assert.equal(x.verificationErrors.length,1);
});

// Reduced from the actual CA Bleu Paradis product response. The selected AQ
// colour has its own URL/reference; its canonical path points to sibling AG.
const garden={market:'CA',sku:'H088612CKAQ',name:'Neo Garden 23 bag',color:'Blue',
 url:'https://www.hermes.com/ca/en/product/neo-garden-23-bag-H088612CKAQ/'};
const gardenBody=()=>({sku:garden.sku,slug:'neo-garden-23-bag',variationParentProduct:'H088612CK',
 url:'/ca/en/product/neo-garden-23-bag-H088612CKAQ/',path:'/ca/en/product/neo-garden-23-bag-H088612CKAG/',
 variants:{colors:[{sku:garden.sku,slug:'neo-garden-23-bag',url:'/ca/en/product/neo-garden-23-bag-H088612CKAQ/'}]}});
function gardenHtml(body=gardenBody(),action='<button>Add to cart</button>') {
 return `<html><head><base href="/ca/en/"><link rel="canonical" href="https://www.hermes.com/ca/en/product/neo-garden-23-bag-H088612CKAG/">
 <script id="hermes-state">${JSON.stringify({product:{b:body}})}</script></head><body><h1>Neo Garden 23 bag</h1>
 <p>Price CA$3,650</p><p>Color , Bleu Paradis / Bleu Paradis selected</p>${action}<h2>Product description</h2>
 <p>Product reference: H088612CKAQ</p>${' '.repeat(6000)}</body></html>`;
}
test('official sibling-colour canonical mapping still requires the selected SKU purchase page',()=>{
 const out=parseOfficialPurchase(gardenHtml(),garden);
 assert.equal(out.ecom,true);assert.equal(out.canonicalEvidence,'official-variant-parent');
 assert.equal(out.sku,garden.sku);assert.equal(out.color,'Bleu Paradis / Bleu Paradis');
 const negative=parseOfficialPurchase(gardenHtml(gardenBody(),'<p>Unfortunately this product is no longer available</p><button disabled>Add to cart</button>'),garden);
 assert.equal(negative.ecom,false);assert.equal(negative.purchaseVerified,true);
});
test('a sibling canonical never weakens market, model, SKU or explicit official mapping checks',()=>{
 const changes=[b=>{b.sku='H088612CKAG';},b=>{b.url=b.path;},b=>{b.path='/ca/en/product/neo-garden-23-bag-H088612CKXX/';},
  b=>{b.variationParentProduct='H088613CK';},b=>{delete b.variationParentProduct;},
  b=>{b.variants.colors[0].sku='H088612CKAG';},b=>{b.variants.colors[0].url=b.path;},b=>{b.slug='another-bag';}];
 for(const change of changes){const b=gardenBody();change(b);assert.throws(()=>parseOfficialPurchase(gardenHtml(b),garden),/canonical/);}
 for(const wrong of ['https://www.hermes.com/us/en/product/neo-garden-23-bag-H088612CKAG/',
  'https://example.com/ca/en/product/neo-garden-23-bag-H088612CKAG/'])
  assert.throws(()=>parseOfficialPurchase(gardenHtml().replace('href="https://www.hermes.com'+gardenBody().path+'"','href="'+wrong+'"'),garden),/canonical/);
 assert.throws(()=>parseOfficialPurchase(gardenHtml().replace('Product reference: H088612CKAQ','Product reference: H088612CKAG'),garden),/did not match/);
 for(const url of [garden.url+'?other=1',garden.url+'#other',garden.url.replace('https://','https://user@')])
  assert.throws(()=>parseOfficialPurchase(gardenHtml(),{...garden,url}),/canonical/);
});
test('variant metadata alone cannot supply a missing main purchase state',()=>{
 assert.throws(()=>parseOfficialPurchase(gardenHtml(gardenBody(),'<p>Loading purchase options</p>'),garden),/unknown/);
 assert.throws(()=>parseOfficialPurchase(gardenHtml().replace(/<script[\s\S]*?<\/script>/,''),garden),/canonical/);
 assert.throws(()=>parseOfficialPurchase(gardenHtml().replace('<h1>','<div aria-hidden="true"><h1>').replace('</body>','</div></body>'),garden),/Missing main product heading/);
});

