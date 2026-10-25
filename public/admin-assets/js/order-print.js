/* Odour admin add-on: print controls for the v2 order-detail view.
 * It deliberately does not depend on the internals of the existing orders.js;
 * it observes the already-authenticated order detail request instead.
 */
(function () {
  "use strict";

  if (!window.fetch || !document.getElementById("ox-main")) return;
  var boot = document.getElementById("ox-boot");
  try {
    var meta = JSON.parse(boot && boot.textContent || "{}");
    if (!Array.isArray(meta.permissions) || !meta.permissions.includes("manage_orders")) return;
  } catch (_) { return; }

  var current = null;
  var matchedContainer = null;
  var toolbar = null;
  var scheduled = false;
  var apiPattern = /^\/admin\/api\/v2\/orders\/([0-9a-f]{24})\/?$/i;
  var originalFetch = window.fetch;

  var css = document.createElement("style");
  css.textContent =
    '.ox-order-print-tools{display:flex;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:8px;padding:12px;margin:10px 0;border:1px solid #d5dbca;border-radius:10px;background:#f4f6eb;direction:rtl;font:500 13px Vazirmatn,Tahoma,sans-serif;box-sizing:border-box;z-index:5}' +
    '.ox-order-print-tools .ox-print-label{font-size:12px;color:#586349;margin-left:auto}' +
    '.ox-order-print-tools a{display:inline-flex;align-items:center;gap:5px;padding:8px 12px;border-radius:7px;font:600 13px Vazirmatn,Tahoma,sans-serif;text-decoration:none!important;border:1px solid #4c593a;background:#4c593a;color:white!important;white-space:nowrap}' +
    '.ox-order-print-tools a:last-child{color:#35452e!important;background:#fff;border-color:#bdc9af}' +
    '.ox-order-print-tools.ox-print-floating{position:fixed;bottom:20px;left:20px;right:20px;max-width:490px;z-index:100000;box-shadow:0 8px 30px #1b231b2b}' +
    '@media(max-width:540px){.ox-order-print-tools.ox-print-floating{bottom:82px;left:12px;right:12px;padding:10px}.ox-order-print-tools .ox-print-label{flex-basis:100%}}';
  document.head.appendChild(css);

  function link(label, kind, id) {
    var a = document.createElement("a");
    a.href = "/admin/orders/" + encodeURIComponent(id) + "/print/" + kind + "?autoprint=1";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label;
    a.setAttribute("aria-label", label + " سفارش " + current.number);
    return a;
  }

  function removeToolbar() {
    if (toolbar) toolbar.remove();
    toolbar = null;
    matchedContainer = null;
  }

  function clearOrder() {
    current = null;
    removeToolbar();
  }

  function visible(node) {
    return node && node.isConnected && node.getClientRects().length > 0 &&
      window.getComputedStyle(node).visibility !== "hidden";
  }

  function findDetailPanel() {
    var panels = document.querySelectorAll(
      '[role="dialog"],.ox-modal,.ox-modal__dialog,.ox-dialog,.ox-drawer,.ox-sheet,[data-order-detail]'
    );
    for (var i = panels.length - 1; i >= 0; i--) {
      var pane = panels[i];
      if (!visible(pane)) continue;
      // Ignore our own controls when deciding whether this is still the
      // active order; otherwise a reused dialog could retain stale buttons.
      var paneText = pane.textContent || "";
      if (toolbar) paneText = paneText.replace(toolbar.textContent || "", "");
      if (paneText.includes(current.number)) return pane;
    }
    // Some versions render order details directly inside the SPA's main element.
    var main = document.getElementById("ox-main");
    if (main && visible(main) && /سفارش|Order/i.test(main.textContent || "") &&
        (main.textContent || "").includes(current.number) &&
        (location.hash || "").startsWith("#/orders/")) return main;
    return null;
  }

  function sync() {
    if (!current) return;
    if (location.hash && !location.hash.startsWith("#/orders") &&
        !location.hash.startsWith("#/dashboard")) { clearOrder(); return; }
    var pane = findDetailPanel();
    if (matchedContainer && !visible(matchedContainer) && !pane) {
      clearOrder();
      return;
    }
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "ox-order-print-tools";
      toolbar.dataset.printOrderId = current.id;
      toolbar.setAttribute("role", "group");
      toolbar.setAttribute("aria-label", "چاپ مدارک سفارش");
      var title = document.createElement("span");
      title.className = "ox-print-label";
      title.textContent = "چاپ سفارش «" + current.number + "»";
      toolbar.appendChild(title);
      toolbar.appendChild(link("چاپ برگه بسته‌بندی", "packing", current.id));
      toolbar.appendChild(link("چاپ فاکتور", "invoice", current.id));
    }
    if (pane) {
      matchedContainer = pane;
      toolbar.classList.remove("ox-print-floating");
      if (toolbar.parentElement !== pane) {
        // The buttons live in the actual detail pane and remain visible when
        // the order component redraws its contents.
        pane.appendChild(toolbar);
      }
    } else if (!matchedContainer) {
      // Fallback for SPA versions whose detail panel uses an unknown selector.
      toolbar.classList.add("ox-print-floating");
      if (toolbar.parentElement !== document.body) document.body.appendChild(toolbar);
    }
  }

  function scheduleSync() {
    if (scheduled || !current) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      sync();
    });
  }

  function activate(order) {
    if (!order || !/^[a-f0-9]{24}$/i.test(String(order._id || ""))) return;
    removeToolbar();
    current = { id: String(order._id), number: String(order.OrderNum || "") };
    scheduleSync();
  }

  window.fetch = function (input, init) {
    var result = originalFetch.apply(this, arguments);
    var raw = typeof input === "string" ? input : (input && input.url);
    if (!raw) return result;
    var url;
    try { url = new URL(raw, window.location.href); } catch (_) { return result; }
    if (url.origin !== window.location.origin || !apiPattern.test(url.pathname)) return result;
    result.then(function (response) {
      if (!response.ok) return;
      response.clone().json().then(function (data) {
        if (data && data.success && data.order && String(data.order._id) === url.pathname.match(apiPattern)[1]) {
          activate(data.order);
        }
      }).catch(function () {});
    }).catch(function () {});
    return result;
  };

  new MutationObserver(scheduleSync).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
  window.addEventListener("hashchange", function () {
    if (!location.hash.startsWith("#/orders")) clearOrder();
    else scheduleSync();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") requestAnimationFrame(scheduleSync);
  });
  document.addEventListener("click", function (event) {
    if (!current || !event.target.closest) return;
    if (event.target.closest('[data-modal-close],[data-dialog-close],[aria-label="بستن"],.ox-modal__close,.ox-drawer__close')) {
      requestAnimationFrame(scheduleSync);
    }
  }, true);
})();
