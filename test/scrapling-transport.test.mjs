import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fetchOfficialCatalog,fetchAntHtml} from '../src/ant-catalog-fetch.mjs';
import {verifyOfficialProducts} from '../src/ant-purchase.mjs';
import {dispatchNextScan} from '../src/ant-schedule.mjs';

test('no-credit transport preserves full pagination, closing checks and exact totals',async()=>{
  const first=await readFile(new URL('fixtures/ca-page1.html',import.meta.url),'utf8');
  const second=await readFile(new URL('fixtures/ca-page2.html',import.meta.url),'utf8');
  const requested=[];
  const result=await fetchOfficialCatalog('CA',null,{
    officialFetcher:async(url,market)=>{requested.push(url);assert.equal(market,'CA');
      return {url,status:200,html:new URL(url).searchParams.get('page')==='2'?second:first};},
    fetcher:()=>{throw new Error('Paid transport must never execute');},
  });
  assert.equal(result.parsed.pageItems,43);assert.equal(result.parsed.reportedTotal,43);
  assert.equal(requested.length,3);assert.equal(result.credits,0);
  assert.ok(result.attempts.every(x=>x.mode==='scrapling-direct'&&x.credits===0));
});

test('blocked official pages never invoke a credit provider or relax unknown state',async()=>{
  let paid=0;
  await assert.rejects(fetchOfficialCatalog('US',null,{
    officialFetcher:async url=>({url,status:403,html:'blocked'}),
    fetcher:()=>{paid++;throw new Error('unexpected paid request');},
  }),/Official HTTP 403/);
  assert.equal(paid,0);
});

test('redirected market and page cannot establish official inventory',async()=>{
  await assert.rejects(fetchAntHtml('https://www.hermes.com/ca/en/product/example/','CA',null,{
    officialFetcher:async()=>({url:'https://www.hermes.com/us/en/product/example/',status:200,html:'x'}),
    parse:()=>({ecom:true}),
  }),/redirected/);
});
test('blocked and redirected HTML is retained for diagnosis but never sent to the stock parser',async()=>{
 const captured=[],attempts=[];
 await assert.rejects(fetchAntHtml('https://www.hermes.com/us/en/product/example/','US',null,{
  attempts,officialFetcher:async()=>({url:'https://www.hermes.com/us/en/',status:403,html:'<title>Access denied</title>'}),
  onHtml:async(html,evidence)=>captured.push({html,status:evidence.status,url:evidence.responseUrl}),
  parse:()=>{throw new Error('Must not parse blocked HTML');},
 }),/redirected/);
 assert.deepEqual(captured,[{html:'<title>Access denied</title>',status:403,url:'https://www.hermes.com/us/en/'}]);
 assert.equal(attempts[0].responseTitle,'Access denied');assert.equal(attempts[0].credits,0);
});

test('product verification also uses only the no-credit transport',async()=>{
  let called=false;
  const parsed=await verifyOfficialProducts({products:[{sku:'H051551CKCS',market:'CA',ecom:true,
    url:'https://www.hermes.com/ca/en/product/garden-party-30-bag-H051551CKCS/'}]},'CA',null,{
    officialFetcher:async url=>{called=true;return {url,status:403,html:'blocked'};},
    fetcher:()=>{throw new Error('unexpected paid request');},
  });
  assert.equal(called,true);assert.equal(parsed.products.length,0);
  assert.equal(parsed.verificationErrors.length,1);
});

test('continuation dispatch targets the active no-credit workflow',async()=>{
  await dispatchNextScan({repo:'x/y',token:'ephemeral',due:0,now:()=>1,
    fetcher:async(url,init)=>{
      assert.ok(url.endsWith('/hermes-stock-watch-ant.yml/dispatches'));
      assert.equal('browser_recovery' in JSON.parse(init.body).inputs,false);
      return new Response(null,{status:204});
    }});
});
