import {readFile,writeFile,mkdir,appendFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {checkCatalogMarkets} from "./ant-catalog-check.mjs";
import {notifyVerifiedStock} from "./ant-notify.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const stateFile=resolve(root,"ant-state.json"),reportFile=resolve(root,"ant-run-report.json");
const key=process.env.SCRAPINGANT_API_KEY;
const repo=process.env.GITHUB_REPOSITORY,owner=process.env.GITHUB_REPOSITORY_OWNER,token=process.env.GITHUB_TOKEN;
const verifyOnly=process.env.VERIFY_ONLY === "true";
if(!key||(!verifyOnly&&(!repo||!owner||!token)))throw new Error("Monitor authentication is not configured");
const state=JSON.parse(await readFile(stateFile,"utf8").catch(()=>"{\"version\":3,\"markets\":{}}"));
state.markets ||= {};
state.version=3;
const checkedAt=new Date().toISOString();
const evidenceDir=resolve(root,'ant-evidence');
await mkdir(evidenceDir,{recursive:true});
let sequence=0;
const {state:nextState,report,alerts}=await checkCatalogMarkets(state,key,checkedAt,{
  browserRecovery:process.env.CATALOG_BROWSER_RECOVERY === "true",
  onHtml:async(html,evidence)=>{
    const name=evidence.market+'-'+(++sequence)+'-'+evidence.mode+'.html';
    evidence.file='ant-evidence/'+name;
    await writeFile(resolve(evidenceDir,name),html);
    console.log(JSON.stringify({event:'official-page-received',...evidence}));
  },
});
report.notificationChannel='github-issue';
report.emailDelivery='unverified';
report.notifications=[];
await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!verifyOnly){
  for(const p of alerts) {
    const delivery=await notifyVerifiedStock(p,{repo,owner,token,checkedAt});
    report.notifications.push({market:p.market,sku:p.sku,...delivery});
    await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({event:'verified-stock-notification',sku:p.sku,...delivery}));
  }
  await writeFile(stateFile,JSON.stringify(nextState,null,2)+'\n');
}
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,
  `execution_status=completed\nverification_status=${report.verificationStatus}\nstate_written=${!verifyOnly}\n`);
if(!report.healthy)console.warn('Market verification incomplete; historical stock retained, unverified markets cannot alert.');
