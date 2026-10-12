"use strict";
/*
 * End-to-end test of the admin panel API against a real MongoDB.
 * Boots the real app (index.js) on a scratch database, seeds data, and drives it over HTTP.
 *
 *   TEST_DB_URL=mongodb://127.0.0.1:27017/odour_admin_test node --test tests/integration/
 *
 * Skipped unless TEST_DB_URL is set. The database named in TEST_DB_URL is DROPPED at
 * start and end — never point it at a real database (the name must contain "test").
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawn } = require("child_process");

const DB = process.env.TEST_DB_URL;
const PORT = Number(process.env.TEST_PORT || 7391);
const BASE = `http://127.0.0.1:${PORT}`;
const skip = !DB ? "TEST_DB_URL not set" : !/test/i.test(DB) ? "TEST_DB_URL must name a *test* database" : false;

const ROOT = path.join(__dirname, "..", "..");
let server;
let mongoose;
let M = {};

// Minimal cookie-jar fetch client.
function client() {
  const jar = new Map();
  let csrf = "";
  const call = async (url, { method = "GET", body, headers = {}, raw = false } = {}) => {
    const h = { Accept: "application/json", ...headers };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) { h["Content-Type"] = "application/json"; }
    if (csrf && method !== "GET" && !("X-CSRF-Token" in headers)) h["X-CSRF-Token"] = csrf;
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    call,
    jar,
    setCsrf: (v) => (csrf = v),
    async login(email, password) {
      const r = await call("/api/authentication/admin/login", { method: "POST", body: { email, password } });
      if (r.status === 200) {
        const page = await call("/admin", { headers: { Accept: "text/html" } });
        csrf = (page.text.match(/name="csrf-token" content="([^"]+)"/) || [])[1] || "";
      }
      return r;
    },
  };
}

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try { await fetch(`${BASE}/robots.txt`); return; } catch (_) { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error("server did not start");
}

test.describe("admin panel (integration)", { skip }, () => {
  const ids = {};

  test.before(async () => {
    mongoose = require(path.join(ROOT, "node_modules/mongoose"));
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    for (const name of ["Admins", "Product", "Order", "User", "Brand", "Category", "Visit", "RecentAction", "DiscountCode", "Weblog"]) {
      M[name] = require(path.join(ROOT, "models", name));
    }
    // Seed
    await M.Admins.create({ fullName: "مدیر ارشد", email: "root@test.local", password: "root-password-123", role: "super_admin" });
    await M.Admins.create({ fullName: "مدیر قدیمی", email: "legacy@test.local", password: "legacy-password-1", role: "admin" });
    await M.Admins.create({ fullName: "مسئول سفارش", email: "orders@test.local", password: "orders-password-1", role: "admin", permissions: ["manage_orders"], permissionsManaged: true });
    const brand = await M.Brand.create({ name: "برند تست" });
    const parent = await M.Category.create({ name: "ادکلن", categoryType: "product" });
    const child = await M.Category.create({ name: "مردانه", categoryType: "product", parentId: parent._id });
    const wcat = await M.Category.create({ name: "مقالات", categoryType: "weblog" });
    ids.brand = brand._id; ids.parent = parent._id; ids.child = child._id; ids.wcat = wcat._id;
    const simple = await M.Product.create({ name: "عطر ساده تست", price: 1000000, offerPrice: 900000, brand: brand._id, category: [child._id], countInStock: 5, isPublished: true, sku: "SIMPLE-1", specialOfferPosition: 1, isFeatured: true, tags: ["a"], specifications: [{ key: "کشور", value: "فرانسه" }], fragrance: { family: "چوبی" } });
    const matrix = new M.Product({ name: "عطر ماتریسی تست", price: 2000000, brand: brand._id, category: [child._id], countInStock: 0, isPublished: true, colors: [{ name: "مشکی", rgb: "#000000" }], sizes: [{ size: "50ml" }, { size: "100ml" }] });
    matrix.variantInventoryConfigured = true;
    matrix.variantStocks = [
      { colorId: String(matrix.colors[0]._id), sizeId: String(matrix.sizes[0]._id), countInStock: 2 },
      { colorId: String(matrix.colors[0]._id), sizeId: String(matrix.sizes[1]._id), countInStock: 4 },
    ];
    await matrix.save();
    ids.simple = simple._id; ids.matrix = matrix._id;
    ids.colorId = String(matrix.colors[0]._id); ids.size50 = String(matrix.sizes[0]._id); ids.size100 = String(matrix.sizes[1]._id);
    const u1 = await M.User.create({ mobile: "09120000001", fullName: "مشتری اول", acquisition: { source: "instagram", medium: "social", model: "x" }, addresses: [{ fullName: "مشتری", city: "تهران", address: "خیابان آزمایشی ۱۲", postcode: "1234567890" }] });
    const u2 = await M.User.create({ mobile: "09120000002", fullName: "مشتری غیرفعال" });
    await M.User.updateOne({ _id: u2._id }, { $set: { isActive: false } });
    ids.u1 = u1._id; ids.u2 = u2._id;
    const base = { postcode: "1234567890", address: "تهران خیابان آزمایشی پلاک ۱", user: u1._id, products: [{ product: simple._id, quantity: 1, priceAtPurchase: 900000, nameAtPurchase: "عطر ساده تست" }], originalPrice: 900000 };
    const now = Date.now();
    const paid = await M.Order.create({ ...base, OrderNum: "ORD-T1", totalPrice: 900000, status: "در حال پردازش", paymentStatus: "پرداخت شده", paymentMethod: "اسنپ‌پی", snappPay: { paymentToken: "SECRET-TOKEN", status: "SETTLE" }, paymentInfo: { returnSessionTokenHash: "HASH" }, acquisition: { firstTouch: { source: "google", at: new Date() }, lastTouch: { source: "torob", at: new Date() }, model: "m" } });
    await M.Order.create({ ...base, OrderNum: "ORD-T2", totalPrice: 500000, status: "لغو شده", paymentStatus: "لغو شده", paymentMethod: "زرین‌پال" });
    await M.Order.create({ ...base, OrderNum: "ORD-T3", totalPrice: 700000, status: "در انتظار پرداخت", paymentStatus: "پرداخت نشده", inventoryReserved: true, products: [{ product: matrix._id, quantity: 1, priceAtPurchase: 700000, nameAtPurchase: "عطر ماتریسی تست", variantStockTracked: true, selectedVariantId: ids.colorId, selectedSizeId: ids.size50 }] });
    await M.Order.create({ ...base, OrderNum: "ORD-T4", totalPrice: 300000, status: "تحویل داده شد", paymentStatus: "پرداخت شده", paymentMethod: "زرین‌پال", createdAt: new Date(now - 400 * 864e5) });
    ids.paid = paid._id;
    await mongoose.disconnect();

    server = spawn(process.execPath, ["index.js"], {
      cwd: ROOT,
      env: { ...process.env, DB_URL: DB, PORT: String(PORT), SESSION_SECRET: "integration-secret", NODE_ENV: "test", SITE_URL: "https://www.odour.ir", SNAPPPAY_RECONCILER_ENABLED: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", () => {});
    server.stderr.on("data", (d) => { if (process.env.DEBUG_SERVER) process.stderr.write(d); });
    await waitForServer();
    await mongoose.connect(DB);
  });

  test.after(async () => {
    if (server) server.kill();
    if (mongoose && mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  test("storefront visits are classified and the attribution cookie is set", async () => {
    const c = client();
    let r = await c.call("/about-us?utm_source=instagram&utm_campaign=yalda", { headers: { Accept: "text/html", Referer: "https://l.instagram.com/" } });
    assert.equal(r.status, 200);
    assert.ok(c.jar.has("odr_src"), "attribution cookie");
    await c.call("/terms-and-conditions", { headers: { Accept: "text/html", Referer: "https://www.odour.ir/about-us" } });
    await c.call("/privacy-policy", { headers: { Accept: "text/html", Referer: "https://www.zarinpal.com/pg/StartPay/x" } });
    await new Promise((res) => setTimeout(res, 300));
    const visits = await M.Visit.find({}).sort({ visitTimestamp: 1 }).lean();
    const byPath = Object.fromEntries(visits.map((v) => [v.path, v]));
    assert.equal(byPath["/about-us"].source, "instagram");
    assert.equal(byPath["/about-us"].entry, true);
    assert.equal(byPath["/about-us"].campaign, "yalda");
    assert.equal(byPath["/terms-and-conditions"].entry, false);
    assert.equal(byPath["/privacy-policy"].source, "gateway");
    assert.equal(byPath["/privacy-policy"].entry, false);
  });

  test("login is rate-limited per failure, issues a CSRF token and rejects writes without it", async () => {
    const c = client();
    assert.equal((await c.login("root@test.local", "wrong-password")).status, 401);
    assert.equal((await c.login("ROOT@test.local", "root-password-123")).status, 200);
    const page = await c.call("/admin", { headers: { Accept: "text/html" } });
    assert.equal(page.status, 200);
    assert.match(page.text, /ox-boot/);
    const noToken = await c.call("/admin/api/v2/products/bulk", { method: "POST", body: { ids: [String(ids.simple)], action: "publish" }, headers: { "X-CSRF-Token": "" } });
    assert.equal(noToken.status, 403);
    const anon = await client().call("/admin/api/v2/dashboard");
    assert.equal(anon.status, 401);
  });

  test("dashboard and traffic analytics return real aggregates", async () => {
    const c = client();
    await c.login("root@test.local", "root-password-123");
    const d = (await c.call("/admin/api/v2/dashboard?days=30")).json;
    assert.equal(d.success, true);
    assert.equal(d.orders.total, 4);
    assert.equal(d.sales.rangeCount, 1, "only the paid, non-cancelled order in range counts");
    assert.equal(d.sales.range, 900000);
    assert.equal(d.series.length, 30);
    assert.equal(d.products.total, 2);
    const t = (await c.call("/admin/api/v2/analytics/traffic?days=30")).json;
    assert.equal(t.success, true);
    const torob = t.sources.find((s) => s.source === "torob");
    assert.equal(torob.revenue, 900000);
    const unknown = t.sources.find((s) => s.source === "unknown");
    assert.equal(unknown.orders, 2, "orders without attribution are reported as unknown");
    const first = (await c.call("/admin/api/v2/analytics/traffic?days=30&model=first")).json;
    assert.equal(first.sources.find((s) => s.source === "google").revenue, 900000);
    assert.ok(t.sources.find((s) => s.source === "instagram").visits >= 1);
  });

  test("product lists, partial edits preserve untouched fields, flags and bulk", async () => {
    const c = client();
    await c.login("root@test.local", "root-password-123");
    const list = (await c.call("/admin/api/v2/products?q=SIMPLE")).json;
    assert.equal(list.total, 1);
    const r = await c.call(`/admin/products/edit/${ids.simple}`, { method: "PUT", body: { name: "عطر ساده ویرایش شده" } });
    assert.equal(r.status, 200, r.text);
    const p = await M.Product.findById(ids.simple).lean();
    assert.equal(p.name, "عطر ساده ویرایش شده");
    assert.equal(p.offerPrice, 900000, "offer kept");
    assert.equal(p.specialOfferPosition, 1, "special offer slot kept");
    assert.deepEqual(p.tags, ["a"], "tags kept");
    assert.equal(p.specifications.length, 1, "specifications kept");
    assert.equal(p.countInStock, 5, "stock kept");
    assert.equal(p.fragrance.family, "چوبی");
    const flags = await c.call(`/admin/api/v2/products/${ids.simple}/flags`, { method: "PATCH", body: { isPublished: false } });
    assert.equal(flags.json.product.isPublished, false);
    const bulk = await c.call("/admin/api/v2/products/bulk", { method: "POST", body: { ids: [String(ids.simple)], action: "publish" } });
    assert.equal(bulk.json.changed, 1);
    const detail = (await c.call(`/admin/api/v2/products/${ids.matrix}`)).json;
    assert.equal(detail.openOrders, 1);
    const del = await c.call(`/admin/products/delete/${ids.matrix}`, { method: "DELETE" });
    assert.equal(del.status, 409, "product with reserved stock in an open order cannot be deleted");
  });

  test("inventory adjustments are atomic, never negative, and conflict on stale values", async () => {
    const c = client();
    await c.login("root@test.local", "root-password-123");
    let r = await c.call(`/admin/api/v2/inventory/${ids.matrix}/adjust`, { method: "POST", body: { colorId: ids.colorId, sizeId: ids.size50, mode: "delta", value: 3 } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.after, 5);
    assert.equal(r.json.product.countInStock, 9);
    r = await c.call(`/admin/api/v2/inventory/${ids.matrix}/adjust`, { method: "POST", body: { colorId: ids.colorId, sizeId: ids.size50, mode: "delta", value: -50 } });
    assert.equal(r.status, 409);
    r = await c.call(`/admin/api/v2/inventory/${ids.matrix}/adjust`, { method: "POST", body: { colorId: ids.colorId, sizeId: ids.size100, mode: "set", value: 10, expected: 99 } });
    assert.equal(r.status, 409, "stale expected value");
    r = await c.call(`/admin/api/v2/inventory/${ids.matrix}/adjust`, { method: "POST", body: { colorId: ids.colorId, sizeId: ids.size100, mode: "set", value: 10, expected: 4 } });
    assert.equal(r.status, 200);
    r = await c.call(`/admin/api/v2/inventory/${ids.matrix}/pause`, { method: "POST", body: { colorId: ids.colorId, sizeId: ids.size100, paused: true } });
    assert.equal(r.status, 200);
    const m = await M.Product.findById(ids.matrix).lean();
    assert.equal(m.countInStock, 15);
    assert.equal(m.variantStocks.find((x) => x.sizeId === ids.size100).isOutOfStock, true);
    assert.equal(m.isOutOfStock, false, "the other variant is still sellable");
    r = await c.call(`/admin/api/v2/inventory/${ids.simple}/adjust`, { method: "POST", body: { mode: "set", value: 0, expected: 5 } });
    assert.equal(r.status, 200);
    assert.equal((await M.Product.findById(ids.simple).lean()).isOutOfStock, true);

    const csv = await c.call("/admin/api/v2/inventory/export.csv", { headers: { Accept: "text/csv" } });
    assert.equal(csv.status, 200);
    const lines = csv.text.replace(/^﻿/, "").trim().split(/\r\n/);
    const edited = lines.map((l, i) => (i > 0 && l.includes(String(ids.simple)) ? l.replace(/""$/, '"7"') : l)).join("\r\n");
    const preview = await c.call("/admin/api/v2/inventory/import", { method: "POST", body: { csv: edited } });
    assert.equal(preview.json.changes.length, 1, JSON.stringify(preview.json));
    const applied = await c.call("/admin/api/v2/inventory/import", { method: "POST", body: { csv: edited, apply: true } });
    assert.equal(applied.json.applied.length, 1);
    assert.equal((await M.Product.findById(ids.simple).lean()).countInStock, 7);
    const again = await c.call("/admin/api/v2/inventory/import", { method: "POST", body: { csv: edited } });
    assert.equal(again.json.errors.length, 1, "re-importing a stale file is rejected");
  });

  test("orders: filters, sanitized detail, status note and tracking number", async () => {
    const c = client();
    await c.login("root@test.local", "root-password-123");
    const all = (await c.call("/admin/api/v2/orders")).json;
    assert.equal(all.total, 4);
    assert.equal((await c.call("/admin/api/v2/orders?source=torob")).json.total, 1);
    assert.equal((await c.call("/admin/api/v2/orders?source=unknown")).json.total, 3);
    assert.equal((await c.call(`/admin/api/v2/orders?q=${encodeURIComponent("مشتری اول")}`)).json.total, 4);
    const detail = await c.call(`/admin/api/v2/orders/${ids.paid}`);
    assert.ok(!detail.text.includes("SECRET-TOKEN"), "gateway token is never sent");
    assert.ok(!detail.text.includes("HASH"));
    assert.equal(detail.json.order.snappPay.hasPaymentToken, true);
    let r = await c.call(`/admin/orders/edit/${ids.paid}`, { method: "PUT", body: { status: "در حال ارسال", note: "ارسال شد" } });
    assert.equal(r.status, 200, r.text);
    r = await c.call(`/admin/api/v2/orders/${ids.paid}/shipping`, { method: "PATCH", body: { trackingNumber: "TPX-1" } });
    assert.equal(r.json.trackingNumber, "TPX-1");
    const o = await M.Order.findById(ids.paid).lean();
    assert.equal(o.statusHistory.at(-1).note, "ارسال شد");
    // Paid SnappPay orders must still be cancelled through the gateway, not manually.
    r = await c.call(`/admin/orders/edit/${ids.paid}`, { method: "PUT", body: { status: "لغو شده" } });
    assert.equal(r.status, 409);
    const actions = await M.RecentAction.find({ targetId: ids.paid }).lean();
    assert.ok(actions.some((a) => a.action === "update_order_status"));
    assert.ok(actions.some((a) => a.action === "update_order_shipping"));
  });

  test("customers include inactive accounts, stats and acquisition; status can be toggled", async () => {
    const c = client();
    await c.login("root@test.local", "root-password-123");
    const list = (await c.call("/admin/api/v2/customers?sort=spent")).json;
    assert.equal(list.total, 2);
    assert.equal(list.items[0].spent, 900000 + 300000);
    assert.equal(list.items[0].successful, 2);
    assert.ok(!JSON.stringify(list).includes("password"));
    assert.equal((await c.call("/admin/api/v2/customers?status=inactive")).json.total, 1);
    const d = (await c.call(`/admin/api/v2/customers/${ids.u1}`)).json;
    assert.equal(d.customer.acquisition.source, "instagram");
    assert.equal(d.orders.length, 4);
    const r = await c.call(`/admin/api/v2/customers/${ids.u2}/status`, { method: "PATCH", body: { isActive: true } });
    assert.equal(r.status, 200);
    assert.ok(await M.User.findById(ids.u2), "re-activated user is visible again");
  });

  test("catalog safeguards: categories and brands in use cannot be deleted; cycles are refused", async () => {
    const c = client();
    await c.login("root@test.local", "root-password-123");
    assert.equal((await c.call(`/admin/categories/delete/${ids.parent}`, { method: "DELETE" })).status, 409);
    assert.equal((await c.call(`/admin/brands/delete/${ids.brand}`, { method: "DELETE" })).status, 409);
    const cyc = await c.call(`/admin/categories/edit/${ids.parent}`, { method: "PUT", body: { name: "ادکلن", categoryType: "product", parentId: String(ids.child) } });
    assert.equal(cyc.status, 400);
    const edit = await c.call(`/admin/categories/edit/${ids.child}`, { method: "PUT", body: { name: "مردانه", categoryType: "product", parentId: String(ids.parent), metaTitle: "عطر مردانه", isActive: true } });
    assert.equal(edit.json.category.metaTitle, "عطر مردانه");
    const brand = await c.call(`/admin/brands/edit/${ids.brand}`, { method: "PUT", body: { name: "برند تست", description: "توضیح", isActive: false, logo: "/uploads/logo.webp" } });
    assert.equal(brand.status, 200, brand.text);
    const b = await M.Brand.findById(ids.brand).lean();
    assert.equal(b.isActive, false);
    assert.equal(b.logo, "/uploads/logo.webp");
    const cats = (await c.call("/admin/api/v2/categories?type=product")).json.categories;
    assert.equal(cats.find((x) => String(x._id) === String(ids.child)).productCount, 2);
  });

  test("discount codes and weblogs with uploaded image paths save correctly", async () => {
    const c = client();
    await c.login("root@test.local", "root-password-123");
    let r = await c.call("/admin/discounts/add", { method: "POST", body: { code: "TEST10", type: "percent", amount: 10, maxDiscountAmount: 50000, isActive: true } });
    assert.equal(r.status, 201, r.text);
    const id = r.json.discount.id;
    // Expired code: editing without changing the date must work.
    await M.DiscountCode.collection.updateOne({ code: "TEST10" }, { $set: { expireDate: new Date(Date.now() - 864e5) } });
    const stored = await M.DiscountCode.findOne({ code: "TEST10" }).lean();
    r = await c.call(`/admin/discounts/edit/${id}`, { method: "PUT", body: { code: "TEST10", type: "percent", amount: 10, maxDiscountAmount: 50000, isActive: false, expireDate: stored.expireDate } });
    assert.equal(r.status, 200, r.text);
    const list = (await c.call("/admin/api/v2/discounts")).json.discounts;
    assert.equal(list[0].isExpired, true);
    r = await c.call("/admin/weblogs/add", { method: "POST", body: { title: "مقاله آزمایشی برای تست", description: "خلاصه", content: "<p>" + "متن ".repeat(60) + "</p>", images: [{ url: "/uploads/a.webp", filename: "a.webp" }], categories: [String(ids.wcat)], isPublished: false } });
    assert.equal(r.status, 201, r.text);
    const wid = r.json.weblog._id || r.json.weblog.id;
    r = await c.call(`/admin/weblogs/edit/${wid}`, { method: "PUT", body: { title: "مقاله آزمایشی برای تست", description: "خلاصه", content: "<p>" + "متن ".repeat(60) + "</p>", images: ["/uploads/a.webp"], categories: [String(ids.wcat)], isPublished: true } });
    assert.equal(r.status, 200, r.text);
    const w = await M.Weblog.findById(wid).lean();
    assert.deepEqual(w.images, ["/uploads/a.webp"]);
    assert.ok(w.publishedAt, "publishing from the edit form sets publishedAt");
  });

  test("storefront pages and checkout keep working; checkout records attribution and rolls back cleanly", async () => {
    const crypto = require("crypto");
    // A logged-in storefront session for u1 (connect-mongo document + signed cookie).
    const sid = crypto.randomBytes(16).toString("hex");
    await mongoose.connection.collection("sessions").insertOne({
      _id: sid,
      expires: new Date(Date.now() + 36e5),
      session: JSON.stringify({ cookie: { originalMaxAge: 36e5, httpOnly: true, path: "/" }, userId: String(ids.u1) }),
    });
    const sig = crypto.createHmac("sha256", "integration-secret").update(sid).digest("base64").replace(/=+$/, "");
    const shopper = client();
    shopper.jar.set("sessionId", encodeURIComponent(`s:${sid}.${sig}`));
    const simple = await M.Product.findById(ids.simple).lean();
    await M.User.updateOne({ _id: ids.u1 }, { $set: { cart: [{ productId: ids.simple, quantity: 2 }] } });

    for (const url of ["/", "/shop", `/productDetails/${encodeURIComponent(simple.slug)}`, `/category/${encodeURIComponent("مردانه")}`, "/cart", "/weblog", "/sitemap.xml", "/userProfile"]) {
      const r = await shopper.call(url, { headers: { Accept: "text/html", Referer: "https://torob.com/p/1" } });
      assert.equal(r.status, 200, `${url} → ${r.status}`);
    }
    assert.ok(shopper.jar.has("odr_src"));

    const inserted = [];
    const stream = M.Order.watch([{ $match: { operationType: "insert" } }], { fullDocument: "default" });
    stream.on("change", (ch) => inserted.push(ch.fullDocument));
    await new Promise((r) => setTimeout(r, 300));
    const ordersBefore = await M.Order.countDocuments();
    const stockBefore = (await M.Product.findById(ids.simple).lean()).countInStock;

    const res = await shopper.call("/api/order", {
      method: "POST",
      body: { fullName: "مشتری اول", postcode: "1234567890", address: "تهران خیابان آزمایشی پلاک ۱۲", province: "تهران", city: "تهران", delivery: "تیپاکس", paymentMethod: "zarinpal" },
    });
    await new Promise((r) => setTimeout(r, 500));
    await stream.close();

    assert.equal(inserted.length, 1, "checkout created the order document");
    assert.equal(inserted[0].acquisition.lastTouch.source, "torob", "attribution stored on the order");
    assert.equal(inserted[0].acquisition.firstTouch.source, "torob");
    if (res.status === 200 && res.json.paymentUrl) {
      // Payment gateway reachable: the order stays, stock is reserved.
      assert.equal(await M.Order.countDocuments(), ordersBefore + 1);
    } else {
      // Gateway unreachable (offline test env): everything is rolled back.
      assert.equal(await M.Order.countDocuments(), ordersBefore, "failed checkout removes the order");
      assert.equal((await M.Product.findById(ids.simple).lean()).countInStock, stockBefore, "reserved stock restored");
      const u = await M.User.findById(ids.u1).lean();
      assert.equal(u.cart.length, 1, "cart restored");
    }
  });

  test("permissions are enforced on the server", async () => {
    const orders = client();
    await orders.login("orders@test.local", "orders-password-1");
    assert.equal((await orders.call("/admin/api/v2/orders")).status, 200);
    assert.equal((await orders.call("/admin/api/v2/products")).status, 403);
    assert.equal((await orders.call(`/admin/products/delete/${ids.simple}`, { method: "DELETE" })).status, 403);
    assert.equal((await orders.call("/admin/api/v2/customers")).status, 403);
    assert.equal((await orders.call("/admin/api/v2/analytics/traffic")).status, 403);
    const dash = (await orders.call("/admin/api/v2/dashboard")).json;
    assert.ok(dash.orders && !dash.sales, "dashboard hides revenue without view_analytics");

    const legacy = client();
    await legacy.login("legacy@test.local", "legacy-password-1");
    assert.equal((await legacy.call("/admin/api/v2/products")).status, 200, "legacy admins keep full access");
    assert.equal((await legacy.call("/admin/api/v2/admins")).status, 403, "...but not admin management");

    const root = client();
    await root.login("root@test.local", "root-password-123");
    let r = await root.call("/admin/api/v2/admins", { method: "POST", body: { fullName: "مدیر جدید", email: "new@test.local", password: "short", role: "admin", permissions: [] } });
    assert.equal(r.status, 400);
    r = await root.call("/admin/api/v2/admins", { method: "POST", body: { fullName: "مدیر جدید", email: "new@test.local", password: "long-enough-pass", role: "admin", permissions: ["manage_products"] } });
    assert.equal(r.status, 201, r.text);
    const me = (await root.call("/admin/api/v2/me")).json.admin;
    r = await root.call(`/admin/api/v2/admins/${me.id}`, { method: "PUT", body: { isActive: false } });
    assert.equal(r.status, 400, "cannot deactivate yourself");
    const fresh = client();
    assert.equal((await fresh.login("new@test.local", "long-enough-pass")).status, 200);
    assert.equal((await fresh.call("/admin/api/v2/products")).status, 200);
    assert.equal((await fresh.call("/admin/api/v2/orders")).status, 403);
    const act = (await root.call("/admin/api/v2/activity?targetType=admin")).json;
    assert.ok(act.items.some((a) => a.action === "create_admin"));
  });
});
