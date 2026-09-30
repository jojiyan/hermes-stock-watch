const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

export async function fetchWithFirecrawl(
  url,
  label,
  fetchImpl = fetch,
  apiKey = process.env.FIRECRAWL_API_KEY || "",
) {
  if (!apiKey) {
    throw new Error(`${label}: FIRECRAWL_API_KEY is missing`);
  }

  const response = await fetchImpl(FIRECRAWL_ENDPOINT, {
    method: "POST",
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "user-agent": "hermes-stock-watch",
    },
    body: JSON.stringify({
      url: String(url),
      formats: ["rawHtml"],
      onlyMainContent: false,
      waitFor: 3500,
      maxAge: 0,
      proxy: "stealth",
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${label}: Firecrawl returned HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${label}: Firecrawl returned invalid JSON`);
  }

  const html =
    payload?.data?.rawHtml ||
    payload?.rawHtml ||
    payload?.data?.html ||
    payload?.html ||
    "";

  if (typeof html !== "string" || html.length < 5_000) {
    throw new Error(
      `${label}: Firecrawl returned only ${html?.length || 0} HTML characters`,
    );
  }

  return html;
}
