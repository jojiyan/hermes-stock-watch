import {readFile,writeFile,mkdir,appendFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {checkCatalogMarkets} from "./ant-catalog-check.mjs";
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
await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!verifyOnly){
  for(const p of alerts)await notify(p);
  await writeFile(stateFile,JSON.stringify(nextState,null,2)+'\n');
}
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,
  `execution_status=completed\nverification_status=${report.verificationStatus}\nstate_written=${!verifyOnly}\n`);
if(!report.healthy)console.warn('Market verification incomplete; historical stock retained, unverified markets cannot alert.');
async function notify(p){
  const headers={authorization:`Bearer ${token}`,accept:"application/vnd.github+json",
    "content-type":"application/json","user-agent":"hermes-stock-watch","x-github-api-version":"2022-11-28"};
  const prior=await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100`,{headers});
  if(!prior.ok)throw new Error(`Unable to confirm duplicate stock alerts (${prior.status})`);
  if((await prior.json()).some(x=>x.body?.includes(p.marker)))return;
  const body=[`@${owner}`,"",`地区：${p.marketName}`,`包款：${p.name}`,
    `颜色：${p.color}`,`价格：${p.price}`,`SKU：${p.sku}`,
    `官方商品链接：${p.url}`,"",
    "来源：Hermès 官方商品页，地区与 SKU 匹配，Add to cart/Add to bag 按钮可用。",
    "说明：已验证官方购买按钮，库存可能随时变化。",
    `检测时间：${checkedAt}`,p.marker].join("\n");
  const r=await fetch(`https://api.github.com/repos/${repo}/issues`,{
    method:"POST",headers,body:JSON.stringify({title:`🟠 Hermès 官方电商有货｜${p.market}｜${p.name}｜${p.color}`,
      body,assignees:[owner]})
  });
  if(!r.ok)throw new Error(`Issue stock notification failed (${r.status}): ${(await r.text()).slice(0,250)}`);
}

