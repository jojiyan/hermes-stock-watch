import {readFile,writeFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {reconcileCatalog} from "./ant-catalog.mjs";
import {fetchOfficialCatalog} from "./ant-catalog-fetch.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const stateFile=resolve(root,"ant-state.json"),reportFile=resolve(root,"ant-run-report.json");
const key=process.env.SCRAPINGANT_API_KEY;
const repo=process.env.GITHUB_REPOSITORY,owner=process.env.GITHUB_REPOSITORY_OWNER,token=process.env.GITHUB_TOKEN;
if(!key||!repo||!owner||!token)throw new Error("Monitor authentication is not configured");
const state=JSON.parse(await readFile(stateFile,"utf8").catch(()=>"{\"version\":2,\"markets\":{}}"));
state.markets ||= {};
state.version=2;
const checkedAt=new Date().toISOString(),alerts=[],summaries=[];
let marketsRead=0;
for (const market of ["US","CA"]) {
  const previous=state.markets[market]||{};
  try{
    const {parsed, credits, mode} = await fetchOfficialCatalog(market,key);
    const reconciled=reconcileCatalog(previous,parsed,checkedAt);
    const listingCodes=new Set(parsed.products.map(p=>p.sku));
    state.markets[market]={
      status:"ok",lastCheckedAt:checkedAt,lastSuccessAt:checkedAt,
      products:parsed.pageItems,targets:parsed.products.length,
      categoryAvailable:parsed.products.filter(x=>x.ecom).length,
      available:reconciled.available,
      catalogStocks:reconciled.catalogStocks,
      alertedSkus:reconciled.alertedSkus,
      coverage:parsed.coverage,
      officialTotal:parsed.reportedTotal,
      fetchMode:mode,
      unlistedPreviouslyAlerted:Object.keys(previous.available||{}).filter(sku=>!listingCodes.has(sku)),
      verificationErrors:[],
    };
    summaries.push({market,status:"ok",categoryProducts:parsed.pageItems,targetProducts:parsed.products.length,
      ecommerceAvailable:parsed.products.filter(x=>x.ecom).length,
      newAlerts:reconciled.alerts.length,credits,fetchMode:mode,
      officialTotal:parsed.reportedTotal,coverage:parsed.coverage});
    marketsRead++;
    // Use the previous catalog state for stable notification deduplication.
    for(const p of reconciled.alerts)alerts.push({...p,
      marker:`<!-- stock:${market}:${p.sku}:${previous.catalogStocks?.[p.sku]?.ecom===false?previous.catalogStocks[p.sku].seenAt:"initial"} -->`});
  }catch(err){
    state.markets[market]={...previous,status:"unknown",lastCheckedAt:checkedAt,error:err.message};
    summaries.push({market,status:"unknown",error:err.message});
  }
}
const report={checkedAt,healthy:marketsRead===2,coverage:"complete published category when official product total matches; products absent from this category cannot be inferred",
  summaries,alerts:alerts.map(({marker,...a})=>a)};
await writeFile(reportFile,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
// Persist successful markets even when another market was temporarily blocked.
// Do not lose a confirmed alert if state saving fails after a notification.
for(const p of alerts)await notify(p);
await writeFile(stateFile,JSON.stringify(state,null,2)+"\n");
if(marketsRead!==2)throw new Error("At least one market has unverified catalog stock.");
async function notify(p){
  const headers={authorization:`Bearer ${token}`,accept:"application/vnd.github+json",
    "content-type":"application/json","user-agent":"hermes-stock-watch","x-github-api-version":"2022-11-28"};
  const prior=await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100`,{headers});
  if(!prior.ok)throw new Error(`Unable to confirm duplicate stock alerts (${prior.status})`);
  if((await prior.json()).some(x=>x.body?.includes(p.marker)))return;
  const body=[`@${owner}`,"",`地区：${p.marketName}`,`包款：${p.name}`,
    `颜色：${p.color}`,`价格：${p.price}`,`SKU：${p.sku}`,
    `官方商品链接：${p.url}`,"",
    "来源：Hermès 官方分类页内嵌库存 stock.ecom=true，且该商品无缺货标签。",
    "说明：这是官方电商库存数据；详情页购买按钮未单独验证，库存可能随时变化。",
    `检测时间：${checkedAt}`,p.marker].join("\n");
  const r=await fetch(`https://api.github.com/repos/${repo}/issues`,{
    method:"POST",headers,body:JSON.stringify({title:`🟠 Hermès 官方电商有货｜${p.market}｜${p.name}｜${p.color}`,
      body,assignees:[owner]})
  });
  if(!r.ok)throw new Error(`Issue stock notification failed (${r.status}): ${(await r.text()).slice(0,250)}`);
}
