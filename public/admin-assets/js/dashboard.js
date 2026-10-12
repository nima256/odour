/* Dashboard: real numbers only, filtered by date range. Sections appear per permission. */
(function () {
  "use strict";
  const { html, set, $, num, money, icon, api, can, router, dayLabel, dayLong, ago, orderBadge, payBadge, sourceBadge, channelLabel } = OA;

  const STATUS_ORDER = ["در انتظار پرداخت", "در حال پردازش", "بسته بندی شده", "در حال ارسال", "تحویل داده شد", "لغو شده"];
  const ACTIONS = {
    create_product: "افزودن محصول", update_product: "ویرایش محصول", delete_product: "حذف محصول",
    create_category: "افزودن دسته", update_category: "ویرایش دسته", delete_category: "حذف دسته",
    create_brand: "افزودن برند", update_brand: "ویرایش برند", delete_brand: "حذف برند",
    create_discount: "افزودن کد تخفیف", update_discount: "ویرایش کد تخفیف", delete_discount: "حذف کد تخفیف",
    update_order_status: "تغییر وضعیت سفارش", update_order_shipping: "ثبت کد رهگیری", order_payment_action: "عملیات درگاه پرداخت",
    create_weblog: "افزودن مقاله", update_weblog: "ویرایش مقاله", delete_weblog: "حذف مقاله",
    admin_login: "ورود به پنل", admin_logout: "خروج از پنل", adjust_inventory: "تغییر موجودی", import_inventory: "ورود CSV موجودی",
    create_banner: "افزودن بنر", update_banner: "ویرایش بنر", delete_banner: "حذف بنر", update_customer: "تغییر وضعیت مشتری",
    create_admin: "افزودن مدیر", update_admin: "ویرایش مدیر", change_password: "تغییر رمز عبور",
  };
  OA.ACTIONS = ACTIONS;

  const stat = ({ label, value, meta = "", go = "", accent = false, unit = "" }) => html`
    <div class="oa-card oa-stat ${go ? "oa-stat--link" : ""} ${accent ? "oa-stat--accent" : ""}" ${OA.raw(go ? `data-go="${OA.esc(go)}" role="link" tabindex="0"` : "")}>
      <span class="oa-stat__label">${label}</span>
      <span class="oa-stat__value">${value}${unit ? html`<small>${unit}</small>` : ""}</span>
      ${meta ? html`<span class="oa-stat__meta">${meta}</span>` : ""}
    </div>`;

  function render(el) {
    const query = router.query();
    set(el, html`
      ${OA.pageHead(`سلام ${OA.boot.admin.fullName.split(" ")[0]}`, "نمای کلی فروشگاه بر اساس داده‌های واقعی", html`<div data-range></div>`)}
      <div data-dash>${dashSkeleton()}</div>`);
    let range = query.from && query.to ? { from: query.from, to: query.to } : { days: query.days || "30" };
    OA.rangePicker($("[data-range]", el), range, (r) => { range = r; router.replaceQuery(r); load(); });
    const box = $("[data-dash]", el);
    async function load() {
      box.style.opacity = "0.6";
      try {
        const d = await api("/dashboard", { query: range });
        box.style.opacity = "";
        draw(box, d);
      } catch (e) {
        box.style.opacity = "";
        set(box, OA.errorBox(e, load));
      }
    }
    load();
  }

  const dashSkeleton = () => html`<div class="oa-grid oa-grid--stats">${Array.from({ length: 6 }, () => html`<div class="oa-card oa-stat"><div class="oa-skel" style="width:60%"></div><div class="oa-skel" style="width:40%;height:24px;margin-top:8px"></div></div>`)}</div>`;

  function draw(box, d) {
    const o = d.orders;
    const s = d.sales;
    const p = d.products;
    const rangeText = d.range ? `${dayLong(d.range.from)} تا ${dayLong(d.range.to)}` : "";
    set(box, html`
      ${s ? html`<div class="oa-grid oa-grid--stats oa-grid--six">
        ${stat({ label: "درآمد امروز", value: num(s.today), unit: "تومان", meta: `${num(s.todayCount)} فروش موفق`, accent: true })}
        ${stat({ label: "درآمد ۷ روز اخیر", value: num(s.week), unit: "تومان" })}
        ${stat({ label: "درآمد ۳۰ روز اخیر", value: num(s.month), unit: "تومان" })}
        ${stat({ label: "فروش موفق در بازه", value: num(s.rangeCount), meta: `میانگین سفارش ${money(s.averageOrder)}`, go: "orders?paymentStatus=پرداخت شده" })}
        ${stat({ label: "درآمد بازه انتخابی", value: num(s.range), unit: "تومان", meta: rangeText })}
        ${d.customers ? stat({ label: "مشتریان جدید در بازه", value: num(d.customers.newInRange), meta: `کل مشتریان: ${num(d.customers.total)}`, go: can("manage_users") ? "customers" : "" }) : ""}
      </div>` : ""}

      ${o ? html`<div class="oa-grid oa-grid--stats oa-grid--six" style="margin-top:16px">
        ${stat({ label: "سفارش‌های امروز", value: num(o.newToday), meta: `در بازه: ${num(o.inRange)}`, go: can("manage_orders") ? "orders" : "" })}
        ${stat({ label: "در انتظار پرداخت", value: num(o.byStatus["در انتظار پرداخت"] || 0), go: can("manage_orders") ? "orders?status=در انتظار پرداخت" : "" })}
        ${stat({ label: "در حال پردازش", value: num(o.byStatus["در حال پردازش"] || 0), meta: `بسته‌بندی شده: ${num(o.byStatus["بسته بندی شده"] || 0)}`, go: can("manage_orders") ? "orders?status=needs_action" : "" })}
        ${stat({ label: "ارسال شده", value: num(o.byStatus["در حال ارسال"] || 0), go: can("manage_orders") ? "orders?status=در حال ارسال" : "" })}
        ${stat({ label: "تحویل شده", value: num(o.byStatus["تحویل داده شد"] || 0), go: can("manage_orders") ? "orders?status=تحویل داده شد" : "" })}
        ${stat({ label: "لغو شده", value: num(o.byStatus["لغو شده"] || 0), meta: `کل سفارش‌ها: ${num(o.total)}`, go: can("manage_orders") ? "orders?status=لغو شده" : "" })}
      </div>` : ""}

      <div class="oa-grid oa-grid--main" style="margin-top:16px">
        <div class="oa-stack">
          ${d.series ? html`<section class="oa-card"><div class="oa-card__head"><h3>درآمد روزانه (فروش موفق)</h3><small>${rangeText}</small></div><div class="oa-card__body" data-chart-revenue></div></section>
          <section class="oa-card"><div class="oa-card__head"><h3>تعداد سفارش‌های ثبت‌شده در روز</h3><small>شامل همه وضعیت‌ها</small></div><div class="oa-card__body" data-chart-orders></div></section>` : ""}
          ${d.recentOrders ? html`<section class="oa-card"><div class="oa-card__head"><h3>آخرین سفارش‌ها</h3>${can("manage_orders") ? html`<a class="oa-link" href="#/orders">همه سفارش‌ها</a>` : ""}</div>
            ${d.recentOrders.length ? html`<div class="oa-table-wrap"><table class="oa-table oa-table--cards"><thead><tr><th>سفارش</th><th>مبلغ</th><th>وضعیت</th><th>پرداخت</th><th>منبع</th></tr></thead><tbody>
              ${d.recentOrders.map((r) => html`<tr class="${can("manage_orders") ? "is-clickable" : ""}" data-order="${r._id}">
                <td class="col-main"><span class="oa-cell-title num">${r.OrderNum}</span><span class="oa-cell-sub">${r.recipientName || r.user?.fullName || r.user?.mobile || "—"} · ${ago(r.createdAt)}</span></td>
                <td data-label="مبلغ" class="num">${money(r.totalPrice)}</td><td data-label="وضعیت">${orderBadge(r.status)}</td><td data-label="پرداخت">${payBadge(r.paymentStatus)}</td>
                <td data-label="منبع">${sourceBadge(r.acquisition?.lastTouch?.source)}</td></tr>`)}
            </tbody></table></div>` : OA.empty("هنوز سفارشی ثبت نشده است", "", "bag")}
          </section>` : ""}
        </div>
        <div class="oa-stack">
          ${o ? html`<section class="oa-card"><div class="oa-card__head"><h3>وضعیت سفارش‌ها در بازه</h3><small>${num(o.inRange)} سفارش</small></div><div class="oa-card__body" data-status></div></section>` : ""}
          ${d.traffic ? html`<section class="oa-card"><div class="oa-card__head"><h3>بازدیدکنندگان و منابع ورودی</h3>${can("view_analytics") ? html`<a class="oa-link" href="#/analytics">جزئیات</a>` : ""}</div>
            <div class="oa-card__body"><div class="oa-grid oa-grid--2" style="margin-bottom:16px">
              <div><div class="oa-muted" style="font-size:12px">بازدیدکننده یکتا</div><div style="font-size:20px;font-weight:700" class="num">${num(d.traffic.visitors)}</div></div>
              <div><div class="oa-muted" style="font-size:12px">بازدید صفحه</div><div style="font-size:20px;font-weight:700" class="num">${num(d.traffic.pageviews)}</div></div>
            </div><div data-sources></div></div></section>` : ""}
          ${p ? html`<section class="oa-card"><div class="oa-card__head"><h3>محصولات و موجودی</h3>${can("manage_inventory", "manage_products") ? html`<a class="oa-link" href="#/inventory?stock=low">مدیریت موجودی</a>` : ""}</div>
            <div class="oa-card__body" style="padding-bottom:8px"><dl class="oa-kv">
              <dt>کل محصولات</dt><dd class="num">${num(p.total)}</dd>
              <dt>منتشر شده</dt><dd class="num">${num(p.published)}</dd>
              <dt>رو به اتمام</dt><dd class="num oa-warn">${num(p.lowStock)}</dd>
              <dt>ناموجود</dt><dd class="num oa-bad">${num(p.outOfStock)}</dd>
            </dl></div>
            ${p.lowList.length ? html`<ul class="oa-list">${p.lowList.map((x) => html`<li>${x.image ? html`<img class="oa-thumb oa-thumb--sm" src="${x.image}" alt="" loading="lazy">` : ""}<div class="oa-list__main"><b>${x.name}</b><span>${x.sku || ""}</span></div><span class="oa-badge oa-badge--warn">${num(x.countInStock)} عدد</span></li>`)}</ul>` : ""}
          </section>` : ""}
          ${d.recentActivity ? html`<section class="oa-card"><div class="oa-card__head"><h3>فعالیت‌های اخیر</h3><a class="oa-link" href="#/activity">همه</a></div>
            ${d.recentActivity.length ? html`<ul class="oa-list">${d.recentActivity.map((a) => html`<li><div class="oa-list__main"><b>${ACTIONS[a.action] || a.action}: ${a.targetName}</b><span>${a.adminName} · ${ago(a.createdAtTimestamp)}</span></div></li>`)}</ul>` : OA.empty("فعالیتی ثبت نشده است", "", "activity")}
          </section>` : ""}
          ${!s && !o && !p ? OA.empty("به پنل مدیریت خوش آمدید", "از منوی کناری بخش مورد نظر را انتخاب کنید.", "home") : ""}
        </div>
      </div>`);

    if (d.series) {
      OA.chart($("[data-chart-revenue]", box), d.series.map((x) => ({ label: dayLabel(x.day), full: dayLong(x.day), value: x.revenue, tip: money(x.revenue) })), { type: "line", format: money, ariaLabel: "نمودار درآمد روزانه", yTitle: "درآمد" });
      OA.chart($("[data-chart-orders]", box), d.series.map((x) => ({ label: dayLabel(x.day), full: `${dayLong(x.day)} · ${num(x.successful)} موفق`, value: x.orders, tip: `${num(x.orders)} سفارش` })), { type: "bar", height: 200, ariaLabel: "نمودار تعداد سفارش", yTitle: "سفارش" });
    }
    if (o) {
      OA.hbars($("[data-status]", box), STATUS_ORDER.map((st) => ({ label: st, value: o.byStatusInRange[st] || 0 })), { emptyTitle: "سفارشی در این بازه ثبت نشده" });
    }
    if (d.traffic) {
      OA.hbars($("[data-sources]", box), d.traffic.sources.map((x) => ({ label: channelLabel(x.source), value: x.visits, sub: `${num(x.visitors)} نفر` })), {
        emptyTitle: "هنوز منبع ورودی ثبت نشده",
        emptyText: "ردیابی منبع از زمان استقرار این نسخه فعال است.",
      });
    }
    box.querySelectorAll("[data-go]").forEach((c) => {
      const go = () => { const [name, qs] = c.dataset.go.split("?"); router.go(name, [], Object.fromEntries(new URLSearchParams(qs || ""))); };
      c.addEventListener("click", go);
      c.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    });
    box.querySelectorAll("[data-order]").forEach((tr) => { if (can("manage_orders")) tr.addEventListener("click", () => router.go("orders", [tr.dataset.order])); });
  }

  OA.section("dashboard", { title: "داشبورد", nav: true, icon: "home", render });
})();
