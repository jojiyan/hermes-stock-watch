const apiKey = process.env.SCRAPINGANT_API_KEY || "";
if (!apiKey) throw new Error("SCRAPINGANT_API_KEY missing");

const target = "https://www.hermes.com/us/en/product/lindy-ii-mini-bag-H085956CCY1/";
const modes = [
  {browser:false, proxy_type:"datacenter", label:"markdown-datacenter"},
  {browser:false, proxy_type:"residential", label:"markdown-residential"},
  {browser:true, proxy_type:"datacenter", label:"markdown-browser-datacenter"},
];

const results=[];
for (const mode of modes) {
  const params = new URLSearchParams({
    url: target,
    browser: mode.browser ? "true" : "false",
    proxy_type: mode.proxy_type,
    proxy_country: "us",
    timeout: "60",
  });
  if (mode.browser) {
    params.append("block_resource","image");
    params.append("block_resource","media");
    params.append("block_resource","font");
  }
  const res=await fetch(`https://api.scrapingant.com/v2/markdown?${params}`,{
    headers:{"x-api-key":apiKey,accept:"application/json"}
  });
  const cost=res.headers.get("ant-credits-cost");
  if(!res.ok){
    results.push({label:mode.label,status:res.status,cost,body:(await res.text()).slice(0,350)});
    continue;
  }
  const data=await res.json();
  const md=String(data.markdown||"");
  results.push({
    label:mode.label,status:res.status,cost:Number(cost||0)||null,length:md.length,
    hasBuy:/\bAdd to (?:cart|bag)\b/i.test(md),
    unavailable:/Available soon|Unavailable|Sold out|no longer available|currently unavailable|back in stock/i.test(md),
    sample:md.slice(0,1200)
  });
  break;
}
console.log(JSON.stringify(results,null,2));
