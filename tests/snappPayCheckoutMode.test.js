"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getSnappPayCheckoutMode,
  snappPaySupportPhone,
  snappPaySupportPhoneDisplay,
  snappPaySupportPhoneTel,
} = require("../services/snappPayCheckoutMode");

test("SnappPay checkout defaults to contact and fails closed for unknown values", () => {
  const original = process.env.SNAPPAY_CHECKOUT_MODE;
  try {
    for (const value of [undefined, "", "pending", "disabled", "false", "CONTACT"]) {
      if (value === undefined) delete process.env.SNAPPAY_CHECKOUT_MODE;
      else process.env.SNAPPAY_CHECKOUT_MODE = value;
      assert.equal(getSnappPayCheckoutMode(), "contact");
    }
    process.env.SNAPPAY_CHECKOUT_MODE = "online";
    assert.equal(getSnappPayCheckoutMode(), "online");
    process.env.SNAPPAY_CHECKOUT_MODE = " ONLINE ";
    assert.equal(getSnappPayCheckoutMode(), "online");
  } finally {
    if (original === undefined) delete process.env.SNAPPAY_CHECKOUT_MODE;
    else process.env.SNAPPAY_CHECKOUT_MODE = original;
  }
});

test("Support number is correct for both display and click-to-call", () => {
  assert.equal(snappPaySupportPhone, "09965851584");
  assert.equal(snappPaySupportPhoneDisplay, "۰۹۹۶۵۸۵۱۵۸۴");
  assert.equal(snappPaySupportPhoneTel, "+989965851584");
});
