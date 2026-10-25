"use strict";
// Dependency-free regression checks for the published/draft boundary.
// Run with: node --test tests/publicationVisibility.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

function productPageHandler(findOne) {
  const source = read("index.js");
  const start = source.indexOf('app.get("/productDetails/:slug"');
  const end = source.indexOf('app.get(\n  "/cart"', start);
  assert.ok(start >= 0 && end > start, "found complete product details route");
  let handler;
  const chain = { select() { return this; }, sort() { return this; }, limit() { return this; }, async lean() { return []; } };
  const ctx = {
    app: { get(route, fn) { assert.equal(route, "/productDetails/:slug"); handler = fn; } },
    Product: { findOne(filter) {
      const result = findOne(filter);
      return {
        select() { return this; },
        lean() { return result; },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
    }, find() { return chain; } },
    Category: { find() { return { select() { return { async lean() { return []; } }; } }; } },
    buildMenuCategories: async () => [],
    parseFragranceProfile: () => ({}),
    User: {},
    CARD_FIELDS: "name price",
    require: () => ({ parseVariantKey: () => ({}) }),
    console,
  };
  vm.runInNewContext(source.slice(start, end), ctx, { filename: "product-details-route.js" });
  return handler;
}

const resSpy = () => ({
  code: 200,
  headers: {},
  set(name, value) { this.headers[name] = value; return this; },
  status(code) { this.code = code; return this; },
  render(view, data) { this.view = view; this.data = data; return this; },
  redirect(code, url) { this.code = code; this.redirectUrl = url; return this; },
});

test("a draft is 404 even when requested by its exact product slug", async () => {
  const seen = [];
  const handler = productPageHandler(async (filter) => { seen.push(filter); return null; });
  const res = resSpy();
  await handler({ params: { slug: "draft-item" }, session: {}, query: {}, originalUrl: "/productDetails/draft-item" }, res, (err) => { throw err; });
  assert.equal(res.code, 404);
  assert.equal(res.view, "404");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((filter) => filter.isPublished), [true, true], "old-slug redirects must also check status");
});

test("a published product is still accessible normally", async () => {
  const published = { _id: "id", slug: "live-item", name: "Live", price: 100, category: [], isPublished: true };
  const handler = productPageHandler(async (filter) => filter.slug === published.slug && filter.isPublished === true ? published : null);
  const res = resSpy();
  await handler({ params: { slug: "live-item" }, session: {}, query: {}, originalUrl: "/productDetails/live-item" }, res, (err) => { throw err; });
  assert.equal(res.code, 200);
  assert.equal(res.view, "ProductDetails");
  assert.equal(res.data.product.isPublished, true);
});

test("a copy of a published product is always created as a draft", async () => {
  const source = read("routes/admin.js");
  const start = source.indexOf('router.post("/products/duplicate/:id"');
  const end = source.indexOf('router.post("/discounts/add"', start);
  assert.ok(start >= 0 && end > start, "found complete duplication route");
  const original = {
    _id: "original", name: "Live", images: [], isPublished: true,
    toObject: () => ({ _id: "original", name: "Live", isPublished: true, publishedAt: new Date(), oldSlugs: ["old-live"], images: [], colors: [], sizes: [], category: [], tags: [] }),
  };
  let copied;
  function Product(data) { copied = data; this._id = "new-id"; this.save = async () => {}; }
  Product.findById = (id) => ({
    populate() { return this; },
    then(resolve, reject) { return Promise.resolve(id === "original" ? original : { _id: "new-id" }).then(resolve, reject); },
  });
  let handler;
  const ctx = {
    router: { post(route, fn) { assert.equal(route, "/products/duplicate/:id"); handler = fn; } },
    Product,
    mongoose: { Types: { ObjectId: { isValid: () => true } } },
    getPersianDate: () => "today",
    console,
  };
  vm.runInNewContext(source.slice(start, end), ctx, { filename: "duplicate-route.js" });
  const res = resSpy();
  res.json = function (value) { this.payload = value; return this; };
  await handler({ params: { id: "original" } }, res);
  assert.equal(res.code, 201);
  assert.equal(res.payload.success, true);
  assert.equal(copied.isPublished, false);
  assert.equal(copied.publishedAt, undefined);
  assert.equal(copied.oldSlugs, undefined);
});

test("cart, checkout and catalog enforce the same publication boundary", () => {
  assert.match(read("routes/cart.js"), /Product\.findOne\(\{ _id: productId, isPublished: true \}\)/);
  assert.match(read("routes/order.js"), /Product\.findOne\(\{ _id: productId, isPublished: true \}\)/);
  assert.match(read("routes/order.js"), /_id: item\.product,\s+isPublished: true,/);
  assert.match(read("helper/catalog.js"), /Product\.find\(\{ _id: \{ \$in: ids \}, isPublished: true \}\)/);
  assert.match(read("index.js"), /user\.cart\.filter\(\(item\) => item\.productId\?\.isPublished === true\)/);
});
