import { parseHermesCatalog } from './ant-catalog.mjs';
import { createHash } from 'node:crypto';

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
  const modes = [
    {browser:false, mode:'low-credit-1'},
    {browser:false, mode:'low-credit-retry'},
    {browser:true, mode:'browser-fallback'},
  ];
  const errors = [];
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    if (i) await wait(1200 * i);
    const params = new URLSearchParams({url, browser:String(mode.browser),
      proxy_type:'datacenter', proxy_country:market.toLowerCase(), timeout:'50'});
    if (mode.browser) for (const type of ['image','media','font']) params.append('block_resource',type);
    const evidence = {market,url,mode:mode.mode,credits:0};
    attempts.push(evidence);
    try {
      const response = await fetcher(`https://api.scrapingant.com/v2/general?${params}`, {
        headers:{'x-api-key':key,accept:'text/html,*/*'}, signal:AbortSignal.timeout(60_000),
      });
      evidence.status = response.status;
      const used = Number(response.headers.get('ant-credits-cost') || 0);
      evidence.credits = Number.isFinite(used) && used >= 0 ? used : 0;
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
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

export async function fetchOfficialCatalog(market, key, options = {}) {
  if (!['US','CA'].includes(market) || !key) throw new Error('Invalid market or missing key');
  const parser = options.parser || parseHermesCatalog;
  const attempts = [];
  const pages = [], products = [], skus = new Set();
  let url = categoryUrl(market), total;
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
      if (total === undefined) total = parsed.reportedTotal;
      if (parsed.reportedTotal !== total) throw new Error('Official total changed during pagination');
      for (const sku of parsed.skus || []) {
        if (skus.has(sku)) throw new Error(`Duplicate SKU across catalog pages: ${sku}`);
        skus.add(sku);
      }
      pages.push({url,pageItems:parsed.pageItems,reportedTotal:parsed.reportedTotal,mode});
      products.push(...parsed.products);
      const count = pages.reduce((sum,p)=>sum+p.pageItems,0);
      if (count > total) throw new Error('Catalog page counts exceed official total');
      if (!parsed.next) {
        if (count !== total || (parsed.skus && skus.size !== total))
          throw new Error(`Incomplete Hermès catalog: received ${count} of ${total} total products; missing next page`);
        return {parsed:{products,pageItems:count,reportedTotal:total,skus:[...skus],pages,
          coverage:'all pages of the currently published category (verified total and unique SKUs)'},
          credits:attempts.reduce((sum,a)=>sum+a.credits,0),mode:pages.length>1?'paginated':mode,attempts};
      }
      if (count === total) throw new Error('Unexpected next page after complete catalog');
      url = nextCatalogUrl(parsed.next,url,market);
    }
    throw new Error('Official catalog exceeded pagination limit');
  } catch (error) {
    error.attempts = attempts;
    error.pages = pages;
    throw error;
  }
}
