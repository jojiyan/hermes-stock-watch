import { parseHermesCatalog } from "./ant-catalog.mjs";

// Only official category pages, using a bounded retry sequence.
// Never turn HTTP 423 or an incomplete page into an "out of stock" result.
export async function fetchOfficialCatalog(market, key, options = {}) {
  if (!["US", "CA"].includes(market) || !key) throw new Error("Invalid market or missing key");
  const fetcher = options.fetcher || fetch;
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const parser = options.parser || parseHermesCatalog;
  const url = `https://www.hermes.com/${market.toLowerCase()}/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/`;
  // Datacenter is normally 1 credit. Rendering (typically 10) is a LAST resort;
  // never escalate to the 25-credit residential proxy.
  const modes = [
    { browser: false, mode: "low-credit-1" },
    { browser: false, mode: "low-credit-retry" },
    { browser: true, mode: "browser-fallback" },
  ];
  const errors = [];
  let credits = 0;
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    if (i !== 0) await wait(1200 * i);
    const params = new URLSearchParams({
      url,
      browser: String(mode.browser),
      proxy_type: "datacenter",
      proxy_country: market.toLowerCase(),
      timeout: "50",
    });
    if (mode.browser) {
      params.append("block_resource", "image");
      params.append("block_resource", "media");
      params.append("block_resource", "font");
    }
    let response;
    try {
      response = await fetcher(`https://api.scrapingant.com/v2/general?${params}`, {
        headers: { "x-api-key": key, accept: "text/html,*/*" },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      errors.push(`${mode.mode}: network ${String(e?.message || e).slice(0,100)}`);
      continue;
    }
    const used = Number(response.headers.get("ant-credits-cost") || 0);
    if (Number.isFinite(used) && used >= 0) credits += used;
    if (!response.ok) {
      const message = `${mode.mode}: HTTP ${response.status}`;
      errors.push(message);
      // Insufficient balance or bad auth cannot be remedied by expensive modes.
      if ([400, 401, 402, 403].includes(response.status)) break;
      continue;
    }
    const html = await response.text();
    try {
      const parsed = parser(html, market);
      return { parsed, credits, mode: mode.mode };
    } catch (e) {
      // Parsing failures are not valid stock evidence; a second mode may
      // recover a partial/blocked response without ever reporting false stock.
      errors.push(`${mode.mode}: ${String(e?.message || e).slice(0,180)}`);
    }
  }
  throw new Error(`${market}: official catalog could not be verified: ${errors.join(" | ")}`);
}
