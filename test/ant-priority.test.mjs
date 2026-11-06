import test from 'node:test';
import assert from 'node:assert/strict';
import {stockPriority, prioritizeProducts, priorityWatchCandidates,discoverPriorityVariants,rememberPriorityProducts} from '../src/ant-priority.mjs';
import {checkCatalogMarkets} from '../src/ant-catalog-check.mjs';
import {verifyOfficialProducts} from '../src/ant-purchase.mjs';

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
  assert.ok(!priorityWatchCandidates('US').some(p=>p.sku==='H088612CKAQ'));
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
    assert.equal(m.priorityWatch.errors.length,priorityWatchCandidates(market).length);assert.deepEqual(m.currentStocks,{});
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
  assert.equal(out.report.healthy,false);assert.equal(out.alerts.length,3);
  assert.equal(out.alerts[0].market,'CA');
  for(const market of ['US','CA'])for(const p of priorityWatchCandidates(market))
    assert.equal(out.state.markets[market].currentStocks[p.sku].ecom,true);
});

const root=priorityWatchCandidates('US')[0];
const variant=(suffix,color,url)=>({sku:'H086422CK'+suffix,slug:'neo-garden-23-bag',title:'Neo Garden 23 bag',color,
 url:url||'/us/en/product/neo-garden-23-bag-H086422CK'+suffix+'/'});
function variantsHtml(variants) {
 return '<script id="hermes-state">'+JSON.stringify({product:{b:{sku:root.sku,title:root.name,
  url:new URL(root.url).pathname,slug:'neo-garden-23-bag',variationParentProduct:'H086422CK',variants:{colors:variants}}}})+'</script>';
}
function productHtml(p,color,available,extra='') {
 return `<head><base href="/${p.market.toLowerCase()}/en/"><link rel="canonical" href="${p.url}">${extra}</head>
 <h1>${p.name}</h1><p>Color , ${color} selected</p>${available?'<button>Add to bag</button>':'<p>This product is currently not available.</p>'}
 <h2>Product description</h2><p>Product reference: ${p.sku}</p>${' '.repeat(6000)}`;
}
test('colour discovery accepts only exact favourites from same-market official model variants',()=>{
 const list=[variant('2T','Bleu Paradis'),variant('U2','Bleu Zéphyr'),variant('T0','Bleu Brume'),
  variant('2T','Bleu Paradis','/ca/en/product/neo-garden-23-bag-H086422CK2T/'),
  variant('2T','Bleu Paradis','https://example.com/us/en/product/neo-garden-23-bag-H086422CK2T/')];
 const found=discoverPriorityVariants(variantsHtml(list),root);
 assert.deepEqual(found.map(p=>p.sku),['H086422CK2T','H086422CKU2']);
 assert.ok(found.every(p=>p.ecom===undefined&&p.purchaseVerified===undefined));
 assert.deepEqual(discoverPriorityVariants(variantsHtml(list).replace(root.sku,'H086422CKXX'),root),[]);
 assert.deepEqual(discoverPriorityVariants(variantsHtml(list),{...root,market:'CA'}),[]);
});
test('new favourite variants get their own purchase check and survive disappearing category listings',async()=>{
 const metadata=variantsHtml([variant('2T','Bleu Paradis'),variant('U2','Bleu Zéphyr')]);
 const requests=[];
 const parsed=await verifyOfficialProducts({products:[{...root,ecom:false}]},'US',null,{
  verifyAllTargets:true,priorityWatch:true,officialFetcher:async url=>{
   requests.push(url);const sku=url.match(/-(H[A-Z0-9]+)\/$/)[1];
   const p={...root,sku,url};const color=sku.endsWith('2T')?'Bleu Paradis':sku.endsWith('U2')?'Bleu Zéphyr':'Étoupe';
   return {url,status:200,html:productHtml(p,color,false,sku===root.sku?metadata:'')};
  },
 });
 assert.equal(requests.length,3);assert.ok(parsed.products.every(p=>p.purchaseVerified&&p.ecom===false));
 const learned=rememberPriorityProducts({},parsed,'US','2026-11-06T14:00:00Z');
 assert.deepEqual(Object.keys(learned).sort(),['H086422CK2T','H086422CKU2']);
 assert.ok(Object.values(learned).every(p=>p.ecom===undefined));
 const state={version:3,markets:{US:{priorityWatchProducts:learned}}};
 const out=await checkCatalogMarkets(state,null,'2026-11-06T14:10:00Z',{
  priorityWatch:true,verifyAllTargets:true,
  fetchCatalog:async()=>({parsed:{products:[],pageItems:20,reportedTotal:20,coverage:'complete'},attempts:[]}),
  officialFetcher:async url=>{
   const sku=url.match(/-(H[A-Z0-9]+)\/$/)[1],p=learned[sku];
   return p?{url,status:200,html:productHtml(p,p.color,sku.endsWith('U2'))}:{url,status:404,html:'Not found'};
  },
 });
 assert.equal(out.alerts.length,1);assert.equal(out.alerts[0].sku,'H086422CKU2');
 assert.equal(out.state.markets.US.currentStocks.H086422CKU2.ecom,true);
 assert.ok(out.state.markets.US.priorityWatchProducts.H086422CK2T);
});
test('a remembered favourite colour cannot replace a missing selected colour on the current page',async()=>{
 const p={...root,color:'Bleu Paradis',watchOnly:true};
 const out=await verifyOfficialProducts({products:[p]},'US',null,{
  officialFetcher:async url=>({url,status:200,html:productHtml(p,'',true).replace('<p>Color ,  selected</p>','')}),
 });
 assert.equal(out.products[0].color,'');assert.equal(stockPriority(out.products[0]).label,'');
});
test('remembered priority candidates are bounded and never cross market or host',()=>{
 const products=Array.from({length:20},(_,i)=>({...root,sku:'H086422CK'+String(i).padStart(2,'0'),
  url:'https://www.hermes.com/us/en/product/neo-garden-23-bag-H086422CK'+String(i).padStart(2,'0')+'/',
  color:'Bleu Paradis',purchaseVerified:true}));
 const learned=rememberPriorityProducts({},{products},'US','2026-11-06T14:00:00Z');
 assert.equal(Object.keys(learned).length,8);
 const bad={...products[0],url:products[0].url.replace('www.hermes.com','example.com')};
 assert.deepEqual(rememberPriorityProducts({},{products:[bad]},'US','2026-11-06T14:00:00Z'),{});
 assert.deepEqual(rememberPriorityProducts({},{products},'CA','2026-11-06T14:00:00Z'),{});
});
