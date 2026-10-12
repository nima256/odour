const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../helper/attribution");

const own = ["www.odour.ir", "odour.ir"];
const classify = (referer, query = {}, path = "/") => A.classifyRequest({ referer, query, path, ownHosts: own });

test("referrer hosts map to the documented channels", () => {
  assert.equal(classify("https://www.google.com/").touch.source, "google");
  assert.equal(classify("https://www.google.co.uk/search?q=x").touch.source, "google");
  assert.equal(classify("android-app://com.google.android.googlequicksearchbox/").touch.source, "google");
  assert.equal(classify("https://torob.com/p/123/").touch.source, "torob");
  assert.equal(classify("https://snapp.market/").touch.source, "snapp");
  assert.equal(classify("https://l.instagram.com/?u=x").touch.source, "instagram");
  assert.equal(classify("https://www.bing.com/").touch.source, "other_search");
  assert.equal(classify("https://t.me/odour").touch.source, "social");
  assert.equal(classify("https://blog.example.com/post").touch.source, "referral");
  assert.equal(classify("https://blog.example.com/post").touch.referrerHost, "blog.example.com");
  assert.equal(classify("").touch.source, "direct");
});

test("payment gateways and internal navigation are never acquisition touches", () => {
  for (const ref of [
    "https://www.zarinpal.com/pg/StartPay/x",
    "https://sep.shaparak.ir/",
    "https://api.snapppay.ir/payment",
    "https://fe.snapppay.ir/",
    "https://torobpay.com/checkout",
  ]) {
    const result = classify(ref);
    assert.equal(result.touch, null, ref);
    assert.equal(result.gateway, true, ref);
  }
  const internal = classify("https://www.odour.ir/shop");
  assert.equal(internal.touch, null);
  assert.equal(internal.internal, true);
});

test("UTM parameters win over the referrer and are kept verbatim", () => {
  const r = classify("https://www.google.com/", { utm_source: "instagram", utm_medium: "story", utm_campaign: "yalda", utm_content: "v1", utm_term: "perfume" }, "/shop");
  assert.equal(r.touch.source, "instagram");
  assert.equal(r.touch.medium, "story");
  assert.equal(r.touch.campaign, "yalda");
  assert.equal(r.touch.content, "v1");
  assert.equal(r.touch.term, "perfume");
  assert.equal(r.touch.landingPage, "/shop");
  assert.equal(classify("", { utm_source: "newsletter" }).touch.source, "campaign");
  assert.equal(classify("", { gclid: "abc" }).touch.source, "google");
  assert.equal(classify("", { gclid: "abc" }).touch.medium, "cpc");
});

test("first touch is kept and direct visits do not overwrite the last real source", () => {
  const google = classify("https://www.google.com/").touch;
  const torob = classify("https://torob.com/").touch;
  const direct = classify("").touch;
  let state = A.mergeTouch(null, google);
  state = A.mergeTouch(state, direct);
  assert.equal(state.firstTouch.source, "google");
  assert.equal(state.lastTouch.source, "google");
  state = A.mergeTouch(state, torob);
  assert.equal(state.firstTouch.source, "google");
  assert.equal(state.lastTouch.source, "torob");
  // A browser whose only touch was direct gets upgraded by a later real source.
  let d = A.mergeTouch(null, direct);
  d = A.mergeTouch(d, torob);
  assert.equal(d.firstTouch.source, "direct");
  assert.equal(d.lastTouch.source, "torob");
});

test("attribution cookie is signed, sanitised and round-trips", () => {
  const touch = classify("https://torob.com/", { utm_source: "torob", utm_campaign: "<script>x" }).touch;
  const value = A.encodeCookie({ firstTouch: touch, lastTouch: touch });
  const decoded = A.decodeCookie(value);
  assert.equal(decoded.firstTouch.source, "torob");
  assert.equal(decoded.lastTouch.campaign, "scriptx");
  // Tampering invalidates the cookie instead of producing fake data.
  const [payload, mac] = value.split(".");
  const forged = Buffer.from(JSON.stringify({ f: { s: "google", a: 1 }, l: null })).toString("base64url");
  assert.equal(A.decodeCookie(`${forged}.${mac}`), null);
  assert.equal(A.decodeCookie(`${payload}.AAAA`), null);
  assert.equal(A.decodeCookie("garbage"), null);
});

test("order snapshot reads the cookie and is undefined when not tracked", () => {
  const touch = classify("https://www.google.com/").touch;
  const cookie = `${A.COOKIE_NAME}=${encodeURIComponent(A.encodeCookie({ firstTouch: touch, lastTouch: touch }))}`;
  const snap = A.acquisitionSnapshot({ headers: { cookie: `a=1; ${cookie}` } });
  assert.equal(snap.firstTouch.source, "google");
  assert.equal(snap.model, A.MODEL);
  assert.equal(A.acquisitionSnapshot({ headers: {} }), undefined);
});

test("middleware sets the cookie for entries and records visit fields", () => {
  const cookies = [];
  const req = {
    method: "GET",
    path: "/productDetails/x",
    query: { utm_source: "torob" },
    headers: { referer: "https://torob.com/" },
    get: (h) => (h === "host" ? "www.odour.ir" : undefined),
  };
  const res = { cookie: (name, value, opts) => cookies.push({ name, value, opts }) };
  let called = false;
  A.attributionMiddleware(req, res, () => (called = true));
  assert.ok(called);
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].opts.httpOnly, true);
  assert.deepEqual(A.visitFields(req).source, "torob");
  assert.equal(A.visitFields(req).entry, true);

  const adminReq = { ...req, path: "/admin", attribution: undefined };
  A.attributionMiddleware(adminReq, res, () => {});
  assert.equal(adminReq.attribution, undefined);
});

test("stored historical visits are classified from their recorded referer only", () => {
  assert.deepEqual(A.classifyStoredVisit({ path: "/", title: "/", referer: "https://www.google.com/" }, own).source, "google");
  assert.equal(A.classifyStoredVisit({ path: "/shop", title: "/shop", referer: "https://www.odour.ir/" }, own).entry, false);
  assert.equal(A.classifyStoredVisit({ path: "/", title: "/?utm_source=instagram", referer: "" }, own).source, "instagram");
});
