import {reconcileCatalog} from './ant-catalog.mjs';
import {fetchOfficialCatalog} from './ant-catalog-fetch.mjs';
import {verifyOfficialProducts} from './ant-purchase.mjs';
import {priorityWatchCandidates, prioritizeProducts} from './ant-priority.mjs';

function withPriorityWatch(parsed, watch) {
  const products = new Map(watch.map(p => [p.sku,p]));
  // A currently listed product keeps normal catalog health requirements.
  for (const p of parsed.products) products.set(p.sku,p);
  return {...parsed, products:prioritizeProducts([...products.values()])};
}
function watchSummary(parsed, watch) {
  return {candidates:watch.map(p=>p.sku),
    verified:parsed.products.filter(p=>watch.some(w=>w.sku===p.sku)&&p.purchaseVerified).map(p=>({sku:p.sku,color:p.color,ecom:p.ecom})),
    errors:parsed.priorityWatchErrors||[]};
}

function currentStocks(reconciled,checkedAt) {
  return Object.fromEntries(Object.entries(reconciled.catalogStocks).filter(([,v])=>v.seenAt===checkedAt));
}
function addAlerts(output,reconciled,market,previous) {
  for(const p of reconciled.alerts)output.push({...p,
    marker:'<!-- stock:'+market+':'+p.sku+':'+(previous.catalogStocks?.[p.sku]?.ecom===false?previous.catalogStocks[p.sku].seenAt:'initial')+' -->'});
}
function verifiedOnly(parsed,market,completeCatalog) {
  return {...parsed,products:parsed.products.filter(p=>p.market===market &&
    (p.purchaseVerified===true || (completeCatalog&&p.categoryNegativeVerified===true&&p.ecom===false)))};
}

export async function checkCatalogMarkets(inputState,key,checkedAt,options={}) {
  const state=structuredClone(inputState);
  state.markets ||= {};state.version=3;
  const summaries=[],alerts=[];
  await Promise.all(['US','CA'].map(async market=>{
    const previous=state.markets[market]||{};
    const watch=options.priorityWatch===true?priorityWatchCandidates(market):[];
    const discovered=new Map(watch.map(p=>[p.sku,p]));
    const marketOptions={...options,onCatalogPage:async(parsed,code,url)=>{
      for(const p of parsed.products)if(p.market===market&&(p.ecom===true||options.verifyAllTargets===true))discovered.set(p.sku,p);
      if(options.onCatalogPage)await options.onCatalogPage(parsed,code,url);
    }};
    try {
      const fetched=await (options.fetchCatalog||fetchOfficialCatalog)(market,key,marketOptions);
      const parsed=await (options.verifyProducts||verifyOfficialProducts)(withPriorityWatch(fetched.parsed,watch),market,key,marketOptions);
      const priorityWatch=watchSummary(parsed,watch);
      const errors=parsed.verificationErrors||[],healthy=errors.length===0;
      // Each SKU commits only its own evidence. One blocked product cannot
      // suppress an unrelated enabled purchase button or change that SKU's state.
      const verified=verifiedOnly(parsed,market,true);
      const reconciled=reconcileCatalog(previous,verified,checkedAt);
      state.markets[market]={...previous,
        catalogStocksUsage:'historical observations; consult currentStocks for this scan',
        currentStocks:currentStocks(reconciled,checkedAt),productVerification:'independent',priorityWatch,
        lastVerifiedCatalog:healthy?{checkedAt,products:parsed.pageItems,targets:fetched.parsed.products.length,
          officialTotal:parsed.reportedTotal,coverage:parsed.coverage}:previous.lastVerifiedCatalog||null,
        status:healthy?'ok':'unknown',lastCheckedAt:checkedAt,
        lastSuccessAt:healthy?checkedAt:previous.lastSuccessAt||null,
        products:parsed.pageItems,targets:fetched.parsed.products.length,
        categoryAvailable:verified.products.filter(p=>p.ecom).length,
        available:reconciled.available,catalogStocks:reconciled.catalogStocks,
        alertedSkus:reconciled.alertedSkus,coverage:parsed.coverage,
        officialTotal:parsed.reportedTotal,fetchMode:fetched.mode,
        verificationErrors:errors,error:healthy?null:'Some official product purchase states are unknown'};
      const attempts=[...(fetched.attempts||[]),...(parsed.purchaseAttempts||[])];
      summaries.push({market,status:healthy?'ok':'unknown',categoryProducts:parsed.pageItems,
        officialTotal:parsed.reportedTotal,targetProducts:fetched.parsed.products.length,
        verifiedTargets:verified.products.length,ecommerceAvailable:verified.products.filter(p=>p.ecom).length,
        pages:parsed.pages,catalogEvidence:fetched.parsed.records||[],recovery:fetched.parsed.recovery||'none',
        scans:fetched.scans||[],attempts,credits:attempts.reduce((n,a)=>n+(a.credits||0),0),
        fetchMode:fetched.mode,verificationErrors:errors,priorityWatch,purchaseEvidence:verified.products,newAlerts:reconciled.alerts.length});
      addAlerts(alerts,reconciled,market,previous);
    } catch(error) {
      // A strictly parsed page can discover a URL even if another page fails.
      // Only its matching, independently verified product page may then alert.
      // Incomplete category negatives never rearm or clear historical stock.
      let parsed={products:[],verificationErrors:[],purchaseAttempts:[]};
      if(discovered.size) {
        try {parsed=await (options.verifyProducts||verifyOfficialProducts)(
          {products:[...discovered.values()]},market,key,marketOptions);}
        catch(purchaseError){parsed.verificationErrors.push({stage:'product',error:purchaseError.message});}
      }
      const verified=verifiedOnly(parsed,market,false);
      const priorityWatch=watchSummary(parsed,watch);
      const reconciled=reconcileCatalog(previous,verified,checkedAt);
      state.markets[market]={...previous,status:'unknown',lastCheckedAt:checkedAt,
        lastVerifiedCatalog:previous.lastVerifiedCatalog||(previous.lastSuccessAt?{
          checkedAt:previous.lastSuccessAt,products:previous.products,targets:previous.targets,
          officialTotal:previous.officialTotal,coverage:previous.coverage}:null),
        products:null,targets:null,officialTotal:null,categoryAvailable:null,coverage:'unverified',fetchMode:null,
        currentStocks:currentStocks(reconciled,checkedAt),productVerification:'independent',priorityWatch,
        available:reconciled.available,catalogStocks:reconciled.catalogStocks,alertedSkus:reconciled.alertedSkus,
        catalogStocksUsage:'historical observations; consult currentStocks for this scan',
        verificationErrors:[{stage:'catalog',error:error.message},...(parsed.verificationErrors||[])],error:error.message};
      const attempts=[...(error.attempts||[]),...(parsed.purchaseAttempts||[])];
      summaries.push({market,status:'unknown',error:error.message,attempts,
        credits:attempts.reduce((n,a)=>n+(a.credits||0),0),pages:error.pages||[],scans:error.scans||[],
        verifiedTargets:verified.products.length,priorityWatch,purchaseEvidence:verified.products,newAlerts:reconciled.alerts.length});
      addAlerts(alerts,reconciled,market,previous);
    }
  }));
  summaries.sort((a,b)=>['US','CA'].indexOf(a.market)-['US','CA'].indexOf(b.market));
  const healthy=summaries.every(s=>s.status==='ok');
  return {state,report:{checkedAt,executionStatus:'completed',verificationStatus:healthy?'verified':'unverified',healthy,
    coverage:'Complete catalog totals are audited independently. Each alert requires its own matching official SKU, market, canonical URL and enabled purchase button. Unlisted or failed products remain unknown.',
    summaries,alerts:prioritizeProducts(alerts).map(({marker,...p})=>p)},alerts:prioritizeProducts(alerts)};
}


