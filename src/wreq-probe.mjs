import { fetch } from 'wreq-js';

const markets = {
  US: {
    locale: 'us_en',
    referer: 'https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/',
  },
  CA: {
    locale: 'ca_en',
    referer: 'https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/',
  },
};

const targetRe = /neo garden 23|garden party 30|garden party 36|bolide.*mini|mini.*bolide|lindy(?: ii)? mini|mini lindy|picotin|birkin|kelly|constance/i;
const result = {};

for (const [code, cfg] of Object.entries(markets)) {
  const url = `https://bck.hermes.com/products?category=WOMEN&sort=relevance&pagesize=144&locale=${cfg.locale}`;
  try {
    const res = await fetch(url, {
      browser: 'chrome_149',
      os: 'windows',
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        origin: 'https://www.hermes.com',
        referer: cfg.referer,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        priority: 'u=1, i',
      },
    });
    const text = await res.text();
    const entry = {
      status: res.status,
      length: text.length,
      contentType: res.headers.get('content-type') || '',
      preview: text.slice(0, 280).replace(/\s+/g, ' '),
    };
    if (res.status === 200) {
      try {
        const data = JSON.parse(text);
        const products = data.products || data.items || [];
        entry.total = data.total ?? null;
        entry.productsCount = products.length;
        entry.targets = products
          .map((p) => ({
            name: p.title || p.name || p.label || '',
            sku: p.sku || p.productSku || p.productsku || '',
            hasStock: p.hasStock,
            stock: p.stock,
          }))
          .filter((p) => targetRe.test(p.name))
          .slice(0, 40);
        entry.topLevelKeys = Object.keys(data).slice(0, 20);
      } catch (e) {
        entry.jsonError = String(e);
      }
    }
    result[code] = entry;
  } catch (e) {
    result[code] = { error: String(e?.stack || e) };
  }
}

console.log(JSON.stringify(result, null, 2));
if (!Object.values(result).every((x) => x.status === 200 && x.productsCount > 0)) process.exit(1);
