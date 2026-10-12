/* Traffic sources & acquisition — uses /analytics/traffic (first / last-touch). */
(function () {
  "use strict";
  const { html, set, $, $$, num, money, pct, compact, icon, api, router, dayLabel, dayLong, channelLabel, glyph, can } = OA;

  function render(el) {
    const q = router.query();
    const st = { model: q.model === "first" ? "first" : "last", source: q.source || "", ...(q.from && q.to ? { from: q.from, to: q.to } : { days: q.days || "30" }) };
    const channels = Object.keys(OA.boot.channels || {}).filter((k) => k !== "unknown");
    set(el, html`${OA.pageHead({ eyebrow: "ACQUISITION", title: "منابع ورودی و جذب مشتری", subtitle: "بازدیدکنندگان، سفارش‌ها و درآمد به تفکیک کانال ورود — فقط داده‌های ثبت‌شده", actions: html`<button class="ox-btn" type="button" data-help>${icon("info", "ox-i--s")}روش محاسبه</button>` })}
      <div class="ox-row" style="gap:12px;margin-bottom:24px;justify-content:space-between">
        <div data-range style="min-width:0;max-width:100%"></div>
        <div class="ox-row">
          <div class="ox-btn-group" role="group" aria-label="مدل انتساب"><button type="button" data-model="last" aria-pressed="${String(st.model === "last")}">آخرین منبع</button><button type="button" data-model="first" aria-pressed="${String(st.model === "first")}">اولین منبع</button></div>
          <select class="ox-select ox-select--sm" style="width:auto" data-source aria-label="فیلتر روند بر اساس منبع"><option value="">روند: همه منابع</option>${channels.map((c) => html`<option value="${c}" ${OA.attr(st.source === c, "selected")}>روند: ${channelLabel(c)}</option>`)}</select>
        </div>
      </div>
      <div data-body>${OA.skeletonBlock(110)}<div style="height:20px"></div>${OA.skeletonBlock(320)}</div>`);
    const body = $("[data-body]", el);
    const sync = () => router.replaceQuery({ ...st, model: st.model === "last" ? "" : "first" });
    OA.rangePicker($("[data-range]", el), st, (r) => { delete st.days; delete st.from; delete st.to; Object.assign(st, r); sync(); load(); });
    $$("[data-model]", el).forEach((b) => b.addEventListener("click", () => { st.model = b.dataset.model; $$("[data-model]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); sync(); load(); }));
    $("[data-source]", el).addEventListener("change", (e) => { st.source = e.target.value; sync(); load(); });
    $("[data-help]", el).addEventListener("click", help);
    async function load() {
      body.style.opacity = "0.55";
      try { const d = await api("/analytics/traffic", { query: st }); body.style.opacity = ""; draw(body, d, st); }
      catch (e) { body.style.opacity = ""; set(body, OA.errorBox(e, load)); }
    }
    load();
  }

  function draw(body, d, st) {
    const t = d.totals;
    const tracked = d.sources.filter((s) => s.source !== "unknown");
    const attributedRevenue = tracked.reduce((a, s) => a + s.revenue, 0);
    const attributedSuccess = tracked.reduce((a, s) => a + s.successful, 0);
    const trackedVisitors = tracked.reduce((a, s) => a + s.visitors, 0);
    const conv = trackedVisitors > 0 && attributedSuccess > 0 ? attributedSuccess / trackedVisitors : null;
    const modelName = st.model === "first" ? "اولین منبع" : "آخرین منبع غیرمستقیم";
    const kpi = (label, value, sub, ic) => html`<div class="ox-health__item" style="cursor:default"><span>${icon(ic, "ox-i--s")}${label}</span><b>${value}</b><span style="font-weight:500">${sub}</span></div>`;
    set(body, html`
      <div class="ox-health ox-health--5">
        ${kpi("بازدیدکننده یکتا", num(t.visitors), `${num(t.pageviews)} بازدید صفحه`, "users")}
        ${kpi("ورود به سایت", num(t.entries), "جلسه با منبع مشخص", "arrow-right")}
        ${kpi("سفارش‌های دارای منبع", num(t.trackedOrders), `${num(t.untrackedOrders)} سفارش ردیابی نشده`, "bag")}
        ${kpi("درآمد منتسب", compact(attributedRevenue), `تومان · بر اساس ${modelName}`, "card")}
        ${kpi("نرخ تبدیل", conv === null ? "—" : pct(conv, 2), conv === null ? "داده کافی برای محاسبه نیست" : "فروش موفق ÷ بازدیدکننده", "chart")}
      </div>
      ${t.untrackedPageviews ? html`<div class="ox-note" style="margin-bottom:20px">${icon("info", "ox-i--s")}<span>${num(t.untrackedPageviews)} بازدید صفحه در این بازه پیش از فعال‌شدن ردیابی ثبت شده و در جدول منابع شمرده نمی‌شود. اسکریپت <code class="ltr">scripts/backfill-visit-sources.js</code> می‌تواند آن‌ها را از روی Referer ذخیره‌شده طبقه‌بندی کند.</span></div>` : ""}

      <div class="ox-grid">
        <section class="ox-panel c-5"><div class="ox-panel__head"><div><div class="ox-panel__title">سهم کانال‌ها از ورود</div><div class="ox-panel__sub">ورودهای دارای منبع در بازه</div></div></div><div class="ox-panel__body" data-channels></div></section>
        <section class="ox-panel c-7"><div class="ox-panel__head ox-panel__head--line"><div><div class="ox-panel__title">عملکرد کانال‌ها</div><div class="ox-panel__sub">سفارش و درآمد بر اساس ${modelName}</div></div></div>
          <div class="ox-table-wrap"><table class="ox-table"><thead><tr><th>کانال</th><th class="col-num">بازدیدکننده</th><th class="col-num">ورود</th><th class="col-num">سفارش</th><th class="col-num">درآمد موفق</th><th class="col-num">تبدیل</th></tr></thead><tbody>
            ${d.sources.length ? d.sources.map((s) => html`<tr class="${can("manage_orders") ? "is-link" : ""}" tabindex="0" data-src="${s.source}"><td><span class="ox-src">${glyph(s.source)}${s.label || channelLabel(s.source)}</span></td>
              <td class="col-num">${num(s.visitors)}</td><td class="col-num">${num(s.visits)}</td><td class="col-num">${num(s.orders)} <span class="faint small">(${num(s.successful)} موفق)</span></td>
              <td class="col-num strong">${money(s.revenue)}</td><td class="col-num">${s.conversion === null ? html`<span class="faint">—</span>` : pct(s.conversion, 2)}</td></tr>`) : html`<tr><td colspan="6">${OA.empty({ icon: "chart", title: "در این بازه داده‌ای ثبت نشده است", compact: true })}</td></tr>`}
          </tbody></table></div></section>

        <section class="ox-panel c-8"><div class="ox-panel__head"><div><div class="ox-panel__title">روند ورود به سایت</div><div class="ox-panel__sub">${st.source ? channelLabel(st.source) : "همه منابع"}${d.range && d.range.from ? ` · ${dayLong(d.range.from)} تا ${dayLong(d.range.to)}` : ""}</div></div><div class="ox-legend"><span><i style="background:#0d9488"></i>ورود روزانه</span></div></div><div class="ox-panel__body" data-trend></div></section>
        <section class="ox-panel c-4"><div class="ox-panel__head"><div class="ox-panel__title">درآمد به تفکیک کانال</div></div><div class="ox-panel__body" data-revenue></div></section>

        <section class="ox-panel c-4"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("link")}دامنه‌های ارجاع‌دهنده</div></div>
          ${d.referrers.length ? html`<ol class="ox-list" style="padding:0">${d.referrers.map((r, i) => html`<li><span class="faint num strong" style="width:18px">${num(i + 1)}</span>${glyph(r.source)}<div class="ox-list__main"><b class="ltr" style="display:block;text-align:start">${r.host}</b><span>${num(r.visitors)} بازدیدکننده</span></div><b class="num">${num(r.visits)}</b></li>`)}</ol>` : OA.empty({ icon: "link", title: "ارجاعی ثبت نشده", compact: true })}</section>
        <section class="ox-panel c-4"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("file")}صفحات ورود</div></div><div class="ox-panel__body" data-landing></div></section>
        <section class="ox-panel c-4"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("tag")}کمپین‌های UTM</div></div>
          ${d.campaigns.length ? html`<div class="ox-table-wrap"><table class="ox-table"><thead><tr><th>کمپین</th><th>منبع / مدیوم</th><th class="col-num">ورود</th></tr></thead><tbody>${d.campaigns.map((c) => html`<tr><td><span class="ltr strong">${c.campaign || "(بدون نام)"}</span></td><td><span class="ltr muted small">${c.utmSource} / ${c.medium || "—"}</span></td><td class="col-num">${num(c.visits)}</td></tr>`)}</tbody></table></div>`
            : OA.empty({ icon: "tag", title: "کمپینی ثبت نشده", text: "لینک‌های تبلیغاتی را با utm_source و utm_campaign بسازید.", compact: true })}</section>
      </div>`);

    OA.dist($("[data-channels]", body), tracked.filter((s) => s.visits).map((s) => ({ lead: glyph(s.source), label: s.label, value: s.visits, sub: pct(s.share) })), { emptyTitle: "هنوز ورودی با منبع ثبت نشده" });
    OA.chart($("[data-trend]", body), d.trend.map((x) => ({ label: dayLabel(x.day), full: dayLong(x.day), value: x.visits, tip: `${num(x.visits)} ورود` })), { type: "area", tone: "teal", title: "روند ورود", yTitle: "ورود", height: 250 });
    OA.dist($("[data-revenue]", body), d.sources.filter((s) => s.revenue > 0).sort((a, b) => b.revenue - a.revenue).map((s) => ({ lead: glyph(s.source), label: s.label, value: s.revenue })), { format: (v) => `${compact(v)}`, emptyTitle: "درآمدی در این بازه ثبت نشده" });
    OA.dist($("[data-landing]", body), d.landingPages.map((r) => ({ label: decode(r.path), value: r.visits })), { tone: "teal", emptyTitle: "صفحه ورودی ثبت نشده" });
    $$("[data-src]", body).forEach((tr) => {
      if (!can("manage_orders")) return;
      const go = () => router.go("orders", [], { source: tr.dataset.src, model: st.model === "first" ? "first" : "", ...(st.from ? { from: st.from, to: st.to } : { days: st.days }) });
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    });
  }
  const decode = (p) => { try { return decodeURIComponent(p); } catch (_) { return p; } };

  function help() {
    OA.modal({
      title: "روش ردیابی و انتساب منبع", iconName: "info", size: "ox-dialog--l",
      body: html`<div class="ox-col" style="gap:12px;font-size:13.5px;line-height:2">
        <p>منبع هر ورود به این ترتیب تعیین می‌شود: پارامترهای UTM، سپس شناسه کلیک تبلیغات گوگل (gclid) و در نهایت دامنه Referer. ورود بدون Referer «ورود مستقیم» است.</p>
        <p>جابه‌جایی داخل سایت و بازگشت از درگاه‌های پرداخت (زرین‌پال، اسنپ‌پی، ترب‌پی، شاپرک) منبع جدید نیست؛ پرداخت با اسنپ‌پی هرگز به معنی جذب از اسنپ نیست.</p>
        <p><b>اولین منبع</b> نخستین ورود ثبت‌شده مرورگر است و <b>آخرین منبع غیرمستقیم</b> آخرین ورود دارای منبع؛ ورود مستقیم بعدی آن را بازنویسی نمی‌کند. هر دو در کوکی امضاشده (۹۰ روز، بدون اطلاعات شخصی) نگه داشته و هنگام ثبت سفارش روی سفارش ذخیره می‌شوند.</p>
        <p>سفارش‌های قبل از فعال‌شدن این قابلیت «${channelLabel("unknown")}» هستند و منبعی برایشان حدس زده نمی‌شود. نرخ تبدیل فقط وقتی هر دو داده موجود است نمایش داده می‌شود.</p>
        <div class="ox-note">${icon("link", "ox-i--s")}<span>نمونه لینک کمپین: <code class="ltr">?utm_source=instagram&amp;utm_medium=story&amp;utm_campaign=yalda</code></span></div></div>`,
      foot: html`<button class="ox-btn ox-btn--primary" type="button" data-close>متوجه شدم</button>`,
    });
  }

  OA.section("analytics", { title: "منابع ورودی", short: "گزارش", group: "نمای کلی", nav: true, icon: "chart", perm: "view_analytics", render });
})();
