import { writeFile } from "node:fs/promises";

const apiKey = process.env.SCRAPINGANT_API_KEY || "";
if (!apiKey) throw new Error("SCRAPINGANT_API_KEY missing");

const targetUrl = "https://www.hermes.com/ca/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/";
const params = new URLSearchParams({
  url: targetUrl,
  browser: "true",
  proxy_type: "datacenter",
  proxy_country: "ca",
  timeout: "60",
});
params.append("block_resource", "image");
params.append("block_resource", "media");
params.append("block_resource", "font");

const response = await fetch(`https://api.scrapingant.com/v2/extended?${params}`, {
  headers: { "x-api-key": apiKey, accept: "application/json" },
});
const credits = response.headers.get("ant-credits-cost");
if (!response.ok) {
  throw new Error(`extended failed ${response.status}: ${(await response.text()).slice(0,500)}`);
}
const data = await response.json();
const xhrs = Array.isArray(data.xhrs) ? data.xhrs : [];
const re = /picotin|garden\s*party|lindy|birkin|kelly|constance|neo\s*garden|inventory|stock|availab|variant|product/i;
const summaries = xhrs.map((x, i) => {
  const body = typeof x.body === "string" ? x.body : JSON.stringify(x.body ?? "");
  const hay = `${x.url || ""}\n${body}`;
  return {
    i,
    url: x.url || "",
    status: x.status ?? null,
    method: x.method || "",
    bodyLength: body.length,
    relevant: re.test(hay),
    sample: re.test(hay) ? body.slice(0, 2500) : "",
  };
});
const report = {
  credits: credits ? Number(credits) : null,
  pageStatus: data.status_code ?? null,
  xhrCount: xhrs.length,
  relevant: summaries.filter(x => x.relevant),
  urls: summaries.map(({i,url,status,method,bodyLength,relevant}) => ({i,url,status,method,bodyLength,relevant})),
};
await writeFile("ant-xhr-probe.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({
  credits: report.credits,
  pageStatus: report.pageStatus,
  xhrCount: report.xhrCount,
  relevantCount: report.relevant.length,
  relevantUrls: report.relevant.map(x => x.url),
}, null, 2));
