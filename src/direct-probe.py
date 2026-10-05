from curl_cffi import requests
import re, json, sys

MARKETS = {
    "US": {
        "locale": "us_en",
        "referer": "https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
    },
    "CA": {
        "locale": "ca_en",
        "referer": "https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
    },
}
TARGET = re.compile(r"neo garden 23|garden party 30|garden party 36|bolide.*mini|mini.*bolide|lindy(?: ii)? mini|mini lindy|picotin|birkin|kelly|constance", re.I)
BLOCK = re.compile(r"sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|robot challenge", re.I)

out = {}
for code, cfg in MARKETS.items():
    url = f"https://bck.hermes.com/products?category=WOMEN&sort=relevance&pagesize=144&locale={cfg['locale']}"
    headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "origin": "https://www.hermes.com",
        "referer": cfg["referer"],
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "cache-control": "no-cache",
        "pragma": "no-cache",
    }
    try:
        r = requests.get(url, impersonate="chrome", headers=headers, timeout=45)
        text = r.text
        entry = {
            "status": r.status_code,
            "length": len(text),
            "blocked": bool(BLOCK.search(text)),
            "content_type": r.headers.get("content-type", ""),
            "final_url": str(r.url),
        }
        if r.status_code == 200 and "json" in entry["content_type"].lower():
            data = r.json()
            products = data.get("products") or data.get("items") or []
            names = []
            targets = []
            stock_fields = []
            for p in products:
                name = str(p.get("title") or p.get("name") or p.get("label") or "")
                if name:
                    names.append(name)
                if name and TARGET.search(name):
                    targets.append({
                        "name": name,
                        "sku": p.get("sku") or p.get("productSku") or p.get("productsku"),
                        "hasStock": p.get("hasStock"),
                        "stock": p.get("stock"),
                        "url": p.get("url") or p.get("productUrl") or p.get("slug"),
                    })
                if len(stock_fields) < 5:
                    for k in p.keys():
                        if "stock" in k.lower() or "avail" in k.lower():
                            stock_fields.append(k)
            entry.update({
                "top_level_keys": list(data.keys())[:20] if isinstance(data, dict) else [],
                "total": data.get("total") if isinstance(data, dict) else None,
                "products_count": len(products),
                "target_products": targets[:30],
                "stock_field_names": list(dict.fromkeys(stock_fields)),
            })
        else:
            entry["preview"] = text[:300].replace("\n", " ")
        out[code] = entry
    except Exception as exc:
        out[code] = {"error": repr(exc)}

print(json.dumps(out, ensure_ascii=False, indent=2))
if not all(v.get("status") == 200 and not v.get("blocked") and v.get("products_count", 0) > 0 for v in out.values()):
    sys.exit(1)
