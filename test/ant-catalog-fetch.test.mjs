import test from "node:test";
import assert from "node:assert/strict";
import {fetchOfficialCatalog} from "../src/ant-catalog-fetch.mjs";

const mockResponse=(status, body, credits=0)=>new Response(body,{
  status, headers:{"ant-credits-cost":String(credits)}
});
const parser=(html,market)=>{
  if(html!=="FULL CATALOG")throw new Error("Incomplete Hermès catalog");
  return {products:[],pageItems:33,reportedTotal:33,coverage:"full",market};
};

test("a one-credit category succeeds without retry",async()=>{
  const calls=[];
  const x=await fetchOfficialCatalog("US","test-key",{
    fetcher:async url=>{calls.push(String(url));return mockResponse(200,"FULL CATALOG",1)},
    parser,wait:async()=>{},
  });
  assert.equal(x.credits,1);
  assert.equal(x.mode,"low-credit-1");
  assert.equal(calls.length,1);
  assert.match(calls[0],/proxy_country=us/);
});

test("a transient 423 recovers using the second inexpensive attempt",async()=>{
  let attempts=0;
  const x=await fetchOfficialCatalog("CA","test-key",{
    fetcher:async()=>{
      attempts++;
      return attempts===1?mockResponse(423,"blocked"):mockResponse(200,"FULL CATALOG",1);
    },parser,wait:async()=>{},
  });
  assert.equal(attempts,2);
  assert.equal(x.credits,1);
  assert.equal(x.mode,"low-credit-retry");
});

test("persistent 423 uses at most one browser fallback and never residential",async()=>{
  const modes=[];
  await assert.rejects(
    fetchOfficialCatalog("US","test-key",{
      fetcher:async url=>{modes.push(new URL(url).searchParams);
        return mockResponse(423,"blocked");
      },
      parser,wait:async()=>{},
    }),
    /official catalog could not be verified/
  );
  assert.equal(modes.length,3);
  assert.deepEqual(modes.map(x=>x.get("browser")),["false","false","true"]);
  assert.ok(modes.every(x=>x.get("proxy_type")==="datacenter"));
});

test("a partial successful HTML response does not create a successful stock scan",async()=>{
  let n=0;
  const x=await fetchOfficialCatalog("US","test-key",{
    fetcher:async()=>{
      n++;
      return mockResponse(200,n===1?"PARTIAL":"FULL CATALOG",1);
    },parser,wait:async()=>{},
  });
  assert.equal(n,2);
  assert.equal(x.credits,2);
});

test("bad key and depleted balance do not trigger expensive retries",async()=>{
  for(const status of [401,402,403]){
    let n=0;
    await assert.rejects(fetchOfficialCatalog("US","test-key",{
      fetcher:async()=>{n++;return mockResponse(status,"denied")},
      parser,wait:async()=>{},
    }));
    assert.equal(n,1);
  }
});
