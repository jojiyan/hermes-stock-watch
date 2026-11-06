"""First-party no-credit worker: HTTP plus a persistent Camoufox market session."""
import contextlib
import json
import re
import sys
from urllib.parse import urlparse
from curl_cffi import requests
from camoufox.sync_api import Camoufox


def blocked(status, html):
    text = html[:15000].lower()
    return status != 200 or any(term in text for term in (
        'sorry, you have been blocked', 'access denied', 'verify you are human',
        'robot challenge', 'just a moment', 'captcha-delivery.com',
    ))


def stay_in_market(page, country, attempts):
    # Geolocation may suggest switching CA to US and hide the actual page.
    # Dismiss only the explicit "stay" choice for the requested market.
    name = 'Canada' if country == 'ca' else 'United States'
    try:
        stay = page.get_by_role('button', name=re.compile(
            r'^No,\s*Stay on (?:the )?' + re.escape(name) + r' site$', re.I))
        if stay.count():
            stay.first.click(timeout=3000)
            page.wait_for_timeout(500)
            attempts.append({'mode':'browser-market-confirm','engine':'camoufox',
                             'market':country.upper(),'action':'stay in requested market'})
    except Exception as exc:
        attempts.append({'mode':'browser-market-confirm','engine':'camoufox',
                         'market':country.upper(),'error':str(exc)[:150]})


def main():
    with contextlib.ExitStack() as stack:
        pages = {}
        http = requests.Session(impersonate='chrome')
        stack.callback(http.close)
        for line in sys.stdin:
            try:
                request = json.loads(line)
                url = request['url']
                parsed = urlparse(url)
                if parsed.scheme != 'https' or parsed.hostname != 'www.hermes.com' or parsed.username or parsed.password:
                    raise ValueError('Only official Hermes HTTPS URLs are allowed')
                country = parsed.path.split('/')[1]
                if country not in ('us', 'ca') or not parsed.path.startswith(f'/{country}/en/'):
                    raise ValueError('Unexpected market URL')
                headers = {'accept': 'text/html,application/xhtml+xml',
                           'accept-language': 'en-CA,en;q=0.9' if country == 'ca' else 'en-US,en;q=0.9',
                           'cache-control': 'no-cache', 'pragma': 'no-cache'}
                attempts = []
                with contextlib.redirect_stdout(sys.stderr):
                    if request.get('browserOnly') is True:
                        html, status, final = '', 0, url
                    else:
                        try:
                            response = http.get(url, headers=headers, timeout=35)
                            html, status, final = response.text, response.status_code, str(response.url)
                            attempts.append({'mode':'http','status':status,
                                'cacheAgeSeconds':response.headers.get('age'),
                                'cacheStatus':response.headers.get('cf-cache-status')})
                        except Exception as exc:
                            html, status, final = '', 0, url
                            attempts.append({'mode':'http','error':str(exc)[:200]})
                    if blocked(status, html):
                        if country not in pages:
                            browser = stack.enter_context(Camoufox(headless=False, os='linux'))
                            page = browser.new_page(locale='en-CA' if country == 'ca' else 'en-US')
                            page.set_default_navigation_timeout(35000)
                            pages[country] = page
                            try:
                                warm=page.goto(f'https://www.hermes.com/{country}/en/',
                                               wait_until='domcontentloaded',timeout=15000)
                                page.wait_for_timeout(3500)
                                stay_in_market(page,country,attempts)
                                attempts.append({'mode':'browser-warmup','engine':'camoufox',
                                                 'status':warm.status if warm else None})
                            except Exception as exc:
                                attempts.append({'mode':'browser-warmup','engine':'camoufox','error':str(exc)[:150]})
                        page=pages[country]
                        response=page.goto(url,wait_until='domcontentloaded')
                        page.wait_for_timeout(7000 if '/product/' in parsed.path else 3500)
                        stay_in_market(page,country,attempts)
                        html, status, final=page.content(),response.status if response else 0,page.url
                        attempts.append({'mode':'browser','engine':'camoufox','status':status})
                result={'html':str(html),'status':status,'url':final,'transportAttempts':attempts}
            except Exception as exc:
                result={'error':str(exc)}
            print(json.dumps(result),flush=True)


if __name__ == '__main__':
    main()

