import {reconcileCatalog} from './ant-catalog.mjs';
import {fetchOfficialCatalog} from './ant-catalog-fetch.mjs';
import {verifyOfficialProducts} from './ant-purchase.mjs';

export async function checkCatalogMarkets(inputState,key,checkedAt,options={}) {
  const state=structuredClone(inputState);
  state.markets ||= {};
  state.version=3;
  const summaries=[],alerts=[];
  await Promise.all(['US','CA'].map(async market => {
    const previous=state.markets[market]||{};
    try {
      const fetched=await (options.fetchCatalog||fetchOfficialCatalog)(market,key,options);
      const parsed=await (options.verifyProducts||verifyOfficialProducts)(fetched.parsed,market,key,options);

      const errors=parsed.verificationErrors||[];
      const healthy=errors.length===0;
      // A market is transactional: partial purchase verification cannot alert or rearm.
      const reconciled=healthy?reconcileCatalog(previous,parsed,checkedAt):{
        available:previous.available||{},catalogStocks:previous.catalogStocks||{},
        alertedSkus:previous.alertedSkus||{},alerts:[],
      };
      state.markets[market]={...previous,
        catalogStocksUsage:'historical observations; consult currentStocks for this scan',
        currentStocks:healthy?Object.fromEntries(Object.entries(reconciled.catalogStocks).filter(([,v])=>v.seenAt===checkedAt)):{},
        lastVerifiedCatalog:healthy?{checkedAt,products:parsed.pageItems,targets:fetched.parsed.products.length,
          officialTotal:parsed.reportedTotal,coverage:parsed.coverage}:previous.lastVerifiedCatalog||null,
        status:healthy?'ok':'unknown',lastCheckedAt:checkedAt,
        lastSuccessAt:healthy?checkedAt:previous.lastSuccessAt||null,
        products:parsed.pageItems,targets:fetched.parsed.products.length,
        categoryAvailable:parsed.products.filter(p=>p.ecom).length,
        available:reconciled.available,catalogStocks:reconciled.catalogStocks,
        alertedSkus:reconciled.alertedSkus,coverage:parsed.coverage,
        officialTotal:parsed.reportedTotal,fetchMode:fetched.mode,
        verificationErrors:errors,error:healthy?null:'Some official product purchase states are unknown',
      };
      const attempts=[...(fetched.attempts||[]),...(parsed.purchaseAttempts||[])];
      summaries.push({market,status:healthy?'ok':'unknown',categoryProducts:parsed.pageItems,
        officialTotal:parsed.reportedTotal,targetProducts:fetched.parsed.products.length,
        verifiedTargets:parsed.products.length,ecommerceAvailable:parsed.products.filter(p=>p.ecom).length,
        pages:parsed.pages,catalogEvidence:fetched.parsed.records||[],recovery:fetched.parsed.recovery||'none',scans:fetched.scans||[],attempts,credits:attempts.reduce((n,a)=>n+a.credits,0),
        fetchMode:fetched.mode,verificationErrors:errors,
        purchaseEvidence:parsed.products,newAlerts:reconciled.alerts.length});
      for(const p of reconciled.alerts) alerts.push({...p,
        marker:`<!-- stock:${market}:${p.sku}:${previous.catalogStocks?.[p.sku]?.ecom===false?previous.catalogStocks[p.sku].seenAt:'initial'} -->`});
    } catch(error) {
      // Failure preserves previous observations and notification deduplication.
      state.markets[market]={...previous,status:'unknown',lastCheckedAt:checkedAt,
        lastVerifiedCatalog:previous.lastVerifiedCatalog || (previous.lastSuccessAt?{
          checkedAt:previous.lastSuccessAt,products:previous.products,targets:previous.targets,
          officialTotal:previous.officialTotal,coverage:previous.coverage}:null),
        products:null,targets:null,officialTotal:null,categoryAvailable:null,coverage:'unverified',fetchMode:null,
        currentStocks:{},catalogStocksUsage:'historical observations; consult currentStocks for this scan',
        verificationErrors:[{stage:'catalog',error:error.message}],error:error.message};
      summaries.push({market,status:'unknown',error:error.message,attempts:error.attempts||[],credits:(error.attempts||[]).reduce((n,a)=>n+(a.credits||0),0),pages:error.pages||[],scans:error.scans||[],newAlerts:0});
    }
  }));
  summaries.sort((a,b)=>['US','CA'].indexOf(a.market)-['US','CA'].indexOf(b.market));
  return {state,report:{checkedAt,executionStatus:'completed',verificationStatus:summaries.every(s=>s.status==='ok')?'verified':'unverified',healthy:summaries.every(s=>s.status==='ok'),
    coverage:'Complete published category, official pagination and unique totals; positive stock requires an enabled official product purchase button. Unlisted products remain unknown.',
    summaries,alerts:alerts.map(({marker,...p})=>p)},alerts};
}

