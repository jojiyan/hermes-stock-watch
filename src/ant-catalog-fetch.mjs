import { parseHermesCatalog, normalizeCatalogTitle } from './ant-catalog.mjs';
import { createHash } from 'node:crypto';

// A plan may allow just one concurrent paid request. Market state stays independent.
let requestQueue=Promise.resolve();
async function paidFetch(fetcher,url,init) {
  const previous=requestQueue;
  let release;
  requestQueue=new Promise(resolve=>{release=resolve;});
  await previous;
  try {return await fetcher(url,{...init,signal:AbortSignal.timeout(60_000)});}
  finally {release();}
}

export function categoryUrl(market) {
  return `https://www.hermes.com/${market.toLowerCase()}/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/`;
}

function validateCatalogLocation(html,url,market) {
  const base=html.match(/<base\b[^>]*href=["']([^"']+)["']/i)?.[1];
  const canonical=[...html.matchAll(/<link\b[^>]*>/gi)]
    .find(x=>/\brel=["']canonical["']/i.test(x[0]))?.[0]
    .match(/\bhref=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g,'&');
  if(base!==`/${market.toLowerCase()}/en/`||canonical!==url)
    throw new Error('Official catalog canonical URL/market/page mismatch');
}

// Reuse only within the same market/path. Never follow a scraped external URL.
export function nextCatalogUrl(next, current, market) {
  const url = new URL(next, current);
  const base = new URL(categoryUrl(market));
  const expected = Number(new URL(current).searchParams.get('page') || 1) + 1;
  if (url.origin !== base.origin || url.pathname !== base.pathname ||
      url.username || url.password || url.hash ||
      [...url.searchParams.keys()].some(k => k !== 'page') ||
      url.searchParams.getAll('page').length !== 1 ||
      url.searchParams.get('page') !== String(expected)) {
    throw new Error('Invalid or looping official catalog pagination');
  }
  return url.href;
}

export async function fetchAntHtml(url, market, key, options = {}) {
  const fetcher = options.fetcher || fetch;
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const attempts = options.attempts || [];
  const modes = options.browserOnly ? [
    {browser:true, mode:'browser-consistency-recovery'},
  ] : [
    {browser:false, mode:'low-credit-1'},
    {browser:false, mode:'low-credit-retry'},
    {browser:true, mode:'browser-fallback'},
  ];
  if(!options.browserOnly && new URL(url).searchParams.has('page')) {
    // Observed official equivalent: ?page=2& serves the same canonical page.
    // A distinct transport URL can recover an edge/proxy block without changing scope.
    modes.splice(2,0,{browser:false,mode:'low-credit-page-delimiter',targetUrl:url+'&'});
  }
  const errors = [];
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    if (i) await wait(attempts.at(-1)?.status===409?10_000:1200 * i);
    if(!options.browserOnly && attempts.at(-1)?.status===409)mode.browser=false;
    const targetUrl=mode.targetUrl||url;
    const params = new URLSearchParams({url:targetUrl, browser:String(mode.browser),
      proxy_type:'datacenter', proxy_country:market.toLowerCase(), timeout:'50'});
    if (mode.browser) for (const type of ['image','media','font']) params.append('block_resource',type);
    const evidence = {market,url:targetUrl,mode:mode.mode,credits:0};
    attempts.push(evidence);
    try {
      const response = await paidFetch(fetcher,`https://api.scrapingant.com/v2/general?${params}`, {
        headers:{'x-api-key':key,accept:'text/html,*/*'}, signal:AbortSignal.timeout(60_000),
      });
      evidence.status = response.status;
      const used = Number(response.headers.get('ant-credits-cost') || 0);
      evidence.credits = Number.isFinite(used) && used >= 0 ? used : 0;
      if (!response.ok) {
        const body=(await response.text()).split(key).join('[redacted]').slice(0,800);
        evidence.responseBody=body;
        const error = new Error(`HTTP ${response.status}: ${body.slice(0,180)}`);
        error.fatal = [400,401,402,403].includes(response.status);
        throw error;
      }
      const html = await response.text();
      evidence.bytes = Buffer.byteLength(html);
      evidence.fetchedAt = new Date().toISOString();
      evidence.sha256 = createHash('sha256').update(html).digest('hex');
      // Optional evidence sink is used by Actions; never includes request headers/key.
      if (options.onHtml) await options.onHtml(html,evidence);
      const parsed = options.parse(html);
      evidence.pageItems = parsed.pageItems;
      evidence.officialTotal = parsed.reportedTotal;
      return {parsed,mode:mode.mode};
    } catch (error) {
      evidence.error = String(error.message || error).slice(0,250);
      errors.push(`${mode.mode}: ${evidence.error}`);
      if (error.fatal) break;
    }
  }
  const error = new Error(`${market}: official page could not be verified: ${errors.join(' | ')}`);
  error.attempts = attempts;
  throw error;
}

async function fetchCatalogScan(market, key, options = {}) {
  if (!['US','CA'].includes(market) || !key) throw new Error('Invalid market or missing key');
  const parser = options.parser || parseHermesCatalog;
  const attempts = [];
  const pages = [], products = [], records = [], skus = new Set(), recoveredFacets=[];
  let url = categoryUrl(market), total, firstPage;
  try {
    for (let page = 1; page <= 13; page++) {
      const parse=html=>{
          if(!options.parser)validateCatalogLocation(html,url,market);
          return parser(html,market,{partial:true});
      };
      let fetched;
      try {
        fetched=await fetchAntHtml(url,market,key,{...options,attempts,parse});
      } catch(error) {
        // Public official HTML is an independent fallback, never a relaxed parser.
        // Do not hide authentication/balance failures or retry untrusted pagination.
        const last=attempts.at(-1);
        if(![423,500,502,503,504].includes(last?.status) || (options.fetcher&&!options.directFetcher))throw error;
        const evidence={market,url,mode:'direct-official',credits:0};
        attempts.push(evidence);
        try {
          const response=await (options.directFetcher||fetch)(url,{signal:AbortSignal.timeout(30_000),
            headers:{accept:'text/html','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'}});
          evidence.status=response.status;
          if(!response.ok)throw new Error(`Direct official HTTP ${response.status}`);
          const html=await response.text();
          evidence.bytes=Buffer.byteLength(html);
          evidence.sha256=createHash('sha256').update(html).digest('hex');
          evidence.fetchedAt=new Date().toISOString();
          if(options.onHtml)await options.onHtml(html,evidence);
          const parsed=parse(html);
          evidence.pageItems=parsed.pageItems;evidence.officialTotal=parsed.reportedTotal;
          fetched={parsed,mode:evidence.mode};
        } catch(directError) {
          evidence.error=directError.message;
          throw new Error(`${error.message} | ${directError.message}`);
        }
      }
      const {parsed,mode}=fetched;
      if (total === undefined) { total = parsed.reportedTotal; firstPage = parsed; }
      if (parsed.reportedTotal !== total) throw unstableCatalog('Official total changed during pagination');
      for (const sku of parsed.skus || []) {
        if (skus.has(sku)) throw unstableCatalog(`Duplicate SKU across catalog pages: ${sku}`);
        skus.add(sku);
      }
      pages.push({url,pageItems:parsed.pageItems,reportedTotal:parsed.reportedTotal,mode});
      products.push(...parsed.products);
      records.push(...(parsed.records||[]));
      let count = pages.reduce((sum,p)=>sum+p.pageItems,0);
      if (count > total) throw unstableCatalog('Catalog page counts exceed official total');
      if (!parsed.next) {
        if(count<total && total-count<=5 && records.length===count && options.facetRecovery!==false) {
          // Ranking only limits cost; acceptance still needs exact official totals,
          // rendered SKU records, matching overlaps and closing consistency checks.
          const normalize=s=>' '+normalizeCatalogTitle(s).toLowerCase()+' ';
          const candidates=(firstPage.recoveryFacets||[]).map(f=>{
            const terms=[f.name,...String(f.value).split(';')].map(normalize);
            const observed=records.filter(p=>terms.some(t=>normalize(p.name).includes(t))).length;
            return {...f,deficit:f.total-observed};
          }).filter(f=>f.deficit>0).sort((a,b)=>b.deficit-a.deficit||a.total-b.total).slice(0,3);
          for(const facet of candidates) {
            const facetUrl=new URL(facet.url),base=new URL(categoryUrl(market));
            if(facetUrl.origin!==base.origin || facetUrl.pathname!==base.pathname ||
              facetUrl.username || facetUrl.password || facetUrl.hash ||
              [...facetUrl.searchParams.keys()].length!==1 ||
              facetUrl.searchParams.get('facet_line')!==facet.value)
              throw new Error('Unsafe official recovery facet URL');
            const result=await fetchAntHtml(facet.url,market,key,{...options,attempts,parse:html=>{
              if(!options.parser)validateCatalogLocation(html,facet.url,market);
              return parser(html,market,{partial:true});
            }});
            const recovered=result.parsed;
            if(recovered.reportedTotal!==facet.total || recovered.pageItems!==facet.total ||
              recovered.next || recovered.records?.length!==facet.total ||
              recovered.skus?.length!==facet.total)
              throw unstableCatalog('Official recovery facet is incomplete or changed');
            let added=0;
            for(const record of recovered.records) {
              const existing=records.find(p=>p.sku===record.sku);
              if(existing) {
                if(JSON.stringify(existing)!==JSON.stringify(record))
                  throw unstableCatalog('Conflicting SKU metadata in official recovery facet: '+record.sku);
              } else {
                records.push(record);skus.add(record.sku);added++;
                const target=recovered.products.find(p=>p.sku===record.sku);
                if(target)products.push(target);
              }
            }
            count=skus.size;
            pages.push({url:facet.url,kind:'facet-recovery',pageItems:recovered.pageItems,
              reportedTotal:recovered.reportedTotal,addedSkus:added,mode:result.mode});
            recoveredFacets.push({facet,parsed:recovered});
            if(count>total)throw unstableCatalog('Recovered unique SKU count exceeds official total');
            if(count===total)break;
          }
        }
        if (count !== total || (parsed.skus && skus.size !== total))
          throw unstableCatalog(`Incomplete Hermès catalog: received ${count} of ${total} total products; missing next page`);
        // Re-fetch the first page after pagination: reject a moving boundary/total.
        if (pages.length > 1) {
          const firstUrl = categoryUrl(market);
          const closing = await fetchAntHtml(firstUrl,market,key,{...options,attempts,parse:html=>{
            if(!options.parser)validateCatalogLocation(html,firstUrl,market);
            return parser(html,market,{partial:true});
          }});
          if (catalogFingerprint(closing.parsed) !== catalogFingerprint(firstPage))
            throw unstableCatalog('Official catalog changed during closing first-page verification');
        }
        for(const recovery of recoveredFacets) {
          const {facet}=recovery;
          const closing=await fetchAntHtml(facet.url,market,key,{...options,attempts,parse:html=>{
            if(!options.parser)validateCatalogLocation(html,facet.url,market);
            return parser(html,market,{partial:true});
          }});
          if(catalogFingerprint(closing.parsed)!==catalogFingerprint(recovery.parsed))
            throw unstableCatalog('Official recovery facet changed during closing verification');
        }
        return {parsed:{products,records,pageItems:count,reportedTotal:total,skus:[...skus],pages,
          recovery:recoveredFacets.length?'official linked line facets (exact unique total)':'none',
          coverage:'all published category SKUs; exact official total with closing page and recovery-facet verification'},
          credits:attempts.reduce((sum,a)=>sum+a.credits,0),
          mode:recoveredFacets.length?'facet-recovered':pages.length>1?'paginated':mode,attempts};
      }
      if (count === total) throw unstableCatalog('Unexpected next page after complete catalog');
      url = nextCatalogUrl(parsed.next,url,market);
    }
    throw new Error('Official catalog exceeded pagination limit');
  } catch (error) {
    error.attempts = attempts;
    error.pages = pages;
    throw error;
  }
}


function unstableCatalog(message) {
  return Object.assign(new Error(message),{retryCatalog:true});
}
function catalogFingerprint(parsed) {
  return JSON.stringify([parsed.reportedTotal,parsed.pageItems,parsed.skus,parsed.next,parsed.records||parsed.products,parsed.recoveryFacets]);
}

export async function fetchOfficialCatalog(market,key,options={}) {
  const attempts=[], scans=[];
  const wait=options.wait || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  for(let scan=1;scan<=3;scan++) {
    try {
      // Each attempt owns fresh totals, pages, products and SKU sets. Never merge scans.
      const result=await fetchCatalogScan(market,key,{...options,browserOnly:scan===3 && options.browserRecovery===true,onHtml:async(html,evidence)=>{
        evidence.scan=scan;
        if(options.onHtml)await options.onHtml(html,evidence);
      }});
      attempts.push(...result.attempts.map(a=>({...a,scan})));
      scans.push({scan,transport:scan===3 && options.browserRecovery===true?'browser':'http',status:'verified',pages:result.parsed.pages});
      return {...result,attempts,scans,credits:attempts.reduce((n,a)=>n+a.credits,0)};
    } catch(error) {
      attempts.push(...(error.attempts||[]).map(a=>({...a,scan})));
      scans.push({scan,transport:scan===3 && options.browserRecovery===true?'browser':'http',status:'unknown',error:error.message,pages:error.pages||[]});
      if(!error.retryCatalog || scan===3) {
        error.attempts=attempts; error.scans=scans;
        throw error;
      }
      await wait(1500*scan);
    }
  }
}
