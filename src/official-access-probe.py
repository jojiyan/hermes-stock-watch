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


def inspect_browser_paging(page):
    responses = []
    def capture(response):
        if 'bck.hermes.com/products' not in response.url:
            return
        item = {'url':response.url, 'status':response.status,
                'method':response.request.method, 'body':(response.request.post_data or '')[:1500]}
        try:
            data = response.json()
            products = data.get('products',{})
            item.update({'total':data.get('total'), 'items':len(products.get('items',[])) if isinstance(products,dict) else len(products)})
        except Exception:
            pass
        responses.append(item)
    page.on('response', capture)
    try:
        page.get_by_role('button', name='See more products', exact=True).click(force=True, timeout=8000)
        page.wait_for_timeout(4000)
    except Exception as exc:
        responses.append({'error':str(exc)[:300]})
    print(json.dumps({'mode':'browser-xhr','responses':responses}),flush=True)


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
    with requests.Session(impersonate='chrome') as api:
        api.get(base, timeout=25)
        for query in (f'fh_location=--%2Fcategories%3C%7Bwomenbagsandclutches%7D&country={market}&fh_view_size=144',
                      f'category=WOMEN_BAGS_AND_CLUTCHES&sort=relevance&pagesize=144&locale={market}_en'):
            api_url = 'https://bck.hermes.com/products?' + query
            try:
                response = api.get(api_url, timeout=25, headers={
                    'accept':'application/json, text/plain, */*', 'origin':'https://www.hermes.com',
                    'referer':base,'sec-fetch-mode':'cors','sec-fetch-site':'same-site','sec-fetch-dest':'empty',
                    'accept-language':'en-US,en;q=0.9', 'cache-control':'no-cache'})
                data = response.json() if response.status_code == 200 else {}
                items = data.get('products',{}).get('items',[]) if isinstance(data.get('products'),dict) else data.get('products',[])
                print(json.dumps({'market':market,'mode':'official-json','url':api_url,'status':response.status_code,
                    'total':data.get('total'),'items':len(items),'keys':list(data.keys())[:15]}),flush=True)
            except Exception as exc:
                print(json.dumps({'market':market,'mode':'official-json','url':api_url,'error':str(exc)}),flush=True)
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
                        page = browser.fetch(url, google_search=False, wait=1500, network_idle=False,
                                             page_action=inspect_browser_paging)
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


