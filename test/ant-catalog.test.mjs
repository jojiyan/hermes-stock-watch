import test from "node:test";
import assert from "node:assert/strict";
import {parseHermesCatalog,reconcileCatalog,isRequestedBag} from "../src/ant-catalog.mjs";

const market="US", time="2026-10-09T05:00:00.000Z";
const target=[["H086422CK37","Neo Garden 23 bag",true],
 ["H056289CC3Y","Picotin Lock 18 bag",false],
 ["H051551CKCM","Garden Party 30 bag",false],
 ["H085689CKAC","Garden Party 36 bag",true]];
const products=[...target];
for(let i=0;i<8;i++)products.push(["H087987CK"+String(i).padStart(2,"0"),"Other bag",true]);
function makeHtml(p=products){
 const items=p.map(([sku,title,ecom])=>({
    sku,title,slug:title.toLowerCase().replace(/\s+/g,"-"),
    url:"/product/"+title.toLowerCase().replace(/\s+/g,"-")+"-"+sku+"/",
    stock:{ecom,retail:false},avgColor:"Black",price:4475
 }));
 const entries=items.map(x=>`<div id="grid-product-${x.sku}"><a href="/us/en${x.url}">${x.title}</a>
  ${x.stock.ecom?"":'<h-out-of-stock-label class="tag-unavailable">Discover</h-out-of-stock-label>'}</div>`).join("");
 const state=JSON.stringify({"700976760":{b:{products:{items,maxSize:33},total:items.length}}});
 return `<html><head><title>Hermès official catalog</title></head><body>${entries}<script id="hermes-state" type="application/json">${state}</script>${" ".repeat(11000)}</body></html>`;
}
test("parses official stock true and false, explicitly excludes Garden Party 36",()=>{
 const p=parseHermesCatalog(makeHtml(),market);
 assert.equal(p.pageItems,12);
 assert.equal(p.products.length,3);
 assert.deepEqual(p.products.map(x=>[x.sku,x.ecom]),[
  ["H086422CK37",true],["H056289CC3Y",false],["H051551CKCM",false]]);
 assert.equal(p.products[0].url,"https://www.hermes.com/us/en/product/neo-garden-23-bag-H086422CK37/");
});
test("new e-commerce stock alerts once, then stays silent until explicitly sold out",()=>{
 const catalog=parseHermesCatalog(makeHtml(),market);
 const first=reconcileCatalog({},catalog,time);
 assert.equal(first.alerts.length,1);
 assert.equal(first.alerts[0].sku,"H086422CK37");
 const p2=reconcileCatalog({...first},catalog,"2026-10-09T05:10:00.000Z");
 assert.equal(p2.alerts.length,0);
 const noStock=makeHtml(products.map(p=>p[0]==="H086422CK37"?[p[0],p[1],false]:p));
 const p3=reconcileCatalog({...p2},parseHermesCatalog(noStock,market),"2026-10-09T05:20:00.000Z");
 assert.equal(p3.alerts.length,0);
 const p4=reconcileCatalog({...p3},catalog,"2026-10-09T05:30:00.000Z");
 assert.equal(p4.alerts.length,1);
});
test("missing SKU does not trigger an artificial restock",()=>{
 const old=reconcileCatalog({},parseHermesCatalog(makeHtml(),market),time);
 const without=products.filter(p=>p[0]!=="H086422CK37");
 const noProduct=reconcileCatalog({...old},parseHermesCatalog(makeHtml(without),market),"2026-10-09T05:10:00.000Z");
 const again=reconcileCatalog({...noProduct},parseHermesCatalog(makeHtml(),market),"2026-10-09T05:20:00.000Z");
 assert.equal(again.alerts.length,0);
});
test("rejects fake, incomplete, or conflicting inventory",()=>{
 assert.throws(()=>parseHermesCatalog("<html>blocked</html>","US"),/Missing complete/);
 const mismatch=makeHtml().replace('class="tag-unavailable">Discover','class="tag-unavailable">Discover');
 const ecomTrueSku="H086422CK37";
 const conflicted=mismatch.replace('id="grid-product-'+ecomTrueSku+'"><a','id="grid-product-'+ecomTrueSku+'"><h-out-of-stock-label class="tag-unavailable">Discover</h-out-of-stock-label><a');
 assert.throws(()=>parseHermesCatalog(conflicted,"US"),/Conflicting/);
});
test("accepts only requested families",()=>{
 assert.equal(isRequestedBag("Neo Garden 23 bag"),true);
 assert.equal(isRequestedBag("Mini Garden Party bag"),true);
 assert.equal(isRequestedBag("Garden Party 36 bag"),false);
 assert.equal(isRequestedBag("Neo Garden Voyage 41 bag"),false);
});

test("rejects a category that exposes only the first page of a larger catalog",()=>{
 const html=makeHtml();
 const short=html.replace('"total":12', '"total":120');
 assert.throws(()=>parseHermesCatalog(short,"US"),/Incomplete Hermès catalog: received 12 of 120/);
});
