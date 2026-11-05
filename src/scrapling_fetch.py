"""First-party no-credit worker: fresh HTTP HTML, then a browser on access failure."""
import contextlib
import json
import sys
import time
from urllib.parse import urlparse, urlsplit, urlunsplit, parse_qsl, urlencode
from curl_cffi import requests
from scrapling.fetchers import StealthySession


def fresh_url(url):
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    if any(key == '_hwatch' for key, _ in query):
        raise ValueError('Unexpected transport cache parameter')
    suffix = ('&' if parts.query else '') + '_hwatch=' + str(time.time_ns())
    return urlunsplit(parts._replace(query=parts.query + suffix))


def canonical_transport_url(url):
    parts = urlsplit(url)
    query = '&'.join(part for part in parts.query.split('&') if part.split('=', 1)[0] != '_hwatch')
    return urlunsplit(parts._replace(query=query))


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
                target = fresh_url(url)
                headers = {'accept': 'text/html,application/xhtml+xml',
                           'accept-language': 'en-CA,en;q=0.9' if country == 'ca' else 'en-US,en;q=0.9',
                           'cache-control': 'no-cache', 'pragma': 'no-cache'}
                attempts = []
                with contextlib.redirect_stdout(sys.stderr):
                    try:
                        response = http.get(target, headers=headers, timeout=35)
                        html, status, final = response.text, response.status_code, str(response.url)
                        attempts.append({'mode': 'http', 'status': status})
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
                        page = browsers[country].fetch(target, google_search=False,
                            network_idle=False, wait=2000, disable_resources=False, extra_headers=headers)
                        html, status, final = page.html_content, page.status, str(page.url)
                        if isinstance(html, bytes):
                            html = html.decode('utf-8', errors='replace')
                        attempts.append({'mode': 'browser', 'status': status})
                result = {'html': str(html), 'status': status,
                          'url': canonical_transport_url(final), 'transportAttempts': attempts}
            except Exception as exc:
                result = {'error': str(exc)}
            print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()

