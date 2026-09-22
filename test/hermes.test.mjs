import test from "node:test";
import assert from "node:assert/strict";
import {
  isTargetProduct,
  parseCategoryHtml,
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
