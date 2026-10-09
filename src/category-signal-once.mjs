import { Buffer } from "node:buffer";
const key=process.env.SCRAPINGANT_API_KEY;
if(!key)throw new Error("Missing SCRAPINGANT_API_KEY");
const target="https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/";
const params=new URLSearchParams({url:target,browser:"false",proxy_country:"us",proxy_type:"datacenter",timeout:"50"});
const res=await fetch("https://api.scrapingant.com/v2/general?"+params,{headers:{"x-api-key":key,"accept":"text/html,*/*"}});
const html=await res.text();
const signals=["H086422CK37","H056289CC3Y","H051551CKCM","availability","inventory","outOfStock","inStock","stockStatus","addToCart","Add to cart","product-card","product-item","data-product"];
const rows=signals.map(term=>{
 const i=html.toLowerCase().indexOf(term.toLowerCase());
 return {term,count:html.toLowerCase().split(term.toLowerCase()).length-1,firstSnippet:i<0?null:html.slice(Math.max(0,i-220),i+420).replace(/\s+/g," ").slice(0,650)};
});
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)].map(m=>({attrs:m[1].slice(0,150),len:m[2].length,containsSku:/H086422CK37|H051551CKCM/i.test(m[2])})).filter(x=>x.containsSku||/application\/ld\+json|__NEXT_DATA__|application\/json/i.test(x.attrs)).slice(0,20);
console.log(JSON.stringify({status:res.status,credits:res.headers.get("ant-credits-cost"),length:html.length,title:html.match(/<title[^>]*>([^<]*)/i)?.[1]||"",signals:rows,scripts},null,2));
