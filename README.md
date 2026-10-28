# Hermès US + Canada stock monitor

Production: [Hermes Stock Watch (ScrapingAnt)](.github/workflows/hermes-stock-watch-scrapingant.yml).

## Operation

- Each production run scans both markets, saves the observations, and queues the next workflow_dispatch for a ten-minute interval. The next run waits for its due time and the most recent persisted observation. GitHub's native ten-minute cron is a recovery trigger.
- This runs in GitHub Actions and does not depend on a user's computer remaining open. The job's temporary GITHUB_TOKEN queues its successor with Actions write permission. No permanent personal token is required.
- GitHub queue delays or service outages can shift a scan. Completion of one scan is not evidence of recurring timing; verify successive state timestamps and the dispatched successor.
- Disable the production workflow in Actions to stop the continuation. Repair branches run VERIFY_ONLY and never save production state, notify, wait for a slot, or queue successors.

## Stock confirmation

Targets are Neo Garden 23 / Mini Garden, Garden Party 30, Picotin, Mini Lindy / Lindy II mini, and Birkin, Kelly and Constance. Garden Party 36, Neo Garden Voyage 41 and Bolide are excluded.

Every published category page must reconcile with the official total and unique rendered SKU records. An eligible positive requires its official product page to match the canonical URL, market and visible SKU, with an enabled Add to cart / Add to bag button. Category stock.ecom is discovery metadata. An explicitly negative complete category can establish unavailability without an additional product request.

Coverage is the currently published women's bags category. Unlisted historical SKUs and product pages outside that category remain unknown. No result guarantees inventory across the entire retail site.

US and CA state is independent. Failed or incomplete evidence remains unknown, cannot alert or rearm a SKU, and retains historical observations and deduplication. Only explicit negative observations rearm an alerted SKU.

## Exact-count recovery

The captured US fault returned 39 + 9 ordinary-page SKUs against an official total of 49. The official So Medor line page included the omitted H085054CK37.

For gaps of at most five SKUs, up to three same-market/category line links explicitly published in the official page can recover omitted records. Facet names only rank requests to limit cost. Each selected facet must reconcile its exact total; overlapping SKU metadata must agree; the union must reach the unfiltered official unique total. The opening category and used recovery facets are fetched again and must remain identical. Data is never combined across scan retries. Any discrepancy remains unknown.

Requests use bounded datacenter retries and one browser fallback; residential proxies are not used. Whole-catalog inconsistencies can retry up to three fresh scans. Optional browser diagnostics preserve the same strict validation.

## State persistence and reruns

Production loads the current main-branch state before scanning. It writes only ant-state.json through the GitHub Contents API with the current blob SHA. A conflicting write triggers a bounded fresh read/merge/retry; newer market observations and per-SKU histories are preserved. No git rebase or force push is used for state.

This fixes a production rerun that successfully scanned both markets but failed while rebasing an old state commit over a newer one. The final verification gate requires execution, state persistence and both-market verification to succeed.

State schema is version 3:

- currentStocks contains only observations verified in the current successful scan.
- catalogStocks, available and alertedSkus contain historical observations and deduplication.
- lastVerifiedCatalog and lastSuccessAt retain the most recent verified evidence through failures.
- Unknown scans expose no current stock.

## Notifications

A newly verified purchasable target creates a GitHub Issue mentioning and assigning the repository owner. Deduplication checks existing Issues across pages before creating the alert. Tests cover positive eligibility, duplicate suppression and failed delivery. No fake stock alert is sent for testing.

GitHub Issue creation is the configured notification channel. Gmail inbox arrival is **not verified** and requires an authorized email connection or a signed-in check of [GitHub notification routing](https://github.com/settings/notifications). A profile email or successfully created Issue is not proof of inbox delivery.

## Configuration and evidence

- Required secret: SCRAPINGANT_API_KEY.
- Production job permissions: contents: write, issues: write, actions: write.
- workflow_dispatch accepts optional browser_recovery and internal not_before inputs.
- npm test runs the regression suite.
- ant-run-report.json records each market, page, request status, retry, credit cost, SHA-256, all validated catalog records, product purchase evidence and notification results.
- Raw HTML and the report are retained as Actions artifacts for seven days.
- Reduced CA 40 + 3 and US 39 + 9 + 2 fixtures preserve actual official fields, links and counts.
- Scrapling and legacy workflows remain manual backups.

The catalog/persistence/scheduler/notification suite has 89 tests. Validate real production state saves and the next ten-minute scan after changing scheduling or storage.
