const apiKey = process.env.SCRAPINGANT_API_KEY || "";
if (!apiKey) throw new Error("SCRAPINGANT_API_KEY missing");

const cases = [
  { market:"US", country:"us", sku:"H085956CCY1", note:"Lindy ecom=false / Discover" },
  { market:"US", country:"us", sku:"H085933CKAB", note:"Silkycity ecom=true / no Discover" },
  { market:"CA", country:"ca", sku:"H087968CC55", note:"Le Petit Sac / no Discover" },
];

const htmlByMarket = new Map();

for (const item of cases) {
  if (!htmlByMarket.has(item.market)) {
    const url = `https://www.hermes.com/${item.market.toLowerCase()}/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/`;
    const params = new URLSearchParams({
      url,
      browser:"false",
      proxy_type:"datacenter",
      proxy_country:item.country,
      timeout:"60",
    });
    const response = await fetch(`https://api.scrapingant.com/v2/general?${params}`, {
      headers:{
        "x-api-key":apiKey,
        accept:"text/html,*/*",
        "ant-user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        "ant-accept-language":"en-US,en;q=0.9",
      },
    });
    htmlByMarket.set(item.market,{html:await response.text(),status:response.status,credits:response.headers.get("ant-credits-cost")});
  }

  const {html,status,credits}=htmlByMarket.get(item.market);
  const i=html.toUpperCase().indexOf(item.sku);
  const start=i>=0?html.lastIndexOf("<h-grid-result-item",i):-1;
  const end=start>=0?html.indexOf("</h-grid-result-item>",i):-1;
  const tile=start>=0&&end>=0?html.slice(start,end+"</h-grid-result-item>".length):"";

  const buttons=[...tile.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].map(m=>({
    attrs:m[1].replace(/\s+/g," ").trim(),
    text:m[2].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(),
  }));
  const addButtons=buttons.filter(b=>/add-to-cart|Add to (?:cart|bag)/i.test(b.attrs+" "+b.text)).map(b=>({
    ...b,
    disabled:/(?:^|\s)disabled(?:\s|=|$)|aria-disabled=["']true["']/i.test(b.attrs)
  }));
  const text=tile.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();

  console.log(JSON.stringify({
    market:item.market,note:item.note,sku:item.sku,status,credits,
    skuFound:i>=0,tileFound:!!tile,tileLength:tile.length,
    discover:/\bDiscover\b/i.test(text),
    addButtons,
    textSample:text.slice(0,1200),
  },null,2));
}
