from curl_cffi import requests
import re, json, sys, time

MARKETS = {
    "US": "https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
    "CA": "https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
}
BLOCK = re.compile(r"sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|robot challenge", re.I)
TARGET = re.compile(r"neo garden 23|garden party 30|garden party 36|bolide.*mini|mini.*bolide|lindy(?: ii)? mini|mini lindy|picotin|birkin|kelly|constance", re.I)

out = {}
for code, base in MARKETS.items():
    url = base + f"?_hwatch={int(time.time()//600)}"
    try:
        r = requests.get(url, impersonate="chrome", timeout=45, headers={
            "accept-language": "en-US,en;q=0.9",
            "cache-control": "no-cache",
            "pragma": "no-cache",
        })
        text = r.text
        names = re.findall(r'class="product-title[^\"]*"[^>]*>(.*?)</span>', text, re.I|re.S)
        clean = [re.sub(r"<[^>]+>", " ", n) for n in names]
        clean = [re.sub(r"\s+", " ", n).strip() for n in clean]
        targets = [n for n in clean if TARGET.search(n)]
        out[code] = {
            "status": r.status_code,
            "length": len(text),
            "blocked": bool(BLOCK.search(text)),
            "product_titles": len(clean),
            "target_titles": targets,
            "final_url": r.url,
        }
    except Exception as e:
        out[code] = {"error": repr(e)}
print(json.dumps(out, ensure_ascii=False, indent=2))
if any(v.get("status") != 200 or v.get("blocked") or v.get("product_titles",0) < 5 for v in out.values()):
    sys.exit(1)
