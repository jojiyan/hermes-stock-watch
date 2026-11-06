import { parseProductPageHtml } from './hermes.mjs';
import { fetchAntHtml } from './ant-catalog-fetch.mjs';
import {isGarden23, prioritizeProducts} from './ant-priority.mjs';

function matchesOfficialVariantParent(html, canonical, candidate) {
  // Hermès may canonicalize every colour to a sibling SKU. Accept that only
  // when its own product response explicitly maps the requested SKU/URL to
  // this canonical path and both SKUs share the declared variant parent.
  try {
    const requested=new URL(candidate.url), parentUrl=new URL(canonical);
    if(requested.origin!=='https://www.hermes.com'||parentUrl.origin!==requested.origin||
      parentUrl.username||parentUrl.password||parentUrl.search||parentUrl.hash) return false;
    const raw=html.match(/<script\b(?=[^>]*\bid=["']hermes-state["'])[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if(!raw)return false;
    const state=JSON.parse(raw);
    const bodies=Object.values(state).map(x=>x?.b).filter(p=>p?.sku===candidate.sku&&p?.variationParentProduct);
    if(bodies.length!==1)return false;
    const p=bodies[0],parent=p.variationParentProduct;
    if(!/^H[A-Z0-9]{7,14}$/.test(parent)||!candidate.sku.startsWith(parent)||
      !/^[A-Z0-9]{2}$/.test(candidate.sku.slice(parent.length))||
      !/^[a-z0-9-]+$/.test(p.slug))return false;
    const prefix=`/${candidate.market.toLowerCase()}/en/product/${p.slug}-`;
    if(requested.pathname!==prefix+candidate.sku+'/'||p.url!==requested.pathname||
      p.path!==parentUrl.pathname||!parentUrl.pathname.startsWith(prefix))return false;
    const canonicalSku=parentUrl.pathname.slice(prefix.length,-1);
    if(parentUrl.pathname!==prefix+canonicalSku+'/'||!canonicalSku.startsWith(parent)||
      !/^[A-Z0-9]{2}$/.test(canonicalSku.slice(parent.length)))return false;
    return Array.isArray(p.variants?.colors)&&p.variants.colors.some(v=>
      v.sku===candidate.sku&&v.url===requested.pathname&&v.slug===p.slug);
  } catch {return false;}
}

function visibleHtml(html) {
  const stack=[];
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  let out='',cursor=0;
  for(const match of html.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)) {
    const hidden=stack.some(x=>x.hidden);
    if(!hidden)out+=html.slice(cursor,match.index);
    const tag=match[1].toLowerCase();
    if(match[0].startsWith('</')) {
      const index=stack.findLastIndex(x=>x.tag===tag);
      if(index>=0)stack.splice(index);
      if(!hidden)out+=match[0];
    } else {
      const ownHidden=/(?:^|\s)(?:hidden|inert)(?:\s|=|>|\/)|aria-hidden\s*=\s*(?:["']true["']|true\b)|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(match[0]);
      const disabled=stack.some(x=>x.disabled) || (tag==='fieldset' && /\sdisabled(?:\s|=|>)/i.test(match[0]));
      if(!hidden&&!ownHidden)out+=tag==='button'&&disabled?match[0].replace('<button','<button disabled'):match[0];
      if(!voidTags.has(tag)&&!match[0].endsWith('/>'))stack.push({tag,hidden:hidden||ownHidden,disabled});
    }
    cursor=match.index+match[0].length;
  }
  if(!stack.some(x=>x.hidden))out+=html.slice(cursor);
  return out;
}

export function parseOfficialPurchase(html, candidate) {
  if(typeof html!=='string'||html.length<5000)throw new Error('Incomplete official product HTML');
  // Remove non-rendered text before SKU and action checks.
  const clean = visibleHtml(html.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
    .replace(/<!--[\s\S]*?-->/g,''));
  const canonical = [...clean.matchAll(/<link\b[^>]*>/gi)]
    .find(x=>/\brel=["']canonical["']/i.test(x[0]))?.[0]
    .match(/\bhref=["']([^"']+)["']/i)?.[1];
  const canonicalEvidence=canonical===candidate.url?'matching-product-url':
    matchesOfficialVariantParent(html,canonical,candidate)?'official-variant-parent':null;
  if (!canonicalEvidence) throw new Error('Product canonical URL/market/SKU mismatch');
  const base = clean.match(/<base\b[^>]*href=["']([^"']+)["']/i)?.[1];
  if (base !== `/${candidate.market.toLowerCase()}/en/`) throw new Error('Product market base mismatch');
  const start = clean.search(/<h1\b/i);
  if (start < 0) throw new Error('Missing main product heading');
  // Recommendation buttons must never establish availability of the main SKU.
  const main = clean.slice(start).split(/<h-product-recommendations\b|<h-recommendations\b|You may also like|Complete your look/i)[0];
  const description = main.search(/Product description/i);
  const purchase = description >= 0 ? main.slice(0,description) : main;
  const buttons = [...purchase.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]
    .filter(x=>/\bAdd to (?:cart|bag)\b/i.test(x[2].replace(/<[^>]*>/g,' ')));
  if (buttons.some(x=>/(?:^|\s)(?:hidden|inert)(?:\s|=|$)|aria-hidden\s*=\s*["']true["']|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(x[1])))
    throw new Error('Hidden purchase action cannot verify stock');
  // The common parser verifies visible Product reference and explicit unavailable evidence.
  // Supply only the main purchase buttons; retain the full main product description/reference.
  const scoped = main.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi,'') + buttons.map(x=>x[0]).join('');
  const result = parseProductPageHtml(scoped + ' '.repeat(5000),candidate);
  if (candidate.watchOnly && !isGarden23(result.name)) throw new Error('Priority watch product model mismatch');
  return {...candidate, name:result.name, color:result.color, material:result.material,
    price:result.price, ecom:result.available, purchaseVerified:true, canonicalEvidence,
    purchaseAction:result.purchaseAction, purchaseButtonDisabled:result.purchaseButtonDisabled,
    evidence:result.available?'Official matching product page: enabled Add to cart/Add to bag':'Official matching product page: disabled purchase button or explicit unavailable message'};
}

export async function verifyOfficialProducts(parsed, market, key, options = {}) {
  const attempts = [], products = [], verificationErrors = [], priorityWatchErrors = [];
  for (const candidate of prioritizeProducts(parsed.products)) {
    // A complete official catalog explicitly says this SKU cannot be bought.
    // It needs no expensive/blocked detail request, and can never be positive.
    if(candidate.ecom===false && !candidate.watchOnly && options.verifyAllTargets!==true) {
      products.push({...candidate,categoryNegativeVerified:true,
        evidence:'Complete official catalog: stock.ecom=false (not purchasable)',purchaseAction:''});
      continue;
    }
    try {
      const result = await fetchAntHtml(candidate.url,market,key,{...options,attempts,
        parse:html=>parseOfficialPurchase(html,candidate)});
      products.push(result.parsed);
    } catch (error) {
      (candidate.watchOnly ? priorityWatchErrors : verificationErrors)
        .push({sku:candidate.sku,url:candidate.url,error:error.message});
    }
  }
  return {...parsed, products, verificationErrors, priorityWatchErrors, purchaseAttempts:attempts};
}

