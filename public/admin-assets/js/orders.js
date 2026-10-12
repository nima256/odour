/* Orders — fulfillment list + full-page order workspace. Status, payment and inventory rules
   are untouched: every action calls the same server endpoints as before. */
(function () {
  "use strict";
  const { html, raw, set, $, $$, num, money, icon, api, router, date, dateTime, ago, orderChip, payChip, source, channelLabel, busy, confirm, toast, boot, attr } = OA;
  const STATUSES = boot.orderStatuses || [];

  // ------------------------------------------------------------------ list
  function renderList(el) {
    const q = router.query();
    const channels = Object.keys(boot.channels || {});
    const rangeLabel = () => { const s = listApi && listApi.state; const r = s || q; return r.from ? `${OA.dayLong(r.from)} تا ${OA.dayLong(r.to)}` : r.days ? `${num(r.days)} روز اخیر` : "همه تاریخ‌ها"; };
    set(el, html`${OA.pageHead({ title: "سفارش‌ها", count: "", subtitle: "پیگیری، پردازش و ارسال سفارش‌ها", actions: html`<button class="ox-btn" type="button" data-date>${icon("calendar", "ox-i--s")}<span data-date-label></span></button>` })}<div data-list></div>`);
    let listApi = null;
    listApi = OA.list($("[data-list]", el), {
      endpoint: "/orders",
      defaults: { status: "", sort: "newest" },
      searchPlaceholder: "شماره سفارش، نام، موبایل، کد پستی یا رهگیری…",
      tabs: {
        name: "status",
        options: [["", "همه"], ["needs_action", "نیازمند اقدام"], ["در انتظار پرداخت", "در انتظار پرداخت"], ["در حال پردازش", "در حال پردازش"], ["بسته بندی شده", "بسته‌بندی"], ["در حال ارسال", "در حال ارسال"], ["تحویل داده شد", "تکمیل شده"], ["لغو شده", "لغو شده"]],
        count: (d, v) => { const c = d.statusCounts || {}; return v === "" ? Object.values(c).reduce((a, b) => a + b, 0) : v === "needs_action" ? (c["در حال پردازش"] || 0) + (c["بسته بندی شده"] || 0) : c[v] || 0; },
      },
      filters: [
        { name: "paymentStatus", label: "وضعیت پرداخت", options: [["", "همه پرداخت‌ها"], ...(boot.paymentStatuses || []).map((s) => [s, s])] },
        { name: "paymentMethod", label: "روش پرداخت", options: [["", "همه روش‌های پرداخت"], ...(boot.paymentMethods || []).map((s) => [s, s])] },
        { name: "delivery", label: "روش ارسال", options: [["", "همه روش‌های ارسال"], ...(boot.deliveryMethods || []).map((s) => [s, s.replace(/-/g, " ")])] },
        { name: "source", label: "منبع جذب", options: [["", "همه منابع جذب"], ...channels.map((c) => [c, channelLabel(c)])] },
        { name: "sort", label: "مرتب‌سازی", options: [["newest", "جدیدترین"], ["oldest", "قدیمی‌ترین"], ["total_desc", "بیشترین مبلغ"], ["total_asc", "کمترین مبلغ"]] },
      ],
      onData: (d) => { const c = $("[data-head-count]", el); if (c) c.textContent = `${num(d.total)} سفارش`; $("[data-date-label]", el).textContent = rangeLabel(); },
      columns: [
        { label: "سفارش", render: (o) => html`<span class="ox-ref" style="font-size:13.5px">${o.OrderNum}</span><span class="ox-cell-sub">${date(o.createdAt)} · ${OA.time(o.createdAt)}</span>` },
        { label: "مشتری", render: (o) => html`<span class="ox-cell-main">${o.recipientName || o.user?.fullName || "—"}</span><span class="ox-cell-sub ltr">${o.recipientMobile || o.user?.mobile || ""}</span>` },
        { label: "اقلام", cls: "col-num-start", render: (o) => html`${num(o.itemsCount)} قلم` },
        { label: "مبلغ", cls: "col-num", render: (o) => html`<span class="strong">${money(o.totalPrice)}</span>` },
        { label: "پرداخت", render: (o) => html`${payChip(o.paymentStatus)}<span class="ox-cell-sub">${o.paymentMethod}</span>` },
        { label: "وضعیت", render: (o) => orderChip(o.status) },
        { label: "منبع جذب", render: (o) => source(o.source) },
      ],
      record: (o) => html`<div class="ox-record__top"><div class="ox-record__main"><span class="ox-ref">${o.OrderNum}</span><span class="ox-cell-sub">${o.recipientName || o.user?.fullName || "—"} · ${ago(o.createdAt)}</span></div><div class="ox-record__side"><b class="num">${money(o.totalPrice)}</b></div></div>
        <div class="ox-record__row"><span class="ox-row" style="gap:6px">${orderChip(o.status)}${payChip(o.paymentStatus)}</span><button class="ox-btn ox-btn--sm" type="button" data-open>باز کردن</button></div>
        <details><summary>جزئیات بیشتر</summary><dl><dt>موبایل</dt><dd class="ltr">${o.recipientMobile || o.user?.mobile || "—"}</dd><dt>اقلام</dt><dd>${num(o.itemsCount)}</dd><dt>روش پرداخت</dt><dd>${o.paymentMethod}</dd><dt>منبع</dt><dd>${channelLabel(o.source || "unknown")}</dd></dl></details>`,
      actions: (o) => [{ label: "باز کردن سفارش", icon: "eye", run: () => router.go("orders", [o._id]) }, o.user?._id && OA.can("manage_users") ? { label: "پروفایل مشتری", icon: "user", run: () => router.go("customers", [o.user._id]) } : null],
      onRow: (o) => router.go("orders", [o._id]),
      bind: (row, o) => { const b = $("[data-open]", row); if (b) b.addEventListener("click", () => router.go("orders", [o._id])); },
      empty: () => OA.empty({ icon: "bag", title: "سفارشی با این مشخصات پیدا نشد", text: "فیلترها یا عبارت جستجو را تغییر دهید." }),
    });
    $("[data-date-label]", el).textContent = rangeLabel();
    $("[data-date]", el).addEventListener("click", () => {
      let picked = listApi.state.from ? { from: listApi.state.from, to: listApi.state.to } : listApi.state.days ? { days: listApi.state.days } : { days: "30" };
      const m = OA.modal({ title: "بازه تاریخ سفارش", sub: "بر اساس تاریخ ثبت سفارش (وقت تهران)", iconName: "calendar", body: html`<div data-r></div>`, foot: html`<button class="ox-btn" type="button" data-all>همه تاریخ‌ها</button><button class="ox-btn ox-btn--primary" type="button" data-ok>اعمال</button>` });
      OA.rangePicker($("[data-r]", m.el), picked, (r) => (picked = r));
      const apply = (r) => { ["from", "to", "days"].forEach((k) => delete listApi.state[k]); Object.assign(listApi.state, r || {}); listApi.state.page = 1; listApi.reload(); m.close(true); };
      $("[data-ok]", m.el).addEventListener("click", () => apply(picked));
      $("[data-all]", m.el).addEventListener("click", () => apply(null));
    });
  }

  // ------------------------------------------------------------- detail page
  function renderDetail(el, id) {
    set(el, html`${OA.workHead({ title: html`<span class="ox-skel" style="width:220px;height:26px;display:inline-block"></span>` })}<div class="ox-grid"><div class="c-8">${OA.skeletonBlock(320)}</div><div class="c-4">${OA.skeletonBlock(320)}</div></div>`);
    const load = async () => {
      try { const { order, activity } = await api(`/orders/${id}`); draw(el, order, activity, load); }
      catch (e) { set(el, html`${OA.workHead({ title: "سفارش" })}${OA.errorBox(e, load)}`); }
    };
    load();
  }

  function draw(el, o, activity, reload) {
    const items = o.products || [];
    const units = items.reduce((s, p) => s + Number(p.quantity || 0), 0);
    const itemsTotal = items.reduce((s, p) => s + Number(p.priceAtPurchase || 0) * Number(p.quantity || 0), 0);
    const listTotal = items.reduce((s, p) => s + Number(p.originalUnitPrice || p.priceAtPurchase || 0) * Number(p.quantity || 0), 0);
    const gateway = o.paymentMethod === "اسنپ‌پی" ? "snappay" : o.paymentMethod === "ترب‌پی" ? "torobpay" : "";
    const g = gateway === "snappay" ? o.snappPay || {} : gateway === "torobpay" ? o.torobPay || {} : null;
    const acq = o.acquisition;
    const timeline = [
      { at: o.createdAt, title: "ثبت سفارش", sub: `${o.paymentMethod} · ${money(o.totalPrice)}` },
      ...(o.paymentInfo?.paymentDate ? [{ at: o.paymentInfo.paymentDate, title: "تأیید پرداخت", sub: o.paymentInfo.refId ? `کد پیگیری ${o.paymentInfo.refId}` : "" }] : []),
      ...(g?.settledAt ? [{ at: g.settledAt, title: "تسویه در درگاه", sub: o.paymentMethod }] : []),
      ...(g?.cancelledAt ? [{ at: g.cancelledAt, title: "لغو در درگاه", sub: o.paymentMethod }] : []),
      ...(o.statusHistory || []).map((h) => ({ at: h.changedAt, title: h.status, sub: [h.changedByName && `توسط ${h.changedByName}`, h.note].filter(Boolean).join(" · ") })),
      ...(g?.updateHistory || []).map((u) => ({ at: u.changedAt, title: "به‌روزرسانی مبلغ در درگاه", sub: money(Number(u.amount || 0) / 10) })),
      ...(activity || []).filter((a) => a.action === "update_order_shipping").map((a) => ({ at: a.createdAtTimestamp, title: "ثبت کد رهگیری", sub: `${a.details} · ${a.adminName}` })),
    ].filter((x) => x.at).sort((a, b) => new Date(b.at) - new Date(a.at));
    const touch = (label, t) => html`<div class="ox-touch"><div class="ox-touch__h"><span>${label}</span>${t ? OA.source(t.source) : ""}</div>${t ? html`<dl class="ox-kv" style="font-size:12.5px;gap:6px 14px">${t.medium ? html`<dt>مدیوم</dt><dd class="ltr">${t.medium}</dd>` : ""}${t.campaign ? html`<dt>کمپین</dt><dd class="ltr">${t.campaign}</dd>` : ""}${t.referrerHost ? html`<dt>ارجاع‌دهنده</dt><dd class="ltr">${t.referrerHost}</dd>` : ""}<dt>صفحه ورود</dt><dd class="ltr">${t.landingPage || "—"}</dd><dt>زمان</dt><dd>${dateTime(t.at)}</dd></dl>` : html`<span class="muted small">—</span>`}</div>`;

    set(el, html`
      ${OA.workHead({
        title: html`سفارش <span class="ox-ref" style="font-size:inherit">${o.OrderNum}</span>`,
        meta: html`<span>${dateTime(o.createdAt)}</span>${orderChip(o.status)}${payChip(o.paymentStatus)}<span class="ox-tag">${o.paymentMethod}</span>`,
        actions: html`${g ? html`<button class="ox-btn" type="button" data-gw="sync">${icon("refresh", "ox-i--s")}استعلام از ${o.paymentMethod}</button>` : ""}${o.user?._id && OA.can("manage_users") ? html`<a class="ox-btn" href="#/customers/${o.user._id}">${icon("user", "ox-i--s")}پروفایل مشتری</a>` : ""}`,
      })}
      ${o.snappPay?.lastError || o.torobPay?.lastError ? html`<div class="ox-note ox-note--danger" style="margin-bottom:20px">${icon("alert", "ox-i--s")}<span>آخرین خطای درگاه: ${o.snappPay?.lastError || o.torobPay?.lastError}</span></div>` : ""}
      <div class="ox-grid">
        <div class="c-8 ox-stack">
          <section class="ox-panel"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("box")}اقلام خریداری‌شده</div><span class="ox-panel__sub">${num(items.length)} ردیف · ${num(units)} عدد</span></div>
            <div>${items.map((p) => html`<div class="ox-lineitem">
              ${p.product?.image ? html`<img class="ox-thumb" src="${p.product.image}" alt="" loading="lazy">` : html`<span class="ox-thumb ox-thumb--empty">${icon("box")}</span>`}
              <div style="min-width:0"><span class="ox-cell-main">${p.nameAtPurchase}</span><span class="ox-cell-sub">${[p.selectedColor && `رنگ ${p.selectedColor}`, p.selectedSize && `سایز ${p.selectedSize}`, p.product?.sku && `SKU ${p.product.sku}`].filter(Boolean).join(" · ") || "بدون تنوع"}${!p.product ? " · محصول حذف شده" : ""}</span></div>
              <span class="num muted">${num(p.quantity)} × ${money(p.priceAtPurchase)}</span>
              <span class="num strong">${money(Number(p.priceAtPurchase) * Number(p.quantity))}</span></div>`)}</div></section>

          <section class="ox-panel"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("receipt")}خلاصه پرداخت</div>${g ? html`<span class="ox-chip ox-chip--outline ox-chip--plain ltr">${g.status || "—"}</span>` : ""}</div>
            <div class="ox-panel__body ox-grid" style="gap:28px">
              <dl class="ox-sum c-6">
                <dt>جمع اقلام</dt><dd>${money(itemsTotal)}</dd>
                ${listTotal > itemsTotal ? html`<dt>تخفیف محصولات (در قیمت لحاظ شده)</dt><dd class="t-success">${money(listTotal - itemsTotal)}</dd>` : ""}
                ${o.discountAmount ? html`<dt>کد تخفیف ${o.discount?.code ? html`<span class="ox-tag ltr">${o.discount.code}</span>` : ""}</dt><dd class="t-success">− ${money(o.discountAmount)}</dd>` : ""}
                ${o.taxAmount ? html`<dt>مالیات / کارمزد</dt><dd>${money(o.taxAmount)}</dd>` : ""}
                ${o.externalSourceAmount ? html`<dt>پرداخت از منبع دیگر</dt><dd>− ${money(o.externalSourceAmount)}</dd>` : ""}
                <dt>هزینه ارسال</dt><dd class="muted" style="font-weight:500">پس‌کرایه</dd>
                <dt class="total">مبلغ نهایی</dt><dd class="total">${money(o.totalPrice)}</dd>
              </dl>
              <dl class="ox-kv c-6" style="align-content:start">
                <dt>درگاه</dt><dd>${o.paymentMethod}</dd><dt>وضعیت</dt><dd>${payChip(o.paymentStatus)}</dd>
                ${o.paymentInfo?.refId ? html`<dt>کد پیگیری</dt><dd class="ltr">${o.paymentInfo.refId}</dd>` : ""}
                ${o.paymentInfo?.cardPan ? html`<dt>کارت</dt><dd class="ltr">${o.paymentInfo.cardPan}</dd>` : ""}
                ${o.paymentInfo?.paymentDate ? html`<dt>زمان پرداخت</dt><dd>${dateTime(o.paymentInfo.paymentDate)}</dd>` : ""}
                ${g?.transactionId ? html`<dt>شناسه تراکنش</dt><dd class="ltr">${g.transactionId}</dd>` : ""}
                ${g?.lastStatusCheckAt ? html`<dt>آخرین استعلام</dt><dd>${dateTime(g.lastStatusCheckAt)}</dd>` : ""}
                <dt>موجودی</dt><dd>${o.inventoryRestored ? OA.chip("به انبار برگشت", "info") : o.inventoryReserved ? OA.chip("رزرو شده", "primary") : OA.chip("رزرو نشده")}</dd>
              </dl></div></section>

          <section class="ox-panel"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("activity")}تاریخچه سفارش</div></div><div class="ox-panel__body">
            ${timeline.length ? html`<ol class="ox-timeline">${timeline.map((t) => html`<li><span class="ox-timeline__dot"></span><div><b>${t.title}</b><span>${dateTime(t.at)}${t.sub ? ` · ${t.sub}` : ""}</span></div></li>`)}</ol>` : html`<span class="muted">—</span>`}</div></section>
        </div>

        <div class="c-4 ox-stack">
          <section class="ox-panel" style="border-top:3px solid var(--primary)"><div class="ox-panel__head"><div class="ox-panel__title">${icon("truck")}پردازش و ارسال</div></div><div class="ox-panel__body ox-col" style="gap:14px">
            ${OA.field({ label: "وضعیت سفارش", control: html`<select class="ox-select" data-status>${STATUSES.map((s) => html`<option ${attr(s === o.status, "selected")}>${s}</option>`)}</select>` })}
            ${OA.field({ label: "یادداشت تغییر وضعیت", opt: true, control: html`<input class="ox-input" data-note maxlength="300" placeholder="مثلاً: تحویل پست شد">` })}
            <button class="ox-btn ox-btn--primary ox-btn--block" type="button" data-save-status>${icon("check", "ox-i--s")}ثبت وضعیت</button>
            <hr class="ox-sep" style="margin:4px 0">
            <dl class="ox-kv"><dt>روش ارسال</dt><dd>${(o.delivery || "—").replace(/-/g, " ")}</dd></dl>
            ${OA.field({ label: "کد رهگیری مرسوله", control: html`<div class="ox-row ox-row--nowrap"><input class="ox-input ox-input--ltr" data-tracking maxlength="60" value="${o.trackingNumber || ""}"><button class="ox-btn" type="button" data-save-tracking aria-label="ذخیره کد رهگیری">${icon("save", "ox-i--s")}</button></div>` })}
            ${g ? html`<hr class="ox-sep" style="margin:4px 0"><div class="ox-label">عملیات درگاه ${o.paymentMethod}</div>
              <div class="ox-col" style="gap:8px"><button class="ox-btn ox-btn--block" type="button" data-gw="update">${icon("minus", "ox-i--s")}مرجوعی بخشی از اقلام</button><button class="ox-btn ox-btn--danger ox-btn--block" type="button" data-gw="cancel">${icon("x", "ox-i--s")}لغو کامل و عودت وجه</button></div>
              <p class="ox-help">از طریق API ${o.paymentMethod} انجام می‌شود و وضعیت درگاه پیش از هر اقدام دوباره استعلام می‌شود.</p>` : ""}
          </div></section>

          <section class="ox-panel"><div class="ox-panel__head"><div class="ox-panel__title">${icon("user")}مشتری و تحویل</div></div><div class="ox-panel__body">
            <div class="ox-entity" style="margin-bottom:14px"><span class="ox-avatar ox-avatar--light">${(o.user?.fullName || o.recipientName || "؟").charAt(0)}</span><div><span class="ox-cell-main">${o.user?.fullName || "—"}</span><span class="ox-cell-sub ltr">${o.user?.mobile || ""}</span></div></div>
            <dl class="ox-kv"><dt>تحویل‌گیرنده</dt><dd>${o.recipientName || "—"}</dd><dt>موبایل</dt><dd class="ltr">${o.recipientMobile || "—"}</dd><dt>استان / شهر</dt><dd>${[o.province, o.city].filter(Boolean).join("، ") || "—"}</dd><dt>آدرس</dt><dd>${o.address}</dd><dt>کد پستی</dt><dd class="ltr">${o.postcode}</dd></dl>
          </div></section>

          <section class="ox-panel"><div class="ox-panel__head"><div class="ox-panel__title">${icon("chart")}منبع جذب</div>${acq ? "" : OA.chip(channelLabel("unknown"), "", true)}</div><div class="ox-panel__body ox-col" style="gap:10px">
            ${acq ? html`${touch("آخرین منبع غیرمستقیم", acq.lastTouch)}${touch("اولین منبع", acq.firstTouch)}<p class="ox-help">روش پرداخت (${o.paymentMethod}) ربطی به منبع جذب ندارد.</p>`
              : html`<p class="muted small" style="line-height:1.9">برای این سفارش اطلاعات ردیابی ثبت نشده است (سفارش پیش از فعال‌شدن ردیابی یا مرورگری که کوکی را نپذیرفته).</p>`}
          </div></section>
        </div>
      </div>`);

    $("[data-save-status]", el).addEventListener("click", async (e) => {
      const status = $("[data-status]", el).value;
      if (status === o.status) return toast("وضعیت تغییری نکرده است", "error");
      const cancel = status === "لغو شده";
      if (!(await confirm({ title: "تغییر وضعیت سفارش", message: `وضعیت سفارش ${o.OrderNum} از «${o.status}» به «${status}» تغییر کند؟`, consequence: cancel ? "لغو دستی وجه را بازنمی‌گرداند و موجودی را به انبار برنمی‌گرداند. سفارش‌های پرداخت‌شده اسنپ‌پی/ترب‌پی را با دکمه لغو درگاه لغو کنید." : "", confirmText: "ثبت وضعیت", danger: cancel }))) return;
      try { await busy(e.currentTarget, () => api(`/admin/orders/edit/${o._id}`, { method: "PUT", body: { status, note: $("[data-note]", el).value } }), "وضعیت سفارش ثبت شد"); reload(); } catch (_) {}
    });
    $("[data-save-tracking]", el).addEventListener("click", async (e) => {
      try { await busy(e.currentTarget, () => api(`/orders/${o._id}/shipping`, { method: "PATCH", body: { trackingNumber: $("[data-tracking]", el).value } }), "کد رهگیری ذخیره شد"); reload(); } catch (_) {}
    });
    $$("[data-gw]", el).forEach((b) => b.addEventListener("click", () => gatewayAction(b, b.dataset.gw, gateway, o, reload)));
  }

  async function gatewayAction(btn, action, gateway, o, done) {
    const base = `/admin/orders/${o._id}/${gateway}`;
    if (action === "sync") { try { await busy(btn, () => api(`${base}/sync`, { method: "POST", body: {} }), (r) => `${r.message} (${r.status || "—"})`); done(); } catch (_) {} return; }
    if (action === "cancel") {
      const ok = await confirm({ title: "لغو کامل و عودت وجه", message: `سفارش ${o.OrderNum} در ${o.paymentMethod} لغو می‌شود.`, consequence: "وجه از طریق درگاه به مشتری برگردانده و موجودی به انبار برگردانده می‌شود. این عملیات برگشت‌ناپذیر است.", confirmText: "لغو و عودت وجه", danger: true, requireText: o.OrderNum });
      if (!ok) return;
      try { await busy(btn, () => api(`${base}/cancel`, { method: "POST", body: { confirmed: true } }), (r) => r.message); done(); } catch (_) {}
      return;
    }
    const key = (p) => String(gateway === "snappay" ? p.snappItemId || p.product?._id || p.product : p.product?._id || p.product);
    const m = OA.modal({
      title: "مرجوعی بخشی از اقلام", sub: "فقط کاهش تعداد مجاز است؛ مبلغ جدید با درگاه به‌روز و اقلام کم‌شده به انبار برمی‌گردند.", iconName: "minus", size: "ox-dialog--l",
      body: html`<div class="ox-table-wrap" style="border:1px solid var(--line);border-radius:8px"><table class="ox-table"><thead><tr><th>محصول</th><th class="col-num">تعداد فعلی</th><th>تعداد جدید</th></tr></thead><tbody>
        ${o.products.map((p) => html`<tr><td><span class="ox-cell-main">${p.nameAtPurchase}</span><span class="ox-cell-sub">${[p.selectedColor, p.selectedSize].filter(Boolean).join(" / ")}</span></td><td class="col-num">${num(p.quantity)}</td><td><input class="ox-input ox-input--sm ox-input--num" style="width:90px" type="number" min="0" max="${p.quantity}" value="${p.quantity}" data-qty="${key(p)}"></td></tr>`)}</tbody></table></div>`,
      foot: html`<button class="ox-btn" type="button" data-close>انصراف</button><button class="ox-btn ox-btn--danger-solid" type="button" data-ok>ارسال به درگاه</button>`,
    });
    $("[data-ok]", m.el).addEventListener("click", async (e) => {
      const items = $$("[data-qty]", m.el).map((i) => ({ itemId: i.dataset.qty, productId: i.dataset.qty, quantity: Number(OA.toEn(i.value)) }));
      if (!(await confirm({ title: "تأیید نهایی", message: "این تغییر در درگاه پرداخت ثبت می‌شود.", consequence: "برگشت‌پذیر نیست.", confirmText: "بله، ارسال شود", danger: true }))) return;
      try { await busy(e.currentTarget, () => api(`${base}/update`, { method: "POST", body: { items, confirmed: true } }), (r) => r.message); m.close(true); done(); } catch (_) {}
    });
  }

  OA.section("orders", {
    title: "سفارش‌ها", short: "سفارش‌ها", group: "تجارت", nav: true, icon: "bag", perm: "manage_orders",
    quick: { label: "نیازمند اقدام", icon: "truck", href: "#/orders?status=needs_action" },
    render(el, { args }) { if (args[0]) renderDetail(el, args[0]); else renderList(el); },
  });
  void raw;
})();
