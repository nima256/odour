"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOrderPrintData, formatDate, money } = require("../helper/orderPrint");

const makeOrder = () => ({
  OrderNum: "OD-2026-00019",
  createdAt: new Date("2026-10-13T08:00:00.000Z"),
  user: { fullName: "خریدار اصلی", mobile: "09121111111" },
  recipientName: "گیرنده متفاوت",
  recipientMobile: "09122222222",
  province: "تهران",
  city: "تهران",
  address: "تهران، خیابان تست، پلاک ۱۲",
  postcode: "1234567890",
  delivery: "تیپاکس",
  trackingNumber: "TRACK-42",
  paymentMethod: "ترب‌پی",
  paymentStatus: "پرداخت شده",
  status: "بسته بندی شده",
  products: [
    {
      nameAtPurchase: "عطر قدیمی و معتبر",
      product: { name: "عطر جدید متفاوت", sku: "OT-01" },
      quantity: 2,
      priceAtPurchase: 540000,
      originalUnitPrice: 600000,
      selectedColor: "طلایی",
      selectedSize: "۵۰ میل",
    },
    { nameAtPurchase: "عطر دوم", product: null, quantity: 1, priceAtPurchase: 240000, selectedSize: "۱۰۰ میل" },
  ],
  discountAmount: 100000,
  taxAmount: 10000,
  externalSourceAmount: 30000,
  totalPrice: 1200000,
  paymentInfo: { returnSessionTokenHash: "SECRET" },
});

test("invoice prints purchase-time prices/variants and reconciles to the saved amount", () => {
  const data = buildOrderPrintData(makeOrder(), "invoice");
  assert.equal(data.invoice, true);
  assert.equal(data.items[0].name, "عطر قدیمی و معتبر");
  assert.equal(data.items[0].color, "طلایی");
  assert.equal(data.items[0].size, "۵۰ میل");
  assert.equal(data.items[0].sku, "OT-01");
  assert.equal(data.items[0].subtotal, 1080000);
  assert.equal(data.items[0].originalUnitPrice, 600000);
  assert.equal(data.items[1].name, "عطر دوم");
  assert.equal(data.quantityTotal, 3);
  assert.equal(data.itemsSum, 1320000);
  assert.equal(data.discount, 100000);
  assert.equal(data.tax, 10000);
  assert.equal(data.external, 30000);
  assert.equal(data.difference, 0);
  assert.equal(data.total, 1200000);
  assert.equal(data.recipient, "گیرنده متفاوت");
  assert.equal(data.customer, "خریدار اصلی");
  assert.equal(data.recipientMobile, "09122222222");
  assert.equal(data.postcode, "1234567890");
  assert.ok(data.orderDate.includes("۱۴۰۵") || data.orderDate.includes("1405"));
  assert.ok(!JSON.stringify(data).includes("SECRET"));
});

test("packing slip contains the same purchased items, quantities and recipient", () => {
  const data = buildOrderPrintData(makeOrder(), "packing");
  assert.equal(data.invoice, false);
  assert.equal(data.items[0].name, "عطر قدیمی و معتبر");
  assert.equal(data.items[0].quantity, 2);
  assert.equal(data.quantityTotal, 3);
  assert.equal(data.trackingNumber, "TRACK-42");
  assert.equal(data.recipient, "گیرنده متفاوت");
});

test("archived orders can be printed even after a product or user is deleted", () => {
  const order = makeOrder();
  order.user = null;
  order.products[0].product = null;
  order.totalPrice = 1100000;
  const d = buildOrderPrintData(order, "invoice");
  assert.equal(d.customer, "گیرنده متفاوت");
  assert.equal(d.items[0].name, "عطر قدیمی و معتبر");
  assert.equal(d.difference, -100000);
});

test("legacy orders with only variant IDs resolve their color and size", () => {
  const order = makeOrder();
  order.products[0].selectedColor = null;
  order.products[0].selectedSize = null;
  order.products[0].selectedVariantId = "color-id";
  order.products[0].selectedSizeId = "size-id";
  order.products[0].product.colors = [{ _id: "color-id", name: "نقره‌ای" }];
  order.products[0].product.sizes = [{ _id: "size-id", size: "۱۰۰ میل" }];
  const data = buildOrderPrintData(order, "packing");
  assert.equal(data.items[0].color, "نقره‌ای");
  assert.equal(data.items[0].size, "۱۰۰ میل");
});

test("invalid print types are rejected, dates and currency are safely formatted", () => {
  assert.throws(() => buildOrderPrintData(makeOrder(), "invalid"));
  assert.equal(formatDate("invalid"), "—");
  assert.equal(money(NaN), "۰");
});
