// middlewares/adminAuth.js
const crypto = require("crypto");
const Admin = require("../models/Admins");

// Requests made by the admin UI (fetch) get JSON errors instead of redirects.
const wantsJson = (req) =>
  req.xhr ||
  req.path.startsWith('/api/') ||
  String(req.get('accept') || '').includes('application/json') ||
  !['GET', 'HEAD'].includes(req.method);

const isAdminLoggedIn = async (req, res, next) => {
  try {
    // مسیرهای عمومی
    if (req.path === '/login' ||
        req.path === '/login-page' ||
        req.path.startsWith('/css/') ||
        req.path.startsWith('/js/') ||
        req.path.startsWith('/fonts/') ||
        req.path === '/favicon.ico') {
      return next();
    }

    const deny = (query = '') => {
      if (wantsJson(req)) {
        return res.status(401).json({ success: false, message: "لطفاً وارد حساب مدیریت شوید" });
      }
      return res.redirect(`/admin/login${query}`);
    };

    // چک کردن سشن
    if (!req.session || !req.session.adminId) {
      return deny();
    }

    const admin = await Admin.findById(req.session.adminId).select('+isActive');

    if (!admin) {
      delete req.session.adminId;
      return deny();
    }

    if (!admin.isActive) {
      delete req.session.adminId;
      return deny('?error=account_disabled');
    }

    req.admin = admin;
    req.adminPermissions = admin.effectivePermissions();
    next();
  } catch (error) {
    console.error("Admin auth error:", error);
    if (wantsJson(req)) return res.status(500).json({ success: false, message: "خطا در احراز هویت" });
    res.redirect('/admin/login');
  }
};

// ------------------------------------------------------------------ permissions
const has = (req, permission) => Array.isArray(req.adminPermissions) && req.adminPermissions.includes(permission);

const forbidden = (res) =>
  res.status(403).json({ success: false, message: "شما به این بخش دسترسی ندارید" });

// Passes when the admin has ANY of the listed permissions.
const requirePermission = (...permissions) => (req, res, next) =>
  permissions.some((p) => has(req, p)) ? next() : forbidden(res);

const MEDIA_EDITORS = ['manage_products', 'manage_weblogs', 'manage_categories', 'manage_brands', 'manage_banners'];
const READ = ['GET', 'HEAD'];

// Server-side permission rules for the pre-existing /admin endpoints (routes/admin.js).
// New endpoints (routes/adminApi.js) declare their permission per route.
// `read: null` means any signed-in admin may read (lookups used by several editors).
const LEGACY_RULES = [
  { test: /^\/(upload-image|upload-images|upload-temp-image|delete-image)$/, any: MEDIA_EDITORS },
  { test: /^\/products(\/|$)/, any: ['manage_products'] },
  { test: /^\/orders(\/|$)/, any: ['manage_orders'] },
  { test: /^\/api\/(orders|orders-stats|new-orders-count|mark-orders-seen)(\/|$)/, any: ['manage_orders'] },
  { test: /^\/categories(\/|$)/, any: ['manage_categories'], read: null },
  { test: /^\/api\/category-description(\/|$)/, any: ['manage_categories'], read: null },
  { test: /^\/brands(\/|$)/, any: ['manage_brands'] },
  { test: /^\/discounts(\/|$)/, any: ['manage_discounts'] },
  { test: /^\/(api\/)?weblogs(\/|$)/, any: ['manage_weblogs'] },
  { test: /^\/banners(\/|$)/, any: ['manage_banners'] },
  { test: /^\/recent-actions$/, any: ['view_analytics', 'manage_admins'] },
];

const legacyPermissionGuard = (req, res, next) => {
  const rule = LEGACY_RULES.find((r) => r.test.test(req.path));
  if (!rule) return next();
  if (READ.includes(req.method) && rule.read === null) return next();
  return rule.any.some((p) => has(req, p)) ? next() : forbidden(res);
};

// ------------------------------------------------------------------------- CSRF
// Admin sessions get a random token (rendered into the panel); every state-changing
// admin request must echo it in the X-CSRF-Token header.
const ensureCsrfToken = (req) => {
  if (!req.session.adminCsrf) req.session.adminCsrf = crypto.randomBytes(24).toString('base64url');
  return req.session.adminCsrf;
};

const verifyCsrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const expected = req.session && req.session.adminCsrf;
  const received = String(req.get('x-csrf-token') || '');
  if (
    expected &&
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  ) {
    return next();
  }
  return res.status(403).json({ success: false, message: "نشست شما منقضی شده است. صفحه را دوباره بارگذاری کنید.", csrf: true });
};

module.exports = {
  isAdminLoggedIn,
  requirePermission,
  legacyPermissionGuard,
  ensureCsrfToken,
  verifyCsrf,
  LEGACY_RULES,
};
