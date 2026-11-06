// Exact selected colour names, never the catalog's generic "Blue" group.
const normalize = value => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function isGarden23(name) {
  return /\b(?:neo )?garden(?: party)? 23\b|\bmini garden(?: party)?\b|\bgarden party mini\b/.test(normalize(name));
}

export function stockPriority(product) {
  if (!isGarden23(product.name)) return {rank: 4, label: ''};
  const colours = normalize(product.color).split(/\s*[/,;|]\s*/);
  if (colours.some(c => /^(?:bleu paradis|blue paradise|paradise blue|天堂蓝|天堂藍)$/.test(c)))
    return {rank: 1, label: '天堂蓝 Garden 23'};
  if (colours.some(c => /^(?:bleu zephyr|blue zephyr|zephyr blue|微风蓝|微風藍)$/.test(c)))
    return {rank: 2, label: '微风蓝 Garden 23'};
  return {rank: 3, label: ''};
}

export function prioritizeProducts(products) {
  return [...products].sort((a, b) => stockPriority(a).rank - stockPriority(b).rank);
}

function localProduct(p,market) {
  try {
    const u=new URL(p.url),match=u.pathname.match(/^\/(us|ca)\/en\/product\/([a-z0-9-]+)-(H[A-Z0-9]{7,16})\/$/);
    return p.market===market&&isGarden23(p.name)&&u.origin==='https://www.hermes.com'&&
      !u.username&&!u.password&&!u.search&&!u.hash&&match?.[1]===market.toLowerCase()&&match[3]===p.sku;
  } catch {return false;}
}

export function discoverPriorityVariants(html,candidate) {
  if(!isGarden23(candidate.name)||!localProduct(candidate,candidate.market))return [];
  try {
    const raw=html.match(/<script\b(?=[^>]*\bid=["']hermes-state["'])[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    const bodies=Object.values(JSON.parse(raw)).map(x=>x?.b).filter(p=>p?.sku===candidate.sku&&
      p.url===new URL(candidate.url).pathname&&isGarden23(p.title));
    if(bodies.length!==1)return [];
    const p=bodies[0],parent=p.variationParentProduct;
    if(p.url!==`/${candidate.market.toLowerCase()}/en/product/${p.slug}-${p.sku}/`||
      !/^H[A-Z0-9]{7,14}$/.test(parent)||!candidate.sku.startsWith(parent)||
      !/^[A-Z0-9]{2}$/.test(candidate.sku.slice(parent.length)))return [];
    return (p.variants?.colors||[]).flatMap(v=>{
      const product={market:candidate.market,marketName:candidate.marketName,sku:v.sku,
        name:v.title||p.title,color:v.color,url:new URL(v.url,'https://www.hermes.com').href,
        price:'',watchOnly:true,discoveredVia:'official-product-variant'};
      return typeof v.sku==='string'&&v.sku.startsWith(parent)&&/^[A-Z0-9]{2}$/.test(v.sku.slice(parent.length))&&
        v.slug===p.slug&&localProduct(product,candidate.market)&&stockPriority(product).rank<=2?[product]:[];
    }).slice(0,8);
  } catch {return [];}
}

export function rememberPriorityProducts(previous,parsed,market,checkedAt) {
  const products=new Map(Object.values(previous.priorityWatchProducts||{})
    .filter(p=>localProduct(p,market)&&stockPriority(p).rank<=2).map(p=>[p.sku,p]));
  for(const p of [...(parsed.discoveredPriorityProducts||[]),...parsed.products.filter(p=>p.purchaseVerified===true)]) {
    if(!localProduct(p,market)||stockPriority(p).rank>2)continue;
    products.set(p.sku,{market,sku:p.sku,name:p.name,color:p.color,url:p.url,lastDiscoveredAt:checkedAt,
      source:p.purchaseVerified?'official-product-purchase':'official-product-variant'});
  }
  return Object.fromEntries([...products.values()].sort((a,b)=>
    String(b.lastDiscoveredAt).localeCompare(String(a.lastDiscoveredAt))||stockPriority(a).rank-stockPriority(b).rank)
    .slice(0,8).map(p=>[p.sku,p]));
}

export function priorityWatchCandidates(market,previous={}) {
  if (!['US', 'CA'].includes(market)) throw new Error('Unsupported priority market');
  // Start with URLs actually published in that market; never translate a CA
  // product reference into an assumed US listing. Seeds discover colour links.
  // https://www.hermes.com/us/en/product/neo-garden-23-bag-H086422CK18/
  // https://www.hermes.com/us/en/product/neo-garden-23-bag-H086418CKAC/
  // https://www.hermes.com/ca/en/product/neo-garden-23-bag-H088612CKAQ/
  const skus=market==='US'?['H086422CK18','H086418CKAC']:['H088612CKAQ'];
  const products=new Map(skus.map(sku=>[sku,{market,
    marketName:market==='US'?'Hermès USA':'Hermès Canada',sku,name:'Neo Garden 23 bag',
    color:'',price:'',watchOnly:true,
    url:`https://www.hermes.com/${market.toLowerCase()}/en/product/neo-garden-23-bag-${sku}/`}]));
  for(const p of Object.values(previous.priorityWatchProducts||{}).filter(p=>localProduct(p,market)&&stockPriority(p).rank<=2).slice(0,8))
    products.set(p.sku,{...p,marketName:market==='US'?'Hermès USA':'Hermès Canada',watchOnly:true});
  return prioritizeProducts([...products.values()]);
}
