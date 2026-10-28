import test from 'node:test';
import assert from 'node:assert/strict';
import {notifyVerifiedStock} from '../src/ant-notify.mjs';
const p={market:'US',marketName:'Hermès USA',sku:'H12345678',name:'Mini Lindy',color:'Black',
  price:'$1',url:'https://www.hermes.com/us/en/product/mini-lindy-H12345678/',
  purchaseVerified:true,ecom:true,marker:'<!-- stock:US:H12345678:initial -->'};
const auth={repo:'test/repo',owner:'owner',token:'token',checkedAt:'2026-10-28T10:00:00Z'};
test('unverified stock and explicit unavailable states never send a notification',async()=>{
  for(const candidate of [{...p,purchaseVerified:false},{...p,ecom:false}])
    await assert.rejects(notifyVerifiedStock(candidate,{...auth,fetcher:async()=>{throw new Error('must not call');}}),/Only confirmed/);
});
test('confirmed official purchase stock creates the expected owner-assigned Issue',async()=>{
  const calls=[];
  const result=await notifyVerifiedStock(p,{...auth,fetcher:async(url,init)=>{
    calls.push({url,init});
    if(init.method!=='POST')return new Response('[]');
    const body=JSON.parse(init.body);
    assert.deepEqual(body.assignees,['owner']);
    assert.ok(body.body.includes(p.marker));assert.ok(body.body.includes(p.url));
    return new Response(JSON.stringify({number:42,html_url:'https://github.com/test/repo/issues/42'}));
  }});
  assert.equal(calls.length,2);assert.equal(result.status,'created');assert.equal(result.number,42);
});
test('a matching alert beyond the first 100 Issues is deduplicated',async()=>{
  let calls=0;
  const result=await notifyVerifiedStock(p,{...auth,fetcher:async(url,init)=>{
    assert.notEqual(init.method,'POST');calls++;
    return new Response(JSON.stringify(calls===1?Array.from({length:100},()=>({body:'unrelated'})):[{body:p.marker}]));
  }});
  assert.equal(calls,2);assert.equal(result.status,'duplicate');
});
test('failed delivery is not recorded as success',async()=>{
  await assert.rejects(notifyVerifiedStock(p,{...auth,fetcher:async(_url,init)=>
    init.method==='POST'?new Response('',{status:500}):new Response('[]')}),/notification failed.*500/);
});
