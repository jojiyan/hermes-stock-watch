const apiKey = process.env.SCRAPINGANT_API_KEY || "";
if (!apiKey) throw new Error("SCRAPINGANT_API_KEY missing");

const targets = [
  { sku: "H087968CC55", locale: "ca_en", note: "CA Le Petit Sac; category no Discover" },
  { sku: "H087987CK2D", locale: "ca_en", note: "CA Hermes Videpoches; category no Discover" },
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

for (const item of targets) {
  const target = `https://bck.hermes.com/product?productsku=${item.sku}&locale=${item.locale}`;
  const attempts = [];
  let data = null;

  for (let i = 1; i <= 12; i += 1) {
    const params = new URLSearchParams({
      url: target,
      browser: "false",
      proxy_type: "datacenter",
      timeout: "60",
    });
    const response = await fetch(`https://api.scrapingant.com/v2/general?${params}`, { headers });
    const text = await response.text();
    const credits = response.headers.get("ant-credits-cost");
    attempts.push({ attempt: i, status: response.status, credits });

    if (!response.ok) continue;
    try { data = JSON.parse(text); } catch {}
    if (data?.sku === item.sku) break;
  }

  console.log(JSON.stringify({
    note: item.note,
    sku: item.sku,
    attempts,
    success: data?.sku === item.sku,
    title: data?.title || null,
    stock: data?.stock || null,
    displayMode: data?.displayMode ?? null,
    labelDisplayOnly: data?.labelDisplayOnly ?? null,
    variant: data?.variants?.colors?.find?.((v) => v.sku === item.sku) || null,
  }, null, 2));
}
