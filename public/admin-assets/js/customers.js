/* Customers — CRM list + profile workspace. */
(function () {
  "use strict";
  const { html, set, $, $$, num, money, compact, icon, api, router, date, dateTime, ago, orderChip, payChip, source, channelLabel, busy, confirm } = OA;

  function renderList(el) {
    const channels = Object.keys(OA.boot.channels || {});
    set(el, html`${OA.pageHead({ title: "مشتریان", count: "", subtitle: "حساب‌های کاربری، ارزش خرید و منبع جذب" })}<div data-list></div>`);
    OA.list($("[data-list]", el), {
      endpoint: "/customers",
      defaults: { status: "", sort: "" },
      searchPlaceholder: "نام، موبایل یا ایمیل مشتری…",
      tabs: { name: "status", options: [["", "همه مشتریان"], ["active", "فعال"], ["inactive", "غیرفعال"]] },
      filters: [
        { name: "source", label: "منبع جذب", options: [["", "همه منابع جذب"], ...channels.map((c) => [c, channelLabel(c)])] },
        { name: "sort", label: "مرتب‌سازی", options: [["", "جدیدترین عضویت"], ["oldest", "قدیمی‌ترین عضویت"], ["spent", "بیشترین ارزش خرید"], ["orders", "بیشترین خرید موفق"]] },
      ],
      onData: (d) => { const c = $("[data-head-count]", el); if (c) c.textContent = `${num(d.total)} مشتری`; },
      columns: [
        { label: "مشتری", render: (u) => html`<div class="ox-entity"><span class="ox-avatar ox-avatar--light">${(u.fullName || "؟").trim().charAt(0)}</span><div><span class="ox-cell-main">${u.fullName || "بدون نام"}</span><span class="ox-cell-sub ltr">${u.mobile}</span></div></div>` },
        { label: "عضویت", render: (u) => html`<span>${date(u.createdAt)}</span>` },
        { label: "خرید موفق", cls: "col-num", render: (u) => html`<b>${num(u.successful)}</b><span class="ox-cell-sub">از ${num(u.orders)} سفارش</span>` },
        { label: "ارزش خرید", cls: "col-num", render: (u) => html`<span class="strong">${money(u.spent)}</span>` },
        { label: "آخرین سفارش", render: (u) => html`<span class="muted small">${u.lastOrderAt ? ago(u.lastOrderAt) : "—"}</span>` },
        { label: "منبع جذب", render: (u) => source(u.source) },
        { label: "وضعیت", render: (u) => (u.isActive ? OA.chip("فعال", "success") : OA.chip("غیرفعال", "danger")) },
      ],
      record: (u) => html`<div class="ox-record__top"><span class="ox-avatar ox-avatar--light">${(u.fullName || "؟").trim().charAt(0)}</span><div class="ox-record__main"><span class="ox-cell-main">${u.fullName || "بدون نام"}</span><span class="ox-cell-sub ltr">${u.mobile}</span></div><div class="ox-record__side"><b class="num">${compact(u.spent)}</b><span class="ox-cell-sub">${num(u.successful)} خرید</span></div></div>
        <div class="ox-record__row">${source(u.source)}${u.isActive ? OA.chip("فعال", "success") : OA.chip("غیرفعال", "danger")}</div>`,
      actions: (u) => [{ label: "پروفایل مشتری", icon: "user", run: () => router.go("customers", [u._id]) }, OA.can("manage_orders") ? { label: "سفارش‌های این مشتری", icon: "bag", run: () => router.go("orders", [], { user: u._id }) } : null],
      onRow: (u) => router.go("customers", [u._id]),
      empty: () => OA.empty({ icon: "users", title: "مشتری‌ای پیدا نشد", text: "عبارت جستجو یا فیلترها را تغییر دهید." }),
    });
  }

  function renderProfile(el, id) {
    set(el, html`${OA.workHead({ title: html`<span class="ox-skel" style="width:200px;height:26px;display:inline-block"></span>` })}<div class="ox-profile">${OA.skeletonBlock(420)}${OA.skeletonBlock(420)}</div>`);
    const load = async () => { try { draw(el, await api(`/customers/${id}`), load); } catch (e) { set(el, html`${OA.workHead({ title: "مشتری" })}${OA.errorBox(e, load)}`); } };
    load();
  }

  function draw(el, { customer: c, stats, orders }, reload) {
    const a = c.acquisition;
    set(el, html`${OA.workHead({ title: c.fullName || c.mobile, meta: html`${c.isActive ? OA.chip("حساب فعال", "success") : OA.chip("حساب غیرفعال", "danger")}<span>عضو از ${date(c.createdAt)}</span>`, actions: OA.can("manage_orders") && orders.length ? html`<a class="ox-btn" href="#/orders?user=${c._id}">${icon("bag", "ox-i--s")}همه سفارش‌ها</a>` : "" })}
      <div class="ox-profile">
        <aside class="ox-stack">
          <section class="ox-panel ox-profile__card"><span class="ox-avatar ox-avatar--xl ox-avatar--light">${(c.fullName || "؟").charAt(0)}</span>
            <h2 style="font-size:18px;font-weight:800">${c.fullName || "بدون نام"}</h2><div class="ltr muted" style="margin-top:2px">${c.mobile}</div>
            <hr class="ox-sep"><dl class="ox-kv" style="text-align:start"><dt>ایمیل</dt><dd class="ltr">${c.email || "—"}</dd><dt>سبد خرید فعلی</dt><dd>${num(c.cartCount)} قلم</dd><dt>علاقه‌مندی‌ها</dt><dd>${num(c.wishlistCount)} محصول</dd><dt>آخرین به‌روزرسانی</dt><dd>${date(c.updatedAt)}</dd></dl></section>
          <section class="ox-panel"><div class="ox-panel__head"><div class="ox-panel__title">${icon("chart")}منبع جذب</div></div><div class="ox-panel__body">
            ${a ? html`<div class="ox-touch"><div class="ox-touch__h"><span>${a.basis === "signup" ? "ثبت‌شده هنگام عضویت" : `اولین منبع سفارش ${a.orderNum || ""}`}</span>${source(a.source)}</div><dl class="ox-kv" style="font-size:12.5px;gap:6px 14px">${a.medium ? html`<dt>مدیوم</dt><dd class="ltr">${a.medium}</dd>` : ""}${a.campaign ? html`<dt>کمپین</dt><dd class="ltr">${a.campaign}</dd>` : ""}${a.referrerHost ? html`<dt>ارجاع‌دهنده</dt><dd class="ltr">${a.referrerHost}</dd>` : ""}${a.landingPage ? html`<dt>صفحه ورود</dt><dd class="ltr">${a.landingPage}</dd>` : ""}</dl></div>`
              : html`<div class="ox-row">${source(null)}</div><p class="ox-help" style="margin-top:8px">حساب پیش از فعال‌شدن ردیابی ساخته شده و سفارش دارای منبع ندارد.</p>`}
          </div></section>
          <section class="ox-panel"><div class="ox-panel__head"><div class="ox-panel__title">${icon("pin")}آدرس‌های ذخیره‌شده</div><span class="ox-panel__sub">${num((c.addresses || []).length)}</span></div>
            ${(c.addresses || []).length ? html`<ul class="ox-list">${c.addresses.map((x) => html`<li style="align-items:flex-start"><div class="ox-list__main"><b>${[x.province, x.city].filter(Boolean).join("، ")}${x.fullName ? ` — ${x.fullName}` : ""}</b><span style="white-space:normal">${x.address}</span><span>کد پستی <span class="ltr">${x.postcode || "—"}</span> · <span class="ltr">${x.mobile || ""}</span></span></div></li>`)}</ul>` : html`<div class="ox-panel__body muted small">آدرسی ذخیره نشده است.</div>`}</section>
          <section class="ox-panel"><div class="ox-panel__body ox-col" style="gap:10px"><b>${c.isActive ? "غیرفعال‌سازی حساب" : "فعال‌سازی حساب"}</b><p class="ox-help">${c.isActive ? "مشتری دیگر نمی‌تواند وارد شود یا خرید کند؛ سفارش‌های قبلی حفظ می‌شوند." : "مشتری دوباره می‌تواند وارد شود و خرید کند."}</p><button class="ox-btn ${c.isActive ? "ox-btn--danger" : "ox-btn--primary"}" type="button" data-toggle>${c.isActive ? "غیرفعال کردن حساب" : "فعال کردن حساب"}</button></div></section>
        </aside>
        <div class="ox-stack">
          <div class="ox-statline"><div><span>خرید موفق</span><b>${num(stats.successful)}<small>از ${num(stats.orders)}</small></b></div><div><span>ارزش خرید موفق</span><b>${compact(stats.spent)}<small>تومان</small></b></div><div><span>میانگین سفارش</span><b>${compact(stats.successful ? Math.round(stats.spent / stats.successful) : 0)}<small>تومان</small></b></div></div>
          <section class="ox-panel"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("bag")}تاریخچه سفارش‌ها</div>${stats.first ? html`<span class="ox-panel__sub">اولین سفارش ${date(stats.first)} · آخرین ${ago(stats.last)}</span>` : ""}</div>
            ${orders.length ? html`<div class="ox-table-wrap"><table class="ox-table"><thead><tr><th>سفارش</th><th>تاریخ</th><th class="col-num">مبلغ</th><th>پرداخت</th><th>وضعیت</th><th>منبع</th></tr></thead><tbody>${orders.map((o) => html`<tr class="${OA.can("manage_orders") ? "is-link" : ""}" tabindex="0" data-order="${o._id}"><td><span class="ox-ref">${o.OrderNum}</span><span class="ox-cell-sub">${num(o.itemsCount)} قلم</span></td><td class="small">${dateTime(o.createdAt)}</td><td class="col-num strong">${money(o.totalPrice)}</td><td>${payChip(o.paymentStatus)}</td><td>${orderChip(o.status)}</td><td>${source(o.source, { label: false })}</td></tr>`)}</tbody></table></div>` : OA.empty({ icon: "bag", title: "این مشتری سفارشی ثبت نکرده است", compact: true })}</section>
        </div>
      </div>`);
    $$("[data-order]", el).forEach((tr) => { if (!OA.can("manage_orders")) return; const go = () => router.go("orders", [tr.dataset.order]); tr.addEventListener("click", go); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); });
    $("[data-toggle]", el).addEventListener("click", async (e) => {
      const next = !c.isActive;
      if (!next && !(await confirm({ title: "غیرفعال‌سازی حساب مشتری", message: `حساب ${c.fullName || c.mobile} غیرفعال شود؟`, consequence: "مشتری نمی‌تواند وارد شود یا خرید کند. سفارش‌ها و سوابق حذف نمی‌شوند و هر زمان قابل فعال‌سازی است.", confirmText: "غیرفعال کن", danger: true }))) return;
      try { await busy(e.currentTarget, () => api(`/customers/${c._id}/status`, { method: "PATCH", body: { isActive: next } }), (r) => r.message); reload(); } catch (_) {}
    });
  }

  OA.section("customers", { title: "مشتریان", short: "مشتریان", group: "تجارت", nav: true, icon: "users", perm: "manage_users", render(el, { args }) { if (args[0]) renderProfile(el, args[0]); else renderList(el); } });
})();
