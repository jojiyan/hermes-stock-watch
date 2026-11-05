"""Read-only stock access probe. No notification or stock-state writes."""
import json
import re
from pathlib import Path
from camoufox.sync_api import Camoufox

out=Path('camoufox-evidence')
out.mkdir(exist_ok=True)
reports=[]
products={
    'us':'https://www.hermes.com/us/en/product/lindy-ii-mini-bag-H085956CC18/',
    'ca':'https://www.hermes.com/ca/en/product/garden-party-30-bag-H051551CKCS/',
}
for market in ('us','ca'):
    prefix=f'https://www.hermes.com/{market}/en/'
    category=prefix+'category/leather-goods/bags-and-clutches/womens-bags-and-clutches/'
    try:
        with Camoufox(headless=False,os='linux') as browser:
            page=browser.new_page(locale='en-CA' if market=='ca' else 'en-US')
            for index,url in enumerate((prefix,category,category+'?page=2',products[market])):
                record={'market':market,'url':url}
                try:
                    response=page.goto(url,wait_until='domcontentloaded',timeout=35000)
                    page.wait_for_timeout(7000 if '/product/' in url else 3500)
                    html=page.content()
                    file=f'{market}-{index}.html'
                    (out/file).write_text(html,encoding='utf8')
                    record.update({'status':response.status if response else None,'finalUrl':page.url,
                        'title':page.title(),'file':file,'bytes':len(html.encode('utf8')),
                        'challengeFrame':page.locator('iframe[src*="captcha-delivery.com"],iframe[src*="challenges.cloudflare.com"]').count()>0})
                    state=re.search(r'<script\b[^>]*id=["\']hermes-state["\'][^>]*>([\s\S]*?)</script>',html,re.I)
                    if state:
                        holders=[v['b'] for v in json.loads(state[1]).values() if isinstance(v,dict) and
                            isinstance(v.get('b'),dict) and isinstance(v['b'].get('products'),dict) and
                            isinstance(v['b']['products'].get('items'),list)]
                        if holders:
                            holder=max(holders,key=lambda x:len(x['products']['items']))
                            record.update({'total':holder.get('total'),'items':len(holder['products']['items'])})
                    if '/product/' in url:
                        record['buttons']=[{'text':b.inner_text(),'enabled':b.is_enabled(),'visible':b.is_visible()}
                            for b in page.get_by_role('button',name=re.compile(r'Add to (?:cart|bag)',re.I)).all()]
                        record['references']=re.findall(r'Product reference\s*:\s*([A-Z0-9]+)',page.locator('body').inner_text())
                    reports.append(record)
                    print(json.dumps(record),flush=True)
                    if record.get('challengeFrame') or record.get('status') in (403,429):
                        break
                except Exception as exc:
                    record['error']=str(exc)[:400]
                    reports.append(record)
                    print(json.dumps(record),flush=True)
                    break
    except Exception as exc:
        record={'market':market,'error':str(exc)[:500]}
        reports.append(record)
        print(json.dumps(record),flush=True)
(out/'report.json').write_text(json.dumps(reports,indent=2),encoding='utf8')
