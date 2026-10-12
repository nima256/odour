/* Dashboard — command header, weighted KPIs, operational flow, analytics workspace. Real data only. */
(function () {
  "use strict";
  const { html, set, $, $$, num, money, compact, icon, api, can, router, dayLabel, dayLong, ago, todayLong, orderChip, payChip, source, channelLabel, ORDER_COLOR } = OA;

  const STATUSES = ["در انتظار پرداخت", "در حال پردازش", "بسته بندی شده", "در حال ارسال", "تحویل داده شد", "لغو شده"];
  const SHORT = { "در انتظار پرداخت": "در انتظار پرداخت", "در حال پردازش": "در حال پردازش", "بسته بندی شده": "بسته‌بندی شده", "در حال ارسال": "در حال ارسال", "تحویل داده شد": "تحویل شده", "لغو شده": "لغو شده" };
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
  const actionIcon = (a) => (/^create/.test(a) ? "plus" : /^delete/.test(a) ? "trash" : /admin_log/.test(a) ? "lock" : /inventory/.test(a) ? "layers" : /order/.test(a) ? "bag" : "pen");
  Object.assign(OA, { ACTIONS, actionIcon });

  function greeting() {
    const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Tehran" }).format(new Date()));
    return h < 12 ? "صبح بخیر" : h < 17 ? "روز بخیر" : "عصر بخیر";
  }

  function render(el) {
    const q = router.query();
    let range = q.from && q.to ? { from: q.from, to: q.to } : { days: q.days || "30" };
    const first = (OA.boot.admin.fullName || "").split(" ")[0];
    set(el, html`<section class="ox-command">
        <div><div class="ox-command__date">${icon("calendar", "ox-i--s")}${todayLong()}</div>
          <h1>${greeting()}، ${first}</h1>
          <div class="ox-command__summary" data-summary><span class="ox-skel" style="width:320px"></span></div></div>
        <div class="ox-command__tools"><div data-range></div>
          <div class="ox-row">${can("manage_orders") ? html`<a class="ox-btn" href="#/orders?status=needs_action">${icon("truck", "ox-i--s")}صف ارسال</a>` : ""}${can("view_analytics") ? html`<a class="ox-btn" href="#/analytics">${icon("chart", "ox-i--s")}گزارش منابع ورودی</a>` : ""}</div></div>
      </section>
      <div data-dash><div class="ox-kpis">${[1, 2, 3, 4].map(() => html`<div class="ox-kpi"><div class="ox-skel" style="width:50%"></div><div class="ox-skel" style="width:70%;height:30px;margin-top:22px"></div></div>`)}</div></div>`);
    OA.rangePicker($("[data-range]", el), range, (r) => { range = r; router.replaceQuery(r); load(); });
    const box = $("[data-dash]", el);
    async function load() {
      box.style.opacity = "0.55";
      try {
        const [d, n] = await Promise.all([api("/dashboard", { query: range }), can("manage_orders") ? api("/notifications").catch(() => null) : null]);
        box.style.opacity = "";
        draw(el, box, d, n);
      } catch (e) {
        box.style.opacity = "";
        set(box, OA.errorBox(e, load));
      }
    }
    load();
  }

  function kpi({ label, iconName, value, unit = "", desc = "", meta = "", spark = "", go = "", accent = false }) {
    return html`<article class="ox-kpi ${accent ? "ox-kpi--accent" : ""} ${go ? "is-link" : ""}" ${OA.attr(go, `data-go="${OA.esc(go)}" tabindex="0" role="link"`)}>
      <div class="ox-kpi__top"><span class="ox-kpi__icon">${icon(iconName, "ox-i--s")}</span><span class="ox-kpi__label">${label}</span></div>
      <div class="ox-kpi__value">${value}${unit ? html`<small>${unit}</small>` : ""}</div>
      ${desc ? html`<div class="ox-kpi__desc">${desc}</div>` : ""}${meta}
      ${spark ? html`<div class="ox-kpi__spark">${spark}</div>` : ""}
    </article>`;
  }

  function draw(el, box, d, n) {
    const o = d.orders, s = d.sales, p = d.products, series = d.series || [];
    const needs = o ? (o.byStatus["در حال پردازش"] || 0) + (o.byStatus["بسته بندی شده"] || 0) : 0;
    const rangeText = d.range ? `${dayLong(d.range.from)} تا ${dayLong(d.range.to)}` : "";
    const summary = [
      o && html`<span>${icon("bag", "ox-i--s")}<b>${num(o.newToday)}</b> سفارش امروز</span>`,
      o && html`<span>${icon("truck", "ox-i--s")}<b>${num(needs)}</b> سفارش منتظر اقدام</span>`,
      p && html`<span>${icon("layers", "ox-i--s")}<b>${num(p.outOfStock)}</b> کالای ناموجود</span>`,
      s && html`<span>${icon("card", "ox-i--s")}<b>${compact(s.today)}</b> تومان فروش امروز</span>`,
    ].filter(Boolean);
    set($("[data-summary]", el), html`${summary.length ? summary : html`<span>از منوی کناری بخش مورد نظر را انتخاب کنید.</span>`}`);

    const kpis = [];
    if (s) kpis.push(kpi({ label: "درآمد موفق در بازه", iconName: "card", value: num(s.range), unit: "تومان", accent: true, go: can("manage_orders") ? "orders?paymentStatus=پرداخت شده" : "",
      meta: html`<div class="ox-kpi__meta"><span>امروز <b>${compact(s.today)}</b></span><span>۷ روز <b>${compact(s.week)}</b></span><span>۳۰ روز <b>${compact(s.month)}</b></span></div>`,
      spark: OA.spark(series.map((x) => x.revenue), OA.COLORS.sage) }));
    if (o) kpis.push(kpi({ label: "سفارش‌های نیازمند اقدام", iconName: "truck", value: num(needs), desc: `در حال پردازش ${num(o.byStatus["در حال پردازش"] || 0)} · بسته‌بندی شده ${num(o.byStatus["بسته بندی شده"] || 0)}`, go: can("manage_orders") ? "orders?status=needs_action" : "" }));
    if (o) kpis.push(kpi({ label: "سفارش‌های ثبت‌شده در بازه", iconName: "bag", value: num(o.inRange), desc: s ? `${num(s.rangeCount)} فروش موفق · میانگین ${money(s.averageOrder)}` : `امروز ${num(o.newToday)} سفارش`, spark: OA.spark(series.map((x) => x.orders), OA.COLORS.primary), go: can("manage_orders") ? "orders" : "" }));
    if (d.customers) kpis.push(kpi({ label: "مشتریان جدید", iconName: "users", value: num(d.customers.newInRange), desc: `از مجموع ${num(d.customers.total)} مشتری`, go: can("manage_users") ? "customers" : "" }));
    if (!s && p) kpis.push(kpi({ label: "محصولات منتشر شده", iconName: "box", value: num(p.published), desc: `از ${num(p.total)} محصول`, go: "products" }));
    if (!d.customers && p) kpis.push(kpi({ label: "کالاهای ناموجود", iconName: "layers", value: num(p.outOfStock), desc: `${num(p.lowStock)} کالا رو به اتمام`, go: "inventory?stock=out" }));

    set(box, html`
      ${kpis.length ? html`<div class="ox-kpis">${kpis.slice(0, 4)}</div>` : OA.empty({ icon: "home", title: "به Odour Control خوش آمدید", text: "از منوی کناری بخش مورد نظر را انتخاب کنید." })}

      ${o ? html`<div class="ox-flow" role="list" aria-label="وضعیت سفارش‌ها">${STATUSES.map((st) => html`<button class="ox-flow__step" type="button" role="listitem" style="--c:${ORDER_COLOR[st]}" data-status="${st}" ${OA.attr(!can("manage_orders"), "disabled")}>
          <span class="ox-flow__label">${SHORT[st]}</span><span class="ox-flow__n">${num(o.byStatus[st] || 0)}</span><span class="ox-flow__sub">${num(o.byStatusInRange[st] || 0)} در بازه</span></button>`)}</div>` : ""}

      <div class="ox-grid" style="margin-top:28px">
        ${series.length ? html`<section class="ox-panel c-8"><div class="ox-panel__head"><div><div class="ox-panel__title">عملکرد فروش</div><div class="ox-panel__sub">${rangeText}</div></div>
            <div class="ox-btn-group ox-btn-group--soft" role="group" aria-label="نمودار"><button type="button" data-series="revenue" aria-pressed="true">درآمد موفق</button><button type="button" data-series="orders" aria-pressed="false">تعداد سفارش</button></div></div>
            <div class="ox-panel__body"><div class="ox-legend" data-legend style="margin-bottom:10px"></div><div data-chart></div></div></section>` : ""}
        <section class="ox-panel ox-insight ${series.length ? "c-4" : "c-12"}">
          ${o ? html`<div class="ox-insight__block"><div class="ox-insight__h">توزیع وضعیت سفارش‌ها در بازه<span class="num">${num(o.inRange)}</span></div>${OA.stack(STATUSES.map((st) => ({ key: st, label: SHORT[st], value: o.byStatusInRange[st] || 0, color: ORDER_COLOR[st] })), { onClick: can("manage_orders") ? (k) => router.go("orders", [], { status: k }) : null })}</div>` : ""}
          <div class="ox-insight__block"><div class="ox-insight__h">اقدامات و هشدارها</div>
            ${o ? html`<a class="ox-alertrow" href="#/orders?status=needs_action"><span class="ox-alertrow__ic" style="background:var(--info-soft);color:var(--info)">${icon("truck", "ox-i--s")}</span><span>منتظر پردازش و ارسال</span><span class="ox-alertrow__n">${num(needs)}</span></a>
              <a class="ox-alertrow" href="#/orders?status=در انتظار پرداخت"><span class="ox-alertrow__ic" style="background:var(--warning-soft);color:var(--warning)">${icon("card", "ox-i--s")}</span><span>در انتظار پرداخت</span><span class="ox-alertrow__n">${num(o.byStatus["در انتظار پرداخت"] || 0)}</span></a>` : ""}
            ${n && n.stuckPayments ? html`<a class="ox-alertrow" href="#/orders?paymentStatus=در حال بررسی"><span class="ox-alertrow__ic" style="background:var(--danger-soft);color:var(--danger)">${icon("alert", "ox-i--s")}</span><span>پرداخت نامشخص بیش از ۱ ساعت</span><span class="ox-alertrow__n t-danger">${num(n.stuckPayments)}</span></a>` : ""}
            ${p ? html`<a class="ox-alertrow" href="#/inventory?stock=out"><span class="ox-alertrow__ic" style="background:var(--danger-soft);color:var(--danger)">${icon("layers", "ox-i--s")}</span><span>کالای ناموجود</span><span class="ox-alertrow__n">${num(p.outOfStock)}</span></a>
              <a class="ox-alertrow" href="#/inventory?stock=low"><span class="ox-alertrow__ic" style="background:var(--warning-soft);color:var(--warning)">${icon("layers", "ox-i--s")}</span><span>رو به اتمام (زیر حد هشدار)</span><span class="ox-alertrow__n">${num(p.lowStock)}</span></a>` : ""}
          </div>
        </section>

        ${d.recentOrders ? html`<section class="ox-panel c-12"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">آخرین سفارش‌ها</div>${can("manage_orders") ? html`<a class="ox-btn ox-btn--sm" href="#/orders">همه سفارش‌ها ${icon("chevron", "ox-i--s")}</a>` : ""}</div>
          ${d.recentOrders.length ? html`<div class="ox-table-wrap"><table class="ox-table"><thead><tr><th>سفارش</th><th>مشتری</th><th>تاریخ</th><th class="col-num">مبلغ</th><th>پرداخت</th><th>وضعیت</th><th>منبع جذب</th></tr></thead><tbody>
            ${d.recentOrders.map((r) => html`<tr class="${can("manage_orders") ? "is-link" : ""}" data-order="${r._id}" tabindex="0"><td><span class="ox-ref">${r.OrderNum}</span></td>
              <td><span class="ox-cell-main">${r.recipientName || r.user?.fullName || "—"}</span><span class="ox-cell-sub ltr">${r.user?.mobile || ""}</span></td>
              <td><span class="ox-cell-sub" style="color:var(--ink-2)">${ago(r.createdAt)}</span></td><td class="col-num strong">${money(r.totalPrice)}</td>
              <td>${payChip(r.paymentStatus)}</td><td>${orderChip(r.status)}</td><td>${source(r.acquisition?.lastTouch?.source)}</td></tr>`)}
          </tbody></table></div>` : OA.empty({ icon: "bag", title: "هنوز سفارشی ثبت نشده است", compact: true })}</section>` : ""}

        ${d.traffic ? html`<section class="ox-panel c-5"><div class="ox-panel__head"><div><div class="ox-panel__title">جذب بازدیدکننده</div><div class="ox-panel__sub">${num(d.traffic.visitors)} بازدیدکننده یکتا · ${num(d.traffic.pageviews)} بازدید صفحه</div></div>${can("view_analytics") ? html`<a class="ox-btn ox-btn--text" href="#/analytics">گزارش کامل</a>` : ""}</div><div class="ox-panel__body" data-sources></div></section>` : ""}
        ${p ? html`<section class="ox-panel ${d.traffic ? "c-4" : "c-6"}"><div class="ox-panel__head"><div class="ox-panel__title">کالاهای رو به اتمام</div><a class="ox-btn ox-btn--text" href="#/inventory?stock=low">انبار</a></div>
          ${p.lowList.length ? html`<ul class="ox-list ox-list--link">${p.lowList.map((x) => html`<li data-href="#/inventory?q=${encodeURIComponent(x.sku || x.name)}">${x.image ? html`<img class="ox-thumb ox-thumb--s" src="${x.image}" alt="" loading="lazy">` : html`<span class="ox-thumb ox-thumb--s ox-thumb--empty">${icon("box", "ox-i--s")}</span>`}<div class="ox-list__main"><b>${x.name}</b><span class="ltr">${x.sku || ""}</span></div><span class="ox-chip ox-chip--warning">${num(x.countInStock)} عدد</span></li>`)}</ul>` : OA.empty({ icon: "layers", title: "موجودی همه کالاها کافی است", compact: true })}</section>` : ""}
        ${d.recentActivity ? html`<section class="ox-panel ${d.traffic ? "c-3" : "c-6"}"><div class="ox-panel__head"><div class="ox-panel__title">فعالیت تیم</div><a class="ox-btn ox-btn--text" href="#/activity">همه</a></div><div class="ox-panel__body" style="padding-top:0">
          ${d.recentActivity.length ? html`<ul class="ox-feed">${d.recentActivity.slice(0, 6).map((a) => html`<li><span class="ox-feed__ic">${icon(actionIcon(a.action))}</span><div><b>${ACTIONS[a.action] || a.action}</b><span class="ellipsis">${a.targetName}</span><span>${a.adminName} · ${ago(a.createdAtTimestamp)}</span></div></li>`)}</ul>` : OA.empty({ icon: "activity", title: "فعالیتی ثبت نشده است", compact: true })}</div></section>` : ""}
      </div>`);

    if (series.length) {
      const drawChart = (which) => {
        $("[data-legend]", box).innerHTML = which === "revenue" ? `<span><i style="background:${OA.COLORS.primary}"></i>درآمد موفق روزانه (تومان)</span>` : `<span><i style="background:${OA.COLORS.accent}"></i>تعداد سفارش‌های ثبت‌شده در روز</span>`;
        OA.chart($("[data-chart]", box), series.map((x) => which === "revenue"
          ? { label: dayLabel(x.day), full: dayLong(x.day), value: x.revenue, tip: money(x.revenue) }
          : { label: dayLabel(x.day), full: `${dayLong(x.day)} · ${num(x.successful)} موفق`, value: x.orders, tip: `${num(x.orders)} سفارش` }),
        which === "revenue" ? { type: "area", format: money, title: "درآمد روزانه", yTitle: "درآمد", height: 280 } : { type: "bar", tone: "teal", title: "سفارش روزانه", yTitle: "سفارش", height: 280 });
      };
      drawChart("revenue");
      $$("[data-series]", box).forEach((b) => b.addEventListener("click", () => { $$("[data-series]", box).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); drawChart(b.dataset.series); }));
    }
    if (d.traffic) OA.dist($("[data-sources]", box), d.traffic.sources.map((x) => ({ lead: OA.glyph(x.source), label: channelLabel(x.source), value: x.visits, sub: `${num(x.visitors)} نفر` })), { emptyTitle: "هنوز منبع ورودی ثبت نشده", emptyText: "ردیابی منبع از زمان استقرار این نسخه فعال است." });
    $$("[data-go]", box).forEach((c) => { const go = () => { const [name, qs] = c.dataset.go.split("?"); router.go(name, [], Object.fromEntries(new URLSearchParams(qs || ""))); }; c.addEventListener("click", go); c.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); });
    $$("[data-status]", box).forEach((b) => b.addEventListener("click", () => router.go("orders", [], { status: b.dataset.status })));
    $$("[data-order]", box).forEach((tr) => { if (!can("manage_orders")) return; const go = () => router.go("orders", [tr.dataset.order]); tr.addEventListener("click", go); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); });
    $$("[data-href]", box).forEach((li) => li.addEventListener("click", () => (location.hash = li.dataset.href)));
  }

  OA.section("dashboard", { title: "داشبورد", short: "داشبورد", group: "نمای کلی", nav: true, icon: "home", render });
})();
