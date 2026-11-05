# Herm�s US + Canada stock monitor

Production: [Hermes Stock Watch (Scrapling)](.github/workflows/hermes-stock-watch-ant.yml).

## Operation

Production runs in GitHub Actions, with direct first-party HTTP and a persistent Camoufox browser session per market. The browser runs under Xvfb in the cloud and does not require the user's computer or any paid scraping credits. No production step loads Firecrawl, ScrapingAnt or TinyFish credentials. The former credit-provider workflow is retired and cannot queue more scans.

Camoufox Python 0.5.9 and browser 158.0.1-beta.41 are pinned. Public browser/runtime data is cached between runs. Live alternate-engine verification opened the US category and a matching Lindy product page without a challenge frame. The current visible negative message, "This product is currently not available", is recognized under the same SKU/canonical/market checks as other sold-out evidence; recommendation text remains excluded.

Each main-branch run saves its observations and dispatches the active Scrapling workflow for the next ten-minute slot. Native cron is a recovery trigger; GitHub queue delays can shift scan times. Repair branches use VERIFY_ONLY and cannot notify, save production state or chain successors.

Deployments replace obsolete waiting runs and scan immediately. Scheduled continuations respect the latest persisted observation and their due time without cancelling their predecessor. Contents-API state merging and Issue deduplication preserve history through deployment cancellation.

## Stock confirmation

Targets: Neo Garden 23 / Mini Garden / Garden Party Mini, Garden Party 30, Mini Lindy / Lindy II mini, Picotin in all sizes, Birkin, Kelly (including Kelly Pochette), and Constance. Garden Party 36, Neo Garden Voyage 41 and Bolide are excluded.

Every published category page must reconcile with the official total and unique rendered SKU records. Pagination, small-gap recovery through published official line links, and closing consistency checks use the same no-credit transport. An eligible positive requires its matching official product page, visible SKU, market/canonical URL, and an enabled Add to cart / Add to bag button. Category stock metadata cannot establish positive availability.

Production checks every discovered target's purchase page, including category entries marked unavailable. A cached negative cannot suppress its check or rearm an alert when its product page is blocked. The legacy credit-provider parser's negative-category shortcut is not used in production.

When a published page total changes, production continues through safely linked later pages to discover target URLs, but still rejects the mixed catalog as complete coverage. Each discovered SKU requires its own purchase-page validation. An HTTP-200 page without a verifiable purchase state receives one browser-rendered retry under the same strict parser; unavailable or still unknown pages cannot alert.

US, CA and individual SKUs are independent. A failed catalog page keeps full-market coverage unknown. A separately verified matching product page may still alert. A failed SKU never changes its own stock or suppresses another SKU. Incomplete-category negatives cannot rearm stock. Missing listings alone do not prove a sell-out.

Coverage is the currently published women's bags category. Unlisted products remain unknown.

## State and notifications

The only production state is ant-state.json, schema version 3, shared with the ChatGPT inventory reminder. The old direct-state.json is inactive and must not be used for current availability.

- currentStocks contains only observations verified during the latest scan; under unknown market coverage, only independently verified product-page evidence survives persistence.
- catalogStocks, available and alertedSkus retain history and duplicate suppression.
- lastSuccessAt and lastVerifiedCatalog preserve the last verified evidence through failures.
- Only explicit verified negative observations rearm an alerted SKU.

Production loads the current state before scanning and saves through the GitHub Contents API with bounded conflict retries. Newer market observations and SKU histories survive concurrent writes. No git rebase or force push is used.

A newly verified purchasable target creates a GitHub Issue mentioning and assigning the owner, with a stock marker for deduplication across all Issue pages. The ChatGPT reminder accepts only fresh, currently verified purchase observations, including independently verified SKUs during partial catalog failures. Historical or unverified SKU observations remain silent.

GitHub Issue creation is the configured notification channel. Gmail inbox delivery is not independently verified. No fake inventory notifications are sent for testing.

## Validation and evidence

Run npm test. The Linux workflow runs the complete regression suite; the legacy Firecrawl executable fixture in test/check.test.mjs is POSIX-only.

scrapling-run-report.json records market health, exact catalog totals, all validated records, request timestamps/hashes, zero credit usage, purchase evidence and notification results. Raw official HTML and the report are retained as Actions artifacts for seven days.

A green unit-test run does not prove official-site access or recurring execution. Verify fresh US/CA status, successful production state persistence and the automatically dispatched successor after deployment.

Live diagnostics found official category HTML with public max-age=3600 caching and different page ages. Uncached URLs and the live JSON API can return HTTP 403 from free cloud runners. The report retains cache age where available. Ten-minute execution cannot guarantee ten-minute visibility of newly published products while the official site serves cached or blocked content. Full-market verification remains failed if totals or pagination cannot be reconciled.

