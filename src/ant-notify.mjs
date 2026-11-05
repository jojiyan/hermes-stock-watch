import {githubHeaders} from './ant-state-store.mjs';
import {stockPriority} from './ant-priority.mjs';
export async function notifyVerifiedStock(p,{repo,owner,token,checkedAt,fetcher=fetch}) {
  if(p.purchaseVerified!==true||p.ecom!==true||!p.marker)
    throw new Error('Only confirmed purchasable stock can notify');
  const headers=githubHeaders(token);
  let exhausted=false;
  for(let page=1;page<=20;page++) {
    const prior=await fetcher('https://api.github.com/repos/'+repo+'/issues?state=all&per_page=100&page='+page,
      {headers,signal:AbortSignal.timeout(30_000)});
    if(!prior.ok)throw new Error('Unable to confirm duplicate stock alerts (HTTP '+prior.status+')');
    const items=await prior.json();
    if(!Array.isArray(items))throw new Error('Unexpected GitHub alert response');
    if(items.some(x=>x.body?.includes(p.marker)))return {status:'duplicate',channel:'github-issue'};
    if(items.length<100){exhausted=true;break;}
  }
  if(!exhausted)throw new Error('Stock alert deduplication exceeded the safe page limit');
  const priority=stockPriority(p);
  const body=['@'+owner,'',...(priority.label?['????:'+priority.label,'???:'+priority.rank,'']:[]),
    '??:'+p.marketName,'??:'+p.name,'??:'+p.color,
    '??:'+p.price,'SKU:'+p.sku,'??????:'+p.url,'',
    '??:Herm�s ?????,??? SKU ??,Add to cart/Add to bag ?????',
    '????:'+checkedAt,p.marker].join('\n');
  const response=await fetcher('https://api.github.com/repos/'+repo+'/issues',{
    method:'POST',headers,signal:AbortSignal.timeout(30_000),
    body:JSON.stringify({title:(priority.label?'?? ????|'+priority.label+'|':'?? Herm�s ??????|')+p.market+'|'+p.name+'|'+p.color,
      body,assignees:[owner]})});
  if(!response.ok)throw new Error('Issue stock notification failed (HTTP '+response.status+')');
  const issue=await response.json();
  return {status:'created',channel:'github-issue',number:issue.number,url:issue.html_url};
}

