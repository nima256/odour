"use strict";

// Safe default until the SnappPay online gateway is officially activated.
// After activation set SNAPPAY_CHECKOUT_MODE=online in the hosting environment
// and restart the app. All other values intentionally keep contact-only mode.
const getSnappPayCheckoutMode = () =>
  String(process.env.SNAPPAY_CHECKOUT_MODE || "contact").trim().toLowerCase() === "online"
    ? "online"
    : "contact";

const snappPaySupportPhone = "09965851584";
const snappPaySupportPhoneDisplay = "۰۹۹۶۵۸۵۱۵۸۴";
const snappPaySupportPhoneTel = "+989965851584";

module.exports = {
  getSnappPayCheckoutMode,
  snappPaySupportPhone,
  snappPaySupportPhoneDisplay,
  snappPaySupportPhoneTel,
};
