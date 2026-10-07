const apiKey = process.env.SCRAPINGANT_API_KEY || "";
if (!apiKey) throw new Error("SCRAPINGANT_API_KEY missing");

const cases = [
  {
    market: "US",
    country: "us",
    sku: "H085933CKAB",
    url: "https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
    note: "Silkycity 33; known backend ecom=true",
  },
  {
    market: "CA",
    country: "ca",
    sku: "H087968CC55",
    url: "https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
    note: "Le Petit Sac; category no Discover",
  },
];

for (const item of cases) {
  const params = new URLSearchParams({
    url: item.url,
    browser: "false",
    proxy_type: "datacenter",
    proxy_country: item.country,
    timeout: "60",
  });
  const response = await fetch(`https://api.scrapingant.com/v2/general?${params}`, {
    headers: {
      "x-api-key": apiKey,
      accept: "text/html,*/*",
      "ant-user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "ant-accept-language": "en-US,en;q=0.9",
    },
  });
  const html = await response.text();
  const i = html.toUpperCase().indexOf(item.sku);
  const segment = i >= 0 ? html.slice(Math.max(0, i - 3000), Math.min(html.length, i + 7000)) : "";
  const text = segment.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
  const attrs = [...segment.matchAll(/(?:stock|avail|displayOnly|ecom|add-to-cart|add to cart|add to bag)[^<>"']{0,160}/gi)].slice(0,50).map(m=>m[0]);

  console.log(JSON.stringify({
    market:item.market,
    note:item.note,
    status:response.status,
    credits:response.headers.get("ant-credits-cost"),
    htmlLength:html.length,
    skuFound:i>=0,
    segmentHasAdd:/Add to (?:cart|bag)|add-to-cart/i.test(segment),
    segmentHasDiscover:/\bDiscover\b/i.test(text),
    stockHints:attrs,
    textSample:text.slice(0,3000),
  },null,2));
}
