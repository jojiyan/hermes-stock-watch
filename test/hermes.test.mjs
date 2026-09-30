import test from "node:test";
import assert from "node:assert/strict";
import {
  isTargetProduct,
  parseCategoryHtml,
  parseCategoryDocument,
  parseProductPageDocument,
  parseProductPageHtml,
} from "../src/hermes.mjs";

const MARKET = {
  code: "US",
  name: "Hermès USA",
  origin: "https://www.hermes.com",
};

function page(blocks) {
  return `<html><body>${blocks.join("")}${" ".repeat(30_000)}</body></html>`;
}

function productBlock({
  sku,
  name,
  color = "Gold",
  price = "$10,000",
  unavailable = false,
}) {
  return `
    <div class="product-grid-list-item" id="grid-product-${sku}">
      <h-grid-result-item>
        <a class="product-item-name" href="/us/en/product/${name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")}-${sku}/" title="${name}, ${color}">
          <span class="product-title">${name}</span>
        </a>
        <span class="price small">${price}</span>
        ${
          unavailable
            ? '<h-out-of-stock-label class="tag-unavailable">Discover</h-out-of-stock-label>'
            : ""
        }
      </h-grid-result-item>
    </div>`;
}

test("matches only the requested Hermès bag families", () => {
  const wanted = [
    "Neo Garden 23 bag",
    "Garden Party 30 bag",
    "Lindy II mini bag",
    "Lindy mini bag",
    "Mini Lindy bag",
    "Birkin 25 bag",
    "Kelly Pochette bag",
    "Constance 18 bag",
  ];
  const unwanted = [
    "Garden Party 23 bag",
    "Mini Garden Party bag",
    "Garden Party 36 bag",
    "Picotin Lock 18 bag",
    "Lindy 26 bag",
  ];

  wanted.forEach((name) => assert.equal(isTargetProduct(name), true, name));
  unwanted.forEach((name) => assert.equal(isTargetProduct(name), false, name));
});

test("uses the category availability marker and extracts product data", () => {
  const blocks = [
    productBlock({ sku: "H1", name: "Kelly Pochette bag", color: "Noir" }),
    productBlock({
      sku: "H2",
      name: "Neo Garden 23 bag",
      color: "Écru / Noir",
      price: "$3,000",
      unavailable: true,
    }),
    productBlock({ sku: "H3", name: "Picotin Lock 18 bag" }),
    productBlock({ sku: "H4", name: "So Medor bag" }),
    productBlock({ sku: "H5", name: "Bolide mini bag" }),
  ];

  const products = parseCategoryHtml(page(blocks), MARKET);
  assert.equal(products.length, 5);
  assert.equal(products[0].available, true);
  assert.equal(products[0].target, true);
  assert.equal(products[0].color, "Noir");
  assert.equal(products[1].available, false);
  assert.equal(products[1].target, true);
  assert.equal(products[1].price, "$3,000");
  assert.equal(products[2].target, false);
});

test("confirms a product page and extracts exact alert details", () => {
  const candidate = {
    key: "CA:H069573CKAC",
    market: "CA",
    marketName: "Hermès Canada",
    sku: "H069573CKAC",
    name: "Garden Party 30 bag",
    color: "Noir / Noir",
    price: "CA$4,000",
    url: "https://www.hermes.com/ca/en/product/garden-party-30-bag-H069573CKAC/",
  };
  const html = page([
    `<h1>Garden Party 30 bag</h1>
     <div>Price CA$4,000</div>
     <div>Color, Noir / Noir selected</div>
     <button>Add to cart</button>
     <section>Product description</section>
     <p>Bag in Militaire canvas and Negonda calfskin</p>
     <p>- Clou de Selle snap closure</p>
     <div>Product reference: H069573CKAC</div>`,
  ]);

  const product = parseProductPageHtml(html, candidate);
  assert.equal(product.available, true);
  assert.equal(product.name, "Garden Party 30 bag");
  assert.equal(product.color, "Noir / Noir");
  assert.equal(product.material, "Militaire canvas and Negonda calfskin");
  assert.equal(product.price, "CA$4,000");
});

test("rejects stale Add to cart text when the page says unavailable", () => {
  const candidate = {
    key: "CA:H069573CKAC",
    market: "CA",
    marketName: "Hermès Canada",
    sku: "H069573CKAC",
    name: "Garden Party 30 bag",
    color: "Noir / Noir",
    price: "CA$4,000",
    url: "https://www.hermes.com/ca/en/product/garden-party-30-bag-H069573CKAC/",
  };
  const html = page([
    `<h1>Garden Party 30 bag</h1>
     <div>Price CA$4,000</div>
     <div>Color, Noir / Noir selected</div>
     <p>Unfortunately this product is no longer available</p>
     <button>Add to cart</button>
     <p>Bag in Militaire canvas and Negonda calfskin</p>
     <div>Product reference: H069573CKAC</div>`,
  ]);

  assert.equal(parseProductPageHtml(html, candidate).available, false);
});

test("rejects a challenge page even if it contains stale Add to cart text", () => {
  const candidate = {
    key: "US:H123456",
    market: "US",
    marketName: "Hermès USA",
    sku: "H123456",
    name: "Kelly 25 bag",
    color: "Noir",
    price: "$12,000",
    url: "https://www.hermes.com/us/en/product/kelly-25-bag-H123456/",
  };
  const html = `<html><body><h1>Just a moment...</h1><div>cf-chl</div><button>Add to cart</button>${" ".repeat(6000)}</body></html>`;

  assert.throws(
    () => parseProductPageHtml(html, candidate),
    /access-block page/,
  );
});

test("rejects incomplete product HTML instead of interpreting Add to bag as stock", () => {
  const candidate = {
    key: "CA:H123456",
    market: "CA",
    marketName: "Hermès Canada",
    sku: "H123456",
    name: "Constance 18 bag",
    color: "Gold",
    price: "CA$12,000",
    url: "https://www.hermes.com/ca/en/product/constance-18-bag-H123456/",
  };

  assert.throws(
    () => parseProductPageHtml("<html><button>Add to bag</button></html>", candidate),
    /unexpectedly short/,
  );
});

test("requires the official product reference before accepting a purchasable page", () => {
  const candidate = {
    key: "US:H123456",
    market: "US",
    marketName: "Hermès USA",
    sku: "H123456",
    name: "Birkin 25 bag",
    color: "Gold",
    price: "$12,000",
    url: "https://www.hermes.com/us/en/product/birkin-25-bag-H123456/",
  };
  const html = page([
    `<h1>Birkin 25 bag</h1>
     <div>Price $12,000</div>
     <div>Color, Gold selected</div>
     <button>Add to cart</button>
     <p>Bag in Togo calfskin</p>`,
  ]);

  assert.throws(
    () => parseProductPageHtml(html, candidate),
    /product reference is missing/,
  );
});

test("parses trusted Firecrawl category markdown and preserves category availability", () => {
  const markdown = [
    "[Neo Garden 23 bag](https://www.hermes.com/us/en/product/neo-garden-23-bag-H123456/)\nColor: Green\nPrice $3,000\nDiscover",
    "[Kelly Pochette bag](https://www.hermes.com/us/en/product/kelly-pochette-bag-H223456/)\nColor: Noir\nPrice $9,000",
    "[Picotin Lock 18 bag](https://www.hermes.com/us/en/product/picotin-lock-18-bag-H323456/)\nColor: Gold\nPrice $4,000",
    "[Bolide mini bag](https://www.hermes.com/us/en/product/bolide-mini-bag-H423456/)\nColor: Red\nPrice $7,000",
    "[So Medor bag](https://www.hermes.com/us/en/product/so-medor-bag-H523456/)\nColor: Grey\nPrice $8,000",
    " ".repeat(2_000),
  ].join("\n\n");

  const products = parseCategoryDocument(
    {
      source: "firecrawl",
      markdown,
      rawHtml: "",
      metadata: {
        statusCode: 200,
        sourceURL:
          "https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/",
      },
    },
    MARKET,
  );

  assert.equal(products.length, 5);
  assert.equal(products[0].name, "Neo Garden 23 bag");
  assert.equal(products[0].available, false);
  assert.equal(products[0].target, true);
  assert.equal(products[1].name, "Kelly Pochette bag");
  assert.equal(products[1].available, true);
  assert.equal(products[1].target, true);
});

test("Firecrawl product verification rejects stale purchase text when unavailable", () => {
  const candidate = {
    key: "US:H088612CKAO",
    market: "US",
    marketName: "Hermès USA",
    sku: "H088612CKAO",
    name: "Neo Garden 23 bag",
    color: "Green",
    price: "$3,000",
    url: "https://www.hermes.com/us/en/product/neo-garden-23-bag-H088612CKAO/",
  };

  const product = parseProductPageDocument(
    {
      source: "firecrawl",
      markdown:
        "# Neo Garden 23 bag\nAdd to cart\nUnfortunately this product is no longer available" +
        " ".repeat(2_000),
      rawHtml: "<html>Hermès Add to cart Unfortunately this product is no longer available</html>" +
        " ".repeat(6_000),
      metadata: {
        statusCode: 200,
        sourceURL: candidate.url,
        name: "Neo Garden 23 bag",
        "product:retailer_item_id": "H088612CKAO",
        "product:price:amount": "3000",
        "product:price:currency": "USD",
      },
    },
    candidate,
  );

  assert.equal(product.available, false);
});

test("Firecrawl product verification accepts a matching official purchasable page", () => {
  const candidate = {
    key: "CA:H069573CKAC",
    market: "CA",
    marketName: "Hermès Canada",
    sku: "H069573CKAC",
    name: "Garden Party 30 bag",
    color: "Noir",
    price: "CA$4,000",
    url: "https://www.hermes.com/ca/en/product/garden-party-30-bag-H069573CKAC/",
  };

  const product = parseProductPageDocument(
    {
      source: "firecrawl",
      markdown:
        "# Garden Party 30 bag\nColor: Noir\nAdd to bag\nBag in Negonda calfskin" +
        " ".repeat(2_000),
      rawHtml: "<html>Hermès Add to bag H069573CKAC</html>" + " ".repeat(6_000),
      metadata: {
        statusCode: 200,
        sourceURL: candidate.url,
        name: "Garden Party 30 bag",
        "product:retailer_item_id": "H069573CKAC",
        "product:price:amount": "4000",
        "product:price:currency": "CAD",
      },
    },
    candidate,
  );

  assert.equal(product.available, true);
  assert.equal(product.sku, "H069573CKAC");
});

test("Firecrawl product verification rejects a mismatched SKU", () => {
  const candidate = {
    key: "US:H123456",
    market: "US",
    marketName: "Hermès USA",
    sku: "H123456",
    name: "Kelly 25 bag",
    color: "Noir",
    price: "$12,000",
    url: "https://www.hermes.com/us/en/product/kelly-25-bag-H123456/",
  };

  assert.throws(
    () =>
      parseProductPageDocument(
        {
          source: "firecrawl",
          markdown: "# Kelly 25 bag\nAdd to cart" + " ".repeat(2_000),
          rawHtml: "<html>Hermès Add to cart</html>" + " ".repeat(6_000),
          metadata: {
            statusCode: 200,
            sourceURL: candidate.url,
            name: "Kelly 25 bag",
            "product:retailer_item_id": "H999999",
          },
        },
        candidate,
      ),
    /did not match/,
  );
});
