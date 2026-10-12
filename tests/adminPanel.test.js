const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../helper/adminQuery");
const Admin = require("../models/Admins");
const inventory = require("../services/adminInventory");
const { LEGACY_RULES, legacyPermissionGuard, verifyCsrf, requirePermission } = require("../middlewares/adminAuth");

test("date ranges use Tehran calendar days and are inclusive", () => {
  const now = new Date("2026-10-12T22:00:00Z"); // 01:30 on 13 Oct in Tehran
  const r = Q.parseRange({ days: 7 }, { now });
  assert.equal(r.toDay, "2026-10-13");
  assert.equal(r.fromDay, "2026-10-07");
  assert.equal(r.days, 7);
  assert.equal(r.from.toISOString(), "2026-10-06T20:30:00.000Z");
  assert.equal(Q.daysBetween(r).length, 7);
  const custom = Q.parseRange({ from: "2026-10-10", to: "2026-10-01" }, { now });
  assert.equal(custom.fromDay, "2026-10-01");
  assert.equal(custom.toDay, "2026-10-10");
  assert.equal(Q.parseRange({ from: "bad" }, { now, defaultDays: 30 }).days, 30);
});

test("paging is bounded and search text is normalised", () => {
  assert.deepEqual(Q.parsePaging({ page: "-3", limit: "10000" }), { page: 1, limit: 100, skip: 0 });
  assert.deepEqual(Q.parsePaging({ page: "3", limit: "20" }), { page: 3, limit: 20, skip: 40 });
  assert.equal(Q.cleanSearch(" ۰۹۱۲ "), "0912");
  assert.equal(Q.escapeRegex("a.b*"), "a\\.b\\*");
});

test("effective permissions keep legacy admins working and enforce managed ones", () => {
  const all = Admin.ALL_PERMISSIONS;
  assert.deepEqual(Admin.effectivePermissions({ role: "super_admin", permissions: [] }), all);
  const legacy = Admin.effectivePermissions({ role: "admin", permissions: [] });
  assert.ok(legacy.includes("manage_orders"));
  assert.ok(!legacy.includes("manage_admins"));
  assert.deepEqual(Admin.effectivePermissions({ role: "admin", permissions: ["manage_orders"] }), ["manage_orders"]);
  assert.deepEqual(Admin.effectivePermissions({ role: "admin", permissions: [], permissionsManaged: true }), []);
});

const run = (mw, req) => {
  let status = 200;
  let nextCalled = false;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  mw(req, res, () => (nextCalled = true));
  return { status, nextCalled };
};

test("legacy admin endpoints are checked server-side", () => {
  const orderAdmin = { adminPermissions: ["manage_orders"] };
  assert.equal(run(legacyPermissionGuard, { ...orderAdmin, method: "PUT", path: "/orders/edit/1" }).nextCalled, true);
  assert.equal(run(legacyPermissionGuard, { ...orderAdmin, method: "DELETE", path: "/products/delete/1" }).status, 403);
  assert.equal(run(legacyPermissionGuard, { ...orderAdmin, method: "POST", path: "/upload-images" }).status, 403);
  // lookups needed by several editors stay readable
  assert.equal(run(legacyPermissionGuard, { ...orderAdmin, method: "GET", path: "/categories" }).nextCalled, true);
  assert.equal(run(legacyPermissionGuard, { ...orderAdmin, method: "POST", path: "/categories/add" }).status, 403);
  assert.equal(run(legacyPermissionGuard, { adminPermissions: ["manage_weblogs"], method: "POST", path: "/upload-image" }).nextCalled, true);
  assert.equal(run(requirePermission("manage_admins"), orderAdmin).status, 403);
  assert.ok(LEGACY_RULES.length > 5);
});

test("state-changing admin requests need the session CSRF token", () => {
  const session = { adminCsrf: "token-123" };
  const req = (method, header) => ({ method, session, get: (h) => (h === "x-csrf-token" ? header : undefined) });
  assert.equal(run(verifyCsrf, req("GET")).nextCalled, true);
  assert.equal(run(verifyCsrf, req("POST", "token-123")).nextCalled, true);
  assert.equal(run(verifyCsrf, req("POST", "nope")).status, 403);
  assert.equal(run(verifyCsrf, req("DELETE")).status, 403);
});

test("inventory rows describe matrix and legacy products", () => {
  const matrixProduct = {
    variantInventoryConfigured: true,
    colors: [{ _id: "c1", name: "مشکی", rgb: "#000" }],
    sizes: [{ _id: "s1", size: "50ml" }],
    variantStocks: [{ colorId: "c1", sizeId: "s1", countInStock: 4, isOutOfStock: true }],
  };
  const rows = inventory.stockRows(matrixProduct);
  assert.deepEqual(rows.map((r) => [r.kind, r.color, r.size, r.stock, r.paused]), [["matrix", "مشکی", "50ml", 4, true]]);
  const legacy = inventory.stockRows({ countInStock: 7, colors: [{ _id: "c1", name: "قرمز", countInStock: 2 }, { _id: "c2", name: "آبی" }], sizes: [] });
  assert.deepEqual(legacy.map((r) => r.kind), ["total", "color"]);
  assert.throws(() => inventory.locate({ countInStock: 1, colors: [{ _id: "c2", name: "آبی" }] }, { colorId: "c2" }), /جداگانه/);
});

test("inventory CSV round-trips and neutralises spreadsheet formulas", () => {
  const csv = inventory.toCsv([{ _id: "66aaaaaaaaaaaaaaaaaaaaaa", name: "=HYPERLINK(\"x\")", sku: "A-1", countInStock: 3, colors: [], sizes: [] }]);
  assert.ok(csv.includes("'=HYPERLINK"));
  const rows = inventory.parseCsv(csv.replace(/""\r\n$/, '"9"\r\n'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].current_stock, "3");
  assert.equal(rows[0].new_stock, "9");
  assert.throws(() => inventory.parseCsv("a,b\n1,2"), /سرستون/);
});

test("Order and Visit schemas accept the new optional attribution fields", () => {
  const Order = require("../models/Order");
  const Visit = require("../models/Visit");
  assert.ok(Order.schema.path("acquisition"));
  assert.ok(Visit.schema.path("source"));
  const visit = new Visit({ path: "/", visitorId: "x" });
  assert.equal(visit.validateSync(), undefined);
  assert.equal(visit.source, undefined);
});
