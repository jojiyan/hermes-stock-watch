const apiKey = process.env.SCRAPINGANT_API_KEY || "";
if (!apiKey) throw new Error("SCRAPINGANT_API_KEY missing");

const cases = [
  { market: "US", country: "us", url: "https://bck.hermes.com/product?productsku=H085956CCY1&locale=us_en" },
  { market: "CA", country: "ca", url: "https://bck.hermes.com/product?productsku=H087968CC55&locale=ca_en" },
  { market: "US-LIST", country: "us", url: "https://bck.hermes.com/products?category=WOMEN&sort=relevance&pagesize=10&locale=us_en" },
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
      accept: "application/json,text/plain,*/*",
      "ant-user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "ant-accept": "application/json, text/plain, */*",
      "ant-accept-language": "en-US,en;q=0.9",
      "ant-origin": "https://www.hermes.com",
      "ant-referer": "https://www.hermes.com/",
      "ant-sec-fetch-dest": "empty",
      "ant-sec-fetch-mode": "cors",
      "ant-sec-fetch-site": "same-site",
    },
  });

  const text = await response.text();
  const credits = response.headers.get("ant-credits-cost");
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}

  const interesting = [];
  const seen = new WeakSet();
  function scan(value, path = "$", depth = 0) {
    if (depth > 8 || interesting.length >= 120 || value == null) return;
    if (typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
      for (const [k, v] of Object.entries(value)) {
        const p = `${path}.${k}`;
        if (/(avail|stock|sell|order|buy|cart|inventory|quantity|status|sku|price)/i.test(k) && (typeof v !== "object" || v === null)) {
          interesting.push([p, v]);
        }
        scan(v, p, depth + 1);
      }
    }
  }
  if (parsed) scan(parsed);

  console.log(JSON.stringify({
    market: item.market,
    target: item.url,
    status: response.status,
    ok: response.ok,
    credits,
    contentType: response.headers.get("content-type"),
    length: text.length,
    topLevelKeys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 80) : [],
    interesting: interesting.slice(0, 120),
    preview: text.slice(0, 2500),
  }, null, 2));
}
