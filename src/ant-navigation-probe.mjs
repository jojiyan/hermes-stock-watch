const apiKey = process.env.SCRAPINGANT_API_KEY || "";
if (!apiKey) throw new Error("SCRAPINGANT_API_KEY missing");

const category = "https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/";
const target = "https://www.hermes.com/us/en/product/lindy-ii-mini-bag-H085956CCY1/";
const js = `
  const target = ${JSON.stringify(target)};
  const sku = "H085956CCY1";
  const a = Array.from(document.querySelectorAll("a")).find(el => (el.href || "").includes(sku));
  if (a) {
    a.click();
  } else {
    window.location.href = target;
  }
  await new Promise(r => setTimeout(r, 8000));
`;
const params = new URLSearchParams({
  url: category,
  browser: "true",
  proxy_type: "datacenter",
  proxy_country: "us",
  timeout: "60",
  js_snippet: Buffer.from(js, "utf8").toString("base64"),
});
params.append("block_resource","image");
params.append("block_resource","media");
params.append("block_resource","font");

const res = await fetch(`https://api.scrapingant.com/v2/extended?${params}`, {
  headers: { "x-api-key": apiKey, accept: "application/json" },
});
const cost = res.headers.get("ant-credits-cost");
if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,500)}`);
const data = await res.json();
const html = String(data.html || "");
const text = String(data.text || "").replace(/\s+/g," ");
const sku = html.match(/product:retailer_item_id[^>]*content=["']([^"']+)/i)?.[1] || "";
const buy = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].map(m=>({attrs:m[1],label:m[2].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()})).find(x=>/Add to (cart|bag)/i.test(x.label));
const disabled = buy ? /(?:^|\s)disabled(?:\s|=|$)|aria-disabled=["']true/i.test(buy.attrs) : null;
console.log(JSON.stringify({
  cost: cost ? Number(cost) : null,
  pageStatus: data.status_code ?? null,
  sku,
  title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g," ").trim() || "",
  hasBuyButton: !!buy,
  buyLabel: buy?.label || "",
  disabled,
  unavailable: /Available soon|Unavailable|Sold out|no longer available|currently unavailable|back in stock/i.test(text),
  htmlLength: html.length
}, null, 2));
