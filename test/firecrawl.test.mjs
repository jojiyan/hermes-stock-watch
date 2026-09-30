import test from "node:test";
import assert from "node:assert/strict";
import {
  isTargetProduct,
  parseCategoryMarkdown,
  parseProductRawHtml,
} from "../src/firecrawl.mjs";

const MARKET = {
  code: "US",
  name: "Hermès USA",
};

function categoryPage(cards) {
  return `# Leather goods Women's bags and clutches

Product list

${cards.join("\n\n")}
${" ".repeat(12_000)}`;
}

test("matches requested Hermès bag families", () => {
  for (const name of [
    "Neo Garden 23 bag",
    "Garden Party 30 bag",
    "Lindy II mini bag",
    "Mini Lindy bag",
    "Birkin 25 bag",
    "Kelly Pochette bag",
    "Constance 18 bag",
  ]) {
    assert.equal(isTargetProduct(name), true, name);
  }
  assert.equal(isTargetProduct("Picotin Lock 18 bag"), false);
});

test("category parser keeps Discover as a screening signal only", () => {
  const markdown = categoryPage([
    `[Neo Garden 23 bag](https://www.hermes.com/us/en/product/neo-garden-23-bag-H088612CKAO/ "Neo Garden 23 bag, Green"), Color: Green

, Price $3,000

Discover

![](image)`,
    `[Lindy II mini bag](https://www.hermes.com/us/en/product/lindy-ii-mini-bag-H085956CK3Q/ "Lindy II mini bag, Pink"), Color: Pink

, Price $9,050

Discover

![](image)`,
    `[Kelly 25 bag](https://www.hermes.com/us/en/product/kelly-25-bag-H012345CK89/ "Kelly 25 bag, Black"), Color: Black

, Price $12,000

![](image)`,
    `[So Medor bag](https://www.hermes.com/us/en/product/so-medor-bag-H085054CK0L/), Color: Grey

, Price $8,400

![](image)`,
    `[Picotin Lock 18 bag](https://www.hermes.com/us/en/product/picotin-lock-18-bag-H012346CK18/), Color: Gold

, Price $4,000

![](image)`,
  ]);

  const products = parseCategoryMarkdown(markdown, MARKET);
  const neo = products.find((p) => p.sku === "H088612CKAO");
  const kelly = products.find((p) => p.sku === "H012345CK89");

  assert.equal(neo.discoverOnly, true);
  assert.equal(neo.target, true);
  assert.equal(kelly.discoverOnly, false);
  assert.equal(kelly.target, true);
});

test("disabled Add to cart button is not stock", () => {
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
  const html = `<html>${" ".repeat(30_000)}
  H088612CKAO
  <span class="message-info">Unfortunately this product is no longer available</span>
  <button name="add-to-cart" data-testid="Add to cart" disabled="true" aria-disabled="true">
    <span>Add to cart</span>
  </button></html>`;

  const product = parseProductRawHtml(html, candidate);
  assert.equal(product.available, false);
  assert.equal(product.purchaseButtonDisabled, true);
});

test("enabled Add to cart button with matching SKU is stock", () => {
  const candidate = {
    key: "US:H088914CKP0",
    market: "US",
    marketName: "Hermès USA",
    sku: "H088914CKP0",
    name: "Hermès Videpoches bag",
    color: "Grey",
    price: "$5,500",
    url: "https://www.hermes.com/us/en/product/hermes-videpoches-bag-H088914CKP0/",
  };
  const html = `<html>${" ".repeat(30_000)}
  H088914CKP0
  <button name="add-to-cart" data-testid="Add to cart">
    <span>Add to cart</span>
  </button></html>`;

  const product = parseProductRawHtml(html, candidate);
  assert.equal(product.available, true);
  assert.equal(product.purchaseButtonDisabled, false);
});

test("wrong product reference is rejected", () => {
  const candidate = {
    market: "CA",
    sku: "H111111CKAA",
  };
  const html = `<html>${" ".repeat(30_000)}H222222CKAA
  <button name="add-to-cart"><span>Add to cart</span></button></html>`;

  assert.throws(
    () => parseProductRawHtml(html, candidate),
    /expected reference/,
  );
});
