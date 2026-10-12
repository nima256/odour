"use strict";
// Small, pure helpers shared by the admin JSON API (routes/adminApi.js).

const TZ = "Asia/Tehran";
// Iran has had no daylight-saving time since 2022, so the offset is fixed.
const TZ_OFFSET = "+03:30";
const DAY_MS = 24 * 60 * 60 * 1000;

const PAID = "پرداخت شده";
const CANCELLED = "لغو شده";
// A "successful sale": payment confirmed and the order not cancelled afterwards.
const SUCCESS_MATCH = { paymentStatus: PAID, status: { $ne: CANCELLED } };

function parsePaging(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(Number(query.limit) || defaultLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

function pageMeta({ page, limit }, total) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Persian/Arabic digits → ASCII, trimmed and length-limited search text.
function cleanSearch(value, max = 80) {
  return String(value == null ? "" : value)
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .trim()
    .slice(0, max);
}

// "YYYY-MM-DD" of `date` in Tehran.
function tehranDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const startOfTehranDay = (day) => new Date(`${day}T00:00:00${TZ_OFFSET}`);
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(startOfTehranDay(value).getTime());

/**
 * Date range from ?from=YYYY-MM-DD&to=YYYY-MM-DD (Tehran calendar days, inclusive) or
 * ?days=N (last N days including today). Returns { from, to (exclusive), fromDay, toDay, days }.
 */
function parseRange(query = {}, { defaultDays = 30, maxDays = 731, now = new Date() } = {}) {
  const today = tehranDay(now);
  let toDay = isDay(query.to) ? query.to : today;
  let fromDay;
  if (isDay(query.from)) {
    fromDay = query.from;
  } else {
    const days = Math.min(maxDays, Math.max(1, Math.floor(Number(query.days) || defaultDays)));
    fromDay = tehranDay(new Date(startOfTehranDay(toDay).getTime() - (days - 1) * DAY_MS + 12 * 60 * 60 * 1000));
  }
  if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
  let from = startOfTehranDay(fromDay);
  const to = new Date(startOfTehranDay(toDay).getTime() + DAY_MS);
  if (to - from > maxDays * DAY_MS) {
    from = new Date(to.getTime() - maxDays * DAY_MS);
    fromDay = tehranDay(from);
  }
  return { from, to, fromDay, toDay, days: Math.round((to - from) / DAY_MS) };
}

// Every Tehran day in the range, for gap-free chart series.
function daysBetween(range) {
  const out = [];
  for (let t = range.from.getTime() + 12 * 60 * 60 * 1000; t < range.to.getTime(); t += DAY_MS) {
    out.push(tehranDay(new Date(t)));
  }
  return out;
}

// $dateToString expression grouping a date field by Tehran calendar day.
const dayExpr = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: field, timezone: TZ } });

const bool = (value) => value === true || value === "true" || value === "1" || value === 1;

module.exports = {
  TZ,
  PAID,
  CANCELLED,
  SUCCESS_MATCH,
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
};
