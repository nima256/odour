/* Customers: searchable list with purchase stats + profile drawer. */
(function () {
  "use strict";
  const { html, set, $, num, money, icon, api, router, date, dateTime, ago, orderBadge, payBadge, sourceBadge, channelLabel, busy, confirm } = OA;

  let listApi = null;
  let drawerRef = null;

  function render(el, { args }) {
    const channels = Object.keys(OA.boot.channels || {});
    set(el, html`${OA.pageHead("مشتریان", "حساب‌های کاربری، سابقه خرید و منبع جذب")}<div data-list></div>`);
    listApi = OA.list($("[data-list]", el), {
      endpoint: "/customers",
      defaults: { status: "" },
      searchPlaceholder: "نام، موبایل یا ایمیل…",
      tabs: { name: "status", options: [["", "همه"], ["active", "فعال"], ["inactive", "غیرفعال"]], countsKey: "_none", count: () => null },
      filters: [
        { name: "source", label: "منبع جذب", options: [["", "همه منابع"], ...channels.map((c) => [c, channelLabel(c)])] },
        { name: "sort", label: "مرتب‌سازی", options: [["", "جدیدترین ثبت‌نام"], ["oldest", "قدیمی‌ترین"], ["spent", "بیشترین خرید (مبلغ)"], ["orders", "بیشترین خرید موفق"]] },
      ],
      columns: [
        { label: "مشتری", cls: "col-main", main: true, render: (u) => html`<div class="oa-media"><div class="oa-avatar">${(u.fullName || "؟").trim().charAt(0)}</div><div><span class="oa-cell-title">${u.fullName || "بدون نام"}</span><span class="oa-cell-sub ltr">${u.mobile}</span></div></div>` },
        { label: "ثبت‌نام", render: (u) => html`<span>${date(u.createdAt)}</span>` },
        { label: "خرید موفق", render: (u) => html`<span class="num">${num(u.successful)}</span><span class="oa-cell-sub">از ${num(u.orders)} سفارش</span>` },
        { label: "مجموع خرید", render: (u) => html`<span class="num" style="font-weight:600">${money(u.spent)}</span>` },
        { label: "آخرین سفارش", render: (u) => html`<span class="oa-cell-sub" style="color:inherit">${u.lastOrderAt ? ago(u.lastOrderAt) : "—"}</span>` },
        { label: "منبع جذب", render: (u) => sourceBadge(u.source) },
        { label: "وضعیت", render: (u) => (u.isActive ? OA.badge("فعال", "good") : OA.badge("غیرفعال", "bad")) },
      ],
      onRow: (u) => router.go("customers", [u._id], router.query()),
      empty: () => OA.empty("مشتری‌ای پیدا نشد", "", "users"),
    });
    if (args[0]) openCustomer(args[0]);
  }

  async function openCustomer(id) {
    if (drawerRef) drawerRef.close(true);
    const d = OA.drawer({ title: "پروفایل مشتری", body: OA.skeletonRows(6), onClose: () => { drawerRef = null; if (router.parse().name === "customers" && router.parse().args[0]) router.go("customers", [], router.query()); } });
    drawerRef = d;
    const load = async () => {
      try {
        const r = await api(`/customers/${id}`);
        draw(d, r, load);
      } catch (e) { set(d.body, OA.errorBox(e, load)); }
    };
    load();
  }

  function draw(d, { customer: c, stats, orders }, reload) {
    $("h2", d.el).textContent = c.fullName || c.mobile;
    const a = c.acquisition;
    set(d.body, html`
      <div class="oa-inline" style="margin-bottom:16px">${c.isActive ? OA.badge("حساب فعال", "good") : OA.badge("حساب غیرفعال", "bad")}<span class="oa-muted" style="font-size:12.5px">عضویت از ${date(c.createdAt)}</span></div>
      <div class="oa-grid oa-grid--3">
        <div class="oa-card oa-stat"><span class="oa-stat__label">خرید موفق</span><span class="oa-stat__value">${num(stats.successful)}</span><span class="oa-stat__meta">از ${num(stats.orders)} سفارش</span></div>
        <div class="oa-card oa-stat"><span class="oa-stat__label">مجموع خرید موفق</span><span class="oa-stat__value">${num(stats.spent)}<small>تومان</small></span></div>
        <div class="oa-card oa-stat"><span class="oa-stat__label">میانگین سفارش</span><span class="oa-stat__value">${num(stats.successful ? Math.round(stats.spent / stats.successful) : 0)}<small>تومان</small></span></div>
      </div>
      <div class="oa-grid oa-grid--2" style="margin-top:16px">
        <section class="oa-card"><div class="oa-card__head"><h3>اطلاعات تماس</h3></div><div class="oa-card__body"><dl class="oa-kv">
          <dt>نام</dt><dd>${c.fullName || "—"}</dd><dt>موبایل</dt><dd class="ltr">${c.mobile}</dd><dt>ایمیل</dt><dd class="ltr">${c.email || "—"}</dd>
          <dt>سبد خرید فعلی</dt><dd>${num(c.cartCount)} قلم</dd><dt>علاقه‌مندی‌ها</dt><dd>${num(c.wishlistCount)} محصول</dd>
        </dl></div></section>
        <section class="oa-card"><div class="oa-card__head"><h3>منبع جذب</h3></div><div class="oa-card__body">
          ${a ? html`<dl class="oa-kv"><dt>منبع</dt><dd>${channelLabel(a.source)}</dd>${a.medium ? html`<dt>Medium</dt><dd class="ltr">${a.medium}</dd>` : ""}${a.campaign ? html`<dt>کمپین</dt><dd class="ltr">${a.campaign}</dd>` : ""}${a.referrerHost ? html`<dt>ارجاع‌دهنده</dt><dd class="ltr">${a.referrerHost}</dd>` : ""}<dt>مبنا</dt><dd>${a.basis === "signup" ? "ثبت‌شده هنگام عضویت (اولین منبع)" : `اولین منبع سفارش ${a.orderNum || ""}`}</dd></dl>`
            : html`<p class="oa-muted" style="margin:0">${channelLabel("unknown")} — این حساب پیش از فعال‌شدن ردیابی ساخته شده و سفارش دارای منبع ندارد.</p>`}
        </div></section>
      </div>
      <section class="oa-card" style="margin-top:16px"><div class="oa-card__head"><h3>آدرس‌های ذخیره‌شده</h3><small>${num((c.addresses || []).length)} آدرس</small></div>
        ${(c.addresses || []).length ? html`<ul class="oa-list">${c.addresses.map((x) => html`<li>${icon("pin")}<div class="oa-list__main"><b>${[x.province, x.city].filter(Boolean).join("، ")} — ${x.fullName || ""}</b><span>${x.address} · کد پستی <span class="ltr">${x.postcode || "—"}</span> · <span class="ltr">${x.mobile || ""}</span></span></div></li>`)}</ul>` : OA.empty("آدرسی ذخیره نشده است", "", "pin")}
      </section>
      <section class="oa-card" style="margin-top:16px"><div class="oa-card__head"><h3>سفارش‌ها</h3>${orders.length >= 50 ? html`<a class="oa-link" href="#/orders?user=${c._id}">همه سفارش‌ها</a>` : ""}</div>
        ${orders.length ? html`<div class="oa-table-wrap"><table class="oa-table oa-table--cards"><thead><tr><th>سفارش</th><th>مبلغ</th><th>وضعیت</th><th>پرداخت</th><th>منبع</th></tr></thead><tbody>${orders.map((o) => html`<tr class="${OA.can("manage_orders") ? "is-clickable" : ""}" data-order="${o._id}"><td class="col-main"><span class="oa-cell-title num">${o.OrderNum}</span><span class="oa-cell-sub">${dateTime(o.createdAt)} · ${num(o.itemsCount)} قلم</span></td><td data-label="مبلغ" class="num">${money(o.totalPrice)}</td><td data-label="وضعیت">${orderBadge(o.status)}</td><td data-label="پرداخت">${payBadge(o.paymentStatus)}</td><td data-label="منبع">${sourceBadge(o.source)}</td></tr>`)}</tbody></table></div>` : OA.empty("این مشتری سفارشی ثبت نکرده است", "", "bag")}
      </section>
      <section class="oa-card" style="margin-top:16px"><div class="oa-card__body oa-inline" style="justify-content:space-between">
        <div><b>${c.isActive ? "غیرفعال‌سازی حساب" : "فعال‌سازی حساب"}</b><div class="oa-muted" style="font-size:12.5px">${c.isActive ? "مشتری دیگر نمی‌تواند وارد شود یا خرید کند؛ سفارش‌های قبلی حفظ می‌شوند." : "مشتری دوباره می‌تواند وارد شود و خرید کند."}</div></div>
        <button class="oa-btn ${c.isActive ? "oa-btn--danger" : "oa-btn--olive"}" data-toggle>${c.isActive ? "غیرفعال کن" : "فعال کن"}</button>
      </div></section>`);
    d.body.querySelectorAll("[data-order]").forEach((tr) => tr.addEventListener("click", () => { if (OA.can("manage_orders")) router.go("orders", [tr.dataset.order]); }));
    $("[data-toggle]", d.body).addEventListener("click", async (e) => {
      const next = !c.isActive;
      if (!next && !(await confirm({ title: "غیرفعال‌سازی حساب مشتری", message: `حساب ${c.fullName || c.mobile} غیرفعال شود؟`, confirmText: "غیرفعال کن", danger: true }))) return;
      try { await busy(e.currentTarget, () => api(`/customers/${c._id}/status`, { method: "PATCH", body: { isActive: next } }), (r) => r.message); reload(); listApi && listApi.reload(); } catch (_) {}
    });
  }

  OA.section("customers", {
    title: "مشتریان",
    group: "فروش",
    nav: true,
    icon: "users",
    perm: "manage_users",
    render,
    onArgs(args) {
      if (!listApi) return false;
      if (args[0]) openCustomer(args[0]);
      else if (drawerRef) drawerRef.close(true);
      return true;
    },
  });
})();
