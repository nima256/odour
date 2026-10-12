"use strict";
// Admin stock adjustments. Every change is a single conditional, atomic MongoDB
// update (the same $inc pattern checkout uses to reserve/release stock), so an
// adjustment can never drive stock below zero and never silently overwrites a
// reservation that happened after the admin loaded the page:
//  - "delta" adds/removes units relative to whatever is in stock right now;
//  - "set" only applies when the stock still equals the value the admin saw
//    (`expected`); otherwise it fails with a conflict and nothing changes.
const Product = require("../models/Product");
const matrix = require("./variantMatrix");

class InventoryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const toInt = (value) => {
  const normalized = String(value ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .trim();
  return /^-?\d+$/.test(normalized) ? Number(normalized) : NaN;
};

const tracked = (variant) => variant && variant.countInStock !== undefined && variant.countInStock !== null;

// Describes where a stock number lives for a given target.
function locate(product, { colorId = "", sizeId = "" } = {}) {
  colorId = String(colorId || "");
  sizeId = String(sizeId || "");
  if (matrix.configured(product)) {
    const row = (product.variantStocks || []).find((r) => String(r.colorId || "") === colorId && String(r.sizeId || "") === sizeId);
    if (!row) throw new InventoryError("این ترکیب رنگ/سایز برای محصول تعریف نشده است", 404);
    return { kind: "matrix", current: Math.max(0, Number(row.countInStock) || 0), colorId, sizeId };
  }
  if (colorId && sizeId) throw new InventoryError("موجودی ترکیبی برای این محصول فعال نیست؛ ابتدا ماتریس موجودی را در ویرایش محصول تنظیم کنید");
  if (colorId) {
    const color = (product.colors || []).find((c) => String(c._id) === colorId);
    if (!color) throw new InventoryError("رنگ یافت نشد", 404);
    if (!tracked(color)) throw new InventoryError("برای این رنگ موجودی جداگانه ثبت نشده است");
    return { kind: "color", current: Math.max(0, Number(color.countInStock) || 0), colorId };
  }
  if (sizeId) {
    const size = (product.sizes || []).find((s) => String(s._id) === sizeId);
    if (!size) throw new InventoryError("سایز یافت نشد", 404);
    if (!tracked(size)) throw new InventoryError("برای این سایز موجودی جداگانه ثبت نشده است");
    return { kind: "size", current: Math.max(0, Number(size.countInStock) || 0), sizeId };
  }
  return { kind: "total", current: Math.max(0, Number(product.countInStock) || 0) };
}

/**
 * Adjusts stock. `mode` is "delta" (value may be negative) or "set" (value >= 0,
 * requires `expected` = the stock the admin saw). Returns { product, before, after }.
 */
async function adjustStock(productId, { colorId = "", sizeId = "", mode = "delta", value, expected } = {}) {
  const amount = toInt(value);
  if (!Number.isSafeInteger(amount)) throw new InventoryError("مقدار موجودی باید عدد صحیح باشد");
  if (mode !== "delta" && mode !== "set") throw new InventoryError("نوع تغییر موجودی نامعتبر است");
  if (mode === "set" && amount < 0) throw new InventoryError("موجودی نمی‌تواند منفی باشد");
  if (Math.abs(amount) > 1000000) throw new InventoryError("مقدار موجودی بیش از حد مجاز است");

  const product = await Product.findById(productId);
  if (!product) throw new InventoryError("محصول یافت نشد", 404);
  const target = locate(product, { colorId, sizeId });

  let guard;
  let delta;
  if (mode === "set") {
    const seen = toInt(expected);
    if (!Number.isSafeInteger(seen)) throw new InventoryError("موجودی فعلی (expected) برای ثبت مقدار جدید لازم است");
    delta = amount - seen;
    guard = seen; // exact match: the stock must not have changed since it was read
  } else {
    delta = amount;
    guard = delta < 0 ? { $gte: -delta } : { $gte: 0 };
  }
  if (delta === 0) return { product, before: target.current, after: target.current, unchanged: true };

  const filter = { _id: product._id };
  const update = { $inc: { stockRevision: 1 } };
  const options = { new: true };

  if (target.kind === "matrix") {
    filter.variantInventoryConfigured = true;
    filter.variantStocks = { $elemMatch: { colorId: target.colorId, sizeId: target.sizeId, countInStock: guard } };
    update.$inc["variantStocks.$[v].countInStock"] = delta;
    update.$inc.countInStock = delta;
    options.arrayFilters = [{ "v.colorId": target.colorId, "v.sizeId": target.sizeId }];
  } else if (target.kind === "color") {
    filter.variantInventoryConfigured = { $ne: true };
    filter.colors = { $elemMatch: { _id: product.colors.id(target.colorId)._id, countInStock: guard } };
    update.$inc["colors.$[c].countInStock"] = delta;
    options.arrayFilters = [{ "c._id": product.colors.id(target.colorId)._id }];
  } else if (target.kind === "size") {
    filter.variantInventoryConfigured = { $ne: true };
    filter.sizes = { $elemMatch: { _id: product.sizes.id(target.sizeId)._id, countInStock: guard } };
    update.$inc["sizes.$[s].countInStock"] = delta;
    options.arrayFilters = [{ "s._id": product.sizes.id(target.sizeId)._id }];
  } else {
    filter.variantInventoryConfigured = { $ne: true };
    filter.countInStock = guard;
    update.$inc.countInStock = delta;
  }

  const updated = await Product.findOneAndUpdate(filter, update, options);
  if (!updated) {
    throw new InventoryError(
      mode === "set"
        ? "موجودی این کالا از زمان بارگذاری صفحه تغییر کرده است (احتمالاً یک سفارش ثبت شده). صفحه را تازه کنید و دوباره تلاش کنید."
        : "این تغییر موجودی را منفی می‌کند و اعمال نشد.",
      409
    );
  }

  // Re-derive flags the same way checkout's releaseInventory does.
  if (target.kind === "color" || target.kind === "size") {
    const list = target.kind === "color" ? updated.colors : updated.sizes;
    const variant = list.id(target.kind === "color" ? target.colorId : target.sizeId);
    if (variant && Number(variant.countInStock) > 0 && delta > 0) variant.isOutOfStock = false;
  }
  await updated.save(); // pre-save recomputes totals / isOutOfStock

  const after = locate(updated, { colorId, sizeId }).current;
  return { product: updated, before: target.current, after };
}

// Pauses / resumes sale of one matrix combination without touching its quantity.
async function setVariantPaused(productId, { colorId = "", sizeId = "", paused }) {
  const product = await Product.findById(productId);
  if (!product) throw new InventoryError("محصول یافت نشد", 404);
  if (!matrix.configured(product)) throw new InventoryError("توقف فروش تنوع فقط برای محصولات دارای ماتریس موجودی فعال است");
  locate(product, { colorId, sizeId });
  const updated = await Product.findOneAndUpdate(
    { _id: product._id, variantStocks: { $elemMatch: { colorId: String(colorId || ""), sizeId: String(sizeId || "") } } },
    { $set: { "variantStocks.$[v].isOutOfStock": Boolean(paused) }, $inc: { stockRevision: 1 } },
    { new: true, arrayFilters: [{ "v.colorId": String(colorId || ""), "v.sizeId": String(sizeId || "") }] }
  );
  if (!updated) throw new InventoryError("تنوع یافت نشد", 404);
  await updated.save();
  return updated;
}

// Flat, display-ready stock rows for one product (used by the inventory screen & CSV).
function stockRows(product) {
  const colors = new Map((product.colors || []).map((c) => [String(c._id), c]));
  const sizes = new Map((product.sizes || []).map((s) => [String(s._id), s]));
  if (matrix.configured(product)) {
    return (product.variantStocks || []).map((row) => ({
      kind: "matrix",
      colorId: String(row.colorId || ""),
      sizeId: String(row.sizeId || ""),
      color: colors.get(String(row.colorId || ""))?.name || "",
      colorRgb: colors.get(String(row.colorId || ""))?.rgb || "",
      size: sizes.get(String(row.sizeId || ""))?.size || "",
      stock: Math.max(0, Number(row.countInStock) || 0),
      paused: row.isOutOfStock === true,
    }));
  }
  const rows = [{ kind: "total", colorId: "", sizeId: "", color: "", size: "", stock: Math.max(0, Number(product.countInStock) || 0), paused: product.isOutOfStock === true && Number(product.countInStock) > 0 }];
  for (const color of product.colors || []) {
    if (tracked(color)) rows.push({ kind: "color", colorId: String(color._id), sizeId: "", color: color.name || "", colorRgb: color.rgb || "", size: "", stock: Math.max(0, Number(color.countInStock) || 0), paused: color.isOutOfStock === true });
  }
  for (const size of product.sizes || []) {
    if (tracked(size)) rows.push({ kind: "size", colorId: "", sizeId: String(size._id), color: "", size: size.size || "", stock: Math.max(0, Number(size.countInStock) || 0), paused: size.isOutOfStock === true });
  }
  return rows;
}

// ------------------------------------------------------------------------ CSV
const CSV_HEADERS = ["product_id", "sku", "product_name", "kind", "color", "size", "color_id", "size_id", "current_stock", "new_stock"];
const csvSafe = (value) => {
  const text = String(value ?? "").replace(/[\r\n\t]/g, " ").trim();
  return /^[=+@\-]/.test(text) ? `'${text}` : text; // spreadsheet formula injection
};
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

function toCsv(products) {
  const lines = [CSV_HEADERS];
  for (const product of products) {
    for (const row of stockRows(product)) {
      lines.push([String(product._id), csvSafe(product.sku), csvSafe(product.name), row.kind, csvSafe(row.color), csvSafe(row.size), row.colorId, row.sizeId, String(row.stock), ""]);
    }
  }
  return `﻿${lines.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function parseCsv(text) {
  const source = String(text || "").replace(/^﻿/, "");
  if (source.length > 5 * 1024 * 1024) throw new InventoryError("فایل CSV بیش از حد بزرگ است");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = []; field = "";
      continue;
    }
    field += c;
  }
  if (quoted) throw new InventoryError("ساختار CSV نامعتبر است (نقل‌قول بسته نشده)");
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  if (!rows.length) throw new InventoryError("فایل CSV خالی است");
  const [header, ...body] = rows;
  const normalizedHeader = header.map((h) => h.trim());
  if (JSON.stringify(normalizedHeader) !== JSON.stringify(CSV_HEADERS)) {
    throw new InventoryError(`سرستون‌های CSV تغییر کرده‌اند. ستون‌ها باید دقیقاً این باشند: ${CSV_HEADERS.join(", ")}`);
  }
  return body.map((cells, index) => ({ line: index + 2, ...Object.fromEntries(CSV_HEADERS.map((key, i) => [key, String(cells[i] ?? "").trim()])) }));
}

/**
 * Validates CSV rows against live data. Only rows with a non-empty new_stock are
 * considered; each becomes a "set" change guarded by its exported current_stock.
 */
async function planCsvImport(rows) {
  const changes = rows.filter((r) => r.new_stock !== "");
  if (changes.length > 5000) throw new InventoryError("حداکثر ۵۰۰۰ ردیف تغییر در هر بار مجاز است");
  const ids = [...new Set(changes.map((r) => r.product_id))].filter((id) => /^[a-f0-9]{24}$/i.test(id));
  const products = await Product.find({ _id: { $in: ids } }).select("name sku colors sizes variantInventoryConfigured variantStocks countInStock isOutOfStock").lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const plan = [];
  const errors = [];
  const seen = new Set();
  for (const r of changes) {
    const fail = (message) => errors.push({ line: r.line, product: r.product_name, message });
    const product = byId.get(r.product_id);
    if (!product) { fail("محصول یافت نشد"); continue; }
    const next = toInt(r.new_stock);
    const expected = toInt(r.current_stock);
    if (!Number.isSafeInteger(next) || next < 0) { fail("new_stock باید عدد صحیح نامنفی باشد"); continue; }
    if (!Number.isSafeInteger(expected)) { fail("current_stock نباید تغییر کند"); continue; }
    const key = `${r.product_id}|${r.color_id}|${r.size_id}`;
    if (seen.has(key)) { fail("ردیف تکراری"); continue; }
    seen.add(key);
    let target;
    try {
      target = locate(product, { colorId: r.color_id, sizeId: r.size_id });
    } catch (error) {
      fail(error.message);
      continue;
    }
    if (target.current !== expected) {
      fail(`موجودی از زمان خروجی گرفتن تغییر کرده است (${expected} → ${target.current}). دوباره خروجی بگیرید.`);
      continue;
    }
    if (next === expected) continue;
    plan.push({ productId: r.product_id, name: product.name, color: r.color, size: r.size, colorId: r.color_id, sizeId: r.size_id, before: expected, after: next, line: r.line });
  }
  return { plan, errors, considered: changes.length };
}

async function applyCsvPlan(plan) {
  const applied = [];
  const failed = [];
  for (const item of plan) {
    try {
      await adjustStock(item.productId, { colorId: item.colorId, sizeId: item.sizeId, mode: "set", value: item.after, expected: item.before });
      applied.push(item);
    } catch (error) {
      failed.push({ ...item, message: error.message });
    }
  }
  return { applied, failed };
}

module.exports = {
  InventoryError,
  adjustStock,
  setVariantPaused,
  stockRows,
  locate,
  toCsv,
  parseCsv,
  planCsvImport,
  applyCsvPlan,
  CSV_HEADERS,
};
