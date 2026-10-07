"""Line-delimited JSON worker. One first-party browser session per market."""
import contextlib
import json
import sys
from urllib.parse import urlparse
from scrapling.fetchers import StealthySession


def main():
    with contextlib.ExitStack() as stack:
        sessions = {}
        for line in sys.stdin:
            try:
                request = json.loads(line)
                url = request['url']
                parsed = urlparse(url)
                if parsed.scheme != 'https' or parsed.hostname != 'www.hermes.com':
                    raise ValueError('Only official Hermès HTTPS URLs are allowed')
                country = parsed.path.split('/')[1]
                if country not in ('us', 'ca') or not parsed.path.startswith(f'/{country}/en/'):
                    raise ValueError('Unexpected market URL')
                # Library/browser diagnostics must never enter the JSON protocol.
                with contextlib.redirect_stdout(sys.stderr):
                    if country not in sessions:
                        session = stack.enter_context(StealthySession(
                            headless=True, real_chrome=True, block_webrtc=True,
                            hide_canvas=True, allow_webgl=True,
                            locale='en-CA' if country == 'ca' else 'en-US',
                            timezone_id='America/Toronto' if country == 'ca' else 'America/New_York',
                            timeout=45000,
                        ))
                        sessions[country] = session
                    page = sessions[country].fetch(
                        url, google_search=False, network_idle=False,
                        wait=3000, disable_resources=False,
                    )
                html = page.html_content
                if isinstance(html, bytes):
                    html = html.decode('utf-8', errors='replace')
                result = {'html': str(html), 'status': page.status, 'url': str(page.url)}
            except Exception as exc:
                result = {'error': str(exc)}
            print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
