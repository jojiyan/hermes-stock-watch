import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeMonitorState,publishMonitorState,readRemoteState} from '../src/ant-state-store.mjs';
const t=n=>'2026-10-28T10:'+String(n).padStart(2,'0')+':00.000Z';
const stock=(time,ecom)=>({seenAt:time,ecom});
const state=(time,extra={})=>({version:3,markets:{US:{status:'ok',lastCheckedAt:time,lastSuccessAt:time,
  catalogStocks:{},alertedSkus:{},available:{},...extra},CA:{status:'unknown',lastCheckedAt:time}}});
const remoteResponse=(s,sha)=>new Response(JSON.stringify({encoding:'base64',sha,content:Buffer.from(JSON.stringify(s)).toString('base64')}));
test('a rerun reads and updates the current remote blob SHA without rebasing old commits',async()=>{
  const calls=[];const remote=state(t(10)),candidate=state(t(20));
  const result=await publishMonitorState(candidate,{repo:'test/repo',token:'secret',fetcher:async(url,init)=>{
    calls.push({url,init});
    return init.method==='PUT'?new Response(JSON.stringify({commit:{sha:'new'}})):remoteResponse(remote,'current');
  }});
  assert.equal(result.status,'saved');
  assert.equal(JSON.parse(calls[1].init.body).sha,'current');
  assert.equal(JSON.parse(calls[1].init.body).branch,'main');
  assert.equal(result.state.markets.US.lastCheckedAt,t(20));
});
test('a raced write retries with the new remote SHA and preserves unrelated market observations',async()=>{
  let reads=0,writes=0;
  const result=await publishMonitorState(state(t(20)),{repo:'test/repo',token:'secret',fetcher:async(_url,init)=>{
    if(init.method!=='PUT') {
      reads++;const current=state(t(reads===1?10:30));
      current.markets.CA.catalogStocks={CAOLD:stock(t(30),true)};
      return remoteResponse(current,'sha'+reads);
    }
    writes++;assert.equal(JSON.parse(init.body).sha,'sha'+writes);
    return writes===1?new Response('conflict',{status:409}):new Response('{}');
  }});
  assert.equal(reads,2);assert.equal(writes,2);
  assert.equal(result.state.markets.US.lastCheckedAt,t(30));
  assert.equal(result.state.markets.CA.catalogStocks.CAOLD.ecom,true);
});
test('old candidate observations cannot roll back current stock or notification deduplication',()=>{
  const old=state(t(10),{catalogStocks:{SKU:stock(t(10),false)}});
  const current=state(t(20),{catalogStocks:{SKU:stock(t(20),true)},alertedSkus:{SKU:t(20)},
    available:{SKU:{sku:'SKU',lastSeenAt:t(20)}}});
  const result=mergeMonitorState(current,old);
  assert.equal(result.markets.US.catalogStocks.SKU.ecom,true);
  assert.equal(result.markets.US.alertedSkus.SKU,t(20));
  assert.equal(result.markets.US.lastCheckedAt,t(20));
});
test('fresh explicit negatives remove availability and rearm only their own SKU',()=>{
  const current=state(t(10),{catalogStocks:{OLD:stock(t(10),true),KEEP:stock(t(10),true)},
    alertedSkus:{OLD:t(10),KEEP:t(10)},available:{OLD:{lastSeenAt:t(10)},KEEP:{lastSeenAt:t(10)}}});
  const candidate=state(t(20),{catalogStocks:{OLD:stock(t(20),false)}});
  const result=mergeMonitorState(current,candidate);
  assert.equal(result.markets.US.alertedSkus.OLD,undefined);
  assert.equal(result.markets.US.available.OLD,undefined);
  assert.equal(result.markets.US.alertedSkus.KEEP,t(10));
});
test('unknown scans preserve latest verified history and expose no current stocks',()=>{
  const current=state(t(10),{catalogStocks:{SKU:stock(t(10),true)},lastVerifiedCatalog:{checkedAt:t(10)}});
  const incoming=state(t(20),{status:'unknown',lastSuccessAt:null,lastVerifiedCatalog:null});
  const result=mergeMonitorState(current,incoming);
  assert.equal(result.markets.US.lastSuccessAt,t(10));
  assert.equal(result.markets.US.lastVerifiedCatalog.checkedAt,t(10));
  assert.deepEqual(result.markets.US.currentStocks,{});
});
test('authentication and persistent write conflicts fail instead of reporting a saved state',async()=>{
  await assert.rejects(readRemoteState({repo:'x/y',token:'x',fetcher:async()=>new Response('',{status:403})}),/HTTP 403/);
  let writes=0;
  await assert.rejects(publishMonitorState(state(t(20)),{repo:'x/y',token:'x',fetcher:async(_url,init)=>{
    if(init.method==='PUT'){writes++;return new Response('',{status:409});}
    return remoteResponse(state(t(10)),'sha');
  }}),/HTTP 409/);
  assert.equal(writes,3);
});
