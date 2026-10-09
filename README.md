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

## QQ email alerts (optional)

Direct QQ email delivery is implemented in `src/qq-mail-notify.py` and called by the production workflow **only after new official stock is detected**. To enable, add these **Actions repository secrets**:

- `QQ_SMTP_EMAIL`: full QQ sender mailbox address (e.g., `your-account@qq.com`)
- `QQ_SMTP_AUTH_CODE`: QQ Mail's dedicated SMTP authorization code, **not** your QQ login password
- `QQ_NOTIFY_TO`: optional destination email; defaults to the sender QQ email

Use `https://github.com/jojiyan/hermes-stock-watch/settings/secrets/actions`. Enable SMTP in QQ Mail settings and generate a dedicated authorization code. **Never put the code in issues, GitHub source files, or chat messages.**

SMTP server: `smtp.qq.com:465` SSL. `QQ SMTP accepted` in a GitHub log means the server accepted the message, **not** that the recipient inbox or iPhone push notification delivered it. Until the two required secrets are set, **only GitHub Issue notifications are active**; their delivery depends on GitHub notification preferences.

## Checks and evidence

- Run `npm test` and `python3 -m unittest discover -s test -p 'test_qq_mail_notify.py'`.
- Inspect `ant-state.json` for each market's `status`, `lastCheckedAt`, `officialTotal`, `products`, and `coverage`.
- Each production run publishes `ant-run-report.json` as an artifact, showing fetched status, mode, credit consumption and newly detected stock.
- The Scrapling workflow remains **manual-only backup**, and old Firecrawl workflows are not the production schedule.

**A green Actions run validates the published category data, not the availability of an unlisted product or end-to-end QQ inbox delivery.**
