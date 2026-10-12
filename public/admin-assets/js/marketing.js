/* Discount codes and storefront banners. */
(function () {
  "use strict";
  const { html, raw, set, $, $$, num, money, icon, api, upload, toast, busy, confirm, date, dateTime, router } = OA;

  // -------------------------------------------------------------- discounts
  const discountState = (d) => {
    if (!d.isActive) return OA.badge("غیرفعال", "");
    if (d.isExpired) return OA.badge("منقضی", "bad");
    if (d.remaining === 0) return OA.badge("تمام شده", "warn");
    return OA.badge("فعال", "good");
  };
  const toLocalInput = (v) => {
    if (!v) return "";
    const d = new Date(v);
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
  };
  // datetime-local values are entered in Tehran time
  const fromLocalInput = (v) => (v ? new Date(`${v}:00+03:30`).toISOString() : null);

  function renderDiscounts(el) {
    const q = router.query();
    let status = q.status || "";
    set(el, html`${OA.pageHead("کدهای تخفیف", "ایجاد کد، محدودیت استفاده و گزارش عملکرد", html`<button class="oa-btn oa-btn--primary" data-new>${icon("plus", "oa-icon--sm")} کد جدید</button>`)}
      <div class="oa-card"><div class="oa-toolbar"><div class="oa-tabs" role="tablist">${[["", "همه"], ["active", "فعال"], ["inactive", "غیرفعال"], ["expired", "منقضی"]].map(([v, l]) => html`<button class="oa-tab" role="tab" data-st="${v}" aria-selected="${String(status === v)}">${l}</button>`)}</div>
      <label class="oa-search">${icon("search")}<input class="oa-input ltr" type="search" data-q placeholder="جستجوی کد…"></label></div><div data-body>${OA.skeletonRows(5)}</div></div>`);
    const body = $("[data-body]", el);
    let all = [];
    const load = async () => {
      try { all = (await api("/discounts", { query: { status, q: $("[data-q]", el).value } })).discounts; draw(); } catch (e) { set(body, OA.errorBox(e, load)); }
    };
    const draw = () => {
      if (!all.length) return set(body, OA.empty("کد تخفیفی وجود ندارد", "", "percent"));
      set(body, html`<div class="oa-table-wrap"><table class="oa-table oa-table--cards"><thead><tr><th>کد</th><th>مقدار</th><th>شرایط</th><th>استفاده</th><th>فروش موفق با این کد</th><th>انقضا</th><th>وضعیت</th><th class="col-actions"></th></tr></thead><tbody>
        ${all.map((d) => html`<tr class="is-clickable" data-id="${d._id}">
          <td class="col-main"><span class="oa-cell-title ltr" style="letter-spacing:.04em">${d.code}</span><span class="oa-cell-sub">${d.description || ""}</span></td>
          <td data-label="مقدار">${d.type === "percent" ? html`<b class="num">${num(d.amount)}٪</b><span class="oa-cell-sub">سقف ${money(d.maxDiscountAmount)}</span>` : html`<b class="num">${money(d.amount)}</b>`}</td>
          <td data-label="شرایط"><span class="oa-cell-sub" style="color:inherit">${[d.minOrderAmount ? `حداقل سفارش ${money(d.minOrderAmount)}` : "", d.oneTimePerUser ? "یک‌بار برای هر کاربر" : ""].filter(Boolean).join(" · ") || "—"}</span></td>
          <td data-label="استفاده" class="num">${num(d.usedCount || 0)}${d.usageLimit ? html` / ${num(d.usageLimit)}` : html` <span class="oa-muted" style="font-size:12px">(نامحدود)</span>`}</td>
          <td data-label="فروش موفق"><span class="num">${num(d.successfulOrders)}</span><span class="oa-cell-sub">${money(d.revenue)} · تخفیف ${money(d.discountGiven)}</span></td>
          <td data-label="انقضا">${d.expireDate ? date(d.expireDate) : "—"}</td>
          <td data-label="وضعیت">${discountState(d)}</td>
          <td class="col-actions"><button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm oa-btn--danger" data-del="${d._id}" aria-label="حذف">${icon("trash", "oa-icon--sm")}</button></td></tr>`)}
      </tbody></table></div>`);
      $$("tr[data-id]", body).forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("button")) edit(all.find((x) => String(x._id) === tr.dataset.id)); }));
      $$("[data-del]", body).forEach((b) => b.addEventListener("click", async () => {
        const d = all.find((x) => String(x._id) === b.dataset.del);
        if (!(await confirm({ title: "حذف کد تخفیف", message: `کد ${d.code} حذف شود؟${d.usedCount ? " این کد قبلاً استفاده شده است؛ برای حفظ سوابق بهتر است آن را غیرفعال کنید." : ""}`, confirmText: "حذف", danger: true }))) return;
        try { await busy(b, () => api(`/admin/discounts/delete/${d._id}`, { method: "DELETE" }), "کد تخفیف حذف شد"); load(); } catch (_) {}
      }));
    };
    function edit(d) {
      const isNew = !d;
      d = d || { code: "", type: "percent", amount: "", maxDiscountAmount: "", minOrderAmount: "", usageLimit: "", expireDate: "", isActive: true, description: "", oneTimePerUser: false };
      const restricted = (d.applicableCategories || []).length || (d.applicableProducts || []).length;
      const m = OA.modal({
        title: isNew ? "کد تخفیف جدید" : `ویرایش ${d.code}`,
        size: "oa-modal--lg",
        body: html`<form class="oa-form-grid" data-f novalidate>
          <label class="oa-field"><span>کد *</span><div class="oa-inline" style="flex-wrap:nowrap"><input class="oa-input ltr" style="text-transform:uppercase" name="code" maxlength="20" value="${d.code}" placeholder="ODOUR10"><button type="button" class="oa-btn oa-btn--sm" data-gen>ساخت تصادفی</button></div><small>۵ تا ۲۰ حرف انگلیسی یا عدد</small></label>
          <label class="oa-field"><span>نوع تخفیف</span><select class="oa-select" name="type"><option value="percent" ${raw(d.type === "percent" ? "selected" : "")}>درصدی</option><option value="amount" ${raw(d.type === "amount" ? "selected" : "")}>مبلغ ثابت (تومان)</option></select></label>
          <label class="oa-field"><span data-amount-label>${d.type === "percent" ? "درصد تخفیف *" : "مبلغ تخفیف (تومان) *"}</span><input class="oa-input num" name="amount" inputmode="numeric" value="${d.amount}"></label>
          <label class="oa-field" data-max><span>سقف تخفیف (تومان) *</span><input class="oa-input num" name="maxDiscountAmount" inputmode="numeric" value="${d.maxDiscountAmount || ""}"></label>
          <label class="oa-field"><span>حداقل مبلغ سفارش (تومان)</span><input class="oa-input num" name="minOrderAmount" inputmode="numeric" value="${d.minOrderAmount || ""}"></label>
          <label class="oa-field"><span>سقف تعداد استفاده</span><input class="oa-input num" name="usageLimit" inputmode="numeric" value="${d.usageLimit || ""}" placeholder="نامحدود"></label>
          <label class="oa-field"><span>تاریخ انقضا</span><input class="oa-input" type="datetime-local" name="expireDate" value="${toLocalInput(d.expireDate)}"><small>${d.expireDate ? `فعلی: ${dateTime(d.expireDate)} (به وقت تهران)` : "خالی = بدون انقضا"}</small></label>
          <label class="oa-field"><span>توضیحات داخلی</span><input class="oa-input" name="description" maxlength="200" value="${d.description || ""}"></label>
          <label class="oa-switch"><input type="checkbox" name="oneTimePerUser" ${raw(d.oneTimePerUser ? "checked" : "")}><span class="oa-switch__track"></span><span>هر مشتری فقط یک بار</span></label>
          <label class="oa-switch"><input type="checkbox" name="isActive" ${raw(d.isActive !== false ? "checked" : "")}><span class="oa-switch__track"></span><span>فعال</span></label>
          ${restricted ? html`<div class="oa-note span-all">${icon("info")}<span>این کد در پایگاه داده به ${[(d.applicableCategories || []).map((c) => c.name).join("، "), (d.applicableProducts || []).map((p) => p.name).join("، ")].filter(Boolean).join(" / ")} محدود شده، اما محاسبه فعلی سبد خرید این محدودیت را اعمال نمی‌کند.</span></div>` : ""}
          ${!isNew ? html`<p class="oa-help span-all" style="margin:0">تاکنون ${num(d.usedCount || 0)} بار استفاده شده است. تغییر مقدار تخفیف روی سفارش‌های ثبت‌شده اثری ندارد.</p>` : ""}
        </form>`,
        foot: html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn oa-btn--primary" data-ok>${isNew ? "ایجاد کد" : "ذخیره"}</button>`,
      });
      const f = $("[data-f]", m.el).elements;
      const syncType = () => { $("[data-max]", m.el).hidden = f.type.value !== "percent"; $("[data-amount-label]", m.el).textContent = f.type.value === "percent" ? "درصد تخفیف *" : "مبلغ تخفیف (تومان) *"; };
      f.type.addEventListener("change", syncType); syncType();
      $("[data-gen]", m.el).addEventListener("click", () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; f.code.value = `OD${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => a[b % a.length]).join("")}`; });
      $("[data-ok]", m.el).addEventListener("click", async (e) => {
        const code = OA.toEn(f.code.value).trim().toUpperCase();
        const amount = OA.intOrNull(f.amount.value);
        const max = OA.intOrNull(f.maxDiscountAmount.value);
        const errs = [];
        if (!/^[A-Z0-9]{5,20}$/.test(code)) errs.push("کد باید ۵ تا ۲۰ حرف انگلیسی یا عدد باشد");
        if (!amount || amount < 1 || (f.type.value === "percent" && amount > 100)) errs.push(f.type.value === "percent" ? "درصد باید بین ۱ تا ۱۰۰ باشد" : "مبلغ تخفیف معتبر وارد کنید");
        if (f.type.value === "percent" && !(max > 0)) errs.push("برای تخفیف درصدی سقف تخفیف لازم است");
        const expire = fromLocalInput(f.expireDate.value);
        const expireChanged = (expire || "") !== (d.expireDate ? new Date(d.expireDate).toISOString() : "") && toLocalInput(d.expireDate) !== f.expireDate.value;
        if (expire && new Date(expire) < new Date() && (isNew || expireChanged)) errs.push("تاریخ انقضا باید در آینده باشد");
        if (errs.length) return toast(errs[0], "error");
        const body = {
          code, type: f.type.value, amount, maxDiscountAmount: f.type.value === "percent" ? max : null,
          minOrderAmount: OA.intOrNull(f.minOrderAmount.value), usageLimit: OA.intOrNull(f.usageLimit.value),
          expireDate: expireChanged || isNew ? expire : d.expireDate || null,
          isActive: f.isActive.checked, oneTimePerUser: f.oneTimePerUser.checked, description: f.description.value.trim(),
        };
        try {
          await busy(e.currentTarget, () => api(isNew ? "/admin/discounts/add" : `/admin/discounts/edit/${d._id}`, { method: isNew ? "POST" : "PUT", body }), isNew ? "کد تخفیف ایجاد شد" : "کد تخفیف ذخیره شد");
          m.close(true); load();
        } catch (_) {}
      });
    }
    $$("[data-st]", el).forEach((b) => b.addEventListener("click", () => { status = b.dataset.st; $$("[data-st]", el).forEach((x) => x.setAttribute("aria-selected", String(x === b))); router.replaceQuery(status ? { status } : {}); load(); }));
    $("[data-q]", el).addEventListener("input", OA.debounce(load, 350));
    $("[data-new]", el).addEventListener("click", () => edit(null));
    load();
  }

  // ---------------------------------------------------------------- banners
  const THEMES = { cream: "کرم", olive: "زیتونی", dark: "تیره", light: "روشن" };
  const bannerLive = (b) => {
    const now = Date.now();
    if (!b.isActive) return OA.badge("غیرفعال", "");
    if (b.startsAt && new Date(b.startsAt).getTime() > now) return OA.badge(`زمان‌بندی: ${date(b.startsAt)}`, "info");
    if (b.endsAt && new Date(b.endsAt).getTime() < now) return OA.badge("پایان یافته", "warn");
    return OA.badge("در حال نمایش", "good");
  };

  function renderBanners(el) {
    set(el, html`${OA.pageHead("بنرها", "بنرهای صفحه اصلی و فروشگاه با زمان‌بندی و ترتیب نمایش", html`<button class="oa-btn oa-btn--primary" data-new>${icon("plus", "oa-icon--sm")} بنر جدید</button>`)}<div data-body class="oa-stack">${OA.skeletonRows(5)}</div>`);
    const body = $("[data-body]", el);
    let banners = [];
    let placements = OA.boot.bannerPlacements || {};
    const load = async () => {
      try { const r = await api("/admin/banners"); banners = r.banners; placements = r.placements || placements; draw(); } catch (e) { set(body, OA.errorBox(e, load)); }
    };
    const draw = () => {
      set(body, html`${Object.entries(placements).map(([key, label]) => {
        const list = banners.filter((b) => b.placement === key);
        return html`<section class="oa-card"><div class="oa-card__head"><h3>${label}</h3><button class="oa-btn oa-btn--sm" data-new-in="${key}">${icon("plus", "oa-icon--sm")} افزودن</button></div>
          ${list.length ? html`<ul class="oa-list">${list.map((b, i) => html`<li>
            <div class="oa-inline" style="flex-direction:column;gap:2px"><button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm" data-move="${b._id}" data-dir="-1" aria-label="بالاتر" ${raw(i === 0 ? "disabled" : "")}>${icon("chevron-up", "oa-icon--sm")}</button><button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm" data-move="${b._id}" data-dir="1" aria-label="پایین‌تر" ${raw(i === list.length - 1 ? "disabled" : "")}>${icon("chevron-down", "oa-icon--sm")}</button></div>
            ${b.image?.url ? html`<img class="oa-thumb" style="width:96px;height:56px" src="${b.image.url}" alt="">` : html`<div class="oa-thumb" style="width:96px;height:56px;display:grid;place-items:center;font-size:11px;color:var(--oa-muted)">${THEMES[b.theme] || ""}</div>`}
            <div class="oa-list__main"><b>${b.title}</b><span>${[b.ctaText, b.url, b.categorySlug && `دسته: ${b.categorySlug}`].filter(Boolean).join(" · ")}</span></div>
            ${bannerLive(b)}
            <label class="oa-switch" title="فعال / غیرفعال"><input type="checkbox" data-toggle="${b._id}" ${raw(b.isActive ? "checked" : "")}><span class="oa-switch__track"></span><span class="sr-only">فعال</span></label>
            <button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm" data-edit="${b._id}" aria-label="ویرایش">${icon("pen", "oa-icon--sm")}</button>
            <button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm oa-btn--danger" data-del="${b._id}" aria-label="حذف">${icon("trash", "oa-icon--sm")}</button>
          </li>`)}</ul>` : html`<div class="oa-card__body oa-muted" style="font-size:13px">بنری برای این جایگاه تعریف نشده است.</div>`}
        </section>`;
      })}`);
      const find = (id) => banners.find((b) => String(b._id) === id);
      $$("[data-new-in]", body).forEach((b) => b.addEventListener("click", () => edit(null, b.dataset.newIn)));
      $$("[data-edit]", body).forEach((b) => b.addEventListener("click", () => edit(find(b.dataset.edit))));
      $$("[data-toggle]", body).forEach((cb) => cb.addEventListener("change", async () => {
        try { const r = await api(`/admin/banners/${cb.dataset.toggle}/toggle`, { method: "POST", body: {} }); toast(r.banner.isActive ? "بنر فعال شد" : "بنر غیرفعال شد"); Object.assign(find(cb.dataset.toggle), r.banner); draw(); } catch (e) { cb.checked = !cb.checked; OA.fail(e); }
      }));
      $$("[data-del]", body).forEach((b) => b.addEventListener("click", async () => {
        const x = find(b.dataset.del);
        if (!(await confirm({ title: "حذف بنر", message: `بنر «${x.title}» حذف شود؟`, confirmText: "حذف", danger: true }))) return;
        try { await busy(b, () => api(`/admin/banners/${x._id}`, { method: "DELETE" }), "بنر حذف شد"); load(); } catch (_) {}
      }));
      $$("[data-move]", body).forEach((b) => b.addEventListener("click", async () => {
        const x = find(b.dataset.move);
        const list = banners.filter((y) => y.placement === x.placement);
        const i = list.indexOf(x);
        const j = i + Number(b.dataset.dir);
        [list[i], list[j]] = [list[j], list[i]];
        try { await busy(b, () => api("/admin/banners/reorder", { method: "POST", body: { ids: list.map((y) => y._id) } }), "ترتیب ذخیره شد"); load(); } catch (_) {}
      }));
    };
    function edit(b, placement) {
      const isNew = !b;
      b = b || { placement: placement || "home_hero", eyebrow: "", title: "", subtitle: "", ctaText: "", url: "", imageAlt: "", theme: "cream", categorySlug: "", isActive: true, startsAt: null, endsAt: null };
      const imgs = { image: b.image?.url || "", mobileImage: b.mobileImage?.url || "" };
      const m = OA.modal({
        title: isNew ? "بنر جدید" : "ویرایش بنر",
        size: "oa-modal--lg",
        body: html`<form class="oa-form-grid" data-f novalidate>
          <label class="oa-field"><span>جایگاه</span><select class="oa-select" name="placement">${Object.entries(placements).map(([k, l]) => html`<option value="${k}" ${raw(b.placement === k ? "selected" : "")}>${l}</option>`)}</select></label>
          <label class="oa-field"><span>رنگ‌بندی</span><select class="oa-select" name="theme">${Object.entries(THEMES).map(([k, l]) => html`<option value="${k}" ${raw(b.theme === k ? "selected" : "")}>${l}</option>`)}</select></label>
          <label class="oa-field"><span>عنوان کوچک (بالای تیتر)</span><input class="oa-input" name="eyebrow" maxlength="60" value="${b.eyebrow || ""}"></label>
          <label class="oa-field"><span>عنوان *</span><input class="oa-input" name="title" maxlength="120" value="${b.title}"></label>
          <label class="oa-field span-all"><span>زیرعنوان</span><textarea class="oa-textarea" name="subtitle" maxlength="300" rows="2">${b.subtitle || ""}</textarea></label>
          <label class="oa-field"><span>متن دکمه (CTA)</span><input class="oa-input" name="ctaText" maxlength="40" value="${b.ctaText || ""}"></label>
          <label class="oa-field"><span>آدرس مقصد</span><input class="oa-input ltr" style="text-align:left" name="url" value="${b.url || ""}" placeholder="/shop?discount=1"><small>با / شروع شود یا لینک کامل https</small></label>
          <div class="oa-field"><span>تصویر دسکتاپ</span><div data-img="image"></div></div>
          <div class="oa-field"><span>تصویر موبایل</span><div data-img="mobileImage"></div></div>
          <label class="oa-field"><span>متن جایگزین تصویر</span><input class="oa-input" name="imageAlt" maxlength="140" value="${b.imageAlt || ""}"></label>
          <label class="oa-field" data-cat-slug><span>فقط برای دسته (نامک)</span><input class="oa-input" name="categorySlug" value="${b.categorySlug || ""}" placeholder="خالی = همه صفحات فروشگاه"></label>
          <label class="oa-field"><span>شروع نمایش</span><input class="oa-input" type="datetime-local" name="startsAt" value="${toLocalInput(b.startsAt)}"></label>
          <label class="oa-field"><span>پایان نمایش</span><input class="oa-input" type="datetime-local" name="endsAt" value="${toLocalInput(b.endsAt)}"></label>
          <label class="oa-switch span-all"><input type="checkbox" name="isActive" ${raw(b.isActive ? "checked" : "")}><span class="oa-switch__track"></span><span>فعال</span></label>
          <p class="oa-help span-all" style="margin:0">زمان‌ها به وقت تهران هستند. ترتیب نمایش از فهرست بنرها با دکمه‌های بالا/پایین تنظیم می‌شود.</p>
        </form>`,
        foot: html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn oa-btn--primary" data-ok>${isNew ? "ایجاد بنر" : "ذخیره"}</button>`,
      });
      const f = $("[data-f]", m.el).elements;
      const syncSlug = () => ($("[data-cat-slug]", m.el).hidden = f.placement.value !== "shop_top");
      f.placement.addEventListener("change", syncSlug); syncSlug();
      $$("[data-img]", m.el).forEach((host) => {
        const key = host.dataset.img;
        const draw = () => {
          set(host, html`<div class="oa-inline">${imgs[key] ? html`<img class="oa-thumb" style="width:96px;height:56px" src="${imgs[key]}" alt="">` : ""}<button type="button" class="oa-btn oa-btn--sm" data-up>${icon("upload", "oa-icon--sm")} ${imgs[key] ? "تغییر" : "بارگذاری"}</button>${imgs[key] ? html`<button type="button" class="oa-btn oa-btn--sm oa-btn--danger" data-rm>حذف</button>` : ""}</div>`);
          $("[data-up]", host).addEventListener("click", () => {
            const i = document.createElement("input"); i.type = "file"; i.accept = "image/jpeg,image/png,image/webp,image/avif";
            i.onchange = async () => { if (!i.files[0]) return; try { const r = await busy($("[data-up]", host), () => upload(`/admin/banners/upload${key === "mobileImage" ? "?kind=mobile" : ""}`, i.files, "image")); imgs[key] = r.url; draw(); } catch (_) {} };
            i.click();
          });
          const rm = $("[data-rm]", host);
          if (rm) rm.addEventListener("click", () => { imgs[key] = ""; draw(); });
        };
        draw();
      });
      $("[data-ok]", m.el).addEventListener("click", async (e) => {
        if (!f.title.value.trim()) return toast("عنوان بنر الزامی است", "error");
        const url = f.url.value.trim();
        if (url && !/^\/(?!\/)/.test(url) && !/^https?:\/\//i.test(url)) return toast("آدرس مقصد باید با / یا https شروع شود", "error");
        const startsAt = fromLocalInput(f.startsAt.value);
        const endsAt = fromLocalInput(f.endsAt.value);
        if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) return toast("پایان نمایش باید بعد از شروع باشد", "error");
        const body = { placement: f.placement.value, theme: f.theme.value, eyebrow: f.eyebrow.value, title: f.title.value, subtitle: f.subtitle.value, ctaText: f.ctaText.value, url, imageAlt: f.imageAlt.value, categorySlug: f.placement.value === "shop_top" ? f.categorySlug.value : "", isActive: f.isActive.checked, startsAt, endsAt, image: imgs.image || "", mobileImage: imgs.mobileImage || "" };
        try {
          await busy(e.currentTarget, () => api(isNew ? "/admin/banners" : `/admin/banners/${b._id}`, { method: isNew ? "POST" : "PUT", body }), isNew ? "بنر ایجاد شد" : "بنر ذخیره شد");
          m.close(true); load();
        } catch (_) {}
      });
    }
    $("[data-new]", el).addEventListener("click", () => edit(null));
    load();
  }

  OA.section("discounts", { title: "کدهای تخفیف", group: "بازاریابی", nav: true, icon: "percent", perm: "manage_discounts", render: renderDiscounts });
  OA.section("banners", { title: "بنرها", group: "بازاریابی", nav: true, icon: "image", perm: "manage_banners", render: renderBanners });
})();
