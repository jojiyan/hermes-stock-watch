import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialPurchase} from '../src/ant-purchase.mjs';
const p={market:'CA',sku:'H12345678',name:'Picotin 18 bag',url:'https://www.hermes.com/ca/en/product/picotin-18-bag-H12345678/'};
const html=(action)=>`<html><head><base href="/ca/en/"><link rel="canonical" href="${p.url}"></head><body><h1>Picotin 18 bag</h1>${action}<h2>Product description</h2><p>Product reference: H12345678</p>${' '.repeat(6000)}</body></html>`;
test('positive stock requires matching official SKU, market and enabled real purchase button',()=>{
 for(const label of ['Add to cart','Add to bag'])assert.equal(parseOfficialPurchase(html(`<button name="add-to-cart"><span>${label}</span></button>`),p).ecom,true);
});
test('disabled actions and explicit sold-out override stock metadata',()=>{
 for(const attr of ['disabled','disabled="false"','aria-disabled="true"']){
  const x=parseOfficialPurchase(html(`<button ${attr}>Add to bag</button>`),p);assert.equal(x.ecom,false);assert.equal(x.purchaseVerified,true);
 }
 assert.equal(parseOfficialPurchase(html('<button>Add to bag</button><p>Unfortunately this product is no longer available</p>'),p).ecom,false);
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
