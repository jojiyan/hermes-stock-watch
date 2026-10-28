import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {githubHeaders} from './ant-state-store.mjs';
export const INTERVAL_MS=10*60*1000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function scanDueAt({state={},notBefore='',event='',now=Date.now()}) {
  const prior=Math.max(0,...Object.values(state.markets||{}).map(m=>Date.parse(m.lastCheckedAt)||0));
  if(prior>now+120_000)throw new Error('Future stock observation timestamp');
  if(notBefore) {
    const due=Date.parse(notBefore);
    if(!Number.isFinite(due)||due>now+INTERVAL_MS+120_000)throw new Error('Invalid scan continuation time');
    return Math.max(now,due,prior+INTERVAL_MS);
  }
  if(event==='push')return now;
  return Math.max(now,prior+INTERVAL_MS);
}
export async function waitUntil(due,{now=Date.now,wait=sleep}={}) {
  while(due>now())await wait(Math.min(30_000,due-now()));
}
export async function dispatchNextScan({repo,token,due,fetcher=fetch,now=Date.now,wait=sleep}) {
  if(!Number.isFinite(due))throw new Error('Missing next scan time');
  // Queue shortly before the next slot; the new run waits for not_before.
  await waitUntil(due-45_000,{now,wait});
  const url='https://api.github.com/repos/'+repo+'/actions/workflows/hermes-stock-watch-scrapingant.yml/dispatches';
  for(let attempt=1;attempt<=3;attempt++) {
    const response=await fetcher(url,{method:'POST',headers:githubHeaders(token),
      signal:AbortSignal.timeout(30_000),
      body:JSON.stringify({ref:'main',inputs:{not_before:new Date(due).toISOString(),browser_recovery:false}})});
    if(response.ok) {
      let data={};try {data=await response.json();}catch{}
      return {status:'queued',notBefore:new Date(due).toISOString(),runId:data.workflow_run_id||data.id||null};
    }
    if(response.status<500 && response.status!==429 || attempt===3)
      throw new Error('Next stock scan could not be queued (HTTP '+response.status+')');
    await wait(5000*attempt);
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  if(process.argv[2]==='wait') {
    const state=JSON.parse(await readFile(resolve(root,'ant-state.json'),'utf8'));
    const due=scanDueAt({state,notBefore:process.env.NOT_BEFORE||'',event:process.env.GITHUB_EVENT_NAME});
    console.log(JSON.stringify({event:'stock-scan-slot',notBefore:new Date(due).toISOString()}));
    await waitUntil(due);
  } else if(process.argv[2]==='next') {
    const report=JSON.parse(await readFile(resolve(root,'ant-run-report.json'),'utf8').catch(()=>'{}'));
    const checked=Date.parse(report.checkedAt)||Date.now();
    const result=await dispatchNextScan({repo:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,
      due:checked+INTERVAL_MS});
    console.log(JSON.stringify({event:'next-stock-scan',...result}));
  } else throw new Error('Use ant-schedule.mjs wait or next');
}
