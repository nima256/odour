const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const fixtures = [
  { _id: "A", name: "available expensive", finalPrice: 400, price: 400, countInStock: 3, createdAt: 2, sortPriority: 0, discount: 10 },
  { _id: "B", name: "sold out", finalPrice: 1, price: 1, countInStock: 0, createdAt: 9, sortPriority: 100, discount: 90 },
  { _id: "C", name: "call for price", finalPrice: null, price: 900, priceOnRequest: true, countInStock: 15, createdAt: 10, sortPriority: 200 },
  { _id: "D", name: "available inexpensive", finalPrice: 50, price: 50, countInStock: 5, createdAt: 4, sortPriority: 0, discount: 0 },
  { _id: "E", name: "available medium", finalPrice: 200, price: 200, countInStock: 4, createdAt: 3, sortPriority: 0, discount: 30 },
  { _id: "F", name: "manual stock closed", finalPrice: 1000, price: 1000, countInStock: 5, isOutOfStock: true, createdAt: 11, sortPriority: 300 },
  { _id: "G", name: "available new", finalPrice: 700, price: 700, countInStock: 2, createdAt: 7, sortPriority: 0, discount: 0 },
  { _id: "H", name: "missing price", countInStock: 5, createdAt: 12, sortPriority: 500 },
  { _id: "I", name: "available latest", finalPrice: 600, price: 600, countInStock: 4, createdAt: 13, sortPriority: 0 },
];

function evalExpression(expr, doc) {
  if (typeof expr === "string" && expr.startsWith("$")) return doc[expr.slice(1)];
  if (!expr || typeof expr !== "object" || expr instanceof Date) return expr;
  const [[op, args]] = Object.entries(expr);
  if (op === "$ifNull") return evalExpression(args[0], doc) ?? evalExpression(args[1], doc);
  if (op === "$eq") return evalExpression(args[0], doc) === evalExpression(args[1], doc);
  if (op === "$lte") return evalExpression(args[0], doc) <= evalExpression(args[1], doc);
  if (op === "$or") return args.some((x) => evalExpression(x, doc));
  if (op === "$cond") return evalExpression(args[0], doc) ? evalExpression(args[1], doc) : evalExpression(args[2], doc);
  throw new Error(`unexpected expression ${op}`);
}

const Product = {
  countDocuments: async () => fixtures.length,
  async aggregate(stages) {
    const rank = stages.find((s) => s.$addFields).$addFields.catalogUnavailableRank;
    const sort = stages.find((s) => s.$sort).$sort;
    const skip = stages.find((s) => "$skip" in s).$skip;
    const limit = stages.find((s) => s.$limit).$limit;
    return fixtures.map((p) => ({ ...p, catalogUnavailableRank: evalExpression(rank, p) }))
      .sort((a, b) => {
        for (const [key, dir] of Object.entries(sort)) {
          if (a[key] === b[key]) continue;
          if (a[key] == null) return -dir;
          if (b[key] == null) return dir;
          return a[key] > b[key] ? dir : -dir;
        }
        return 0;
      })
      .slice(skip, skip + limit).map((p) => ({ _id: p._id }));
  },
  find({ _id }) {
    const chain = {
      select: () => chain,
      populate: () => chain,
      lean: async () => fixtures.filter((p) => _id.$in.includes(p._id)).reverse(),
    };
    return chain;
  },
};

const source = fs.readFileSync(path.join(__dirname, "../helper/catalog.js"), "utf8");
const sandbox = { module: { exports: {} }, exports: {}, require: (name) => {
  if (name === "mongoose") return { Types: { ObjectId: { isValid: () => false } } };
  if (name === "../models/Product") return Product;
  if (name === "../models/Brand" || name === "../models/Category") return {};
  if (name === "./storefront") return { CARD_FIELDS: "name brand price", getCategoryTreeIds: async () => [] };
  if (name === "./fragranceProfile") return { FIELDS: {}, FILTER_FACETS: [], normalize: (x) => x };
  if (name === "./viewHelpers") return require("../helper/viewHelpers");
  throw new Error(`unexpected require ${name}`);
} };
vm.runInNewContext(source, sandbox, { filename: "catalog.js" });
const { listProducts, parseFilters } = sandbox.module.exports;

for (const sort of ["popular", "newest", "price-low", "price-high", "discount"]) {
  test(`catalog availability priority persists over all pages: ${sort}`, async () => {
    const results = [];
    for (let page = 1; page <= 3; page++) {
      const result = await listProducts(parseFilters({ sort, page: String(page), limit: "4" }));
      results.push(...result.products);
    }
    assert.equal(results.length, fixtures.length);
    assert.deepEqual(results.slice(0, 5).map((p) => p._id).sort(), ["A", "D", "E", "G", "I"]);
    assert.deepEqual(results.slice(5).map((p) => p._id).sort(), ["B", "C", "F", "H"]);
    if (sort === "price-low") assert.deepEqual(results.slice(0, 5).map((p) => p._id), ["D", "E", "A", "I", "G"]);
    if (sort === "price-high") assert.deepEqual(results.slice(0, 5).map((p) => p._id), ["G", "I", "A", "E", "D"]);
  });
}
