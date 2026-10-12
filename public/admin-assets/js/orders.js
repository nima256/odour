/* Orders: filtered server-side list + detail drawer (status, tracking, gateway actions). */
(function () {
  "use strict";
  const { html, raw, set, $, $$, num, money, icon, api, router, dateTime, ago, orderBadge, payBadge, sourceBadge, channelLabel, busy, confirm, toast, fail, boot } = OA;

  const STATUSES = boot.orderStatuses || [];
  let listApi = null;
  let openDrawer = null;

  function render(el, { args }) {
    const channels = Object.keys(boot.channels || {});
    const q = router.query();
    set(el, html`${OA.pageHead("سفارش‌ها", "جستجو، پیگیری و پردازش سفارش‌ها", html`<button class="oa-btn" type="button" data-date>${icon("calendar", "oa-icon--sm")} <span data-date-label>${q.from ? `${OA.dayLong(q.from)} تا ${OA.dayLong(q.to)}` : q.days ? `${num(q.days)} روز اخیر` : "همه تاریخ‌ها"}</span></button>`)}<div data-list></div>`);
    listApi = OA.list($("[data-list]", el), {
      endpoint: "/orders",
      defaults: { status: "" },
      searchPlaceholder: "شماره سفارش، نام، موبایل، کد رهگیری…",
      tabs: {
        name: "status",
        countsKey: "statusCounts",
        options: [["", "همه"], ["needs_action", "نیازمند اقدام"], ...STATUSES.map((s) => [s, s])],
        count: (counts, v) => (v === "" ? Object.values(counts).reduce((a, b) => a + b, 0) : v === "needs_action" ? (counts["در حال پردازش"] || 0) + (counts["بسته بندی شده"] || 0) : counts[v] || 0),
      },
      filters: [
        { name: "paymentStatus", label: "وضعیت پرداخت", options: [["", "همه پرداخت‌ها"], ...(boot.paymentStatuses || []).map((s) => [s, s])] },
        { name: "paymentMethod", label: "روش پرداخت", options: [["", "همه روش‌ها"], ...(boot.paymentMethods || []).map((s) => [s, s])] },
        { name: "delivery", label: "روش ارسال", options: [["", "همه روش‌های ارسال"], ...(boot.deliveryMethods || []).map((s) => [s, s.replace(/-/g, " ")])] },
        { name: "source", label: "منبع جذب", options: [["", "همه منابع"], ...channels.map((c) => [c, channelLabel(c)])] },
        { name: "sort", label: "مرتب‌سازی", options: [["newest", "جدیدترین"], ["oldest", "قدیمی‌ترین"], ["total_desc", "بیشترین مبلغ"], ["total_asc", "کمترین مبلغ"]] },
      ],
      columns: [
        { label: "سفارش", cls: "col-main", main: true, render: (o) => html`<span class="oa-cell-title num">${o.OrderNum}</span><span class="oa-cell-sub">${dateTime(o.createdAt)}</span>` },
        { label: "مشتری", render: (o) => html`<span class="oa-cell-title">${o.recipientName || o.user?.fullName || "—"}</span><span class="oa-cell-sub ltr">${o.recipientMobile || o.user?.mobile || ""}</span>` },
        { label: "اقلام", render: (o) => html`<span class="num">${num(o.itemsCount)}</span>` },
        { label: "مبلغ", render: (o) => html`<span class="num" style="font-weight:600">${money(o.totalPrice)}</span>` },
        { label: "وضعیت", render: (o) => orderBadge(o.status) },
        { label: "پرداخت", render: (o) => html`${payBadge(o.paymentStatus)}<span class="oa-cell-sub">${o.paymentMethod}</span>` },
        { label: "منبع", render: (o) => sourceBadge(o.source) },
      ],
      onRow: (o) => router.go("orders", [o._id], router.query()),
      empty: () => OA.empty("سفارشی با این مشخصات پیدا نشد", "فیلترها یا عبارت جستجو را تغییر دهید.", "bag"),
    });
    $("[data-date]", el).addEventListener("click", () => pickDates(el));
    if (args[0]) openOrder(args[0]);
  }

  function pickDates(el) {
    const q = router.query();
    let picked = q.from ? { from: q.from, to: q.to } : q.days ? { days: q.days } : null;
    const m = OA.modal({
      title: "بازه تاریخ سفارش",
      body: html`<div data-r></div><p class="oa-help" style="margin-top:12px">بازه بر اساس تاریخ ثبت سفارش (به وقت تهران) اعمال می‌شود.</p>`,
      foot: html`<button class="oa-btn" data-clear>همه تاریخ‌ها</button><button class="oa-btn oa-btn--primary" data-apply>اعمال</button>`,
    });
    OA.rangePicker($("[data-r]", m.el), picked || { days: "30" }, (r) => (picked = r));
    const apply = (r) => {
      ["from", "to", "days"].forEach((k) => delete listApi.state[k]);
      Object.assign(listApi.state, r || {});
      listApi.state.page = 1;
      $("[data-date-label]", el).textContent = r ? (r.from ? `${OA.dayLong(r.from)} تا ${OA.dayLong(r.to)}` : `${num(r.days)} روز اخیر`) : "همه تاریخ‌ها";
      listApi.reload();
      m.close(true);
    };
    $("[data-apply]", m.el).addEventListener("click", () => apply(picked || { days: "30" }));
    $("[data-clear]", m.el).addEventListener("click", () => apply(null));
  }

  // ------------------------------------------------------------- detail
  async function openOrder(id) {
    if (openDrawer) openDrawer.close(true);
    const d = OA.drawer({ title: "جزئیات سفارش", size: "oa-drawer--wide", body: OA.skeletonRows(6), onClose: () => { openDrawer = null; if (router.parse().args[0]) router.go("orders", [], router.query()); } });
    openDrawer = d;
    const load = async () => {
      try {
        const { order, activity } = await api(`/orders/${id}`);
        $("h2", d.el).textContent = `سفارش ${order.OrderNum}`;
        drawOrder(d, order, activity, load);
      } catch (e) {
        set(d.body, OA.errorBox(e, load));
      }
    };
    load();
  }

  const unit = (p) => Number(p.priceAtPurchase || 0);

  function drawOrder(d, o, activity, reload) {
    const items = o.products || [];
    const itemsTotal = items.reduce((s, p) => s + unit(p) * Number(p.quantity || 0), 0);
    const originalTotal = items.reduce((s, p) => s + Number(p.originalUnitPrice || p.priceAtPurchase || 0) * Number(p.quantity || 0), 0);
    const productDiscount = Math.max(0, originalTotal - itemsTotal);
    const gateway = o.paymentMethod === "اسنپ‌پی" ? "snappay" : o.paymentMethod === "ترب‌پی" ? "torobpay" : "";
    const g = gateway === "snappay" ? o.snappPay || {} : gateway === "torobpay" ? o.torobPay || {} : null;
    const acq = o.acquisition || null;
    const touch = (t) => (t ? html`<dl class="oa-kv"><dt>منبع</dt><dd>${channelLabel(t.source)}</dd><dt>Medium</dt><dd class="ltr">${t.medium || "—"}</dd>${t.campaign ? html`<dt>کمپین</dt><dd class="ltr">${t.campaign}</dd>` : ""}${t.referrerHost ? html`<dt>ارجاع‌دهنده</dt><dd class="ltr">${t.referrerHost}</dd>` : ""}<dt>صفحه ورود</dt><dd class="ltr">${t.landingPage || "—"}</dd><dt>زمان</dt><dd>${dateTime(t.at)}</dd></dl>` : html`<span class="oa-muted">—</span>`);

    const timeline = [
      { at: o.createdAt, title: "ثبت سفارش", sub: `${o.paymentMethod} · ${money(o.totalPrice)}` },
      ...(o.paymentInfo?.paymentDate ? [{ at: o.paymentInfo.paymentDate, title: "پرداخت تأیید شد", sub: o.paymentInfo.refId ? `کد پیگیری ${o.paymentInfo.refId}` : "" }] : []),
      ...(g?.settledAt ? [{ at: g.settledAt, title: "تسویه در درگاه", sub: gateway }] : []),
      ...(g?.cancelledAt ? [{ at: g.cancelledAt, title: "لغو در درگاه", sub: gateway }] : []),
      ...(o.statusHistory || []).map((h) => ({ at: h.changedAt, title: `وضعیت: ${h.status}`, sub: [h.changedByName && `توسط ${h.changedByName}`, h.note].filter(Boolean).join(" · ") })),
      ...((g?.updateHistory) || []).map((u) => ({ at: u.changedAt, title: "به‌روزرسانی مبلغ در درگاه", sub: `${money(Number(u.amount || 0) / 10)}` })),
      ...(activity || []).filter((a) => a.action === "update_order_shipping").map((a) => ({ at: a.createdAtTimestamp, title: "کد رهگیری", sub: `${a.details} · ${a.adminName}` })),
    ].filter((x) => x.at).sort((a, b) => new Date(b.at) - new Date(a.at));

    set(d.body, html`
      <div class="oa-inline" style="margin-bottom:16px;gap:10px">${orderBadge(o.status)}${payBadge(o.paymentStatus)}<span class="oa-badge oa-badge--plain">${o.paymentMethod}</span><span class="oa-muted" style="font-size:12.5px">${dateTime(o.createdAt)}</span></div>
      ${o.snappPay?.lastError || o.torobPay?.lastError ? html`<div class="oa-note oa-note--bad" style="margin-bottom:16px">${icon("alert")}<span>آخرین خطای درگاه: ${o.snappPay?.lastError || o.torobPay?.lastError}</span></div>` : ""}
      <div class="oa-grid oa-grid--main">
        <div class="oa-stack">
          <section class="oa-card"><div class="oa-card__head"><h3>اقلام سفارش</h3><small>${num(items.reduce((s, p) => s + Number(p.quantity || 0), 0))} عدد</small></div>
            <ul class="oa-list">${items.map((p) => html`<li>
              ${p.product?.image ? html`<img class="oa-thumb" src="${p.product.image}" alt="" loading="lazy">` : html`<div class="oa-thumb"></div>`}
              <div class="oa-list__main"><b>${p.nameAtPurchase}</b><span>${[p.selectedColor && `رنگ: ${p.selectedColor}`, p.selectedSize && `سایز: ${p.selectedSize}`, p.product?.sku && `SKU: ${p.product.sku}`].filter(Boolean).join(" · ") || "بدون تنوع"}${!p.product ? " · محصول حذف شده" : ""}</span></div>
              <div style="text-align:end"><div class="num">${num(p.quantity)} × ${money(unit(p))}</div>${p.hadProductDiscount && p.originalUnitPrice ? html`<div class="oa-muted num" style="font-size:12px;text-decoration:line-through">${money(p.originalUnitPrice)}</div>` : ""}</div>
            </li>`)}</ul>
            <div class="oa-card__body" style="border-top:1px solid var(--oa-border)"><dl class="oa-kv">
              <dt>جمع اقلام</dt><dd class="num">${money(itemsTotal)}</dd>
              ${productDiscount ? html`<dt>تخفیف محصولات</dt><dd class="num">${money(productDiscount)} (در قیمت اقلام لحاظ شده)</dd>` : ""}
              ${o.discountAmount ? html`<dt>کد تخفیف</dt><dd class="num oa-good">− ${money(o.discountAmount)} ${o.discount?.code ? html`<span class="oa-badge oa-badge--plain ltr">${o.discount.code}</span>` : ""}</dd>` : ""}
              ${o.taxAmount ? html`<dt>مالیات / کارمزد</dt><dd class="num">${money(o.taxAmount)}</dd>` : ""}
              ${o.externalSourceAmount ? html`<dt>پرداخت از منبع دیگر</dt><dd class="num">− ${money(o.externalSourceAmount)}</dd>` : ""}
              <dt>هزینه ارسال</dt><dd class="oa-muted">پس‌کرایه (در مبلغ آنلاین نیست)</dd>
              <dt><b>مبلغ نهایی</b></dt><dd class="num" style="font-weight:700;font-size:16px">${money(o.totalPrice)}</dd>
            </dl></div>
          </section>

          <section class="oa-card"><div class="oa-card__head"><h3>پرداخت</h3>${g ? html`<span class="oa-badge oa-badge--plain ltr">${g.status || "—"}</span>` : ""}</div><div class="oa-card__body">
            <dl class="oa-kv">
              <dt>روش</dt><dd>${o.paymentMethod}</dd>
              <dt>وضعیت</dt><dd>${payBadge(o.paymentStatus)}</dd>
              ${o.paymentInfo?.refId ? html`<dt>کد پیگیری</dt><dd class="ltr">${o.paymentInfo.refId}</dd>` : ""}
              ${o.paymentInfo?.authority ? html`<dt>Authority</dt><dd class="ltr" style="font-size:12px">${o.paymentInfo.authority}</dd>` : ""}
              ${o.paymentInfo?.cardPan ? html`<dt>کارت</dt><dd class="ltr">${o.paymentInfo.cardPan}</dd>` : ""}
              ${o.paymentInfo?.paymentDate ? html`<dt>زمان پرداخت</dt><dd>${dateTime(o.paymentInfo.paymentDate)}</dd>` : ""}
              ${g?.transactionId ? html`<dt>شناسه تراکنش</dt><dd class="ltr">${g.transactionId}</dd>` : ""}
              ${g?.lastStatusCheckAt ? html`<dt>آخرین استعلام</dt><dd>${dateTime(g.lastStatusCheckAt)}</dd>` : ""}
              <dt>موجودی</dt><dd>${o.inventoryRestored ? badge2("به انبار برگشت", "info") : o.inventoryReserved ? badge2("رزرو شده", "olive") : badge2("رزرو نشده", "")}</dd>
            </dl>
            ${g ? html`<div class="oa-inline" style="margin-top:16px">
              <button class="oa-btn oa-btn--sm" data-gw="sync">${icon("refresh", "oa-icon--sm")} استعلام وضعیت از ${o.paymentMethod}</button>
              <button class="oa-btn oa-btn--sm" data-gw="update">${icon("minus", "oa-icon--sm")} مرجوعی بخشی از اقلام</button>
              <button class="oa-btn oa-btn--sm oa-btn--danger" data-gw="cancel">${icon("x", "oa-icon--sm")} لغو کامل و عودت وجه</button>
            </div><p class="oa-help" style="margin:10px 0 0">این عملیات مستقیماً از طریق API ${o.paymentMethod} انجام می‌شود و وضعیت درگاه پیش از هر اقدام دوباره استعلام می‌گردد.</p>` : ""}
          </div></section>

          <section class="oa-card"><div class="oa-card__head"><h3>تاریخچه سفارش</h3></div><div class="oa-card__body">
            ${timeline.length ? html`<ol class="oa-timeline">${timeline.map((t) => html`<li><b>${t.title}</b><span>${dateTime(t.at)}${t.sub ? ` · ${t.sub}` : ""}</span></li>`)}</ol>` : html`<span class="oa-muted">—</span>`}
          </div></section>
        </div>

        <div class="oa-stack">
          <section class="oa-card"><div class="oa-card__head"><h3>پردازش سفارش</h3></div><div class="oa-card__body oa-stack" style="gap:12px">
            <label class="oa-field"><span>وضعیت سفارش</span><select class="oa-select" data-status>${STATUSES.map((s) => html`<option ${raw(s === o.status ? "selected" : "")}>${s}</option>`)}</select></label>
            <label class="oa-field"><span>یادداشت تغییر وضعیت (اختیاری)</span><input class="oa-input" data-note maxlength="300" placeholder="مثلاً: تحویل پست شد"></label>
            <button class="oa-btn oa-btn--primary" data-save-status>${icon("check", "oa-icon--sm")} ثبت وضعیت</button>
            <hr class="oa-divider" style="margin:4px 0">
            <label class="oa-field"><span>روش ارسال</span><input class="oa-input" value="${(o.delivery || "").replace(/-/g, " ")}" disabled></label>
            <label class="oa-field"><span>کد رهگیری مرسوله</span><input class="oa-input ltr" style="text-align:left" data-tracking maxlength="60" value="${o.trackingNumber || ""}"></label>
            <button class="oa-btn" data-save-tracking>${icon("truck", "oa-icon--sm")} ذخیره کد رهگیری</button>
          </div></section>

          <section class="oa-card"><div class="oa-card__head"><h3>مشتری و ارسال</h3>${o.user?._id && OA.can("manage_users") ? html`<a class="oa-link" href="#/customers/${o.user._id}">پروفایل</a>` : ""}</div><div class="oa-card__body"><dl class="oa-kv">
            <dt>حساب کاربری</dt><dd>${o.user?.fullName || "—"} <span class="ltr oa-muted">${o.user?.mobile || ""}</span></dd>
            <dt>تحویل‌گیرنده</dt><dd>${o.recipientName || "—"}</dd>
            <dt>موبایل گیرنده</dt><dd class="ltr">${o.recipientMobile || "—"}</dd>
            <dt>استان / شهر</dt><dd>${[o.province, o.city].filter(Boolean).join("، ") || "—"}</dd>
            <dt>آدرس</dt><dd>${o.address}</dd>
            <dt>کد پستی</dt><dd class="ltr">${o.postcode}</dd>
          </dl></div></section>

          <section class="oa-card"><div class="oa-card__head"><h3>منبع جذب</h3>${acq ? "" : html`<span class="oa-badge oa-badge--plain">${channelLabel("unknown")}</span>`}</div><div class="oa-card__body">
            ${acq ? html`<div class="oa-stack" style="gap:14px"><div><div class="oa-label" style="margin-bottom:6px">آخرین منبع غیرمستقیم</div>${touch(acq.lastTouch)}</div><hr class="oa-divider" style="margin:0"><div><div class="oa-label" style="margin-bottom:6px">اولین منبع</div>${touch(acq.firstTouch)}</div></div>`
              : html`<p class="oa-muted" style="margin:0;font-size:13px">برای این سفارش اطلاعات ردیابی ثبت نشده است (سفارش‌های پیش از فعال‌سازی ردیابی، یا مرورگری که کوکی را نپذیرفته).</p>`}
          </div></section>
        </div>
      </div>`);

    $("[data-save-status]", d.body).addEventListener("click", async (e) => {
      const status = $("[data-status]", d.body).value;
      if (status === o.status) return toast("وضعیت تغییری نکرده است", "error");
      const warn = status === "لغو شده" ? "لغو دستی سفارش وجه را بازنمی‌گرداند و موجودی را به انبار برنمی‌گرداند. برای سفارش‌های پرداخت‌شده اسنپ‌پی/ترب‌پی از دکمه لغو درگاه استفاده کنید." : "";
      if (!(await confirm({ title: "تغییر وضعیت سفارش", message: `وضعیت از «${o.status}» به «${status}» تغییر کند؟ ${warn}`, confirmText: "ثبت وضعیت", danger: status === "لغو شده" }))) return;
      try {
        await busy(e.currentTarget, () => api(`/admin/orders/edit/${o._id}`, { method: "PUT", body: { status, note: $("[data-note]", d.body).value } }), "وضعیت سفارش ثبت شد");
        reload(); listApi && listApi.reload();
      } catch (_) {}
    });
    $("[data-save-tracking]", d.body).addEventListener("click", async (e) => {
      try {
        await busy(e.currentTarget, () => api(`/orders/${o._id}/shipping`, { method: "PATCH", body: { trackingNumber: $("[data-tracking]", d.body).value } }), "کد رهگیری ذخیره شد");
        reload();
      } catch (_) {}
    });
    $$("[data-gw]", d.body).forEach((b) => b.addEventListener("click", () => gatewayAction(b, b.dataset.gw, gateway, o, () => { reload(); listApi && listApi.reload(); })));
  }

  const badge2 = (t, tone) => OA.badge(t, tone);

  async function gatewayAction(btn, action, gateway, o, done) {
    const base = `/admin/orders/${o._id}/${gateway}`;
    if (action === "sync") {
      try { await busy(btn, () => api(`${base}/sync`, { method: "POST", body: {} }), (r) => `${r.message} (${r.status || "—"})`); done(); } catch (_) {}
      return;
    }
    if (action === "cancel") {
      const ok = await confirm({ title: "لغو کامل سفارش در درگاه", message: `سفارش ${o.OrderNum} در ${o.paymentMethod} لغو و وجه به مشتری برگردانده می‌شود و موجودی به انبار برمی‌گردد. این عملیات برگشت‌ناپذیر است.`, confirmText: "لغو و عودت وجه", danger: true, requireText: o.OrderNum });
      if (!ok) return;
      try { await busy(btn, () => api(`${base}/cancel`, { method: "POST", body: { confirmed: true } }), (r) => r.message); done(); } catch (_) {}
      return;
    }
    // partial return: choose new quantities (only decreases are allowed by the gateway)
    const key = (p) => String(gateway === "snappay" ? p.snappItemId || p.product?._id || p.product : p.product?._id || p.product);
    const m = OA.modal({
      title: "مرجوعی بخشی از اقلام",
      size: "oa-modal--lg",
      body: html`<p class="oa-help" style="margin-top:0">تعداد جدید هر قلم را وارد کنید. فقط کاهش تعداد مجاز است؛ مبلغ جدید با درگاه به‌روزرسانی و اقلام کم‌شده به انبار برمی‌گردند.</p>
        <table class="oa-table"><thead><tr><th>محصول</th><th>تعداد فعلی</th><th>تعداد جدید</th></tr></thead><tbody>
        ${o.products.map((p) => html`<tr><td>${p.nameAtPurchase}<span class="oa-cell-sub">${[p.selectedColor, p.selectedSize].filter(Boolean).join(" / ")}</span></td><td class="num">${num(p.quantity)}</td><td><input class="oa-input oa-input--sm" style="width:90px" type="number" min="0" max="${p.quantity}" value="${p.quantity}" data-qty="${key(p)}"></td></tr>`)}
        </tbody></table>`,
      foot: html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn oa-btn--danger-solid" data-ok>ارسال به درگاه</button>`,
    });
    $("[data-ok]", m.el).addEventListener("click", async (e) => {
      const items = $$("[data-qty]", m.el).map((i) => ({ itemId: i.dataset.qty, productId: i.dataset.qty, quantity: Number(OA.toEn(i.value)) }));
      if (!(await confirm({ title: "تأیید نهایی", message: "این تغییر در درگاه پرداخت ثبت می‌شود و برگشت‌پذیر نیست. ادامه می‌دهید؟", confirmText: "بله، ارسال شود", danger: true }))) return;
      try { await busy(e.currentTarget, () => api(`${base}/update`, { method: "POST", body: { items, confirmed: true } }), (r) => r.message); m.close(true); done(); } catch (_) {}
    });
  }

  OA.section("orders", {
    title: "سفارش‌ها",
    group: "فروش",
    nav: true,
    icon: "bag",
    perm: "manage_orders",
    render,
    onArgs(args) {
      if (!listApi) return false;
      if (args[0]) openOrder(args[0]);
      else if (openDrawer) openDrawer.close(true);
      return true;
    },
  });
  OA.openOrder = openOrder;
  void fail;
})();
