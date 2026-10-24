# Hermès US + CA official stock monitor

**Active production workflow:** [Hermes Stock Watch (ScrapingAnt)](.github/workflows/hermes-stock-watch-scrapingant.yml).

- Runs on GitHub Actions. The cron **requests** a run every 5 minutes; GitHub's queue can delay executions by 15–30+ minutes. Every scheduled execution checks both markets; the former 8-minute freshness guard was removed because it could skip a requested 5-minute check and let one healthy market suppress retries for the other. Scheduling remains best effort, not a 5-minute SLA.
- Uses `SCRAPINGANT_API_KEY`; no Firecrawl runtime dependency.
- Reads every official category page, following the same-market `rel="next"` links. Canada's 43-item catalog is 40 items on page 1 plus 3 on page 2 (normally two category credits). `stock.ecom` is discovery metadata only.
- Requires stable official totals across pages and exactly that many unique validated SKUs/tiles. Missing pages, duplicate SKUs, changed totals and blocked responses remain **unknown** and fail Actions. Requests have bounded datacenter retries, then one browser fallback; residential requests are not used. After transport blocking, one direct request to the same official category URL may recover the page under identical validation; all preceding failures remain in the evidence.
- Tracks Neo Garden 23 / Mini Garden 23 including full-leather when included in the *published category*, Garden Party 30, Picotin, Mini Lindy, Birkin, Kelly (including Pochette), Constance; excludes Garden Party 36, Neo Garden Voyage 41, and Bolide.
- **Coverage limitation:** this checks every item currently published in the women's bags category for each market (the official total is verified). A product that is not included in that category, or a separately accessible product detail page not listed there, cannot be inferred to be for sale. This is **not** a guarantee of complete product-site or historical-SKU coverage.
- **Confirmation level:** target product pages must match canonical URL, market and visible SKU. Only an enabled official **Add to cart / Add to bag** button without unavailable evidence can trigger an alert. Unknown product pages preserve previous observations and alert deduplication. A complete category with explicit `stock.ecom=false` is negative evidence and needs no detail request; only potential positives need button verification.
- US and CA preserve their state independently. A market's failure does not erase prior observations or suppress stock notifications from the other region.
- Each new qualifying SKU / restock sends a GitHub Issue mentioning and assigning the repository owner; duplicate notifications are suppressed until an explicit negative observation from a complete official category or verified product page.

## Stock notifications through GitHub

When an official Hermès product page confirms an enabled purchase button for a new eligible SKU, the workflow creates a GitHub Issue and assigns and @mentions the repository owner (`jojiyan`). This uses the existing GitHub notification system, with **no SMTP authorization code or additional email secrets**.

The connected GitHub account displays `954736371@qq.com` as its profile email. The actual email address used for GitHub notification delivery, plus whether emails/push notifications are enabled, is controlled separately under [GitHub Notifications Settings](https://github.com/settings/notifications). Merely having an email registered does not prove delivery. We cannot verify inbox arrival using repository access alone.

## Checks and evidence

- Run `npm test` and review the GitHub Actions run and issue evidence.
- Inspect `ant-state.json` for each market's `status`, `lastCheckedAt`, `officialTotal`, `products`, and `coverage`.
- Each production run publishes `ant-run-report.json` as an artifact, showing each page, HTTP status, retries, credits, SHA-256, product purchase evidence and errors. Raw HTML is retained alongside it for 7 days.
- The Scrapling workflow remains **manual-only backup**, and old Firecrawl workflows are not the production schedule.

**A green Actions run validates the published category data, not the availability of an unlisted product or actual GitHub email/inbox delivery.**

## Repair validation

The `fix/ca-catalog-pagination` branch push runs the real ScrapingAnt workflow in `VERIFY_ONLY` mode: it uses the repository secret but sends no notifications and writes no production state. Production schedule/manual runs on `main` still persist state and notify. Regression tests also run on pull requests. Verification and production use separate concurrency groups, so branch checks do not cancel pending production checks.

CA regression fixtures are reduced extracts of official HTML retrieved on 2026-10-21: 40 + 3 products, `total=43`, and official next/canonical links. Only required catalog fields and rendered tile identifiers were retained.


### Catalog consistency and historical state

Catalog pagination consistency failures restart the entire market scan from page one,
up to three scans with bounded backoff. Totals, pages, products and SKU sets are never
combined across scans. All pages must agree on the total and reconcile exactly with
unique SKUs. After a multi-page scan, a fresh first-page request must match its opening
total, SKU order, next link and target stock metadata. This detects observed changes;
it cannot guarantee an atomic snapshot of a live retailer. Persistent inconsistency
remains `unknown`. No guessed next-page URL or relaxed count tolerance is used.
Transport retries remain bounded separately; authentication, unsafe pagination and
invalid HTML do not trigger consistency retries. Reports retain each scan's errors,
pages and paid-request evidence, including credits from failed scans.

`catalogStocks`, `available` and `alertedSkus` retain historical observations and
notification deduplication; they are not a current inventory listing. On any market
verification failure, these collections and `lastSuccessAt` are preserved, while
`status`, `lastCheckedAt` and errors reflect the failed check and `currentStocks` is
empty. On success, `currentStocks` contains only observations verified in that scan;
unlisted historical SKUs are not assumed sold out. Partial purchase verification
cannot alert or rearm any SKU in that market. US and CA remain independent.

State schema is version 3. A completed scan can persist `unknown` for one market and
verified observations for the other. The execution step succeeds when processing and
persistence finish; the separate verification gate fails if either market is unknown.
Unexpected execution/notification/write errors fail the execution step directly.
The gate uses explicit execution and verification outputs, not a `continue-on-error`
conclusion. `VERIFY_ONLY=true` writes evidence/report but never state or notifications.

When `CATALOG_BROWSER_RECOVERY=true` (manual workflow diagnostic input), if two full
HTTP scans still return inconsistent catalogs, the third scan uses browser rendering for every page and
the closing first-page check. It cannot fall back to the same incomplete HTTP mode.
This bounded recovery costs more credits, and still requires exact totals and unique
SKUs; it does not treat a repeated short catalog as verified. Code changes on main
also trigger a live `VERIFY_ONLY` scan, without writing state or sending alerts.

Browser diagnostics are disabled by default: live run #833 confirmed rendered US
HTML also contained only 41 of the claimed 42 products. Repeating paid browser
requests cannot resolve that upstream discrepancy. The strict unknown status is
intentional until complete official evidence is available.
