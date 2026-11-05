import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createScraplingClient} from '../src/scrapling-client.mjs';

function mockWorker(handle) {
  const child=new EventEmitter();
  child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,_encoding,done){handle(JSON.parse(String(chunk)),child);done();}});
  child.kill=()=>{child.killed=true;};return child;
}
const url=market=>'https://www.hermes.com/'+market.toLowerCase()+'/en/category/bags/';
test('market workers are isolated and same-market requests serialize',async()=>{
  const children=[],requests=[];
  const client=createScraplingClient('.',{
    spawnWorker:()=>{const child=mockWorker((request,worker)=>requests.push({request,worker}));children.push(child);return child;},
  });
  try {
    const us=client.fetch(url('US'),'US');
    const second=client.fetch(url('US')+'?page=2','US');
    const ca=client.fetch(url('CA'),'CA');
    await new Promise(setImmediate);
    assert.equal(children.length,2);assert.equal(requests.length,2);
    assert.notEqual(requests[0].worker,requests[1].worker);
    requests[1].worker.stdout.write(JSON.stringify({url:url('CA'),status:200,html:'ca'})+'\n');
    assert.equal((await ca).html,'ca');
    requests[0].worker.stdout.write(JSON.stringify({url:url('US'),status:200,html:'us'})+'\n');
    assert.equal((await us).html,'us');
    await new Promise(setImmediate);
    assert.equal(requests.length,3);
    requests[2].worker.stdout.write(JSON.stringify({url:url('US')+'?page=2',status:200,html:'page2'})+'\n');
    assert.equal((await second).html,'page2');
  } finally {client.close();}
  assert.ok(children.every(x=>x.killed));
});
test('a timed-out worker is stopped and never reused for a later response',async()=>{
  let child;
  const client=createScraplingClient('.',{timeoutMs:10,spawnWorker:()=>child=mockWorker(()=>{})});
  await assert.rejects(client.fetch(url('US'),'US'),/timed out/);
  assert.equal(child.killed,true);
  await assert.rejects(client.fetch(url('US'),'US'),/timed out/);
  client.close();
});
test('untrusted or mismatched URLs are rejected before starting a worker',async()=>{
  let started=0;
  const client=createScraplingClient('.',{spawnWorker:()=>{started++;throw Error('unexpected worker');}});
  await assert.rejects(client.fetch(url('CA'),'US'),/matching official market/);
  await assert.rejects(client.fetch('https://example.com/us/en/','US'),/matching official market/);
  assert.equal(started,0);
});
