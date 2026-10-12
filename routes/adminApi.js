"use strict";
// JSON API for the redesigned admin panel, mounted at /admin/api/v2 behind the admin
// session, CSRF and permission middleware of routes/admin.js. Every list is paginated
// and every number comes from the database (no estimates).
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Product = require("../models/Product");
const Order = require("../models/Order");
const User = require("../models/User");
const Category = require("../models/Category");
const Brand = require("../models/Brand");
const DiscountCode = require("../models/DiscountCode");
const Weblog = require("../models/Weblog");
const Visit = require("../models/Visit");
const Admin = require("../models/Admins");
const RecentAction = require("../models/RecentAction");
const AdminNotification = require("../models/AdminNotification");
const { requirePermission } = require("../middlewares/adminAuth");
const { lowStockMatch, outOfStockMatch } = require("../helper/adminDashboard");
const { CHANNELS } = require("../helper/attribution");
const inventory = require("../services/adminInventory");
const {
  SUCCESS_MATCH,
  CANCELLED,
  parsePaging,
  pageMeta,
  escapeRegex,
  cleanSearch,
  tehranDay,
  startOfTehranDay,
  parseRange,
  daysBetween,
  dayExpr,
  bool,
} = require("../helper/adminQuery");

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || "")) && /^[a-f0-9]{24}$/i.test(String(value));
const oid = (value) => new mongoose.Types.ObjectId(String(value));
const can = (req, ...perms) => perms.some((p) => (req.adminPermissions || []).includes(p));

// async handler with consistent error JSON
const h = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    if (error && error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: Object.values(error.errors).map((e) => e.message).join("، ") });
    }
    if (error && error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Admin API error:", req.method, req.originalUrl, error);
    return res.status(500).json({ success: false, message: "خطای سرور. لطفاً دوباره تلاش کنید." });
  }
};

const audit = (req, action, targetType, targetId, targetName, details = "") =>
  RecentAction.create({
    action,
    targetType,
    targetId,
    targetName: String(targetName || targetId).slice(0, 200),
    adminId: req.admin._id,
    adminName: req.admin.fullName,
    details: String(details || "").slice(0, 500),
    ipAddress: req.ip,
  }).catch((error) => console.error("Audit log error:", error.message));

const sourceKey = (model) => (model === "first" ? "$acquisition.firstTouch.source" : "$acquisition.lastTouch.source");

// =============================================================== me / password
router.get(
  "/me",
  h(async (req, res) => {
    const a = req.admin;
    res.json({
      success: true,
      admin: { id: a._id, fullName: a.fullName, email: a.email, role: a.role, lastLoginAt: a.lastLoginAt, lastLoginIP: a.lastLoginIP },
      permissions: req.adminPermissions,
    });
  })
);

router.post(
  "/me/password",
  h(async (req, res) => {
    const current = String(req.body.currentPassword || "");
    const next = String(req.body.newPassword || "");
    if (next.length < 10) return res.status(400).json({ success: false, message: "رمز عبور جدید باید حداقل ۱۰ کاراکتر باشد" });
    const admin = await Admin.findById(req.admin._id).select("+password");
    if (!admin || !(await admin.comparePassword(current))) {
      return res.status(400).json({ success: false, message: "رمز عبور فعلی صحیح نیست" });
    }
    admin.password = next;
    await admin.save();
    audit(req, "change_password", "admin", admin._id, admin.fullName, "تغییر رمز عبور خود");
    res.json({ success: true, message: "رمز عبور با موفقیت تغییر کرد" });
  })
);

// ===================================================================== lookups
// Small reference lists every editor needs (brand / category pickers).
router.get(
  "/lookups",
  h(async (req, res) => {
    const [brands, categories] = await Promise.all([
      Brand.find({}).select("name isActive").sort({ name: 1 }).lean(),
      Category.find({}).select("name parentId categoryType isActive displayOrder slug").sort({ displayOrder: 1, name: 1 }).lean(),
    ]);
    res.json({ success: true, brands, categories });
  })
);

// =================================================================== dashboard
async function revenueBetween(from, to) {
  const [row] = await Order.aggregate([
    { $match: { ...SUCCESS_MATCH, createdAt: { $gte: from, $lt: to } } },
    { $group: { _id: null, total: { $sum: "$totalPrice" }, count: { $sum: 1 } } },
  ]);
  return { total: row ? row.total : 0, count: row ? row.count : 0 };
}

router.get(
  "/dashboard",
  h(async (req, res) => {
    const range = parseRange(req.query, { defaultDays: 30 });
    const analytics = can(req, "view_analytics");
    const ordersView = analytics || can(req, "manage_orders");
    const productsView = analytics || can(req, "manage_products", "manage_inventory");
    const out = { success: true, range: { from: range.fromDay, to: range.toDay, days: range.days } };

    const todayStart = startOfTehranDay(tehranDay());
    const tomorrow = new Date(todayStart.getTime() + 864e5);
    const jobs = [];

    if (ordersView) {
      jobs.push(
        (async () => {
          const [all, inRange, newToday] = await Promise.all([
            Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
            Order.aggregate([
              { $match: { createdAt: { $gte: range.from, $lt: range.to } } },
              { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            Order.countDocuments({ createdAt: { $gte: todayStart, $lt: tomorrow } }),
          ]);
          out.orders = {
            total: all.reduce((s, r) => s + r.count, 0),
            byStatus: Object.fromEntries(all.map((r) => [r._id, r.count])),
            inRange: inRange.reduce((s, r) => s + r.count, 0),
            byStatusInRange: Object.fromEntries(inRange.map((r) => [r._id, r.count])),
            newToday,
          };
          out.recentOrders = await Order.find({})
            .select("OrderNum recipientName totalPrice status paymentStatus paymentMethod createdAt user acquisition.lastTouch.source")
            .populate("user", "fullName mobile")
            .sort({ createdAt: -1 })
            .limit(8)
            .lean();
        })()
      );
    }

    if (analytics) {
      jobs.push(
        (async () => {
          const [today, week, month, inRange, series, newCustomers, totalCustomers] = await Promise.all([
            revenueBetween(todayStart, tomorrow),
            revenueBetween(new Date(todayStart.getTime() - 6 * 864e5), tomorrow),
            revenueBetween(new Date(todayStart.getTime() - 29 * 864e5), tomorrow),
            revenueBetween(range.from, range.to),
            Order.aggregate([
              { $match: { createdAt: { $gte: range.from, $lt: range.to } } },
              {
                $group: {
                  _id: dayExpr("$createdAt"),
                  orders: { $sum: 1 },
                  successful: { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", "پرداخت شده"] }, { $ne: ["$status", CANCELLED] }] }, 1, 0] } },
                  revenue: { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", "پرداخت شده"] }, { $ne: ["$status", CANCELLED] }] }, "$totalPrice", 0] } },
                },
              },
            ]),
            User.aggregate([{ $match: { createdAt: { $gte: range.from, $lt: range.to } } }, { $count: "n" }]),
            User.estimatedDocumentCount(),
          ]);
          const byDay = new Map(series.map((r) => [r._id, r]));
          out.sales = {
            today: today.total,
            todayCount: today.count,
            week: week.total,
            month: month.total,
            range: inRange.total,
            rangeCount: inRange.count,
            averageOrder: inRange.count ? Math.round(inRange.total / inRange.count) : 0,
          };
          out.series = daysBetween(range).map((day) => ({
            day,
            orders: byDay.get(day)?.orders || 0,
            successful: byDay.get(day)?.successful || 0,
            revenue: byDay.get(day)?.revenue || 0,
          }));
          out.customers = { newInRange: newCustomers[0]?.n || 0, total: totalCustomers };

          const visitMatch = { visitTimestamp: { $gte: range.from, $lt: range.to } };
          const [visitors, pageviews, sources] = await Promise.all([
            Visit.aggregate([{ $match: visitMatch }, { $group: { _id: "$visitorId" } }, { $count: "n" }]),
            Visit.countDocuments(visitMatch),
            Visit.aggregate([
              { $match: { ...visitMatch, entry: true } },
              { $group: { _id: "$source", visits: { $sum: 1 }, visitors: { $addToSet: "$visitorId" } } },
              { $project: { visits: 1, visitors: { $size: "$visitors" } } },
              { $sort: { visits: -1 } },
              { $limit: 6 },
            ]),
          ]);
          out.traffic = {
            visitors: visitors[0]?.n || 0,
            pageviews,
            sources: sources.map((s) => ({ source: s._id || "unknown", visits: s.visits, visitors: s.visitors })),
          };
          out.recentActivity = await RecentAction.find({})
            .select("action targetType targetName adminName details createdAtTimestamp")
            .sort({ createdAtTimestamp: -1 })
            .limit(8)
            .lean();
        })()
      );
    }

    if (productsView) {
      jobs.push(
        (async () => {
          const [total, published, low, out_, lowList] = await Promise.all([
            Product.estimatedDocumentCount(),
            Product.countDocuments({ isPublished: true }),
            Product.countDocuments(lowStockMatch),
            Product.countDocuments(outOfStockMatch),
            Product.find(lowStockMatch).select("name countInStock lowStockThreshold images sku").sort({ countInStock: 1 }).limit(6).lean(),
          ]);
          out.products = { total, published, lowStock: low, outOfStock: out_, lowList: lowList.map((p) => ({ ...p, image: p.images?.[0]?.url || "", images: undefined })) };
        })()
      );
    }

    await Promise.all(jobs);
    res.json(out);
  })
);

// =========================================================== traffic analytics
router.get(
  "/analytics/traffic",
  requirePermission("view_analytics"),
  h(async (req, res) => {
    const range = parseRange(req.query, { defaultDays: 30 });
    const model = req.query.model === "first" ? "first" : "last";
    const source = typeof req.query.source === "string" && CHANNELS[req.query.source] ? req.query.source : "";
    const timeMatch = { visitTimestamp: { $gte: range.from, $lt: range.to } };
    const entryMatch = { ...timeMatch, entry: true, ...(source && { source }) };

    const [pageviews, visitorsAll, entries, untracked, bySource, referrers, landing, campaigns, trend] = await Promise.all([
      Visit.countDocuments(timeMatch),
      Visit.aggregate([{ $match: timeMatch }, { $group: { _id: "$visitorId" } }, { $count: "n" }]),
      Visit.countDocuments({ ...timeMatch, entry: true }),
      Visit.countDocuments({ ...timeMatch, entry: { $exists: false } }),
      Visit.aggregate([
        { $match: { ...timeMatch, entry: true } },
        { $group: { _id: { s: "$source", v: "$visitorId" }, visits: { $sum: 1 } } },
        { $group: { _id: "$_id.s", visits: { $sum: "$visits" }, visitors: { $sum: 1 } } },
      ]),
      Visit.aggregate([
        { $match: { ...entryMatch, referrerHost: { $nin: [null, ""] } } },
        { $group: { _id: "$referrerHost", visits: { $sum: 1 }, visitors: { $addToSet: "$visitorId" }, source: { $first: "$source" } } },
        { $project: { visits: 1, source: 1, visitors: { $size: "$visitors" } } },
        { $sort: { visits: -1 } },
        { $limit: 15 },
      ]),
      Visit.aggregate([
        { $match: entryMatch },
        { $group: { _id: "$path", visits: { $sum: 1 } } },
        { $sort: { visits: -1 } },
        { $limit: 15 },
      ]),
      Visit.aggregate([
        { $match: { ...entryMatch, utmSource: { $nin: [null, ""] } } },
        { $group: { _id: { s: "$utmSource", m: "$medium", c: "$campaign" }, visits: { $sum: 1 } } },
        { $sort: { visits: -1 } },
        { $limit: 15 },
      ]),
      Visit.aggregate([
        { $match: entryMatch },
        { $group: { _id: dayExpr("$visitTimestamp"), visits: { $sum: 1 } } },
      ]),
    ]);

    // Orders and revenue per acquisition source (orders created in the range).
    const orderRows = await Order.aggregate([
      { $match: { createdAt: { $gte: range.from, $lt: range.to } } },
      {
        $group: {
          _id: { $ifNull: [sourceKey(model), "unknown"] },
          orders: { $sum: 1 },
          successful: { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", "پرداخت شده"] }, { $ne: ["$status", CANCELLED] }] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", "پرداخت شده"] }, { $ne: ["$status", CANCELLED] }] }, "$totalPrice", 0] } },
        },
      },
    ]);

    const rows = new Map();
    const row = (key) => {
      const k = CHANNELS[key] ? key : key ? "referral" : "unknown";
      if (!rows.has(k)) rows.set(k, { source: k, label: CHANNELS[k], visits: 0, visitors: 0, orders: 0, successful: 0, revenue: 0 });
      return rows.get(k);
    };
    for (const r of bySource) {
      const target = row(r._id || "unknown");
      target.visits += r.visits;
      target.visitors += r.visitors;
    }
    for (const r of orderRows) {
      const target = row(r._id);
      target.orders += r.orders;
      target.successful += r.successful;
      target.revenue += r.revenue;
    }
    const totalVisits = bySource.reduce((s, r) => s + r.visits, 0);
    const sources = [...rows.values()]
      .map((r) => ({
        ...r,
        share: totalVisits ? r.visits / totalVisits : 0,
        // Only meaningful when both sides were tracked for the same source.
        conversion: r.source !== "unknown" && r.visitors > 0 && r.successful > 0 ? r.successful / r.visitors : null,
      }))
      .sort((a, b) => b.visits - a.visits || b.revenue - a.revenue);

    const trendByDay = new Map(trend.map((t) => [t._id, t.visits]));
    const trackedOrders = orderRows.filter((r) => r._id !== "unknown").reduce((s, r) => s + r.orders, 0);
    const untrackedOrders = orderRows.filter((r) => r._id === "unknown").reduce((s, r) => s + r.orders, 0);

    res.json({
      success: true,
      model,
      range: { from: range.fromDay, to: range.toDay, days: range.days },
      totals: { pageviews, visitors: visitorsAll[0]?.n || 0, entries, untrackedPageviews: untracked, trackedOrders, untrackedOrders },
      sources,
      referrers: referrers.map((r) => ({ host: r._id, visits: r.visits, visitors: r.visitors, source: r.source })),
      landingPages: landing.map((r) => ({ path: r._id, visits: r.visits })),
      campaigns: campaigns.map((r) => ({ utmSource: r._id.s, medium: r._id.m || "", campaign: r._id.c || "", visits: r.visits })),
      trend: daysBetween(range).map((day) => ({ day, visits: trendByDay.get(day) || 0 })),
    });
  })
);

// ==================================================================== products
const PRODUCT_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  updated: { updatedAt: -1 },
  name: { name: 1 },
  price_asc: { finalPrice: 1 },
  price_desc: { finalPrice: -1 },
  stock_asc: { countInStock: 1 },
  stock_desc: { countInStock: -1 },
  priority: { sortPriority: -1, createdAt: -1 },
};

function productFilter(query) {
  const filter = {};
  const and = [];
  const q = cleanSearch(query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    const or = [{ name: rx }, { englishName: rx }, { sku: rx }, { slug: rx }];
    if (isId(q)) or.push({ _id: oid(q) });
    and.push({ $or: or });
  }
  if (query.status === "published") filter.isPublished = true;
  if (query.status === "draft") filter.isPublished = { $ne: true };
  if (isId(query.brand)) filter.brand = oid(query.brand);
  if (isId(query.category)) filter.category = oid(query.category);
  if (query.stock === "out") and.push(outOfStockMatch);
  if (query.stock === "low") and.push(lowStockMatch);
  if (query.stock === "in") and.push({ countInStock: { $gt: 0 }, isOutOfStock: { $ne: true } });
  if (query.flag === "featured") filter.specialOfferPosition = { $gte: 1 };
  if (query.flag === "new") filter.isNewProduct = true;
  if (query.flag === "discounted") and.push({ offerPrice: { $gt: 0 }, $expr: { $lt: ["$offerPrice", "$price"] } });
  if (query.flag === "matrix") filter.variantInventoryConfigured = true;
  if (["new", "bestseller", "limited", "exclusive"].includes(query.badge)) filter.badge = query.badge;
  if (and.length) filter.$and = and;
  return filter;
}

const PRODUCT_LIST_FIELDS =
  "name englishName slug sku price offerPrice finalPrice countInStock isOutOfStock lowStockThreshold isPublished images brand category badge isNewProduct specialOfferPosition sortPriority variantInventoryConfigured colors.name colors.rgb sizes.size collectionName updatedAt createdAt";

router.get(
  "/products",
  requirePermission("manage_products", "manage_inventory"),
  h(async (req, res) => {
    const paging = parsePaging(req.query);
    const filter = productFilter(req.query);
    const [items, total] = await Promise.all([
      Product.find(filter)
        .select(PRODUCT_LIST_FIELDS)
        .populate("brand", "name")
        .populate("category", "name")
        .sort(PRODUCT_SORTS[req.query.sort] || PRODUCT_SORTS.newest)
        .skip(paging.skip)
        .limit(paging.limit)
        .lean(),
      Product.countDocuments(filter),
    ]);
    res.json({
      success: true,
      items: items.map((p) => ({ ...p, image: p.images?.[0]?.url || "", images: undefined, imagesCount: (p.images || []).length })),
      ...pageMeta(paging, total),
    });
  })
);

router.get(
  "/products/:id",
  requirePermission("manage_products", "manage_inventory"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const [product, orderCount, openOrders] = await Promise.all([
      Product.findById(req.params.id).lean(),
      Order.countDocuments({ "products.product": oid(req.params.id) }),
      Order.countDocuments({
        "products.product": oid(req.params.id),
        inventoryReserved: true,
        inventoryRestored: { $ne: true },
        status: { $nin: [CANCELLED, "تحویل داده شد"] },
      }),
    ]);
    if (!product) return res.status(404).json({ success: false, message: "محصول یافت نشد" });
    res.json({ success: true, product, orderCount, openOrders });
  })
);

// Quick flags from the product list (publication, merchandising). Uses save() so the
// model hooks (publishedAt, slug, finalPrice) keep working; nothing else is touched.
router.patch(
  "/products/:id/flags",
  requirePermission("manage_products"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "محصول یافت نشد" });
    const b = req.body || {};
    const changes = [];
    if (b.isPublished !== undefined) { product.isPublished = bool(b.isPublished); changes.push(product.isPublished ? "انتشار" : "عدم انتشار"); }
    if (b.isNewProduct !== undefined) { product.isNewProduct = bool(b.isNewProduct); changes.push("برچسب جدید"); }
    if (b.badge !== undefined) { product.badge = ["", "new", "bestseller", "limited", "exclusive"].includes(b.badge) ? b.badge : ""; changes.push("نشان"); }
    if (b.sortPriority !== undefined) {
      const n = Math.round(Number(b.sortPriority));
      if (Number.isFinite(n)) { product.sortPriority = Math.max(-1000, Math.min(1000, n)); changes.push("اولویت نمایش"); }
    }
    if (!changes.length) return res.status(400).json({ success: false, message: "تغییری ارسال نشده است" });
    await product.save();
    audit(req, "update_product", "product", product._id, product.name, changes.join("، "));
    res.json({ success: true, message: "محصول به‌روزرسانی شد", product: { _id: product._id, isPublished: product.isPublished, isNewProduct: product.isNewProduct, badge: product.badge, sortPriority: product.sortPriority } });
  })
);

router.post(
  "/products/bulk",
  requirePermission("manage_products"),
  h(async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter(isId).slice(0, 200);
    const action = req.body.action;
    if (!ids.length || !["publish", "unpublish"].includes(action)) {
      return res.status(400).json({ success: false, message: "درخواست گروهی نامعتبر است" });
    }
    const products = await Product.find({ _id: { $in: ids } });
    let changed = 0;
    for (const product of products) {
      const next = action === "publish";
      if (product.isPublished === next) continue;
      product.isPublished = next;
      await product.save();
      changed += 1;
      audit(req, "update_product", "product", product._id, product.name, next ? "انتشار گروهی" : "عدم انتشار گروهی");
    }
    res.json({ success: true, message: `${changed} محصول به‌روزرسانی شد`, changed });
  })
);

// =================================================================== inventory
router.get(
  "/inventory",
  requirePermission("manage_inventory", "manage_products"),
  h(async (req, res) => {
    const paging = parsePaging(req.query, { defaultLimit: 25 });
    const filter = productFilter(req.query);
    if (req.query.mode === "matrix") filter.variantInventoryConfigured = true;
    if (req.query.mode === "simple") filter.variantInventoryConfigured = { $ne: true };
    const [items, total, counts] = await Promise.all([
      Product.find(filter)
        .select("name sku images countInStock isOutOfStock lowStockThreshold isPublished colors sizes variantInventoryConfigured variantStocks stockRevision updatedAt")
        .sort(PRODUCT_SORTS[req.query.sort] || { countInStock: 1, name: 1 })
        .skip(paging.skip)
        .limit(paging.limit)
        .lean(),
      Product.countDocuments(filter),
      Promise.all([
        Product.estimatedDocumentCount(),
        Product.countDocuments(lowStockMatch),
        Product.countDocuments(outOfStockMatch),
        Product.countDocuments({ variantInventoryConfigured: true }),
      ]),
    ]);
    res.json({
      success: true,
      summary: { total: counts[0], low: counts[1], out: counts[2], matrix: counts[3] },
      items: items.map((p) => ({
        _id: p._id,
        name: p.name,
        sku: p.sku,
        image: p.images?.[0]?.url || "",
        countInStock: p.countInStock,
        isOutOfStock: p.isOutOfStock,
        lowStockThreshold: p.lowStockThreshold ?? 3,
        isPublished: p.isPublished,
        matrix: p.variantInventoryConfigured === true,
        stockRevision: p.stockRevision || 0,
        colorsCount: (p.colors || []).length,
        sizesCount: (p.sizes || []).length,
        rows: inventory.stockRows(p),
      })),
      ...pageMeta(paging, total),
    });
  })
);

router.post(
  "/inventory/:id/adjust",
  requirePermission("manage_inventory", "manage_products"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const { colorId = "", sizeId = "", mode = "delta", value, expected, reason = "" } = req.body || {};
    const result = await inventory.adjustStock(req.params.id, { colorId, sizeId, mode, value, expected });
    if (!result.unchanged) {
      const target = inventory.stockRows(result.product).find((r) => r.colorId === String(colorId || "") && r.sizeId === String(sizeId || ""));
      const label = target ? [target.color, target.size].filter(Boolean).join(" / ") || "موجودی کل" : "موجودی";
      audit(req, "adjust_inventory", "product", result.product._id, result.product.name, `${label}: ${result.before} → ${result.after}${reason ? ` (${String(reason).slice(0, 120)})` : ""}`);
    }
    res.json({
      success: true,
      message: result.unchanged ? "تغییری لازم نبود" : "موجودی به‌روزرسانی شد",
      before: result.before,
      after: result.after,
      product: { _id: result.product._id, countInStock: result.product.countInStock, isOutOfStock: result.product.isOutOfStock, rows: inventory.stockRows(result.product) },
    });
  })
);

router.post(
  "/inventory/:id/pause",
  requirePermission("manage_inventory", "manage_products"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const { colorId = "", sizeId = "", paused } = req.body || {};
    const product = await inventory.setVariantPaused(req.params.id, { colorId, sizeId, paused: bool(paused) });
    audit(req, "adjust_inventory", "product", product._id, product.name, bool(paused) ? "توقف فروش یک تنوع" : "ازسرگیری فروش یک تنوع");
    res.json({ success: true, message: bool(paused) ? "فروش این تنوع متوقف شد" : "فروش این تنوع فعال شد", product: { _id: product._id, countInStock: product.countInStock, isOutOfStock: product.isOutOfStock, rows: inventory.stockRows(product) } });
  })
);

router.post(
  "/inventory/:id/threshold",
  requirePermission("manage_inventory", "manage_products"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const n = Math.round(Number(req.body.lowStockThreshold));
    if (!Number.isFinite(n) || n < 0 || n > 1000) return res.status(400).json({ success: false, message: "حد هشدار باید بین ۰ تا ۱۰۰۰ باشد" });
    const product = await Product.findByIdAndUpdate(req.params.id, { $set: { lowStockThreshold: n } }, { new: true, runValidators: true }).select("name lowStockThreshold");
    if (!product) return res.status(404).json({ success: false, message: "محصول یافت نشد" });
    audit(req, "adjust_inventory", "product", product._id, product.name, `حد هشدار موجودی: ${n}`);
    res.json({ success: true, message: "حد هشدار ذخیره شد", lowStockThreshold: product.lowStockThreshold });
  })
);

router.get(
  "/inventory/export.csv",
  requirePermission("manage_inventory", "manage_products"),
  h(async (req, res) => {
    const filter = productFilter(req.query);
    const products = await Product.find(filter)
      .select("name sku colors sizes variantInventoryConfigured variantStocks countInStock isOutOfStock")
      .sort({ name: 1 })
      .limit(5000)
      .lean();
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="odour-inventory-${tehranDay()}.csv"`);
    res.set("Cache-Control", "no-store");
    res.send(inventory.toCsv(products));
  })
);

router.post(
  "/inventory/import",
  requirePermission("manage_inventory", "manage_products"),
  express.json({ limit: "6mb" }),
  h(async (req, res) => {
    const rows = inventory.parseCsv(req.body.csv);
    const { plan, errors, considered } = await inventory.planCsvImport(rows);
    if (!bool(req.body.apply)) {
      return res.json({ success: true, preview: true, considered, changes: plan, errors });
    }
    if (errors.length) {
      return res.status(400).json({ success: false, message: "ابتدا خطاهای فایل را برطرف کنید؛ هیچ تغییری اعمال نشد.", errors, changes: plan });
    }
    const { applied, failed } = await inventory.applyCsvPlan(plan);
    if (applied.length) {
      const first = applied[0];
      audit(req, "import_inventory", "product", first.productId, `${applied.length} ردیف`, `ورود CSV موجودی: ${applied.length} تغییر${failed.length ? `، ${failed.length} ناموفق` : ""}`);
    }
    res.json({ success: true, message: `${applied.length} تغییر اعمال شد${failed.length ? ` و ${failed.length} مورد به دلیل تغییر هم‌زمان اعمال نشد` : ""}`, applied, failed });
  })
);

// ====================================================================== orders
const ORDER_SORTS = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, total_desc: { totalPrice: -1 }, total_asc: { totalPrice: 1 } };

async function orderFilter(query) {
  const filter = {};
  const and = [];
  const statuses = Order.schema.path("status").enumValues;
  if (statuses.includes(query.status)) filter.status = query.status;
  if (query.status === "needs_action") filter.status = { $in: ["در حال پردازش", "بسته بندی شده"] };
  if (Order.schema.path("paymentStatus").enumValues.includes(query.paymentStatus)) filter.paymentStatus = query.paymentStatus;
  if (Order.schema.path("paymentMethod").enumValues.includes(query.paymentMethod)) filter.paymentMethod = query.paymentMethod;
  if (Order.schema.path("delivery").enumValues.includes(query.delivery)) filter.delivery = query.delivery;
  if (query.source) {
    const field = query.model === "first" ? "acquisition.firstTouch.source" : "acquisition.lastTouch.source";
    if (query.source === "unknown") filter[field] = { $exists: false };
    else if (CHANNELS[query.source]) filter[field] = query.source;
  }
  if (query.from || query.to || query.days) {
    const range = parseRange(query);
    filter.createdAt = { $gte: range.from, $lt: range.to };
  }
  if (isId(query.user)) filter.user = oid(query.user);
  const q = cleanSearch(query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    const or = [{ OrderNum: rx }, { recipientName: rx }, { recipientMobile: rx }, { trackingNumber: rx }, { postcode: rx }];
    const users = await User.aggregate([
      { $match: { $or: [{ fullName: rx }, { mobile: rx }, { email: rx }] } },
      { $limit: 300 },
      { $project: { _id: 1 } },
    ]);
    if (users.length) or.push({ user: { $in: users.map((u) => u._id) } });
    and.push({ $or: or });
  }
  if (and.length) filter.$and = and;
  return filter;
}

router.get(
  "/orders",
  requirePermission("manage_orders"),
  h(async (req, res) => {
    const paging = parsePaging(req.query);
    const filter = await orderFilter(req.query);
    const [items, total, statusCounts] = await Promise.all([
      Order.find(filter)
        .select("OrderNum createdAt recipientName recipientMobile user totalPrice status paymentStatus paymentMethod delivery trackingNumber products.quantity acquisition.lastTouch.source acquisition.firstTouch.source")
        .populate("user", "fullName mobile")
        .sort(ORDER_SORTS[req.query.sort] || ORDER_SORTS.newest)
        .skip(paging.skip)
        .limit(paging.limit)
        .lean(),
      Order.countDocuments(filter),
      Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    res.json({
      success: true,
      items: items.map((o) => ({
        ...o,
        itemsCount: (o.products || []).reduce((s, p) => s + Number(p.quantity || 0), 0),
        products: undefined,
        source: o.acquisition?.lastTouch?.source || null,
        firstSource: o.acquisition?.firstTouch?.source || null,
        acquisition: undefined,
      })),
      statusCounts: Object.fromEntries(statusCounts.map((r) => [r._id, r.count])),
      ...pageMeta(paging, total),
    });
  })
);

// Strips secrets (gateway tokens, return-session hashes) before sending an order.
function sanitizeOrder(order) {
  const o = { ...order };
  if (o.paymentInfo) {
    const { returnSessionTokenHash, returnSessionExpiresAt, ...rest } = o.paymentInfo;
    o.paymentInfo = rest;
  }
  for (const key of ["snappPay", "torobPay"]) {
    if (!o[key]) continue;
    const { paymentToken, returnSessionTokenHash, returnSessionExpiresAt, ...rest } = o[key];
    o[key] = { ...rest, hasPaymentToken: Boolean(paymentToken) };
  }
  delete o.orderRegisteredSmsLockAt;
  return o;
}

router.get(
  "/orders/:id",
  requirePermission("manage_orders"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const order = await Order.findById(req.params.id)
      .populate("user", "fullName mobile email createdAt")
      .populate("products.product", "name slug images sku")
      .lean();
    if (!order) return res.status(404).json({ success: false, message: "سفارش یافت نشد" });
    const adminIds = [
      ...(order.statusHistory || []).map((s) => s.changedBy),
      ...(order.snappPay?.updateHistory || []).map((s) => s.changedBy),
      ...(order.torobPay?.updateHistory || []).map((s) => s.changedBy),
    ].filter(Boolean);
    const admins = adminIds.length ? await Admin.find({ _id: { $in: adminIds } }).select("fullName").lean() : [];
    const names = Object.fromEntries(admins.map((a) => [String(a._id), a.fullName]));
    order.statusHistory = (order.statusHistory || []).map((s) => ({ ...s, changedByName: s.changedBy ? names[String(s.changedBy)] || "" : "" }));
    order.products = (order.products || []).map((p) => ({
      ...p,
      product: p.product ? { _id: p.product._id, name: p.product.name, slug: p.product.slug, sku: p.product.sku, image: p.product.images?.[0]?.url || "" } : null,
    }));
    const activity = await RecentAction.find({ targetType: "order", targetId: order._id }).select("action adminName details createdAtTimestamp").sort({ createdAtTimestamp: -1 }).limit(30).lean();
    res.json({ success: true, order: sanitizeOrder(order), activity });
  })
);

router.patch(
  "/orders/:id/shipping",
  requirePermission("manage_orders"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const trackingNumber = String(req.body.trackingNumber ?? "").trim();
    if (trackingNumber.length > 60 || /[<>"'`]/.test(trackingNumber)) {
      return res.status(400).json({ success: false, message: "کد رهگیری نامعتبر است" });
    }
    const order = await Order.findByIdAndUpdate(req.params.id, { $set: { trackingNumber: trackingNumber || undefined } }, { new: true }).select("OrderNum trackingNumber");
    if (!order) return res.status(404).json({ success: false, message: "سفارش یافت نشد" });
    audit(req, "update_order_shipping", "order", order._id, order.OrderNum, trackingNumber ? `کد رهگیری: ${trackingNumber}` : "حذف کد رهگیری");
    res.json({ success: true, message: "کد رهگیری ذخیره شد", trackingNumber: order.trackingNumber || "" });
  })
);

// ============================================================== notifications
router.get(
  "/notifications",
  h(async (req, res) => {
    const out = { success: true, newOrders: 0, latest: [], needsAction: 0, lowStock: 0, outOfStock: 0, stuckPayments: 0 };
    if (can(req, "manage_orders")) {
      const query = { status: { $nin: [CANCELLED, "در انتظار پرداخت"] } };
      const seen = await AdminNotification.findOne({ adminId: req.admin._id }).lean();
      if (seen && seen.lastSeenOrderId) {
        const last = await Order.findById(seen.lastSeenOrderId).select("createdAt").lean();
        if (last) query.createdAt = { $gt: last.createdAt };
      }
      const [newOrders, latest, needsAction, stuck] = await Promise.all([
        Order.countDocuments(query),
        Order.find(query).select("OrderNum recipientName totalPrice createdAt paymentMethod").sort({ createdAt: -1 }).limit(6).lean(),
        Order.countDocuments({ status: { $in: ["در حال پردازش", "بسته بندی شده"] } }),
        // Gateway payments whose state is still unclear after an hour need a manual sync.
        Order.countDocuments({ paymentStatus: { $in: ["در حال بررسی", "نامشخص"] }, createdAt: { $lt: new Date(Date.now() - 36e5) }, status: { $ne: CANCELLED } }),
      ]);
      Object.assign(out, { newOrders, latest, needsAction, stuckPayments: stuck });
    }
    if (can(req, "manage_inventory", "manage_products", "view_analytics")) {
      const [low, outCount] = await Promise.all([Product.countDocuments(lowStockMatch), Product.countDocuments(outOfStockMatch)]);
      out.lowStock = low;
      out.outOfStock = outCount;
    }
    res.json(out);
  })
);

router.post(
  "/notifications/seen",
  requirePermission("manage_orders"),
  h(async (req, res) => {
    const latest = await Order.findOne({ status: { $nin: [CANCELLED, "در انتظار پرداخت"] } }).sort({ createdAt: -1 }).select("_id").lean();
    if (latest) {
      await AdminNotification.findOneAndUpdate({ adminId: req.admin._id }, { lastSeenOrderId: latest._id, lastSeenAt: new Date() }, { upsert: true });
    }
    res.json({ success: true });
  })
);

// =================================================================== customers
// Users are read with aggregate() on purpose: the User model hides deactivated
// accounts from every find(), and admins must be able to see and re-activate them.
const CUSTOMER_FIELDS = { fullName: 1, mobile: 1, email: 1, createdAt: 1, isActive: 1, "acquisition.source": 1, addressesCount: { $size: { $ifNull: ["$addresses", []] } } };
const successExpr = { $and: [{ $eq: ["$paymentStatus", "پرداخت شده"] }, { $ne: ["$status", CANCELLED] }] };
const statsLookup = {
  $lookup: {
    from: Order.collection.name,
    let: { uid: "$_id" },
    pipeline: [
      { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          successful: { $sum: { $cond: [successExpr, 1, 0] } },
          spent: { $sum: { $cond: [successExpr, "$totalPrice", 0] } },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
    ],
    as: "stats",
  },
};

router.get(
  "/customers",
  requirePermission("manage_users"),
  h(async (req, res) => {
    const paging = parsePaging(req.query);
    const match = {};
    const q = cleanSearch(req.query.q);
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      match.$or = [{ fullName: rx }, { mobile: rx }, { email: rx }];
    }
    if (req.query.status === "inactive") match.isActive = false;
    if (req.query.status === "active") match.isActive = { $ne: false };
    if (req.query.source) {
      if (req.query.source === "unknown") match["acquisition.source"] = { $exists: false };
      else if (CHANNELS[req.query.source]) match["acquisition.source"] = req.query.source;
    }
    const byStats = ["spent", "orders"].includes(req.query.sort);
    const sort = req.query.sort === "oldest" ? { createdAt: 1 } : { createdAt: -1 };
    const pipeline = [{ $match: match }];
    if (byStats) {
      pipeline.push(statsLookup, { $addFields: { s: { $ifNull: [{ $arrayElemAt: ["$stats", 0] }, {}] } } });
      pipeline.push({ $sort: req.query.sort === "spent" ? { "s.spent": -1, createdAt: -1 } : { "s.successful": -1, createdAt: -1 } });
      pipeline.push({ $skip: paging.skip }, { $limit: paging.limit });
    } else {
      pipeline.push({ $sort: sort }, { $skip: paging.skip }, { $limit: paging.limit }, statsLookup);
    }
    pipeline.push({ $project: { ...CUSTOMER_FIELDS, stats: { $ifNull: [{ $arrayElemAt: ["$stats", 0] }, null] } } });
    const [items, totalRows] = await Promise.all([User.aggregate(pipeline), User.aggregate([{ $match: match }, { $count: "n" }])]);
    res.json({
      success: true,
      items: items.map((u) => ({
        ...u,
        isActive: u.isActive !== false,
        source: u.acquisition?.source || null,
        acquisition: undefined,
        orders: u.stats?.orders || 0,
        successful: u.stats?.successful || 0,
        spent: u.stats?.spent || 0,
        lastOrderAt: u.stats?.lastOrderAt || null,
        stats: undefined,
      })),
      ...pageMeta(paging, totalRows[0]?.n || 0),
    });
  })
);

router.get(
  "/customers/:id",
  requirePermission("manage_users"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const [user] = await User.aggregate([
      { $match: { _id: oid(req.params.id) } },
      {
        $project: {
          fullName: 1, mobile: 1, email: 1, createdAt: 1, updatedAt: 1, isActive: 1, addresses: 1, acquisition: 1,
          cartCount: { $size: { $ifNull: ["$cart", []] } },
          wishlistCount: { $size: { $ifNull: ["$wishlist", []] } },
        },
      },
    ]);
    if (!user) return res.status(404).json({ success: false, message: "مشتری یافت نشد" });
    const [orders, stats, firstAttributed] = await Promise.all([
      Order.find({ user: user._id })
        .select("OrderNum createdAt totalPrice status paymentStatus paymentMethod products.quantity acquisition.lastTouch.source")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      Order.aggregate([
        { $match: { user: user._id } },
        { $group: { _id: null, orders: { $sum: 1 }, successful: { $sum: { $cond: [successExpr, 1, 0] } }, spent: { $sum: { $cond: [successExpr, "$totalPrice", 0] } }, first: { $min: "$createdAt" }, last: { $max: "$createdAt" } } },
      ]),
      Order.findOne({ user: user._id, "acquisition.firstTouch.source": { $exists: true } }).sort({ createdAt: 1 }).select("acquisition.firstTouch OrderNum").lean(),
    ]);
    // Acquisition: recorded at sign-up, otherwise the first-touch of the first attributed order.
    let acquisition = null;
    if (user.acquisition?.source) acquisition = { ...user.acquisition, basis: "signup" };
    else if (firstAttributed) acquisition = { ...firstAttributed.acquisition.firstTouch, basis: "order", orderNum: firstAttributed.OrderNum };
    res.json({
      success: true,
      customer: { ...user, isActive: user.isActive !== false, acquisition },
      stats: stats[0] || { orders: 0, successful: 0, spent: 0 },
      orders: orders.map((o) => ({ ...o, itemsCount: (o.products || []).reduce((s, p) => s + Number(p.quantity || 0), 0), products: undefined, source: o.acquisition?.lastTouch?.source || null, acquisition: undefined })),
    });
  })
);

router.patch(
  "/customers/:id/status",
  requirePermission("manage_users"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const isActive = bool(req.body.isActive);
    // updateOne bypasses the find hook that hides inactive users.
    const result = await User.updateOne({ _id: oid(req.params.id) }, { $set: { isActive } });
    if (!result.matchedCount) return res.status(404).json({ success: false, message: "مشتری یافت نشد" });
    const [user] = await User.aggregate([{ $match: { _id: oid(req.params.id) } }, { $project: { fullName: 1, mobile: 1 } }]);
    audit(req, "update_customer", "customer", req.params.id, user?.fullName || user?.mobile, isActive ? "فعال‌سازی حساب" : "غیرفعال‌سازی حساب");
    res.json({ success: true, message: isActive ? "حساب مشتری فعال شد" : "حساب مشتری غیرفعال شد", isActive });
  })
);

// ============================================================== catalog lists
router.get(
  "/categories",
  h(async (req, res) => {
    const type = ["product", "weblog"].includes(req.query.type) ? req.query.type : null;
    const [categories, productCounts, weblogCounts] = await Promise.all([
      Category.find(type ? { categoryType: type } : {}).sort({ displayOrder: 1, name: 1 }).lean(),
      Product.aggregate([{ $unwind: "$category" }, { $group: { _id: "$category", count: { $sum: 1 }, published: { $sum: { $cond: ["$isPublished", 1, 0] } } } }]),
      Weblog.aggregate([{ $unwind: "$categories" }, { $group: { _id: "$categories", count: { $sum: 1 } } }]),
    ]);
    const pc = new Map(productCounts.map((r) => [String(r._id), r]));
    const wc = new Map(weblogCounts.map((r) => [String(r._id), r.count]));
    res.json({
      success: true,
      categories: categories.map((c) => ({
        ...c,
        productCount: pc.get(String(c._id))?.count || 0,
        publishedCount: pc.get(String(c._id))?.published || 0,
        weblogCount: wc.get(String(c._id)) || 0,
      })),
    });
  })
);

router.get(
  "/brands",
  h(async (req, res) => {
    const [brands, counts] = await Promise.all([
      Brand.find({}).sort({ name: 1 }).lean(),
      Product.aggregate([{ $group: { _id: "$brand", count: { $sum: 1 }, published: { $sum: { $cond: ["$isPublished", 1, 0] } } } }]),
    ]);
    const map = new Map(counts.map((r) => [String(r._id), r]));
    res.json({ success: true, brands: brands.map((b) => ({ ...b, productCount: map.get(String(b._id))?.count || 0, publishedCount: map.get(String(b._id))?.published || 0 })) });
  })
);

router.get(
  "/discounts",
  requirePermission("manage_discounts"),
  h(async (req, res) => {
    const filter = {};
    const q = cleanSearch(req.query.q);
    if (q) filter.code = new RegExp(escapeRegex(q.toUpperCase()), "i");
    const now = new Date();
    if (req.query.status === "active") Object.assign(filter, { isActive: true, $or: [{ expireDate: null }, { expireDate: { $gte: now } }] });
    if (req.query.status === "inactive") filter.isActive = false;
    if (req.query.status === "expired") filter.expireDate = { $lt: now };
    const discounts = await DiscountCode.find(filter)
      .select("-usedByUsers")
      .populate("applicableCategories", "name")
      .populate("applicableProducts", "name")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    // Revenue of successful orders that used each code.
    const usage = await Order.aggregate([
      { $match: { ...SUCCESS_MATCH, "discount.discountId": { $in: discounts.map((d) => d._id) } } },
      { $group: { _id: "$discount.discountId", orders: { $sum: 1 }, revenue: { $sum: "$totalPrice" }, discountGiven: { $sum: "$discountAmount" } } },
    ]);
    const u = new Map(usage.map((r) => [String(r._id), r]));
    res.json({
      success: true,
      discounts: discounts.map((d) => ({
        ...d,
        isExpired: Boolean(d.expireDate && new Date(d.expireDate) < now),
        remaining: d.usageLimit ? Math.max(0, d.usageLimit - (d.usedCount || 0)) : null,
        successfulOrders: u.get(String(d._id))?.orders || 0,
        revenue: u.get(String(d._id))?.revenue || 0,
        discountGiven: u.get(String(d._id))?.discountGiven || 0,
      })),
    });
  })
);

router.get(
  "/weblogs",
  requirePermission("manage_weblogs"),
  h(async (req, res) => {
    const paging = parsePaging(req.query);
    const filter = {};
    const q = cleanSearch(req.query.q);
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ title: rx }, { tags: rx }, { slug: rx }];
    }
    if (req.query.status === "published") filter.isPublished = true;
    if (req.query.status === "draft") filter.isPublished = { $ne: true };
    if (req.query.status === "featured") filter.isFeatured = true;
    if (isId(req.query.category)) filter.categories = oid(req.query.category);
    const sort = req.query.sort === "views" ? { viewCount: -1 } : req.query.sort === "oldest" ? { createdAt: 1 } : { createdAt: -1 };
    const [items, total] = await Promise.all([
      Weblog.find(filter)
        .select("title slug description images categories tags readingTime isFeatured isPublished publishedAt viewCount createdAt updatedAt")
        .populate("categories", "name")
        .sort(sort)
        .skip(paging.skip)
        .limit(paging.limit)
        .lean(),
      Weblog.countDocuments(filter),
    ]);
    res.json({ success: true, items: items.map((w) => ({ ...w, image: w.images?.[0]?.url || w.images?.[0] || "", images: undefined })), ...pageMeta(paging, total) });
  })
);

// ===================================================================== activity
router.get(
  "/activity",
  requirePermission("view_analytics", "manage_admins"),
  h(async (req, res) => {
    const paging = parsePaging(req.query, { defaultLimit: 30 });
    const filter = {};
    if (req.query.targetType && RecentAction.schema.path("targetType").enumValues.includes(req.query.targetType)) filter.targetType = req.query.targetType;
    if (req.query.action && RecentAction.schema.path("action").enumValues.includes(req.query.action)) filter.action = req.query.action;
    if (isId(req.query.admin)) filter.adminId = oid(req.query.admin);
    if (isId(req.query.target)) filter.targetId = oid(req.query.target);
    if (req.query.from || req.query.to || req.query.days) {
      const range = parseRange(req.query);
      filter.createdAtTimestamp = { $gte: range.from, $lt: range.to };
    }
    const q = cleanSearch(req.query.q);
    if (q) filter.targetName = new RegExp(escapeRegex(q), "i");
    const [items, total, admins] = await Promise.all([
      RecentAction.find(filter).select("-__v -createdAt -updatedAt").sort({ createdAtTimestamp: -1 }).skip(paging.skip).limit(paging.limit).lean(),
      RecentAction.countDocuments(filter),
      Admin.find({}).select("fullName").lean(),
    ]);
    res.json({ success: true, items, admins, ...pageMeta(paging, total) });
  })
);

// ======================================================================= admins
const adminView = (a) => ({
  _id: a._id,
  fullName: a.fullName,
  email: a.email,
  role: a.role,
  permissions: a.permissions || [],
  permissionsManaged: a.permissionsManaged === true,
  effectivePermissions: Admin.effectivePermissions(a),
  isActive: a.isActive !== false,
  lastLoginAt: a.lastLoginAt || null,
  lastLoginIP: a.lastLoginIP || "",
  createdAt: a.createdAt,
});

const validEmail = (v) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 120;
const cleanPermissions = (list) => [...new Set((Array.isArray(list) ? list : []).filter((p) => Admin.ALL_PERMISSIONS.includes(p)))];

router.get(
  "/admins",
  requirePermission("manage_admins"),
  h(async (req, res) => {
    const admins = await Admin.find({}).select("+isActive").sort({ role: -1, fullName: 1 }).lean();
    res.json({ success: true, admins: admins.map(adminView), permissions: Admin.ALL_PERMISSIONS });
  })
);

router.post(
  "/admins",
  requirePermission("manage_admins"),
  h(async (req, res) => {
    const isSuper = req.admin.role === "super_admin";
    const fullName = String(req.body.fullName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const role = req.body.role === "super_admin" ? "super_admin" : "admin";
    if (role === "super_admin" && !isSuper) return res.status(403).json({ success: false, message: "فقط مدیر ارشد می‌تواند مدیر ارشد بسازد" });
    if (fullName.length < 3) return res.status(400).json({ success: false, message: "نام کامل حداقل ۳ کاراکتر است" });
    if (!validEmail(email)) return res.status(400).json({ success: false, message: "ایمیل معتبر نیست" });
    if (password.length < 10) return res.status(400).json({ success: false, message: "رمز عبور باید حداقل ۱۰ کاراکتر باشد" });
    const permissions = cleanPermissions(req.body.permissions);
    // Nobody can grant a permission they do not hold themselves.
    const notOwned = permissions.filter((p) => !req.adminPermissions.includes(p));
    if (notOwned.length) return res.status(403).json({ success: false, message: "نمی‌توانید دسترسی‌ای را بدهید که خودتان ندارید" });
    if (await Admin.exists({ email })) return res.status(409).json({ success: false, message: "این ایمیل قبلاً ثبت شده است" });
    const admin = await Admin.create({ fullName, email, password, role, permissions, permissionsManaged: true, isActive: true, createdBy: req.admin._id });
    audit(req, "create_admin", "admin", admin._id, admin.fullName, `نقش: ${role}`);
    res.status(201).json({ success: true, message: "مدیر جدید ساخته شد", admin: adminView(admin.toObject()) });
  })
);

router.put(
  "/admins/:id",
  requirePermission("manage_admins"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const target = await Admin.findById(req.params.id).select("+isActive");
    if (!target) return res.status(404).json({ success: false, message: "مدیر یافت نشد" });
    const isSuper = req.admin.role === "super_admin";
    const self = String(target._id) === String(req.admin._id);
    if (target.role === "super_admin" && !isSuper) return res.status(403).json({ success: false, message: "فقط مدیر ارشد می‌تواند مدیر ارشد را ویرایش کند" });

    const b = req.body || {};
    const changes = [];
    if (b.fullName !== undefined) {
      const name = String(b.fullName || "").trim();
      if (name.length < 3) return res.status(400).json({ success: false, message: "نام کامل حداقل ۳ کاراکتر است" });
      target.fullName = name;
    }
    if (b.role !== undefined) {
      const role = b.role === "super_admin" ? "super_admin" : "admin";
      if (role !== target.role) {
        if (!isSuper) return res.status(403).json({ success: false, message: "فقط مدیر ارشد می‌تواند نقش را تغییر دهد" });
        if (self) return res.status(400).json({ success: false, message: "نمی‌توانید نقش خودتان را تغییر دهید" });
        if (target.role === "super_admin" && (await Admin.countDocuments({ role: "super_admin", isActive: { $ne: false } })) <= 1) {
          return res.status(400).json({ success: false, message: "حداقل یک مدیر ارشد فعال باید باقی بماند" });
        }
        target.role = role;
        changes.push(`نقش: ${role}`);
      }
    }
    if (b.permissions !== undefined) {
      const permissions = cleanPermissions(b.permissions);
      const before = new Set(target.permissions || []);
      const added = permissions.filter((p) => !before.has(p));
      if (added.some((p) => !req.adminPermissions.includes(p))) {
        return res.status(403).json({ success: false, message: "نمی‌توانید دسترسی‌ای را بدهید که خودتان ندارید" });
      }
      if (self && !permissions.includes("manage_admins") && target.role !== "super_admin") {
        return res.status(400).json({ success: false, message: "نمی‌توانید دسترسی مدیریت ادمین‌ها را از خودتان بگیرید" });
      }
      target.permissions = permissions;
      target.permissionsManaged = true;
      changes.push("دسترسی‌ها");
    }
    if (b.isActive !== undefined) {
      const active = bool(b.isActive);
      if (self && !active) return res.status(400).json({ success: false, message: "نمی‌توانید حساب خودتان را غیرفعال کنید" });
      if (!active && target.role === "super_admin" && (await Admin.countDocuments({ role: "super_admin", isActive: { $ne: false } })) <= 1) {
        return res.status(400).json({ success: false, message: "حداقل یک مدیر ارشد فعال باید باقی بماند" });
      }
      if (active !== (target.isActive !== false)) changes.push(active ? "فعال‌سازی" : "غیرفعال‌سازی");
      target.isActive = active;
    }
    await target.save();
    audit(req, "update_admin", "admin", target._id, target.fullName, changes.join("، "));
    res.json({ success: true, message: "اطلاعات مدیر ذخیره شد", admin: adminView(target.toObject()) });
  })
);

router.post(
  "/admins/:id/password",
  requirePermission("manage_admins"),
  h(async (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const password = String(req.body.password || "");
    if (password.length < 10) return res.status(400).json({ success: false, message: "رمز عبور باید حداقل ۱۰ کاراکتر باشد" });
    const target = await Admin.findById(req.params.id).select("+password");
    if (!target) return res.status(404).json({ success: false, message: "مدیر یافت نشد" });
    if (target.role === "super_admin" && req.admin.role !== "super_admin") {
      return res.status(403).json({ success: false, message: "فقط مدیر ارشد می‌تواند رمز مدیر ارشد را تغییر دهد" });
    }
    target.password = password;
    await target.save();
    audit(req, "change_password", "admin", target._id, target.fullName, "بازنشانی رمز عبور");
    res.json({ success: true, message: "رمز عبور تغییر کرد" });
  })
);

module.exports = router;
