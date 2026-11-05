# Herm�s US + Canada stock monitor

Production: [Hermes Stock Watch (Scrapling)](.github/workflows/hermes-stock-watch-ant.yml).

## Operation

Production runs in GitHub Actions, with a first-party Scrapling browser session per market. It does not require the user's computer or any paid scraping credits. No production step loads Firecrawl, ScrapingAnt or TinyFish credentials. The former credit-provider workflow is retired and cannot queue more scans.

Each main-branch run saves its observations and dispatches the active Scrapling workflow for the next ten-minute slot. Native cron is a recovery trigger; GitHub queue delays can shift scan times. Repair branches use VERIFY_ONLY and cannot notify, save production state or chain successors.

## Stock confirmation

Targets: Neo Garden 23 / Mini Garden / Garden Party Mini, Garden Party 30, Mini Lindy / Lindy II mini, Picotin in all sizes, Birkin, Kelly (including Kelly Pochette), and Constance. Garden Party 36, Neo Garden Voyage 41 and Bolide are excluded.

Every published category page must reconcile with the official total and unique rendered SKU records. Pagination, small-gap recovery through published official line links, and closing consistency checks use the same no-credit transport. An eligible positive requires its matching official product page, visible SKU, market/canonical URL, and an enabled Add to cart / Add to bag button. Category stock metadata cannot establish positive availability.

US and CA are independent. Failed or incomplete evidence remains unknown, exposes no current stock, and cannot alert or rearm a SKU. Missing listings alone do not prove a sell-out.

Coverage is the currently published women's bags category. Unlisted products remain unknown.

## State and notifications

The only production state is ant-state.json, schema version 3, shared with the ChatGPT inventory reminder. The old direct-state.json is inactive and must not be used for current availability.

- currentStocks contains only observations verified in the market's latest successful scan.
- catalogStocks, available and alertedSkus retain history and duplicate suppression.
- lastSuccessAt and lastVerifiedCatalog preserve the last verified evidence through failures.
- Only explicit verified negative observations rearm an alerted SKU.

Production loads the current state before scanning and saves through the GitHub Contents API with bounded conflict retries. Newer market observations and SKU histories survive concurrent writes. No git rebase or force push is used.

A newly verified purchasable target creates a GitHub Issue mentioning and assigning the owner, with a stock marker for deduplication across all Issue pages. The ChatGPT reminder accepts only fresh, currently verified purchase observations. Historical stock and unknown markets remain silent.

GitHub Issue creation is the configured notification channel. Gmail inbox delivery is not independently verified. No fake inventory notifications are sent for testing.

## Validation and evidence

Run npm test. The Linux workflow runs the complete regression suite; the legacy Firecrawl executable fixture in test/check.test.mjs is POSIX-only.

scrapling-run-report.json records market health, exact catalog totals, all validated records, request timestamps/hashes, zero credit usage, purchase evidence and notification results. Raw official HTML and the report are retained as Actions artifacts for seven days.

A green unit-test run does not prove official-site access or recurring execution. Verify fresh US/CA status, successful production state persistence and the automatically dispatched successor after deployment.

