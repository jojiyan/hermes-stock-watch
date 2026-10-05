from curl_cffi import requests
import re, json, sys, time

MARKETS = {
    "US": "https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
    "CA": "https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
}
BLOCK = re.compile(r"sorry, you have been blocked|access denied|verify you are human|captcha|checking your browser|just a moment|cf-chl|turnstile|robot challenge", re.I)
TARGET = re.compile(r"neo garden 23|garden party 30|garden party 36|bolide.*mini|mini.*bolide|lindy(?: ii)? mini|mini lindy|picotin|birkin|kelly|constance", re.I)

def analyze(text, status, final_url):
    product_links = re.findall(r'\[([^\]\n]+)\]\((https?://www\.hermes\.com/(?:us|ca)/en/product/[^)\s]+)', text, re.I)
    html_names = re.findall(r'class="product-title[^\"]*"[^>]*>(.*?)</span>', text, re.I|re.S)
    names = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", n)).strip() for n in html_names]
    if product_links:
        names.extend([re.sub(r"\s+", " ", n).strip() for n,_ in product_links])
    uniq = list(dict.fromkeys([n for n in names if n]))
    targets = [n for n in uniq if TARGET.search(n)]
    return {
        "status": status,
        "length": len(text),
        "blocked": bool(BLOCK.search(text)),
        "product_titles": len(uniq),
        "target_titles": targets,
        "final_url": str(final_url),
        "has_add_to_cart": bool(re.search(r"Add to (?:cart|bag)", text, re.I)),
        "has_discover": bool(re.search(r"\bDiscover\b", text, re.I)),
    }

out = {}
for code, base in MARKETS.items():
    entry = {}
    try:
        url = base + f"?_hwatch={int(time.time()//600)}"
        r = requests.get(url, impersonate="chrome", timeout=35, headers={
            "accept-language": "en-US,en;q=0.9",
            "cache-control": "no-cache",
            "pragma": "no-cache",
        })
        entry["direct"] = analyze(r.text, r.status_code, r.url)
    except Exception as e:
        entry["direct"] = {"error": repr(e)}

    try:
        relay = "https://r.jina.ai/" + base
        r = requests.get(relay, impersonate="chrome", timeout=60, headers={"accept": "text/plain"})
        entry["jina"] = analyze(r.text, r.status_code, r.url)
        entry["jina"]["preview"] = r.text[:220].replace("\n", " ")
    except Exception as e:
        entry["jina"] = {"error": repr(e)}

    out[code] = entry

print(json.dumps(out, ensure_ascii=False, indent=2))

def ok(v):
    return v.get("status") == 200 and not v.get("blocked") and v.get("product_titles", 0) >= 5
if not all(ok(v.get("direct", {})) or ok(v.get("jina", {})) for v in out.values()):
    sys.exit(1)
