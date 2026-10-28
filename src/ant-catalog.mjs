// Parse first-party product stock fields embedded by Hermès in the category page.
// This is direct retail inventory evidence, NOT a scraped "Add to cart" button.
export const REQUESTED_BAGS = [
  /\bneo garden 23\b/i,
  /\b(?:mini garden(?: party)?|garden party (?:mini|23))\b/i,
  /\bgarden party 30\b/i,
  /\blindy(?: ii)? mini\b|\bmini lindy\b/i,
  /\bpicotin\b/i,
  /\bbirkin\b/i,
  /\bkelly\b/i,
  /\bconstance\b/i,
];

export function normalizeCatalogTitle(title) {
  return String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function isRequestedBag(title) {
  return REQUESTED_BAGS.some(r => r.test(normalizeCatalogTitle(title)));
}

export function parseHermesCatalog(html, marketCode, { partial = false } = {}) {
  if(!["US","CA"].includes(marketCode)) throw new Error("Unsupported Hermès market");
  if(typeof html !== "string" || html.length < 10_000) throw new Error("Missing complete category HTML");
  if(/sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|robot challenge/i.test(html.slice(0,15000))) {
    throw new Error("Received an anti-bot/challenge page, not inventory");
  }
  const stateRaw = html.match(/<script\b(?=[^>]*\bid=["']hermes-state["'])[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if(!stateRaw) throw new Error("Missing first-party hermes-state inventory data");
  let state;
  try { state=JSON.parse(stateRaw); }
  catch{throw new Error("Invalid first-party inventory JSON");}
  const matches=Object.values(state).filter(x=>Array.isArray(x?.b?.products?.items));
  const holder=matches.sort((a,b)=>b.b.products.items.length-a.b.products.items.length)[0]?.b;
  if(!holder || !Number.isInteger(holder.products.maxSize)) throw new Error("Unknown Hermès catalog schema");
  const items=holder.products.items;
  if(items.length < (partial ? 1 : 10) || items.length > 500) throw new Error("Incomplete category product list");
  // The "total" field is the official number of products in this catalog
  // (not the number of cards we happened to scrape). Fail CLOSED if a later
  // site redesign introduces pagination, lazy loading or partial hydration.
  const reportedTotal=Number(holder.total);
  if(!Number.isSafeInteger(reportedTotal) || reportedTotal < 0)
    throw new Error("Hermès catalog total count is missing or invalid");
  if(reportedTotal > 500 || reportedTotal < items.length) throw new Error("Invalid Hermès catalog total");
  if(!partial && reportedTotal !== items.length)
    throw new Error(`Incomplete Hermès catalog: received ${items.length} of ${reportedTotal} total products`);
  const result=[], records=[];
  const seen=new Set();
  let recognized=0;
  for(const p of items) {
    if(!p?.sku) throw new Error("Missing official SKU");
    const sku=String(p.sku).toUpperCase();
    if(seen.has(sku)) throw new Error("Duplicate official SKU "+sku);
    if(!/^H[A-Z0-9]{7,16}$/.test(sku)) throw new Error("Invalid official SKU");
    if(typeof p.stock?.ecom!=="boolean")throw new Error("Missing e-commerce stock value for SKU "+sku);
    if(typeof p.title!=="string" || !normalizeCatalogTitle(p.title)) throw new Error("Missing official product title for SKU "+sku);
    const rawPath=String(p.url||"");
    if(!/^\/product\/[a-z0-9-]+\/$/i.test(rawPath) || !rawPath.endsWith("-"+sku+"/"))throw new Error("Unexpected official product URL for SKU "+sku);
    const productUrl=`https://www.hermes.com/${marketCode.toLowerCase()}/en${rawPath}`;
    const tileStart=html.indexOf(`id="grid-product-${sku}"`);
    if(tileStart < 0) throw new Error("Catalog item missing rendered product tile "+sku);
    const nextTile=html.indexOf('id="grid-product-',tileStart+20);
    const tile=html.slice(tileStart,nextTile<0?tileStart+9000:nextTile);
    const unavailableTag=/<h-out-of-stock-label\b[^>]*class=["'][^"']*tag-unavailable/i.test(tile);
    if(p.stock.ecom && unavailableTag) throw new Error("Conflicting e-commerce stock and unavailable badge for "+sku);
    // If the shop explicitly says not ecom available, never alert.
    const ecom=p.stock.ecom && !unavailableTag;
    seen.add(sku);
    recognized+=1;
    const record={
      market:marketCode,
      marketName:marketCode==="US"?"Hermès USA":"Hermès Canada",
      sku, name:String(p.title), color:String(p.avgColor||""),
      price:typeof p.price==="number" ? `$${p.price.toLocaleString("en-US")}` : "",
      url:productUrl, ecom,
      evidence:"Hermès official category: stock.ecom and rendered product tile",
    };
    records.push(record);
    if(isRequestedBag(p.title))result.push(record);
  }
  if(!partial && recognized < 10)throw new Error("Too few verified stock records");
  if(recognized !== items.length)throw new Error("Official product totals did not reconcile with verified SKU records");
  const nextLinks=[...html.matchAll(/<link\b[^>]*>/gi)].filter(x=>/\brel=["']next["']/i.test(x[0]));
  if(nextLinks.length>1) throw new Error("Ambiguous next catalog page");
  const next=nextLinks[0]?.[0].match(/\bhref=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g,"&") || null;
  // Recovery links must be explicitly published in this official page.
  const baseUrl="https://www.hermes.com/"+marketCode.toLowerCase()+"/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/";
  const links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(x=>x[1].replace(/&amp;/g,'&'));
  const facets=(holder.filtersGroup||[]).find(f=>f.attribute==='display_name')?.filters||[];
  const recoveryFacets=facets.filter(f=>f.facetIsCrawlable===true && Number.isSafeInteger(f.total) && f.total>0 && f.total<=40)
    .flatMap(f=>{
      const url=links.find(link=>{
        try {const u=new URL(link,baseUrl),base=new URL(baseUrl);
          return u.origin===base.origin && u.pathname===base.pathname && !u.username && !u.password && !u.hash &&
            [...u.searchParams.keys()].length===1 && u.searchParams.get('facet_line')===f.value;
        }catch{return false;}
      });
      return url?[{name:f.name,value:f.value,total:f.total,url:new URL(url,baseUrl).href}]:[];
    });
  return { products:result, records, recoveryFacets, pageItems:recognized, reportedTotal,
           skus:[...seen], next,
           maxSize:holder.products.maxSize, coverage:"all items of the currently published category (verified total)" };
}

export function reconcileCatalog(previousMarket, parsed, nowIso) {
  const prev=previousMarket||{};
  const previousStatus={...(prev.catalogStocks||{})};
  // Migrate old GitHub alerts from the former product-page monitor. Some of
  // those SKUs have disappeared from the visible catalog, but reappearing
  // must not send a duplicate notification unless observed explicitly sold out.
  const legacyAlerted=Object.fromEntries(Object.values(prev.available||{})
    .filter(x=>x?.sku).map(x=>[x.sku,x.firstSeenAt||nowIso]));
  const notified={...legacyAlerted,...(prev.alertedSkus||{})};
  const available={...(prev.available||{})};
  const newAlerts=[];
  const stocks={...previousStatus};
  for(const p of parsed.products) {
    // Metadata is discovery evidence only. Unknown product pages never rearm alerts.
    if(p.purchaseVerified!==true && !(p.categoryNegativeVerified===true && p.ecom===false)) continue;
    const previously=stocks[p.sku]?.ecom;
    stocks[p.sku]={ecom:p.ecom,seenAt:nowIso,
      source:p.purchaseVerified?'official-product-purchase':'complete-official-category-negative'};
    if(!p.ecom){delete available[p.sku];continue;}
    available[p.sku]={market:p.market,sku:p.sku,name:p.name,
      color:p.color,price:p.price,url:p.url,lastSeenAt:nowIso,source:"official-catalog"};
    const legacyAlert=!!prev.available?.[p.sku];
    if(previously!==true && (previously===false || (!notified[p.sku]&&!legacyAlert))) {
      newAlerts.push(p);
      notified[p.sku]=nowIso;
    }
  }
  // A negative observation explicitly rearms the SKU, but a missing catalog
  // entry does not: pagination and disappearing listings are not sell-out proof.
  for(const p of parsed.products) if((p.purchaseVerified===true||p.categoryNegativeVerified===true) && !p.ecom)delete notified[p.sku];
  return {available,catalogStocks:stocks,alertedSkus:notified,alerts:newAlerts};
}
