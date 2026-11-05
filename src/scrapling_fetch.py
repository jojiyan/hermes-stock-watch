"""First-party no-credit worker: canonical HTTP HTML, then a browser on access failure."""
import contextlib
import json
import sys
from urllib.parse import urlparse
from curl_cffi import requests
from scrapling.fetchers import StealthySession


def blocked(status, html):
    text = html[:15000].lower()
    return status != 200 or any(term in text for term in (
        'sorry, you have been blocked', 'access denied', 'verify you are human',
        'robot challenge', 'just a moment', 'captcha-delivery.com',
    ))


def main():
    with contextlib.ExitStack() as stack:
        browsers = {}
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
                target = url
                headers = {'accept': 'text/html,application/xhtml+xml',
                           'accept-language': 'en-CA,en;q=0.9' if country == 'ca' else 'en-US,en;q=0.9',
                           'cache-control': 'no-cache', 'pragma': 'no-cache'}
                attempts = []
                with contextlib.redirect_stdout(sys.stderr):
                    if request.get('browserOnly') is True:
                        html, status, final = '', 0, target
                    else:
                        try:
                            response = http.get(target, headers=headers, timeout=35)
                            html, status, final = response.text, response.status_code, str(response.url)
                            attempts.append({'mode': 'http', 'status': status,
                                'cacheAgeSeconds': response.headers.get('age'),
                                'cacheStatus': response.headers.get('cf-cache-status')})
                        except Exception as exc:
                            html, status, final = '', 0, target
                            attempts.append({'mode': 'http', 'error': str(exc)[:200]})
                    if blocked(status, html):
                        if country not in browsers:
                            browsers[country] = stack.enter_context(StealthySession(
                                headless=True, real_chrome=True, block_webrtc=True,
                                hide_canvas=True, allow_webgl=True,
                                locale='en-CA' if country == 'ca' else 'en-US',
                                timezone_id='America/Toronto' if country == 'ca' else 'America/New_York',
                                timeout=45000,
                            ))
                            # Establish the normal first-party market session
                            # before entering a cold product/category deep link.
                            try:
                                warm = browsers[country].fetch(
                                    f'https://www.hermes.com/{country}/en/',
                                    google_search=False, network_idle=False, wait=2500,
                                    timeout=15000, extra_headers=headers)
                                attempts.append({'mode':'browser-warmup','status':warm.status})
                            except Exception as exc:
                                attempts.append({'mode':'browser-warmup','error':str(exc)[:150]})
                        page = browsers[country].fetch(target, google_search=False,
                            network_idle=False, wait=7000 if '/product/' in parsed.path else 2500,
                            disable_resources=False, extra_headers=headers)
                        html, status, final = page.html_content, page.status, str(page.url)
                        if isinstance(html, bytes):
                            html = html.decode('utf-8', errors='replace')
                        attempts.append({'mode': 'browser', 'status': status})
                result = {'html': str(html), 'status': status,
                          'url': final, 'transportAttempts': attempts}
            except Exception as exc:
                result = {'error': str(exc)}
            print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()

