import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkCatalogMarkets} from './ant-catalog-check.mjs';
import {notifyVerifiedStock} from './ant-notify.mjs';
import {createScraplingClient} from './scrapling-client.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const verifyOnly=process.env.VERIFY_ONLY==='true';
const repo=process.env.GITHUB_REPOSITORY,owner=process.env.GITHUB_REPOSITORY_OWNER,token=process.env.GITHUB_TOKEN;
if(!verifyOnly&&(!repo||!owner||!token))throw new Error('Missing GitHub notification configuration');
const state=JSON.parse(await readFile(resolve(root,'ant-state.json'),'utf8'));
const checkedAt=new Date().toISOString();
const evidenceDir=resolve(root,'scrapling-evidence');
await mkdir(evidenceDir,{recursive:true});
const client=createScraplingClient(root);
let sequence=0,result;
try {
  result=await checkCatalogMarkets(state,null,checkedAt,{
    // Category HTML may be cached for an hour. Its negative stock field must
    // not suppress checking the target's own current purchase page.
    verifyAllTargets:true,
    discoverThroughDrift:true,
    priorityWatch:true,
    officialFetcher:(url,market,options)=>client.fetch(url,market,options),
    onHtml:async(html,evidence)=>{
      evidence.file='scrapling-evidence/'+evidence.market+'-'+(++sequence)+'.html';
      await writeFile(resolve(root,evidence.file),html);
      console.log(JSON.stringify({event:'official-page-received',...evidence}));
    },
  });
} finally {client.close();}
const {report,alerts,state:nextState}=result;
report.provider='First-party HTTP + Camoufox (no credits)';
report.notificationChannel='github-issue';report.emailDelivery='unverified';report.notifications=[];
const reportPath=resolve(root,'scrapling-run-report.json');
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!verifyOnly) {
  for(const product of alerts) {
    const delivery=await notifyVerifiedStock(product,{repo,owner,token,checkedAt});
    report.notifications.push({market:product.market,sku:product.sku,...delivery});
    await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  }
  await writeFile(resolve(root,'ant-state.json'),JSON.stringify(nextState,null,2)+'\n');
}
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,
  `execution_status=completed\nverification_status=${report.verificationStatus}\nstate_written=${!verifyOnly}\n`);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
  '\nProvider: Scrapling (no credits)\n\n'+report.summaries.map(s=>s.market+': **'+s.status+'** — '+(s.error||s.categoryProducts+' catalog products; '+s.newAlerts+' new alerts')).join('\n\n')+'\n');
