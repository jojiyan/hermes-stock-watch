# Hermès Stock Watch

Checks the official Hermès United States and Canada women's bags pages every 10 minutes.

It alerts only for:

- Neo Garden 23
- Garden Party 30
- Lindy II mini / Mini Lindy
- Birkin, Kelly, and Constance in every size, style, and color, including Kelly Pochette

For every target candidate, the monitor opens the official product page and requires an `Add to cart` / `Add to bag` action with no current unavailable message. Other bags, stale category results, sold-out pages, and page-order changes are ignored. A GitHub issue mentions the repository owner when a target changes into the verified in-stock state. The first successful run only builds the baseline; no issue is created when nothing changes, and a restock after a sellout produces a new alert.

The schedule runs at minutes 7, 17, 27, 37, 47, and 57 of every hour to avoid the busiest start-of-hour window.

## Local verification

```bash
npm test
DRY_RUN=1 npm run check
```

## Notification delivery

GitHub sends the owner an email or push notification for the mention, according to the owner's GitHub notification settings. To receive alerts at `313418297@qq.com`, add and verify that address in GitHub Settings → Emails and select it as the notification email. The repository should remain public for no-cost scheduled runner minutes; it contains no credentials or personal information.


## Firecrawl live access

Hermès blocks GitHub-hosted runner IPs even when Chrome is used directly. The active `Hermes Stock Watch v2` workflow therefore uses Firecrawl to fetch the official Hermès US and Canada pages.

Repository secret required:

- `FIRECRAWL_API_KEY` — a Firecrawl API key stored in GitHub Actions secrets. Never commit the key to the repository.

The v2 workflow runs at minutes 7, 22, 37, and 52 of every hour (every 15 minutes). Each normal check fetches the US and Canada category pages with Firecrawl basic proxy. Target product pages are fetched only when the category page indicates a target may be purchasable.

An in-stock alert is allowed only after the official product page is verified. The verifier requires:

- the expected product SKU/reference;
- a real `Add to cart` or `Add to bag` button;
- the purchase button is not `disabled` and does not have `aria-disabled="true"`;
- no visible product-level unavailable / sold-out message.

If either market cannot be fully verified, that market's previous state is preserved. A failure in one market does not overwrite the other market.

At a 15-minute cadence, the two category-page checks alone use about 5,760 Firecrawl credits per 30-day month. Extra product-page verification uses additional credits only when a target looks purchasable.
