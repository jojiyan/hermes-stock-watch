import sys
from scrapling.fetchers import StealthySession

url = sys.argv[1]
is_ca = "/ca/en/" in url.lower()
locale = "en-CA" if is_ca else "en-US"
timezone = "America/Toronto" if is_ca else "America/New_York"


def as_html(page):
    html = (
        getattr(page, "html_content", None)
        or getattr(page, "html", None)
        or getattr(page, "text", None)
        or str(page)
    )
    if isinstance(html, bytes):
        html = html.decode("utf-8", errors="replace")
    return str(html)


with StealthySession(
    headless=True,
    real_chrome=True,
    block_webrtc=True,
    hide_canvas=True,
    allow_webgl=True,
    locale=locale,
    timezone_id=timezone,
    timeout=60000,
) as session:
    # Warm a first-party Hermès session before the monitored navigation so
    # DataDome/browser cookies and storage survive into the target request.
    session.fetch(
        "https://www.hermes.com/us/en/",
        google_search=True,
        network_idle=True,
        wait=2500,
        disable_resources=False,
    )

    # For Canada, touch the country home page in the same browser before the
    # category/product request. This keeps the browser/IP/session identity
    # stable instead of starting a fresh challenge for every URL.
    if is_ca:
        session.fetch(
            "https://www.hermes.com/ca/en/",
            google_search=False,
            extra_headers={"Referer": "https://www.hermes.com/us/en/"},
            network_idle=True,
            wait=2500,
            disable_resources=False,
        )

    page = session.fetch(
        url,
        google_search=False,
        extra_headers={"Referer": "https://www.hermes.com/ca/en/" if is_ca else "https://www.hermes.com/us/en/"},
        network_idle=True,
        wait=3000,
        disable_resources=False,
    )
    sys.stdout.write(as_html(page))
