"""One-time probe for a 423-blocked official Hermès product page. No alerts."""
import json
import re
from scrapling.fetchers import StealthySession

url = "https://www.hermes.com/us/en/product/neo-garden-23-bag-H086422CK37/"
with StealthySession(headless=True, real_chrome=True, block_webrtc=True,
                    hide_canvas=True, allow_webgl=True,
                    locale="en-US", timezone_id="America/New_York",
                    timeout=45000) as session:
    page = session.fetch(url, google_search=False, network_idle=False,
                         wait=3000, disable_resources=False)
    html = page.html_content
    if isinstance(html, bytes):
        html = html.decode("utf-8", errors="replace")
    title_match = re.search(r"<title[^>]*>([\s\S]*?)</title>", str(html), re.I)
    text = re.sub(r"<[^>]*>", " ", str(html))
    text = re.sub(r"\s+", " ", text)
    sku = re.search(r"Product reference\s*:\s*(H\w+)", text, re.I)
    blocked = bool(re.search(r"access denied|verify you are human|captcha|sorry, you have been blocked|please enable javascript and cookies", text, re.I))
    print(json.dumps({
        "http_status": page.status,
        "final_url": str(page.url),
        "title": title_match.group(1)[:110] if title_match else "",
        "html_chars": len(str(html)),
        "sku": sku.group(1) if sku else None,
        "add_to_cart_in_text": bool(re.search(r"Add to (cart|bag)", text, re.I)),
        "unavailable_in_text": bool(re.search(r"product is no longer available|back in stock", text, re.I)),
        "challenge": blocked,
    }, ensure_ascii=False))
