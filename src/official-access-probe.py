"""Read-only diagnostics for free first-party access; never writes stock or alerts."""
import contextlib
import json
import re
from urllib.parse import urlsplit
from curl_cffi import requests
from scrapling.fetchers import StealthySession


def summary(html):
    raw = re.search(r'<script\b[^>]*id=["\']hermes-state["\'][^>]*>([\s\S]*?)</script>', html, re.I)
    try:
        holders = [v['b'] for v in json.loads(raw[1]).values() if isinstance(v, dict) and
                   isinstance(v.get('b'), dict) and isinstance(v['b'].get('products'), dict) and
                   isinstance(v['b']['products'].get('items'), list)]
        holder = max(holders, key=lambda b: len(b['products']['items']))
        return {'total': holder['total'], 'items': len(holder['products']['items']),
                'version': holder.get('version'),
                'canonical': re.search(r'<link\b[^>]*rel=["\']canonical["\'][^>]*href=["\']([^"\']+)', html, re.I)[1]}
    except Exception:
        return {'title': re.search(r'<title[^>]*>(.*?)</title>', html, re.S)[1] if '<title' in html else ''}


for market in ('us', 'ca'):
    base = f'https://www.hermes.com/{market}/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/'
    with requests.Session(impersonate='chrome') as session:
        for suffix in ('', '?page=1', '?page=2', '?page=2&'):
            url = base + suffix
            try:
                page = session.get(url, timeout=25, headers={'cache-control':'no-cache','pragma':'no-cache'})
                print(json.dumps({'market':market,'mode':'http','url':url,'status':page.status_code,
                    'headers':{k:v for k,v in page.headers.items() if k.lower() in ('age','date','cache-control','x-cache','cf-cache-status')},
                    **summary(page.text)}), flush=True)
            except Exception as exc:
                print(json.dumps({'market':market,'mode':'http','url':url,'error':str(exc)}), flush=True)
    try:
        with contextlib.redirect_stdout(__import__('sys').stderr):
            browser = StealthySession(headless=True, real_chrome=True, timeout=35000,
                locale='en-CA' if market=='ca' else 'en-US')
            browser.__enter__()
        try:
            for suffix in ('','?page=2'):
                url = base + suffix
                try:
                    with contextlib.redirect_stdout(__import__('sys').stderr):
                        page = browser.fetch(url, google_search=False, wait=1500, network_idle=False)
                    html = page.html_content
                    if isinstance(html, bytes): html=html.decode('utf8',errors='replace')
                    print(json.dumps({'market':market,'mode':'browser','url':url,'status':page.status,**summary(str(html))}),flush=True)
                except Exception as exc:
                    print(json.dumps({'market':market,'mode':'browser','url':url,'error':str(exc)}),flush=True)
        finally:
            with contextlib.redirect_stdout(__import__('sys').stderr):
                browser.__exit__(None,None,None)
    except Exception as exc:
        print(json.dumps({'market':market,'mode':'browser','error':str(exc)}),flush=True)
