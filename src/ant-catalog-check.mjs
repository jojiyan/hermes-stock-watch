import {reconcileCatalog} from './ant-catalog.mjs';
import {fetchOfficialCatalog} from './ant-catalog-fetch.mjs';
import {verifyOfficialProducts} from './ant-purchase.mjs';

export async function checkCatalogMarkets(inputState,key,checkedAt,options={}) {
  const state=structuredClone(inputState);
  state.markets ||= {};
  state.version=3;
  const summaries=[],alerts=[];
  for (const market of ['US','CA']) {
    const previous=state.markets[market]||{};
    try {
      const fetched=await (options.fetchCatalog||fetchOfficialCatalog)(market,key,options);
      const parsed=await (options.verifyProducts||verifyOfficialProducts)(fetched.parsed,market,key,options);
      const reconciled=reconcileCatalog(previous,parsed,checkedAt);
      const errors=parsed.verificationErrors||[];
      const healthy=errors.length===0;
      state.markets[market]={...previous,
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
        pages:parsed.pages,attempts,credits:attempts.reduce((n,a)=>n+a.credits,0),
        fetchMode:fetched.mode,verificationErrors:errors,
        purchaseEvidence:parsed.products,newAlerts:reconciled.alerts.length});
      for(const p of reconciled.alerts) alerts.push({...p,
        marker:`<!-- stock:${market}:${p.sku}:${previous.catalogStocks?.[p.sku]?.ecom===false?previous.catalogStocks[p.sku].seenAt:'initial'} -->`});
    } catch(error) {
      // Failure preserves previous observations and notification deduplication.
      state.markets[market]={...previous,status:'unknown',lastCheckedAt:checkedAt,error:error.message};
      summaries.push({market,status:'unknown',error:error.message,attempts:error.attempts||[],pages:error.pages||[]});
    }
  }
  return {state,report:{checkedAt,healthy:summaries.every(s=>s.status==='ok'),
    coverage:'Complete published category, official pagination and unique totals; positive stock requires an enabled official product purchase button. Unlisted products remain unknown.',
    summaries,alerts:alerts.map(({marker,...p})=>p)},alerts};
}
