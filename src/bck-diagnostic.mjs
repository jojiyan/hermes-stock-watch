const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/140.0.0.0 Safari/537.36";

const headers = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  origin: "https://www.hermes.com",
  referer: "https://www.hermes.com/",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "user-agent": UA,
};

const urls = [
  "https://bck.hermes.com/products?category=WOMEN&sort=relevance&pagesize=10&locale=us_en",
  "https://bck.hermes.com/product?productsku=H652320HE0246&locale=ca_en",
];

for (const url of urls) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
    headers,
  });
  const text = await response.text();
  console.log(JSON.stringify({
    url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type"),
    length: text.length,
    preview: text.slice(0, 500),
  }, null, 2));
}
