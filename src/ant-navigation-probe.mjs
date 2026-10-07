const apiKey = process.env.SCRAPINGANT_API_KEY || "";
if (!apiKey) throw new Error("SCRAPINGANT_API_KEY missing");
const target = "https://www.hermes.com/us/en/product/lindy-ii-mini-bag-H085956CCY1/";
const params = new URLSearchParams({
  url: target,
  browser: "false",
  proxy_type: "datacenter",
  proxy_country: "us",
  timeout: "60",
});
const res=await fetch(`https://api.scrapingant.com/v2/markdown?${params}`,{
  headers:{"x-api-key":apiKey,accept:"application/json"}
});
const cost=res.headers.get("ant-credits-cost");
if(!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,500)}`);
const data=await res.json();
const md=String(data.markdown||"");
function around(re){
  const m=md.match(re);
  if(!m || m.index==null) return "";
  return md.slice(Math.max(0,m.index-350),Math.min(md.length,m.index+700)).replace(/\s+/g," ");
}
console.log(JSON.stringify({
  status:res.status,
  cost:Number(cost||0)||null,
  length:md.length,
  productReference:md.match(/Product reference\s*:?\s*([A-Z0-9]+)/i)?.[1]||"",
  buyContext:around(/Add to (?:cart|bag)/i),
  unavailableContext:around(/Available soon|Unavailable|Sold out|no longer available|currently unavailable|back in stock/i)
},null,2));
