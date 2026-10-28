import test from 'node:test';
import assert from 'node:assert/strict';
import {scanDueAt,dispatchNextScan,waitUntil,INTERVAL_MS} from '../src/ant-schedule.mjs';
const now=Date.parse('2026-10-28T10:00:00Z');
test('scheduled and continuation runs respect the latest ten-minute observation slot',()=>{
  const state={markets:{US:{lastCheckedAt:new Date(now-120000).toISOString()}}};
  assert.equal(scanDueAt({state,now,event:'schedule'}),now+480000);
  assert.equal(scanDueAt({state,now,event:'push'}),now);
  assert.equal(scanDueAt({state,now,notBefore:new Date(now-1000).toISOString()}),now+480000);
  assert.throws(()=>scanDueAt({now,notBefore:'not a date'}),/Invalid/);
  assert.throws(()=>scanDueAt({now,notBefore:new Date(now+INTERVAL_MS*3).toISOString()}),/Invalid/);
});
test('waiting is bounded into short intervals and dispatch happens before the next due time',async()=>{
  let clock=now;const sleeps=[],requests=[];
  const due=now+INTERVAL_MS;
  const result=await dispatchNextScan({repo:'x/y',token:'secret',due,now:()=>clock,
    wait:async ms=>{assert.ok(ms<=30000);sleeps.push(ms);clock+=ms;},
    fetcher:async(url,init)=>{requests.push({url,init,clock});return new Response('{}',{status:200});}});
  assert.equal(requests.length,1);assert.equal(requests[0].clock,due-45000);
  const payload=JSON.parse(requests[0].init.body);
  assert.equal(payload.ref,'main');assert.equal(payload.inputs.not_before,new Date(due).toISOString());
  assert.equal(result.status,'queued');assert.ok(sleeps.length>1);
});
test('dispatch handles 204 responses and never uses a permanent personal token',async()=>{
  const out=await dispatchNextScan({repo:'x/y',token:'ephemeral',due:now,now:()=>now,
    fetcher:async(_url,init)=>{assert.equal(init.headers.authorization,'Bearer ephemeral');return new Response(null,{status:204});}});
  assert.equal(out.status,'queued');
});
test('a transient dispatch failure retries but authentication failure stops',async()=>{
  let tries=0;
  const out=await dispatchNextScan({repo:'x/y',token:'x',due:now,now:()=>now,wait:async()=>{},
    fetcher:async()=>++tries===1?new Response('',{status:503}):new Response('{}')});
  assert.equal(tries,2);assert.equal(out.status,'queued');
  tries=0;
  await assert.rejects(dispatchNextScan({repo:'x/y',token:'x',due:now,now:()=>now,
    fetcher:async()=>{tries++;return new Response('',{status:403});}}),/HTTP 403/);
  assert.equal(tries,1);
});
test('the pre-scan wait reaches the exact slot without fixed long sleeps',async()=>{
  let clock=now;
  await waitUntil(now+65000,{now:()=>clock,wait:async ms=>{assert.ok(ms<=30000);clock+=ms;}});
  assert.equal(clock,now+65000);
});
