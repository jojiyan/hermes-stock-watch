# Hermès US + CA official stock monitor

**Active production workflow:** [Hermes Stock Watch (ScrapingAnt)](.github/workflows/hermes-stock-watch-scrapingant.yml).

- Runs on GitHub Actions. The cron **requests** a run every 5 minutes; GitHub's queue can delay executions by 15–30+ minutes. A freshness guard skips paid checks when a recent check already occurred within 8 minutes.
- Uses `SCRAPINGANT_API_KEY`; no Firecrawl runtime dependency.
- Reads each market's official Hermès women's bags category HTML (normally **1 credit per country**) and the official hydrated product listing field **`stock.ecom`**. A false value or a rendered unavailable label cannot trigger stock alerts.
- Requires the official `holder.total` to exactly match the parsed complete category items; incomplete/blocked pages remain **unknown**, not sold out. Transient 423s trigger a bounded datacenter retry, then one rendered-browser fallback; residential requests are not used.
- Tracks Neo Garden 23 / Mini Garden 23 including full-leather when included in the *published category*, Garden Party 30, Picotin, Mini Lindy, Birkin, Kelly (including Pochette), Constance; excludes Garden Party 36, Neo Garden Voyage 41, and Bolide.
- **Coverage limitation:** this checks every item currently published in the women's bags category for each market (the official total is verified). A product that is not included in that category, or a separately accessible product detail page not listed there, cannot be inferred to be for sale. This is **not** a guarantee of complete product-site or historical-SKU coverage.
- **Confirmation level:** `stock.ecom=true` is official first-party e-commerce stock metadata, NOT a verified live enabled `Add to cart` button. Alerts say this explicitly; availability can change before clicking.
- US and CA preserve their state independently. A market's failure does not erase prior observations or suppress stock notifications from the other region.
- Each new qualifying SKU / restock sends a GitHub Issue mentioning and assigning the repository owner; duplicate notifications are suppressed until an explicit `stock.ecom=false` observation.

## Stock notifications through GitHub

When first-party Hermès category data confirms a new eligible SKU is available, the workflow creates a GitHub Issue and assigns and @mentions the repository owner (`jojiyan`). This uses the existing GitHub notification system, with **no SMTP authorization code or additional email secrets**.

The connected GitHub account displays `954736371@qq.com` as its profile email. The actual email address used for GitHub notification delivery, plus whether emails/push notifications are enabled, is controlled separately under [GitHub Notifications Settings](https://github.com/settings/notifications). Merely having an email registered does not prove delivery. We cannot verify inbox arrival using repository access alone.

## Checks and evidence

- Run `npm test` and review the GitHub Actions run and issue evidence.
- Inspect `ant-state.json` for each market's `status`, `lastCheckedAt`, `officialTotal`, `products`, and `coverage`.
- Each production run publishes `ant-run-report.json` as an artifact, showing fetched status, mode, credit consumption and newly detected stock.
- The Scrapling workflow remains **manual-only backup**, and old Firecrawl workflows are not the production schedule.

**A green Actions run validates the published category data, not the availability of an unlisted product or actual GitHub email/inbox delivery.**
