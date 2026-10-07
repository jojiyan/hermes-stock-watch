const apiKey = process.env.SCRAPINGANT_API_KEY || "";
if (!apiKey) throw new Error("SCRAPINGANT_API_KEY missing");

const cases = [
  { market: "US-DISCOVER", locale: "us_en", preferredCountry: "us", sku: "H085956CCY1", note: "Lindy II mini; category currently shows Discover" },
  { market: "US-NO-DISCOVER", locale: "us_en", preferredCountry: "us", sku: "H085933CKAB", note: "Silkycity 33; category currently has no Discover" },
  { market: "CA-NO-DISCOVER", locale: "ca_en", preferredCountry: "ca", sku: "H087968CC55", note: "Le Petit Sac; category currently has no Discover" },
  { market: "CA-NO-DISCOVER-2", locale: "ca_en", preferredCountry: "ca", sku: "H087987CK2D", note: "Hermes Videpoches; category currently has no Discover" },
];

const headers = {
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
};

for (const item of cases) {
  const target = `https://bck.hermes.com/product?productsku=${item.sku}&locale=${item.locale}`;
  const countries = [item.preferredCountry, "", item.preferredCountry === "ca" ? "us" : "ca"];
  const attempts = [];
  let data = null;

  for (const country of countries) {
    const params = new URLSearchParams({
      url: target,
      browser: "false",
      proxy_type: "datacenter",
      timeout: "60",
    });
    if (country) params.set("proxy_country", country);

    const response = await fetch(`https://api.scrapingant.com/v2/general?${params}`, { headers });
    const text = await response.text();
    const credits = response.headers.get("ant-credits-cost");
    attempts.push({ country: country || "random", status: response.status, credits });

    if (!response.ok) continue;
    try { data = JSON.parse(text); } catch {}
    if (data?.sku) break;
  }

  const variants = Array.isArray(data?.variants?.colors)
    ? data.variants.colors.map((v) => ({
        sku: v.sku,
        stock: v.stock,
        price: v.price,
        title: v.title,
      }))
    : [];

  console.log(JSON.stringify({
    market: item.market,
    note: item.note,
    sku: item.sku,
    attempts,
    responseSku: data?.sku || null,
    title: data?.title || null,
    stock: data?.stock || null,
    displayMode: data?.displayMode ?? null,
    labelDisplayOnly: data?.labelDisplayOnly ?? null,
    variants,
  }, null, 2));
}
