"use strict";
// Traffic-source / customer-acquisition attribution.
//
// Model (documented in docs/ADMIN.md):
//  - Every storefront page request is classified into one "touch": UTM parameters win,
//    then ad click ids (gclid), then the Referer host, otherwise "direct".
//  - Navigation inside the site and returns from payment gateways (Zarinpal, SnappPay,
//    TorobPay, Shaparak, ...) are NOT touches, so paying with SnappPay never makes a
//    customer "acquired from Snapp".
//  - A signed first-party cookie keeps two touches for 90 days:
//      firstTouch = the first touch we ever recorded for this browser,
//      lastTouch  = the most recent non-direct touch ("last non-direct click");
//                   a direct visit only becomes lastTouch when nothing else exists.
//  - The cookie contains marketing parameters only (no IP, no user id, no PII).
//  - Orders copy both touches at creation; orders without the data are reported as
//    "Unknown / Not tracked" and are never back-filled with guesses.
const crypto = require("crypto");

const COOKIE_NAME = "odr_src";
const COOKIE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MODEL = "first-touch+last-non-direct-v1";

const CHANNELS = {
  google: "گوگل",
  torob: "ترب",
  snapp: "اسنپ",
  instagram: "اینستاگرام",
  other_search: "سایر موتورهای جستجو",
  social: "شبکه‌های اجتماعی",
  referral: "سایت‌های ارجاع‌دهنده",
  campaign: "کمپین (UTM)",
  direct: "ورود مستقیم",
  unknown: "نامشخص / ردیابی نشده",
};

// Payment gateways redirect customers back to us; those are never acquisition sources.
const GATEWAY_PATTERNS = [
  /(^|\.)zarinpal\.com$/,
  /(^|\.)shaparak\.ir$/,
  /snapppay/,
  /torobpay/,
  /(^|\.)pay\.torob\.(com|ir)$/,
  /(^|\.)(asanpardakht|sadadpsp|sep|bpm|bitpay|idpay|zibal|payping|vandar)\.ir$/,
  /(^|\.)nextpay\.org$/,
  /(^|\.)enamad\.ir$/,
];

const SEARCH_PATTERNS = [
  /(^|\.)bing\.com$/,
  /(^|\.)yahoo\./,
  /(^|\.)duckduckgo\.com$/,
  /(^|\.)yandex\./,
  /(^|\.)ecosia\.org$/,
  /(^|\.)baidu\.com$/,
  /(^|\.)(zarebin|parsijoo)\.ir$/,
  /(^|\.)gerdoo\.me$/,
  /(^|\.)search\.brave\.com$/,
  /(^|\.)qwant\.com$/,
];

const SOCIAL_PATTERNS = [
  /(^|\.)facebook\.com$/,
  /(^|\.)fb\.(com|me)$/,
  /(^|\.)t\.me$/,
  /telegram/,
  /(^|\.)twitter\.com$/,
  /(^|\.)x\.com$/,
  /(^|\.)t\.co$/,
  /(^|\.)linkedin\.com$/,
  /(^|\.)lnkd\.in$/,
  /(^|\.)pinterest\./,
  /(^|\.)youtube\.com$/,
  /(^|\.)whatsapp\.(com|net)$/,
  /(^|\.)aparat\.com$/,
  /(^|\.)eitaa\.com$/,
  /(^|\.)rubika\.ir$/,
  /(^|\.)bale\.ai$/,
  /(^|\.)threads\.net$/,
  /(^|\.)tiktok\.com$/,
];

const clip = (value, max) => {
  const text = String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f<>"'`]/g, "")
    .trim();
  return text.slice(0, max);
};

const normalizeHost = (value) => {
  let host = String(value || "").trim().toLowerCase();
  if (!host) return "";
  host = host.replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9.-]+$/.test(host) ? host.slice(0, 120) : "";
};

const hostOf = (url) => {
  try {
    const parsed = new URL(String(url || ""));
    // android-app://com.google.android.googlequicksearchbox/ etc.
    return normalizeHost(parsed.hostname || parsed.host);
  } catch (_) {
    return "";
  }
};

const isGatewayHost = (host) => Boolean(host) && GATEWAY_PATTERNS.some((rx) => rx.test(host));

// Classifies an external host into a channel. Payment gateways must be filtered first.
function channelForHost(host) {
  if (!host) return "unknown";
  if (/(^|\.)google\.[a-z.]+$/.test(host) || host.includes("googlequicksearchbox") || host === "com.google.android.gm") return "google";
  if (/(^|\.)torob\.(com|ir)$/.test(host)) return "torob";
  if (/(^|\.)snapp[a-z]*\.[a-z.]+$/.test(host) || host.startsWith("cab.snapp")) return "snapp";
  if (/(^|\.)instagram\.com$/.test(host) || host.includes("com.instagram")) return "instagram";
  if (SEARCH_PATTERNS.some((rx) => rx.test(host))) return "other_search";
  if (SOCIAL_PATTERNS.some((rx) => rx.test(host))) return "social";
  return "referral";
}

// Maps a free-form utm_source onto a known channel when it clearly names one.
function channelForUtmSource(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "campaign";
  if (/google|adwords|gads/.test(v)) return "google";
  if (/torob/.test(v)) return "torob";
  if (/snapp/.test(v)) return "snapp";
  if (/^ig$|insta/.test(v)) return "instagram";
  if (/bing|yahoo|yandex|duckduckgo|zarebin|parsijoo/.test(v)) return "other_search";
  if (/facebook|^fb$|telegram|twitter|linkedin|whatsapp|aparat|eitaa|rubika|bale|tiktok|youtube/.test(v)) return "social";
  return "campaign";
}

const DEFAULT_MEDIUM = {
  google: "organic",
  other_search: "organic",
  instagram: "social",
  social: "social",
  torob: "referral",
  snapp: "referral",
  referral: "referral",
  campaign: "campaign",
  direct: "(none)",
};

function readQuery(query, key) {
  const value = query && query[key];
  return clip(Array.isArray(value) ? value[0] : value, 100);
}

/**
 * Classifies one page request.
 * Returns { touch: object|null, entry: boolean, internal: boolean, gateway: boolean }.
 * `touch` is null for internal navigation and payment-gateway returns.
 */
function classifyRequest({ query = {}, referer = "", path = "/", ownHosts = [], now = new Date() } = {}) {
  const own = new Set(ownHosts.map(normalizeHost).filter(Boolean));
  const refHost = hostOf(referer);
  const landingPage = clip(path, 200) || "/";
  const base = { referrerHost: refHost && !own.has(refHost) ? refHost : "", landingPage, at: now };

  const utmSource = readQuery(query, "utm_source");
  if (utmSource) {
    return {
      entry: true,
      internal: false,
      gateway: false,
      touch: {
        ...base,
        source: channelForUtmSource(utmSource),
        medium: readQuery(query, "utm_medium") || "campaign",
        campaign: readQuery(query, "utm_campaign"),
        content: readQuery(query, "utm_content"),
        term: readQuery(query, "utm_term"),
        utmSource,
      },
    };
  }

  if (readQuery(query, "gclid") || readQuery(query, "gbraid") || readQuery(query, "wbraid")) {
    return { entry: true, internal: false, gateway: false, touch: { ...base, source: "google", medium: "cpc" } };
  }

  if (refHost) {
    if (own.has(refHost)) return { entry: false, internal: true, gateway: false, touch: null };
    if (isGatewayHost(refHost)) return { entry: false, internal: false, gateway: true, touch: null };
    const source = channelForHost(refHost);
    return { entry: true, internal: false, gateway: false, touch: { ...base, source, medium: DEFAULT_MEDIUM[source] || "referral" } };
  }

  return { entry: true, internal: false, gateway: false, touch: { ...base, source: "direct", medium: "(none)" } };
}

// ---------------------------------------------------------------- cookie (signed)
const secret = () => process.env.ATTRIBUTION_SECRET || process.env.SESSION_SECRET || "odour-attribution";
const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 22);

const TOUCH_KEYS = { s: "source", m: "medium", c: "campaign", n: "content", t: "term", u: "utmSource", r: "referrerHost", l: "landingPage" };
const LIMITS = { source: 20, medium: 60, campaign: 100, content: 100, term: 100, utmSource: 100, referrerHost: 120, landingPage: 200 };

function compactTouch(touch) {
  if (!touch) return null;
  const out = {};
  for (const [short, long] of Object.entries(TOUCH_KEYS)) {
    if (touch[long]) out[short] = clip(touch[long], LIMITS[long]);
  }
  out.a = Math.floor(new Date(touch.at || Date.now()).getTime() / 1000);
  return out;
}

function expandTouch(compact) {
  if (!compact || typeof compact !== "object") return null;
  const touch = {};
  for (const [short, long] of Object.entries(TOUCH_KEYS)) {
    if (compact[short]) touch[long] = clip(compact[short], LIMITS[long]);
  }
  if (!CHANNELS[touch.source]) return null;
  const at = Number(compact.a);
  touch.at = Number.isFinite(at) && at > 0 ? new Date(at * 1000) : null;
  return touch;
}

function encodeCookie(state) {
  const payload = Buffer.from(JSON.stringify({ f: compactTouch(state.firstTouch), l: compactTouch(state.lastTouch) })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeCookie(value) {
  if (!value || typeof value !== "string" || value.length > 3000) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const firstTouch = expandTouch(data.f);
    const lastTouch = expandTouch(data.l);
    return firstTouch || lastTouch ? { firstTouch: firstTouch || lastTouch, lastTouch: lastTouch || firstTouch } : null;
  } catch (_) {
    return null;
  }
}

// Applies a new touch to the stored state using the documented model.
function mergeTouch(state, touch) {
  if (!touch) return state;
  if (!state) return { firstTouch: touch, lastTouch: touch };
  const keepPrevious = touch.source === "direct" && state.lastTouch && state.lastTouch.source !== "direct";
  return { firstTouch: state.firstTouch || touch, lastTouch: keepPrevious ? state.lastTouch : touch };
}

function getCookie(req, name) {
  const header = String((req && req.headers && req.headers.cookie) || "");
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    if (pair.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(pair.slice(index + 1).trim());
      } catch (_) {
        return "";
      }
    }
  }
  return "";
}

function readAttribution(req) {
  return decodeCookie(getCookie(req, COOKIE_NAME));
}

// Snapshot stored on orders/users. Undefined when nothing was tracked.
function acquisitionSnapshot(req) {
  try {
    const state = readAttribution(req);
    if (!state) return undefined;
    return { firstTouch: state.firstTouch, lastTouch: state.lastTouch, model: MODEL, capturedAt: new Date() };
  } catch (_) {
    return undefined;
  }
}

function ownHostsFor(req) {
  const hosts = [req.get && req.get("host"), "odour.ir"];
  for (const url of [process.env.SITE_URL, process.env.SITE_BASE_URL]) {
    if (url) hosts.push(hostOf(url));
  }
  return hosts;
}

/**
 * Express middleware for storefront page views (GET, not /admin, not /api, no file
 * extension). Sets req.attribution = { entry, touch } for the visit logger and keeps
 * the attribution cookie up to date. Never throws.
 */
function attributionMiddleware(req, res, next) {
  try {
    if (
      req.method === "GET" &&
      !req.path.startsWith("/admin") &&
      !req.path.startsWith("/api") &&
      !req.path.includes(".")
    ) {
      const result = classifyRequest({
        query: req.query,
        referer: req.headers.referer || req.headers.referrer || "",
        path: req.path,
        ownHosts: ownHostsFor(req),
      });
      req.attribution = result;
      if (result.touch) {
        const current = readAttribution(req);
        const next = mergeTouch(current, result.touch);
        // Skip rewriting the cookie for repeated direct hits that change nothing.
        if (!current || next.lastTouch !== current.lastTouch || next.firstTouch !== current.firstTouch) {
          res.cookie(COOKIE_NAME, encodeCookie(next), {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: COOKIE_MAX_AGE_MS,
            path: "/",
          });
        }
      }
    }
  } catch (error) {
    console.error("Attribution tracking error:", error.message);
  }
  next();
}

// Fields stored on a Visit document for the current request.
function visitFields(req) {
  const a = req && req.attribution;
  if (!a) return {};
  if (!a.touch) return { entry: false, source: a.gateway ? "gateway" : "internal" };
  return {
    entry: true,
    source: a.touch.source,
    medium: a.touch.medium || "",
    campaign: a.touch.campaign || "",
    utmSource: a.touch.utmSource || "",
    referrerHost: a.touch.referrerHost || "",
  };
}

// Classification of a stored historical Visit (used by the back-fill script).
function classifyStoredVisit(visit, ownHosts) {
  let query = {};
  try {
    const url = new URL(String(visit.title || visit.path || "/"), "https://placeholder.local");
    query = Object.fromEntries(url.searchParams.entries());
  } catch (_) {}
  const result = classifyRequest({ query, referer: visit.referer || "", path: visit.path, ownHosts, now: visit.visitTimestamp || new Date() });
  return visitFields({ attribution: result });
}

module.exports = {
  COOKIE_NAME,
  MODEL,
  CHANNELS,
  classifyRequest,
  channelForHost,
  channelForUtmSource,
  isGatewayHost,
  mergeTouch,
  encodeCookie,
  decodeCookie,
  readAttribution,
  acquisitionSnapshot,
  attributionMiddleware,
  visitFields,
  classifyStoredVisit,
  hostOf,
};
