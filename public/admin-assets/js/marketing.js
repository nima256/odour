/* Marketing — discount codes and banner studio (same endpoints and rules as before). */
(function () {
  "use strict";
  const { html, set, $, $$, num, money, icon, api, upload, toast, busy, confirm, date, dateTime, router, attr, field, toggle } = OA;

  const toLocal = (v) => {
    if (!v) return "";
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(v));
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
  };
  const fromLocal = (v) => (v ? new Date(`${v}:00+03:30`).toISOString() : null); // entered in Tehran time

  // ---------------------------------------------------------------- discounts
  const dState = (d) => (!d.isActive ? ["غیرفعال", ""] : d.isExpired ? ["منقضی", "danger"] : d.remaining === 0 ? ["تمام شده", "warning"] : ["فعال", "success"]);

  function renderDiscounts(el) {
    const q = router.query();
    let status = q.status || "";
    let all = [];
    set(el, html`${OA.pageHead({ title: "کدهای تخفیف", count: "", subtitle: "کمپین‌های تخفیف، محدودیت استفاده و عملکرد فروش", actions: html`<button class="ox-btn ox-btn--primary" type="button" data-new>${icon("plus", "ox-i--s")}کد تخفیف جدید</button>` })}
      <div class="ox-tabs" role="tablist" style="margin-bottom:16px">${[["", "همه"], ["active", "فعال"], ["inactive", "غیرفعال"], ["expired", "منقضی"]].map(([v, l]) => html`<button class="ox-tab" type="button" role="tab" data-st="${v}" aria-selected="${String(status === v)}">${l}</button>`)}</div>
      <div class="ox-datacard"><div class="ox-toolbar"><label class="ox-searchbox">${icon("search")}<input class="ox-input ox-input--ltr" type="search" data-q placeholder="جستجوی کد…" aria-label="جستجوی کد"></label><span class="ox-toolbar__count" data-total></span></div><div data-body>${OA.skeletonTable(4)}</div></div>`);
    const body = $("[data-body]", el);
    const load = async () => { try { all = (await api("/discounts", { query: { status, q: $("[data-q]", el).value } })).discounts; draw(); } catch (e) { set(body, OA.errorBox(e, load)); } };
    function draw() {
      $("[data-total]", el).textContent = `${num(all.length)} کد`;
      const c = $("[data-head-count]", el); if (c) c.textContent = `${num(all.length)} کد`;
      if (!all.length) return set(body, OA.empty({ icon: "percent", title: "کد تخفیفی وجود ندارد", text: "اولین کمپین تخفیف را بسازید." }));
      const usage = (d) => { const used = d.usedCount || 0; return d.usageLimit ? html`<div class="ox-row ox-row--nowrap" style="gap:8px"><div class="ox-meter ${used >= d.usageLimit ? "ox-meter--danger" : used / d.usageLimit > 0.8 ? "ox-meter--warn" : ""}" style="width:80px"><span style="width:${Math.min(100, (used / d.usageLimit) * 100)}%"></span></div><span class="num small">${num(used)}/${num(d.usageLimit)}</span></div>` : html`<span class="num small">${num(used)} <span class="faint">/ نامحدود</span></span>`; };
      set(body, html`<div class="ox-table-wrap has-records"><table class="ox-table"><thead><tr><th>کد</th><th>مقدار</th><th>قوانین</th><th>استفاده</th><th class="col-num">فروش با این کد</th><th>اعتبار</th><th>وضعیت</th><th class="col-actions"></th></tr></thead><tbody>
        ${all.map((d) => html`<tr class="is-link" tabindex="0" data-id="${d._id}">
          <td><span class="ox-ref" style="letter-spacing:.06em;font-size:13.5px">${d.code}</span><span class="ox-cell-sub">${d.description || ""}</span></td>
          <td>${d.type === "percent" ? html`<b class="num">${num(d.amount)}٪</b><span class="ox-cell-sub">سقف ${money(d.maxDiscountAmount)}</span>` : html`<b class="num">${money(d.amount)}</b><span class="ox-cell-sub">مبلغ ثابت</span>`}</td>
          <td><span class="small">${d.minOrderAmount ? `حداقل ${money(d.minOrderAmount)}` : "بدون حداقل"}</span>${d.oneTimePerUser ? html`<span class="ox-cell-sub">یک‌بار برای هر مشتری</span>` : ""}${(d.applicableCategories || []).length || (d.applicableProducts || []).length ? html`<span class="ox-cell-sub">محدودیت ثبت‌شده (اعمال نمی‌شود)</span>` : ""}</td>
          <td>${usage(d)}</td>
          <td class="col-num"><b>${num(d.successfulOrders)}</b> <span class="faint small">سفارش</span><span class="ox-cell-sub">${money(d.revenue)}</span></td>
          <td><span class="small">${d.expireDate ? date(d.expireDate) : "بدون انقضا"}</span></td>
          <td>${OA.chip(...dState(d))}</td>
          <td class="col-actions"><button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-menu="${d._id}" aria-label="عملیات">${icon("more")}</button></td></tr>`)}</tbody></table></div>
        <div class="ox-records">${all.map((d) => html`<div class="ox-record" data-id="${d._id}"><div class="ox-record__top"><div class="ox-record__main"><span class="ox-ref">${d.code}</span><span class="ox-cell-sub">${d.type === "percent" ? `${num(d.amount)}٪ تا ${money(d.maxDiscountAmount)}` : money(d.amount)}</span></div><div class="ox-record__side">${OA.chip(...dState(d))}</div></div><div class="ox-record__row">${usage(d)}<span class="small muted">${d.expireDate ? date(d.expireDate) : "بدون انقضا"}</span></div></div>`)}</div>`);
      const find = (id) => all.find((x) => String(x._id) === id);
      $$("[data-id]", body).forEach((r) => { r.addEventListener("click", (e) => { if (!e.target.closest("button")) edit(find(r.dataset.id)); }); r.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === r) edit(find(r.dataset.id)); }); });
      $$("[data-menu]", body).forEach((b) => b.addEventListener("click", () => { const d = find(b.dataset.menu); OA.menu(b, [{ label: "ویرایش", icon: "pen", run: () => edit(d) }, { label: "کپی کد", icon: "copy", run: () => navigator.clipboard && navigator.clipboard.writeText(d.code).then(() => toast("کد کپی شد")) }, "-", { label: "حذف کد", icon: "trash", danger: true, run: () => remove(d) }]); }));
    }
    async function remove(d) {
      if (!(await confirm({ title: "حذف کد تخفیف", message: `کد ${d.code} حذف شود؟`, consequence: d.usedCount ? "این کد قبلاً استفاده شده است؛ برای حفظ سوابق، غیرفعال کردن آن پیشنهاد می‌شود." : "این عملیات برگشت‌پذیر نیست.", confirmText: "حذف کد", danger: true }))) return;
      try { await api(`/admin/discounts/delete/${d._id}`, { method: "DELETE" }); toast("کد تخفیف حذف شد"); load(); } catch (e) { OA.fail(e); }
    }
    function edit(d) {
      const isNew = !d;
      d = d || { code: "", type: "percent", amount: "", maxDiscountAmount: "", minOrderAmount: "", usageLimit: "", expireDate: "", isActive: true, description: "", oneTimePerUser: false };
      const restricted = (d.applicableCategories || []).length || (d.applicableProducts || []).length;
      const group = (title, text, content) => html`<div class="ox-fieldgroup"><div class="ox-fieldgroup__intro"><h3>${title}</h3><p>${text}</p></div><div class="ox-form">${content}</div></div>`;
      const m = OA.modal({
        title: isNew ? "کد تخفیف جدید" : `ویرایش ${d.code}`, sub: isNew ? "" : `${num(d.usedCount || 0)} بار استفاده شده`, iconName: "percent", size: "ox-dialog--l",
        body: html`<form data-f novalidate>
          ${group("اطلاعات کلی", "کدی که مشتری در سبد خرید وارد می‌کند.", html`${field({ label: "کد", req: true, help: "۵ تا ۲۰ حرف انگلیسی یا عدد", control: html`<div class="ox-row ox-row--nowrap"><input class="ox-input ox-input--ltr" style="text-transform:uppercase;letter-spacing:.06em" name="code" maxlength="20" value="${d.code}" placeholder="ODOUR10"><button class="ox-btn" type="button" data-gen>تصادفی</button></div>` })}${field({ label: "توضیحات داخلی", opt: true, control: html`<input class="ox-input" name="description" maxlength="200" value="${d.description || ""}">` })}`)}
          ${group("قانون تخفیف", "درصدی (با سقف) یا مبلغ ثابت به تومان.", html`${field({ label: "نوع تخفیف", control: html`<select class="ox-select" name="type"><option value="percent" ${attr(d.type === "percent", "selected")}>درصدی</option><option value="amount" ${attr(d.type === "amount", "selected")}>مبلغ ثابت</option></select>` })}${field({ label: html`<span data-amount-label>مقدار</span>`, req: true, control: html`<span class="ox-affix"><input class="ox-input ox-input--num" name="amount" inputmode="numeric" value="${d.amount}"><span class="ox-affix__text" data-unit></span></span>` })}<div data-max class="ox-field">${field({ label: "سقف تخفیف", req: true, control: html`<span class="ox-affix"><input class="ox-input ox-input--num" name="maxDiscountAmount" inputmode="numeric" value="${d.maxDiscountAmount || ""}"><span class="ox-affix__text">تومان</span></span>` })}</div>${field({ label: "حداقل مبلغ سفارش", opt: true, control: html`<span class="ox-affix"><input class="ox-input ox-input--num" name="minOrderAmount" inputmode="numeric" value="${d.minOrderAmount || ""}"><span class="ox-affix__text">تومان</span></span>` })}`)}
          ${group("محدودیت استفاده", "سقف کل استفاده و محدودیت هر مشتری.", html`${field({ label: "سقف تعداد استفاده", opt: true, help: "خالی = نامحدود", control: html`<input class="ox-input ox-input--num" name="usageLimit" inputmode="numeric" value="${d.usageLimit || ""}">` })}<div class="ox-field" style="justify-content:center">${toggle({ name: "oneTimePerUser", checked: d.oneTimePerUser, title: "هر مشتری فقط یک بار" })}</div>`)}
          ${group("اعتبار", "زمان‌ها به وقت تهران هستند.", html`${field({ label: "تاریخ انقضا", opt: true, help: d.expireDate ? `فعلی: ${dateTime(d.expireDate)}` : "خالی = بدون انقضا", control: html`<input class="ox-input" type="datetime-local" name="expireDate" value="${toLocal(d.expireDate)}">` })}<div class="ox-field" style="justify-content:center">${toggle({ name: "isActive", checked: d.isActive !== false, title: "کد فعال است" })}</div>`)}
          ${group("محدودیت محصول و دسته", "", html`<div class="span-2">${restricted ? html`<div class="ox-note ox-note--warn">${icon("alert", "ox-i--s")}<span>این کد به ${[(d.applicableCategories || []).map((c) => c.name).join("، "), (d.applicableProducts || []).map((p) => p.name).join("، ")].filter(Boolean).join(" / ")} محدود ثبت شده، اما محاسبه فعلی سبد خرید این محدودیت را اعمال نمی‌کند.</span></div>` : html`<p class="ox-help">محاسبه فعلی سبد خرید محدودیت محصول/دسته را پشتیبانی نمی‌کند؛ این کد روی کل سبد اعمال می‌شود.</p>`}</div>`)}
        </form>`,
        foot: html`<button class="ox-btn" type="button" data-close>انصراف</button><button class="ox-btn ox-btn--primary" type="button" data-ok>${isNew ? "ایجاد کد" : "ذخیره تغییرات"}</button>`,
      });
      const f = $("[data-f]", m.el).elements;
      const sync = () => { const pc = f.type.value === "percent"; $("[data-max]", m.el).hidden = !pc; $("[data-amount-label]", m.el).textContent = pc ? "درصد تخفیف" : "مبلغ تخفیف"; $("[data-unit]", m.el).textContent = pc ? "٪" : "تومان"; };
      f.type.addEventListener("change", sync); sync();
      $("[data-gen]", m.el).addEventListener("click", () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; f.code.value = `OD${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => a[b % a.length]).join("")}`; });
      $("[data-ok]", m.el).addEventListener("click", async (e) => {
        $$(".is-invalid", m.el).forEach((x) => x.classList.remove("is-invalid"));
        const code = OA.toEn(f.code.value).trim().toUpperCase(), amount = OA.intOrNull(f.amount.value), max = OA.intOrNull(f.maxDiscountAmount.value);
        const err = (input, msg) => { input.closest(".ox-field").classList.add("is-invalid"); toast(msg, "error"); };
        if (!/^[A-Z0-9]{5,20}$/.test(code)) return err(f.code, "کد باید ۵ تا ۲۰ حرف انگلیسی یا عدد باشد");
        if (!amount || amount < 1 || (f.type.value === "percent" && amount > 100)) return err(f.amount, f.type.value === "percent" ? "درصد باید بین ۱ تا ۱۰۰ باشد" : "مبلغ تخفیف معتبر وارد کنید");
        if (f.type.value === "percent" && !(max > 0)) return err(f.maxDiscountAmount, "برای تخفیف درصدی سقف تخفیف لازم است");
        const changedExpiry = toLocal(d.expireDate) !== f.expireDate.value;
        const expire = changedExpiry || isNew ? fromLocal(f.expireDate.value) : d.expireDate || null;
        if (expire && new Date(expire) < new Date() && (isNew || changedExpiry)) return err(f.expireDate, "تاریخ انقضا باید در آینده باشد");
        const body = { code, type: f.type.value, amount, maxDiscountAmount: f.type.value === "percent" ? max : null, minOrderAmount: OA.intOrNull(f.minOrderAmount.value), usageLimit: OA.intOrNull(f.usageLimit.value), expireDate: expire, isActive: f.isActive.checked, oneTimePerUser: f.oneTimePerUser.checked, description: f.description.value.trim() };
        try { await busy(e.currentTarget, () => api(isNew ? "/admin/discounts/add" : `/admin/discounts/edit/${d._id}`, { method: isNew ? "POST" : "PUT", body }), isNew ? "کد تخفیف ایجاد شد" : "کد تخفیف ذخیره شد"); m.close(true); load(); } catch (_) {}
      });
    }
    $$("[data-st]", el).forEach((b) => b.addEventListener("click", () => { status = b.dataset.st; $$("[data-st]", el).forEach((x) => x.setAttribute("aria-selected", String(x === b))); router.replaceQuery(status ? { status } : {}); load(); }));
    $("[data-q]", el).addEventListener("input", OA.debounce(load, 350));
    $("[data-new]", el).addEventListener("click", () => edit(null));
    load();
  }

  // ------------------------------------------------------------ banner studio
  const THEMES = { cream: "کرم", olive: "زیتونی", dark: "تیره", light: "روشن" };
  const live = (b) => { const now = Date.now(); if (!b.isActive) return ["غیرفعال", ""]; if (b.startsAt && new Date(b.startsAt) > now) return [`از ${date(b.startsAt)}`, "info"]; if (b.endsAt && new Date(b.endsAt) < now) return ["پایان یافته", "warning"]; return ["در حال نمایش", "success"]; };
  let bannerCache = null;

  function renderBanners(el) {
    const q = router.query();
    let current = q.placement || "";
    set(el, html`${OA.pageHead({ eyebrow: "CONTENT STUDIO", title: "بنرها", subtitle: "بنرهای صفحه اصلی و فروشگاه با زمان‌بندی و ترتیب نمایش", actions: html`<a class="ox-btn ox-btn--primary" href="#/banners/new">${icon("plus", "ox-i--s")}بنر جدید</a>` })}
      <div class="ox-studio"><nav class="ox-placements" data-places aria-label="جایگاه‌ها"></nav><div data-body>${OA.skeletonBlock(300)}</div></div>`);
    const body = $("[data-body]", el);
    let banners = [], placements = OA.boot.bannerPlacements || {};
    const load = async () => { try { const r = await api("/admin/banners"); banners = r.banners; placements = r.placements || placements; bannerCache = { banners, placements }; if (!current || !placements[current]) current = Object.keys(placements)[0]; draw(); } catch (e) { set(body, OA.errorBox(e, load)); } };
    function draw() {
      set($("[data-places]", el), html`<div class="ox-sectionnav__label">جایگاه‌ها</div>${Object.entries(placements).map(([k, l]) => html`<button type="button" data-place="${k}" aria-current="${String(k === current)}"><span class="ellipsis">${l.split("(")[0]}</span><small>${num(banners.filter((b) => b.placement === k).length)}</small></button>`)}`);
      $$("[data-place]", el).forEach((b) => b.addEventListener("click", () => { current = b.dataset.place; router.replaceQuery({ placement: current }); draw(); }));
      const list = banners.filter((b) => b.placement === current);
      set(body, html`<div class="ox-section-title"><div><h2>${placements[current]}</h2><p>${num(list.length)} بنر · ترتیب با دکمه‌های جابه‌جایی</p></div><a class="ox-btn" href="#/banners/new?placement=${current}">${icon("plus", "ox-i--s")}افزودن به این جایگاه</a></div>
        ${list.length ? html`<div class="ox-bcards">${list.map((b, i) => { const [lt, tone] = live(b); return html`<article class="ox-bcard">
          <a class="ox-bcard__art" href="#/banners/${b._id}" aria-label="ویرایش ${b.title}">${b.image?.url ? html`<img src="${b.image.url}" alt="" loading="lazy">` : html`<div class="theme-${b.theme || "cream"}" style="position:absolute;inset:0;display:grid;place-items:center;padding:16px;text-align:center"><b style="font-size:15px">${b.title}</b></div>`}<span class="ox-chip ox-chip--dark ox-chip--plain" style="position:absolute;top:10px;inset-inline-start:10px">#${num(i + 1)}</span></a>
          <div class="ox-bcard__body"><div class="ox-row ox-row--between ox-row--nowrap"><b class="ellipsis">${b.title}</b>${OA.chip(lt, tone)}</div><div class="muted small" style="margin-top:4px">${[b.ctaText, b.url].filter(Boolean).join(" · ") || "بدون دکمه"}</div>
            <div class="faint small" style="margin-top:6px">${b.startsAt || b.endsAt ? `${b.startsAt ? date(b.startsAt) : "اکنون"} تا ${b.endsAt ? date(b.endsAt) : "بدون پایان"}` : "بدون زمان‌بندی"}${b.categorySlug ? ` · دسته ${b.categorySlug}` : ""}</div></div>
          <div class="ox-bcard__foot"><label class="ox-toggle" title="فعال / غیرفعال"><input type="checkbox" data-toggle="${b._id}" ${attr(b.isActive, "checked")}><span class="ox-toggle__ui"></span><span class="sr-only">فعال</span></label><span class="ox-spacer"></span>
            <button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-move="${b._id}" data-dir="-1" aria-label="جلوتر" ${attr(i === 0, "disabled")}>${icon("chevron-r", "ox-i--s")}</button><button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-move="${b._id}" data-dir="1" aria-label="عقب‌تر" ${attr(i === list.length - 1, "disabled")}>${icon("chevron", "ox-i--s")}</button>
            <a class="ox-btn ox-btn--sm" href="#/banners/${b._id}">${icon("pen", "ox-i--s")}ویرایش</a><button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-del="${b._id}" aria-label="حذف">${icon("trash", "ox-i--s")}</button></div></article>`; })}</div>`
          : html`<div class="ox-datacard">${OA.empty({ icon: "image", title: "بنری برای این جایگاه تعریف نشده", action: html`<a class="ox-btn ox-btn--primary" href="#/banners/new?placement=${current}">${icon("plus", "ox-i--s")}افزودن بنر</a>` })}</div>`}`);
      const find = (id) => banners.find((b) => String(b._id) === id);
      $$("[data-toggle]", body).forEach((cb) => cb.addEventListener("change", async () => { try { const r = await api(`/admin/banners/${cb.dataset.toggle}/toggle`, { method: "POST", body: {} }); Object.assign(find(cb.dataset.toggle), r.banner); toast(r.banner.isActive ? "بنر فعال شد" : "بنر غیرفعال شد"); draw(); } catch (e) { cb.checked = !cb.checked; OA.fail(e); } }));
      $$("[data-del]", body).forEach((b) => b.addEventListener("click", async () => { const x = find(b.dataset.del); if (!(await confirm({ title: "حذف بنر", message: `بنر «${x.title}» حذف شود؟`, consequence: "تصاویر آپلودشده‌ای که بنر دیگری از آن‌ها استفاده نکند نیز حذف می‌شوند.", confirmText: "حذف بنر", danger: true }))) return; try { await busy(b, () => api(`/admin/banners/${x._id}`, { method: "DELETE" }), "بنر حذف شد"); load(); } catch (_) {} }));
      $$("[data-move]", body).forEach((b) => b.addEventListener("click", async () => { const x = find(b.dataset.move), l = banners.filter((y) => y.placement === x.placement), i = l.indexOf(x), j = i + Number(b.dataset.dir); [l[i], l[j]] = [l[j], l[i]]; try { await busy(b, () => api("/admin/banners/reorder", { method: "POST", body: { ids: l.map((y) => y._id) } }), "ترتیب ذخیره شد"); load(); } catch (_) {} }));
    }
    load();
  }

  async function renderBannerEditor(el, id) {
    const isNew = id === "new";
    set(el, html`<div class="ox-workhead"><span class="ox-skel" style="width:220px;height:28px"></span></div>${OA.skeletonBlock(420)}`);
    let data = bannerCache;
    try { if (!data || !isNew) { const r = await api("/admin/banners"); data = { banners: r.banners, placements: r.placements }; bannerCache = data; } }
    catch (e) { return set(el, html`${OA.workHead({ title: "بنر" })}${OA.errorBox(e, () => renderBannerEditor(el, id))}`); }
    const placements = data.placements || OA.boot.bannerPlacements;
    const b = isNew ? { placement: router.query().placement || Object.keys(placements)[0], eyebrow: "", title: "", subtitle: "", ctaText: "", url: "", imageAlt: "", theme: "cream", categorySlug: "", isActive: true, startsAt: null, endsAt: null } : data.banners.find((x) => String(x._id) === id);
    if (!b) return set(el, html`${OA.workHead({ title: "بنر" })}${OA.empty({ icon: "image", title: "بنر یافت نشد" })}`);
    const imgs = { image: b.image?.url || "", mobileImage: b.mobileImage?.url || "" };
    let device = "desktop", dirty = false;
    set(el, html`${OA.workHead({ title: isNew ? "بنر جدید" : b.title, meta: html`<span>${placements[b.placement]}</span>${isNew ? "" : OA.chip(...live(b))}` })}
      <form data-f novalidate><div class="ox-workspace ox-workspace--2 ox-workspace--even">
        <div class="ox-editor-sheet ox-form ox-form--1">
          <div class="ox-form">${field({ label: "جایگاه", control: html`<select class="ox-select" name="placement">${Object.entries(placements).map(([k, l]) => html`<option value="${k}" ${attr(b.placement === k, "selected")}>${l}</option>`)}</select>` })}${field({ label: "رنگ‌بندی پنل متن", control: html`<select class="ox-select" name="theme">${Object.entries(THEMES).map(([k, l]) => html`<option value="${k}" ${attr(b.theme === k, "selected")}>${l}</option>`)}</select>` })}</div>
          ${field({ label: "عنوان", req: true, control: html`<input class="ox-input" name="title" maxlength="120" value="${b.title}">`, err: "عنوان بنر الزامی است" })}
          <div class="ox-form">${field({ label: "عنوان کوچک (بالای تیتر)", opt: true, control: html`<input class="ox-input" name="eyebrow" maxlength="60" value="${b.eyebrow || ""}">` })}${field({ label: "متن دکمه (CTA)", opt: true, control: html`<input class="ox-input" name="ctaText" maxlength="40" value="${b.ctaText || ""}">` })}</div>
          ${field({ label: "زیرعنوان", opt: true, control: html`<textarea class="ox-textarea" name="subtitle" maxlength="300" rows="2">${b.subtitle || ""}</textarea>` })}
          ${field({ label: "آدرس مقصد", help: "با / شروع شود یا لینک کامل https", control: html`<input class="ox-input ox-input--ltr" name="url" value="${b.url || ""}" placeholder="/shop?discount=1">`, err: "آدرس مقصد باید با / یا https شروع شود" })}
          <div class="ox-form"><div class="ox-field"><span class="ox-label">تصویر دسکتاپ</span><div data-img="image"></div></div><div class="ox-field"><span class="ox-label">تصویر موبایل</span><div data-img="mobileImage"></div></div></div>
          ${field({ label: "متن جایگزین تصویر", opt: true, control: html`<input class="ox-input" name="imageAlt" maxlength="140" value="${b.imageAlt || ""}">` })}
          <div data-cat>${field({ label: "فقط برای دسته (نامک)", opt: true, help: "خالی = همه صفحات فروشگاه", control: html`<input class="ox-input" name="categorySlug" value="${b.categorySlug || ""}">` })}</div>
          <div class="ox-form">${field({ label: "شروع نمایش", opt: true, control: html`<input class="ox-input" type="datetime-local" name="startsAt" value="${toLocal(b.startsAt)}">` })}${field({ label: "پایان نمایش", opt: true, control: html`<input class="ox-input" type="datetime-local" name="endsAt" value="${toLocal(b.endsAt)}">`, err: "پایان باید بعد از شروع باشد" })}</div>
          <div class="ox-setting" style="border:0">${toggle({ name: "isActive", checked: b.isActive, title: "بنر فعال است", text: "زمان‌ها به وقت تهران هستند." })}</div>
        </div>
        <div class="ox-preview"><div class="ox-row ox-row--between"><b>پیش‌نمایش</b><div class="ox-btn-group" role="group" aria-label="دستگاه پیش‌نمایش"><button type="button" data-dev="desktop" aria-pressed="true">${icon("desktop", "ox-i--s")}دسکتاپ</button><button type="button" data-dev="mobile" aria-pressed="false">${icon("phone", "ox-i--s")}موبایل</button></div></div>
          <div class="ox-bpreview" data-preview></div><p class="ox-help">پیش‌نمایش تقریبی چیدمان است؛ نمایش نهایی به طرح جایگاه در فروشگاه بستگی دارد.</p></div>
      </div>
      <div class="ox-actionbar"><span class="ox-actionbar__state" data-state>${isNew ? "بنر هنوز ذخیره نشده است" : "همه تغییرات ذخیره شده‌اند"}</span><span class="ox-spacer"></span><button class="ox-btn" type="button" data-cancel>بازگشت</button><button class="ox-btn ox-btn--primary" type="submit" data-ok>${icon("save", "ox-i--s")}${isNew ? "ایجاد بنر" : "ذخیره"}</button></div></form>`);
    const formEl = $("[data-f]", el), f = formEl.elements;
    const preview = () => {
      const img = device === "mobile" ? imgs.mobileImage || imgs.image : imgs.image;
      set($("[data-preview]", el), html`<div class="ox-bpreview__frame ox-bpreview__frame--${device}"><div class="ox-bpreview__hero">${img ? html`<img src="${img}" alt="">` : ""}
        <div class="ox-bpreview__panel theme-${f.theme.value}">${f.eyebrow.value ? html`<small>${f.eyebrow.value}</small>` : ""}<h3>${f.title.value || "عنوان بنر"}</h3>${f.subtitle.value ? html`<p>${f.subtitle.value}</p>` : ""}${f.ctaText.value ? html`<span>${f.ctaText.value}</span>` : ""}</div></div></div>`);
      $("[data-cat]", el).hidden = f.placement.value !== "shop_top";
    };
    formEl.addEventListener("input", () => { dirty = true; const s = $("[data-state]", el); s.textContent = "تغییرات ذخیره نشده"; s.classList.add("is-dirty"); preview(); });
    formEl.addEventListener("change", preview);
    OA.protect(() => dirty);
    $$("[data-dev]", el).forEach((x) => x.addEventListener("click", () => { device = x.dataset.dev; $$("[data-dev]", el).forEach((y) => y.setAttribute("aria-pressed", String(y === x))); preview(); }));
    $$("[data-img]", el).forEach((host) => {
      const key = host.dataset.img;
      const draw = () => {
        set(host, html`<div class="ox-row">${imgs[key] ? html`<img class="ox-thumb" style="width:96px;height:56px" src="${imgs[key]}" alt="">` : html`<span class="ox-thumb ox-thumb--empty" style="width:96px;height:56px">${icon(key === "image" ? "desktop" : "phone")}</span>`}<div class="ox-col" style="gap:4px"><button class="ox-btn ox-btn--sm" type="button" data-up>${icon("upload", "ox-i--s")}${imgs[key] ? "تغییر" : "بارگذاری"}</button>${imgs[key] ? html`<button class="ox-btn ox-btn--sm ox-btn--text" type="button" data-rm style="color:var(--danger)">حذف</button>` : ""}</div></div>`);
        $("[data-up]", host).addEventListener("click", () => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/jpeg,image/png,image/webp,image/avif"; i.onchange = async () => { if (!i.files[0]) return; try { const r = await busy($("[data-up]", host), () => upload(`/admin/banners/upload${key === "mobileImage" ? "?kind=mobile" : ""}`, i.files, "image")); imgs[key] = r.url; dirty = true; draw(); preview(); } catch (_) {} }; i.click(); });
        const rm = $("[data-rm]", host); if (rm) rm.addEventListener("click", () => { imgs[key] = ""; dirty = true; draw(); preview(); });
      };
      draw();
    });
    $("[data-cancel]", el).addEventListener("click", () => router.back("banners"));
    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      $$(".is-invalid", el).forEach((x) => x.classList.remove("is-invalid"));
      const bad = (input, msg) => { input.closest(".ox-field").classList.add("is-invalid"); toast(msg, "error"); };
      if (!f.title.value.trim()) return bad(f.title, "عنوان بنر الزامی است");
      const url = f.url.value.trim();
      if (url && !/^\/(?!\/)/.test(url) && !/^https?:\/\//i.test(url)) return bad(f.url, "آدرس مقصد باید با / یا https شروع شود");
      const startsAt = fromLocal(f.startsAt.value), endsAt = fromLocal(f.endsAt.value);
      if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) return bad(f.endsAt, "پایان نمایش باید بعد از شروع باشد");
      const body = { placement: f.placement.value, theme: f.theme.value, eyebrow: f.eyebrow.value, title: f.title.value, subtitle: f.subtitle.value, ctaText: f.ctaText.value, url, imageAlt: f.imageAlt.value, categorySlug: f.placement.value === "shop_top" ? f.categorySlug.value : "", isActive: f.isActive.checked, startsAt, endsAt, image: imgs.image || "", mobileImage: imgs.mobileImage || "" };
      try { await busy($("[data-ok]", el), () => api(isNew ? "/admin/banners" : `/admin/banners/${b._id}`, { method: isNew ? "POST" : "PUT", body }), isNew ? "بنر ایجاد شد" : "بنر ذخیره شد"); dirty = false; bannerCache = null; router.go("banners", [], { placement: body.placement }); } catch (_) {}
    });
    preview();
  }

  OA.section("discounts", { title: "کدهای تخفیف", group: "بازاریابی", nav: true, icon: "percent", perm: "manage_discounts", render: renderDiscounts, quick: { label: "کد تخفیف جدید", icon: "plus", href: "#/discounts" } });
  OA.section("banners", { title: "بنرها", group: "بازاریابی", nav: true, icon: "image", perm: "manage_banners", render(el, { args }) { if (args[0]) renderBannerEditor(el, args[0]); else renderBanners(el); }, quick: { label: "بنر جدید", icon: "plus", href: "#/banners/new" } });
})();
