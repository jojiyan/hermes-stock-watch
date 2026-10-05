import sys
from scrapling.fetchers import DynamicFetcher

url = sys.argv[1]
page = DynamicFetcher.fetch(
    url,
    headless=True,
    real_chrome=True,
    stealth=True,
    google_search=True,
    network_idle=True,
    wait=3000,
    timeout=60000,
    disable_resources=False,
)
html = getattr(page, "html_content", None) or getattr(page, "html", None) or getattr(page, "text", None) or str(page)
if isinstance(html, bytes):
    html = html.decode("utf-8", errors="replace")
sys.stdout.write(str(html))
