import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const stamp=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0;
function latestMap(a={},b={},field) {
  const result=structuredClone(a);
  for(const [key,value] of Object.entries(b)) {
    const before=result[key];
    if(!before || stamp(field?value[field]:value)>=stamp(field?before[field]:before)) result[key]=structuredClone(value);
  }
  return result;
}
export function mergeMonitorState(remote,incoming) {
  const out={...remote,...incoming,version:3,markets:{...(remote.markets||{})}};
  for(const [market,next] of Object.entries(incoming.markets||{})) {
    const before=remote.markets?.[market];
    if(!before){out.markets[market]=structuredClone(next);continue;}
    const winner=stamp(next.lastCheckedAt)>=stamp(before.lastCheckedAt)?next:before;
    const stocks=latestMap(before.catalogStocks,next.catalogStocks,'seenAt');
    const notified=latestMap(before.alertedSkus,next.alertedSkus);
    const available=latestMap(before.available,next.available,'lastSeenAt');
    for(const [sku,stock] of Object.entries(stocks)) {
      if(stock.ecom===false) {
        if(stamp(stock.seenAt)>=stamp(notified[sku]))delete notified[sku];
        if(stamp(stock.seenAt)>=stamp(available[sku]?.lastSeenAt))delete available[sku];
      }
    }
    const summaries=[before.lastVerifiedCatalog,next.lastVerifiedCatalog].filter(Boolean)
      .sort((a,b)=>stamp(b.checkedAt)-stamp(a.checkedAt));
    out.markets[market]={...winner,catalogStocks:stocks,alertedSkus:notified,available,
      lastSuccessAt:stamp(next.lastSuccessAt)>=stamp(before.lastSuccessAt)?next.lastSuccessAt:before.lastSuccessAt,
      lastVerifiedCatalog:summaries[0]||null,
      currentStocks:winner.status==='ok'?Object.fromEntries(Object.entries(stocks).filter(([,v])=>v.seenAt===winner.lastCheckedAt)):{}};
  }
  return out;
}
export function githubHeaders(token) {
  return {authorization:'Bearer '+token,accept:'application/vnd.github+json',
    'content-type':'application/json','user-agent':'hermes-stock-watch','x-github-api-version':'2022-11-28'};
}
export async function readRemoteState({repo,token,fetcher=fetch}) {
  const response=await fetcher('https://api.github.com/repos/'+repo+'/contents/ant-state.json?ref=main',
    {headers:githubHeaders(token),signal:AbortSignal.timeout(30_000)});
  if(!response.ok)throw new Error('Read current monitor state failed (HTTP '+response.status+')');
  const data=await response.json();
  if(data.encoding!=='base64'||!data.sha||typeof data.content!=='string')
    throw new Error('Unexpected GitHub state response');
  const state=JSON.parse(Buffer.from(data.content,'base64').toString('utf8'));
  if(state.version!==3 || !state.markets)throw new Error('Unsupported remote stock state');
  return {state,sha:data.sha};
}
export async function publishMonitorState(candidate,options) {
  const fetcher=options.fetcher||fetch;
  for(let attempt=1;attempt<=3;attempt++) {
    const remote=await readRemoteState({...options,fetcher});
    const state=mergeMonitorState(remote.state,candidate);
    const content=JSON.stringify(state,null,2)+'\n';
    if(content===JSON.stringify(remote.state,null,2)+'\n')return {status:'unchanged',state};
    const response=await fetcher('https://api.github.com/repos/'+options.repo+'/contents/ant-state.json',{
      method:'PUT',headers:githubHeaders(options.token),signal:AbortSignal.timeout(30_000),
      body:JSON.stringify({message:'chore: persist current stock observations [skip ci]',branch:'main',
        sha:remote.sha,content:Buffer.from(content).toString('base64')})});
    if(response.ok){const data=await response.json();return {status:'saved',state,commit:data.commit?.sha};}
    if(response.status!==409||attempt===3)throw new Error('Persist stock state failed (HTTP '+response.status+')');
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const file=resolve(root,'ant-state.json');
  const options={repo:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN};
  if(!options.repo||!options.token)throw new Error('State storage authentication is missing');
  if(process.argv[2]==='load') {
    const {state}=await readRemoteState(options);
    await writeFile(file,JSON.stringify(state,null,2)+'\n');
    console.log(JSON.stringify({event:'loaded-current-production-state',
      markets:Object.fromEntries(Object.entries(state.markets).map(([m,s])=>[m,s.lastCheckedAt]))}));
  } else if(process.argv[2]==='save') {
    const candidate=JSON.parse(await readFile(file,'utf8'));
    const saved=await publishMonitorState(candidate,options);
    await writeFile(file,JSON.stringify(saved.state,null,2)+'\n');
    console.log(JSON.stringify({event:'stock-state-persisted',status:saved.status,commit:saved.commit}));
    if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'persistence_status='+saved.status+'\n');
  } else throw new Error('Use ant-state-store.mjs load or save');
}
