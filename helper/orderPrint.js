"use strict";

// Printable order documents deliberately read from the order's purchase-time
// snapshots. The current product catalogue may have different names or prices.
const digits = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
const persianDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const money = (value) => digits.format(Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
const valueOrDash = (value) => String(value ?? "").trim() || "—";
const nonNegative = (value) => Math.max(0, Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : persianDate.format(date);
};

function buildOrderPrintData(order, kind) {
  if (!["invoice", "packing"].includes(kind)) throw new Error("Invalid print kind");

  const items = (order.products || []).map((item, index) => {
    const quantity = nonNegative(item.quantity);
    const unitPrice = nonNegative(item.priceAtPurchase);
    const originalUnitPrice = nonNegative(item.originalUnitPrice);
    // Some older rows contain only variant IDs. Prefer the purchase-time
    // labels; use the current variant catalogue only when snapshots are empty.
    const colorFromId = (item.product?.colors || []).find(
      (c) => String(c._id) === String(item.selectedVariantId || "")
    );
    const sizeFromId = (item.product?.sizes || []).find(
      (s) => String(s._id) === String(item.selectedSizeId || "")
    );
    return {
      row: index + 1,
      name: valueOrDash(item.nameAtPurchase || item.product?.name),
      sku: valueOrDash(item.product?.sku),
      color: String(item.selectedColor || colorFromId?.name || "").trim(),
      size: String(item.selectedSize || sizeFromId?.size || "").trim(),
      quantity,
      unitPrice,
      originalUnitPrice: originalUnitPrice > unitPrice ? originalUnitPrice : null,
      subtotal: quantity * unitPrice,
    };
  });
  const itemsSum = items.reduce((sum, item) => sum + item.subtotal, 0);
  const tax = nonNegative(order.taxAmount);
  const discount = nonNegative(order.discountAmount ?? order.discount?.calculatedAmount);
  const external = nonNegative(order.externalSourceAmount);
  const total = nonNegative(order.totalPrice);
  // Historical orders may contain manual corrections/partial refunds. We must
  // show the saved order total rather than quietly recalculate another amount.
  const difference = total - (itemsSum + tax - discount - external);
  const user = order.user && typeof order.user === "object" ? order.user : {};
  return {
    kind,
    invoice: kind === "invoice",
    orderNumber: valueOrDash(order.OrderNum),
    orderDate: formatDate(order.createdAt),
    printedAt: formatDate(new Date()),
    customer: valueOrDash(user.fullName || order.recipientName),
    customerMobile: valueOrDash(user.mobile || order.recipientMobile),
    recipient: valueOrDash(order.recipientName || user.fullName),
    recipientMobile: valueOrDash(order.recipientMobile || user.mobile),
    province: String(order.province || "").trim(),
    city: String(order.city || "").trim(),
    address: valueOrDash(order.address),
    postcode: valueOrDash(order.postcode),
    delivery: valueOrDash(order.delivery).replaceAll("-", " "),
    trackingNumber: valueOrDash(order.trackingNumber),
    paymentMethod: valueOrDash(order.paymentMethod),
    paymentStatus: valueOrDash(order.paymentStatus),
    status: valueOrDash(order.status),
    items,
    quantityTotal: items.reduce((sum, item) => sum + item.quantity, 0),
    itemsSum,
    tax,
    discount,
    external,
    difference,
    total,
    discountCode: String(order.discount?.code || "").trim(),
    formatMoney: money,
    formatQty: money,
  };
}

module.exports = { buildOrderPrintData, formatDate, money };
