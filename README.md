# Hermès Stock Watch

Checks the official Hermès United States and Canada women's bags pages every 10 minutes.

It alerts only for:

- Neo Garden 23
- Garden Party 30
- Lindy II mini / Mini Lindy
- Birkin, Kelly, and Constance in every size, style, and color, including Kelly Pochette

For every target candidate, the monitor opens the official product page and requires an `Add to cart` / `Add to bag` action with no current unavailable message. Other bags, stale category results, sold-out pages, and page-order changes are ignored. A GitHub issue mentions the repository owner when a target changes into the verified in-stock state. The first successful run only builds the baseline; no issue is created when nothing changes, and a restock after a sellout produces a new alert.

The workflow wakes every 5 minutes and uses an 8-minute freshness gate, so a real US/Canada verification is due about every 10 minutes even when GitHub skips an individual cron wake-up.

## Local verification

```bash
npm test
DRY_RUN=1 npm run check
```

## Notification delivery

GitHub sends the owner an email or push notification for the mention, according to the owner's GitHub notification settings. To receive alerts at `313418297@qq.com`, add and verify that address in GitHub Settings → Emails and select it as the notification email. The repository should remain public for no-cost scheduled runner minutes; it contains no credentials or personal information.

## Firecrawl live access

Hermès blocks direct requests from GitHub-hosted runner IPs. The active `Hermes Stock Watch v2` workflow therefore installs the official Firecrawl CLI and uses its keyless client mode to fetch the official Hermès US and Canada pages.

No `FIRECRAWL_API_KEY` repository secret is required.

The workflow wakes every 5 minutes and performs a real verification when the last complete US/Canada check is at least 8 minutes old. Each real check:

- fetches the Hermès US and Canada women's bags category pages;
- filters only for Neo Garden 23, Garden Party 30, Mini Lindy / Lindy II mini, and all Birkin, Kelly, and Constance bags;
- treats category-page `Discover` / unavailable markers only as a screening signal;
- opens a target's official product page when the category page suggests it may be purchasable;
- requires the expected SKU/reference;
- requires a real `Add to cart` or `Add to bag` button that is not `disabled` and does not have `aria-disabled="true"`;
- rejects visible unavailable / sold-out states;
- preserves a market's previous state when that market cannot be fully verified;
- does not let a US failure overwrite CA state, or vice versa.

Only a confirmed transition into an in-stock state creates an alert. Duplicate in-stock checks do not alert again; a later sell-out followed by a new restock can alert again.
