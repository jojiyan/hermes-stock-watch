import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchOfficialCatalog,categoryUrl} from '../src/ant-catalog-fetch.mjs';

test('page-total drift does not hide later targets and never becomes verified full coverage',async()=>{
 const requests=[],seen=[];
 await assert.rejects(fetchOfficialCatalog('US',null,{
  discoverThroughDrift:true,wait:async()=>{},parser:JSON.parse,
  officialFetcher:async url=>{
   const page=Number(new URL(url).searchParams.get('page')||1);requests.push(page);
   return {url,status:200,html:JSON.stringify({products:[{market:'US',sku:'page'+page,ecom:false}],
    skus:['page'+page],pageItems:1,reportedTotal:page===1?3:4,next:page===3?null:'?page='+(page+1)})};
  },
  onCatalogPage:async parsed=>seen.push(parsed.products[0].sku),
 }),/Official total changed/);
 assert.deepEqual(requests,[1,2,3,1,2,3,1,2,3]);
 assert.equal(seen.filter(s=>s==='page3').length,3);
});

test('continuing discovery never follows a foreign or looping pagination URL',async()=>{
 for(const next of ['https://example.com/?page=3',categoryUrl('CA')+'?page=3','?page=1']) {
  const requested=[];
  await assert.rejects(fetchOfficialCatalog('US',null,{
   discoverThroughDrift:true,wait:async()=>{},parser:JSON.parse,
   officialFetcher:async url=>{
    requested.push(url);const page=Number(new URL(url).searchParams.get('page')||1);
    return {url,status:200,html:JSON.stringify({products:[],skus:['page'+page],pageItems:1,
      reportedTotal:page===1?3:4,next:page===1?'?page=2':next})};
   },
  }),/Invalid or looping/);
  assert.equal(requested.length,2);assert.ok(requested.every(url=>url.startsWith(categoryUrl('US'))));
 }
});
