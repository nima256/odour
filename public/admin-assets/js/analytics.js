/* Traffic sources & customer acquisition. */
(function () {
  "use strict";
  const { html, set, $, num, money, pct, api, router, dayLabel, dayLong, channelLabel, badge } = OA;

  function render(el) {
    const q = router.query();
    const state = { model: q.model === "first" ? "first" : "last", source: q.source || "", ...(q.from && q.to ? { from: q.from, to: q.to } : { days: q.days || "30" }) };
    const channels = Object.keys(OA.boot.channels || {}).filter((k) => k !== "unknown");
    set(el, html`
      ${OA.pageHead("منابع ورودی و جذب مشتری", "بازدیدکنندگان، سفارش‌ها و درآمد به تفکیک منبع ورود", html`<div data-range></div>`)}
      <div class="oa-card" style="margin-bottom:16px"><div class="oa-toolbar" style="border:0">
        <div class="oa-segment" role="group" aria-label="مدل انتساب">
          <button type="button" data-model="last" aria-pressed="${String(state.model === "last")}">آخرین منبع (Last non-direct)</button>
          <button type="button" data-model="first" aria-pressed="${String(state.model === "first")}">اولین منبع (First touch)</button>
        </div>
        <label><span class="sr-only">منبع</span><select class="oa-select" data-source aria-label="فیلتر منبع"><option value="">همه منابع</option>${channels.map((c) => html`<option value="${c}" ${OA.raw(state.source === c ? "selected" : "")}>${channelLabel(c)}</option>`)}</select></label>
        <span style="flex:1"></span>
        <button class="oa-btn oa-btn--ghost oa-btn--sm" type="button" data-help>${OA.icon("info", "oa-icon--sm")} روش محاسبه</button>
      </div></div>
      <div data-body>${OA.skeletonRows(5)}</div>`);
    const body = $("[data-body]", el);
    const sync = () => router.replaceQuery({ ...state, model: state.model === "last" ? "" : state.model });
    OA.rangePicker($("[data-range]", el), state, (r) => { delete state.days; delete state.from; delete state.to; Object.assign(state, r); sync(); load(); });
    el.querySelectorAll("[data-model]").forEach((b) => b.addEventListener("click", () => {
      state.model = b.dataset.model;
      el.querySelectorAll("[data-model]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      sync(); load();
    }));
    $("[data-source]", el).addEventListener("change", (e) => { state.source = e.target.value; sync(); load(); });
    $("[data-help]", el).addEventListener("click", help);

    async function load() {
      body.style.opacity = "0.6";
      try {
        const d = await api("/analytics/traffic", { query: state });
        body.style.opacity = "";
        draw(body, d, state);
      } catch (e) {
        body.style.opacity = "";
        set(body, OA.errorBox(e, load));
      }
    }
    load();
  }

  function draw(body, d, state) {
    const t = d.totals;
    const totalOrders = t.trackedOrders + t.untrackedOrders;
    set(body, html`
      <div class="oa-grid oa-grid--stats">
        <div class="oa-card oa-stat"><span class="oa-stat__label">بازدیدکننده یکتا</span><span class="oa-stat__value">${num(t.visitors)}</span><span class="oa-stat__meta">${num(t.pageviews)} بازدید صفحه</span></div>
        <div class="oa-card oa-stat"><span class="oa-stat__label">ورود به سایت (جلسه)</span><span class="oa-stat__value">${num(t.entries)}</span><span class="oa-stat__meta">ورود از بیرون سایت با منبع مشخص</span></div>
        <div class="oa-card oa-stat"><span class="oa-stat__label">سفارش‌های دارای منبع</span><span class="oa-stat__value">${num(t.trackedOrders)}</span><span class="oa-stat__meta">از ${num(totalOrders)} سفارش در بازه</span></div>
        <div class="oa-card oa-stat"><span class="oa-stat__label">سفارش‌های بدون ردیابی</span><span class="oa-stat__value">${num(t.untrackedOrders)}</span><span class="oa-stat__meta">${channelLabel("unknown")}</span></div>
      </div>
      ${t.untrackedPageviews ? html`<div class="oa-note oa-note--info" style="margin-top:16px">${OA.icon("info")}<span>${num(t.untrackedPageviews)} بازدید صفحه در این بازه پیش از فعال شدن ردیابی منبع ثبت شده و در جدول منابع شمرده نمی‌شود. برای طبقه‌بندی آن‌ها از روی Referer ذخیره‌شده، اسکریپت <code>scripts/backfill-visit-sources.js</code> را اجرا کنید.</span></div>` : ""}

      <section class="oa-card" style="margin-top:16px">
        <div class="oa-card__head"><h3>عملکرد منابع ورودی</h3><small>سفارش و درآمد بر اساس ${state.model === "first" ? "اولین منبع" : "آخرین منبع غیرمستقیم"}</small></div>
        <div class="oa-table-wrap"><table class="oa-table oa-table--cards"><thead><tr><th>منبع</th><th>ورود</th><th>سهم</th><th>بازدیدکننده</th><th>سفارش</th><th>فروش موفق</th><th>درآمد</th><th>نرخ تبدیل</th></tr></thead><tbody>
          ${d.sources.length ? d.sources.map((s) => html`<tr class="is-clickable" data-source-row="${s.source}">
            <td class="col-main"><span class="oa-cell-title">${s.label || channelLabel(s.source)}</span></td>
            <td data-label="ورود" class="num">${num(s.visits)}</td>
            <td data-label="سهم"><div class="oa-inline" style="flex-wrap:nowrap"><div class="oa-progress" style="width:70px"><span style="width:${s.share * 100}%"></span></div><span class="num" style="font-size:12px">${pct(s.share)}</span></div></td>
            <td data-label="بازدیدکننده" class="num">${num(s.visitors)}</td>
            <td data-label="سفارش" class="num">${num(s.orders)}</td>
            <td data-label="فروش موفق" class="num">${num(s.successful)}</td>
            <td data-label="درآمد" class="num">${money(s.revenue)}</td>
            <td data-label="نرخ تبدیل" class="num">${s.conversion === null ? html`<span class="oa-muted">—</span>` : pct(s.conversion, 2)}</td>
          </tr>`) : html`<tr><td colspan="8">${OA.empty("داده‌ای برای این بازه ثبت نشده است", "", "chart")}</td></tr>`}
        </tbody></table></div>
      </section>

      <div class="oa-grid oa-grid--main" style="margin-top:16px">
        <section class="oa-card"><div class="oa-card__head"><h3>روند ورود به سایت ${state.source ? `از ${channelLabel(state.source)}` : ""}</h3></div><div class="oa-card__body" data-trend></div></section>
        <section class="oa-card"><div class="oa-card__head"><h3>درآمد به تفکیک منبع</h3></div><div class="oa-card__body" data-revenue></div></section>
      </div>
      <div class="oa-grid oa-grid--3" style="margin-top:16px">
        <section class="oa-card"><div class="oa-card__head"><h3>دامنه‌های ارجاع‌دهنده</h3></div><div class="oa-card__body" data-referrers></div></section>
        <section class="oa-card"><div class="oa-card__head"><h3>صفحات ورود</h3></div><div class="oa-card__body" data-landing></div></section>
        <section class="oa-card"><div class="oa-card__head"><h3>کمپین‌های UTM</h3></div>
          ${d.campaigns.length ? html`<ul class="oa-list">${d.campaigns.map((c) => html`<li><div class="oa-list__main"><b><span class="ltr">${c.campaign || "(بدون نام)"}</span></b><span><span class="ltr">${c.utmSource} / ${c.medium || "—"}</span></span></div><span class="num">${num(c.visits)}</span></li>`)}</ul>` : OA.empty("کمپینی ثبت نشده", "لینک‌های تبلیغاتی را با utm_source و utm_campaign بسازید.", "tag")}
        </section>
      </div>`);

    OA.chart($("[data-trend]", body), d.trend.map((x) => ({ label: dayLabel(x.day), full: dayLong(x.day), value: x.visits, tip: `${num(x.visits)} ورود` })), { type: "line", ariaLabel: "روند ورود به سایت", yTitle: "ورود" });
    OA.hbars($("[data-revenue]", body), d.sources.filter((s) => s.revenue > 0).sort((a, b) => b.revenue - a.revenue).map((s) => ({ label: s.label, value: s.revenue })), { format: money, emptyTitle: "درآمدی در این بازه ثبت نشده" });
    OA.hbars($("[data-referrers]", body), d.referrers.map((r) => ({ label: r.host, value: r.visits, sub: channelLabel(r.source) })), { emptyTitle: "ارجاعی ثبت نشده" });
    OA.hbars($("[data-landing]", body), d.landingPages.map((r) => ({ label: decodeSafe(r.path), value: r.visits })), { emptyTitle: "صفحه ورودی ثبت نشده" });
    body.querySelectorAll("[data-source-row]").forEach((tr) => tr.addEventListener("click", () => {
      if (!OA.can("manage_orders")) return;
      router.go("orders", [], { source: tr.dataset.sourceRow, model: state.model === "first" ? "first" : "", ...(state.from ? { from: state.from, to: state.to } : { days: state.days }) });
    }));
  }

  const decodeSafe = (p) => { try { return decodeURIComponent(p); } catch (_) { return p; } };

  function help() {
    OA.modal({
      title: "روش ردیابی و انتساب منبع",
      size: "oa-modal--lg",
      body: html`<div class="oa-stack" style="gap:10px;font-size:13.5px">
        <p style="margin:0">هر بار که بازدیدکننده از بیرون سایت وارد می‌شود، منبع ورود بر اساس این ترتیب تعیین می‌شود: پارامترهای UTM (utm_source، utm_medium، utm_campaign، utm_content، utm_term)، سپس شناسه کلیک تبلیغات گوگل (gclid) و در نهایت دامنه Referer. ورود بدون Referer «ورود مستقیم» است.</p>
        <p style="margin:0">جابه‌جایی داخل سایت و بازگشت از درگاه‌های پرداخت (زرین‌پال، اسنپ‌پی، ترب‌پی، شاپرک و…) منبع جدید محسوب نمی‌شود؛ بنابراین پرداخت با اسنپ‌پی هرگز به معنی جذب از اسنپ نیست.</p>
        <p style="margin:0"><b>اولین منبع</b> نخستین ورود ثبت‌شده این مرورگر است. <b>آخرین منبع غیرمستقیم</b> آخرین ورود دارای منبع است؛ ورود مستقیم بعدی آن را بازنویسی نمی‌کند. هر دو در یک کوکی امضاشده (۹۰ روز، بدون اطلاعات شخصی) نگه داشته می‌شوند و هنگام ثبت سفارش روی سفارش ذخیره می‌شوند.</p>
        <p style="margin:0">سفارش‌های قدیمی که پیش از این قابلیت ثبت شده‌اند «${channelLabel("unknown")}» نمایش داده می‌شوند و هیچ منبعی برای آن‌ها حدس زده نمی‌شود. نرخ تبدیل = فروش موفق ÷ بازدیدکننده یکتای همان منبع و فقط وقتی هر دو داده موجود است نمایش داده می‌شود.</p>
        <p style="margin:0">پیشنهاد: لینک‌های اینستاگرام، کمپین‌ها و همکاری‌ها را با UTM بسازید، مثلاً <code class="ltr">?utm_source=instagram&amp;utm_medium=story&amp;utm_campaign=yalda</code></p>
      </div>`,
      foot: html`<button class="oa-btn oa-btn--primary" data-close>متوجه شدم</button>`,
    });
  }

  OA.section("analytics", { title: "منابع ورودی", group: "گزارش‌ها", nav: true, icon: "chart", perm: "view_analytics", render });
  OA.sectionBadge = badge;
})();
