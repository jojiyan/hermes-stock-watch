# Hermès Stock Watch

The active workflow is **Hermes Stock Watch (Scrapling - zero credits)** in
`.github/workflows/hermes-stock-watch-ant.yml`. It runs on GitHub's cloud
runner with open-source Scrapling 0.4.15 and Chrome. No Firecrawl, ScrapingAnt,
AI calls, scraper API keys, or per-page credits are used by this workflow.
Legacy paid-provider workflows remain manual-only.

Configured cadence: every 10 minutes, at minutes 03/13/23/33/43/53. GitHub
scheduled jobs can be delayed. No personal computer needs to stay on.

Targets: Neo Garden 23, Garden Party 30, Mini Lindy/Lindy II mini, Picotin
(菜篮子), and all Birkin, Kelly, Constance including Kelly Pochette.
Garden Party 36 and Bolide are excluded.

A target's official product page must have the expected SKU and an enabled
Add to cart / Add to bag button, without a sold-out message. Category labels
alone never establish stock. Challenge pages, HTTP failures, short or incomplete
pages, and market redirects are rejected. Ordinary anti-bot script names alone
are not proof that a page is blocked.

US and Canada keep independent baselines. A failed region preserves its old
stock and does not suppress a confirmed alert from the other region. Missing
category links alone do not mean sold out. The first verified check establishes
a baseline; unchanged stock is silent; a verified sellout followed by a restock
can notify again. Notifications are GitHub issues mentioning the repository owner.
Email/push delivery depends on the owner's GitHub notification settings.

## Health is separate from workflow completion

A scheduled run records failed access as **unknown** in `direct-state.json`
and `direct-run-report.json`, without creating failure/out-of-stock alerts.
A green scheduled workflow means the process completed, not that both markets
were readable. Inspect `healthy`, each market's status, and `lastSuccessAt`.
Manual and push validation exit nonzero unless both markets are verified.

Scrapling has no scraping-credit bill, but it cannot guarantee that Hermès
accepts the runner's network address. A genuine block remains unknown, never
"out of stock". Free software does not guarantee uninterrupted website access.

## Checks

```bash
npm test
DRY_RUN=1 SCRAPLING_PYTHON=.venv/bin/python node src/direct-monitor.mjs
```

Dry runs save only the report, not stock state or notifications. Tests cover
wrong/missing SKUs, disabled buttons, challenge pages, single-region failure,
state preservation, target filtering, restocks, and duplicate suppression.
