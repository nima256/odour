/* Administration — admins & permissions, activity audit feed, own account. */
(function () {
  "use strict";
  const { html, set, $, $$, num, icon, api, router, toast, busy, confirm, date, dateTime, time, ago, attr, field, toggle, boot } = OA;

  const PERMS = {
    manage_orders: ["سفارش‌ها", "مشاهده و پردازش سفارش‌ها، عملیات درگاه"],
    manage_users: ["مشتریان", "پروفایل، آدرس و وضعیت حساب مشتریان"],
    manage_products: ["محصولات", "ایجاد، ویرایش و حذف محصولات"],
    manage_inventory: ["انبار", "تغییر موجودی و ورود CSV"],
    manage_categories: ["دسته‌بندی‌ها", "دسته‌های محصول و مجله"],
    manage_brands: ["برندها", "مدیریت برندها"],
    manage_discounts: ["کدهای تخفیف", "ایجاد و ویرایش کدها"],
    manage_banners: ["بنرها", "بنرهای صفحه اصلی و فروشگاه"],
    manage_weblogs: ["مجله", "نوشتن و انتشار مقالات"],
    view_analytics: ["گزارش‌ها", "درآمد، منابع ورودی و فعالیت‌ها"],
    manage_admins: ["مدیران", "ایجاد و ویرایش حساب‌های مدیریت"],
  };
  const PERM_GROUPS = [
    ["تجارت", ["manage_orders", "manage_users"]],
    ["کاتالوگ", ["manage_products", "manage_inventory", "manage_categories", "manage_brands"]],
    ["بازاریابی و محتوا", ["manage_discounts", "manage_banners", "manage_weblogs"]],
    ["مدیریت و گزارش", ["view_analytics", "manage_admins"]],
  ];
  OA.PERMS = PERMS;
  const permNames = (list) => list.map((p) => (PERMS[p] || [p])[0]).join("، ");
  const roleChip = (a) => (a.role === "super_admin" ? OA.chip("مدیر ارشد", "primary") : OA.chip("مدیر", ""));
  const statusChip = (a) => (a.isActive ? OA.chip("فعال", "success") : OA.chip("غیرفعال", "danger"));
  const permSummary = (a) => (a.role === "super_admin" ? html`<span class="muted">همه بخش‌ها</span>` : !a.permissionsManaged && !a.permissions.length ? OA.chip("دسترسی کامل (حساب قدیمی)", "warning") : html`<span class="small">${a.effectivePermissions.length ? html`<b>${num(a.effectivePermissions.length)}</b> بخش · <span class="muted">${permNames(a.effectivePermissions.slice(0, 3))}${a.effectivePermissions.length > 3 ? "…" : ""}</span>` : html`<span class="muted">بدون دسترسی</span>`}</span>`);

  // ----------------------------------------------------------------- admins
  function renderAdmins(el) {
    set(el, html`${OA.pageHead({ title: "مدیران و دسترسی‌ها", count: "", subtitle: "حساب‌های پنل، نقش‌ها و مجوزها — همه مجوزها در سرور بررسی می‌شوند.", actions: html`<button class="ox-btn ox-btn--primary" type="button" data-new>${icon("plus", "ox-i--s")}مدیر جدید</button>` })}
      <div class="ox-datacard" data-body>${OA.skeletonTable(4)}</div>`);
    const body = $("[data-body]", el);
    let admins = [];
    const load = async () => { try { admins = (await api("/admins")).admins; draw(); } catch (e) { set(body, OA.errorBox(e, load)); } };
    const isMe = (a) => String(a._id) === String(boot.admin.id);
    const draw = () => {
      const hc = $("[data-head-count]", el); if (hc) hc.textContent = `${num(admins.length)} حساب`;
      set(body, html`<div class="ox-table-wrap has-records"><table class="ox-table"><thead><tr><th>مدیر</th><th>نقش</th><th>دسترسی‌ها</th><th>آخرین ورود</th><th>وضعیت</th><th class="col-actions"><span class="sr-only">عملیات</span></th></tr></thead><tbody>
        ${admins.map((a, i) => html`<tr class="is-link" tabindex="0" data-i="${i}">
          <td><div class="ox-entity"><span class="ox-avatar">${a.fullName.charAt(0)}</span><div><span class="ox-cell-main">${a.fullName}${isMe(a) ? html` <span class="muted small">(شما)</span>` : ""}</span><span class="ox-cell-sub ltr">${a.email}</span></div></div></td>
          <td>${roleChip(a)}</td><td>${permSummary(a)}</td>
          <td>${a.lastLoginAt ? html`<span>${ago(a.lastLoginAt)}</span><span class="ox-cell-sub ltr">${a.lastLoginIP || ""}</span>` : html`<span class="muted">هرگز</span>`}</td>
          <td>${statusChip(a)}</td>
          <td class="col-actions"><button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-menu aria-label="عملیات">${icon("more")}</button></td></tr>`)}
      </tbody></table></div>
      <div class="ox-records">${admins.map((a, i) => html`<div class="ox-record is-link" data-i="${i}"><div class="ox-record__top"><span class="ox-avatar">${a.fullName.charAt(0)}</span><div class="ox-record__main"><span class="ox-cell-main">${a.fullName}${isMe(a) ? " (شما)" : ""}</span><span class="ox-cell-sub ltr">${a.email}</span></div><button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-menu aria-label="عملیات">${icon("more")}</button></div>
        <div class="ox-record__row">${roleChip(a)}${statusChip(a)}<span class="muted small">${a.lastLoginAt ? `ورود ${ago(a.lastLoginAt)}` : "بدون ورود"}</span></div></div>`)}</div>`);
      $$("[data-i]", body).forEach((row) => {
        const a = admins[Number(row.dataset.i)];
        row.addEventListener("click", (e) => { if (!e.target.closest("button, a")) edit(a); });
        row.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === row) edit(a); });
        $("[data-menu]", row).addEventListener("click", (e) => OA.menu(e.currentTarget, [
          { label: "ویرایش دسترسی‌ها", icon: "shield", run: () => edit(a) },
          a.role !== "super_admin" || boot.admin.role === "super_admin" ? { label: "تعیین رمز جدید", icon: "lock", run: () => resetPassword(a) } : null,
          OA.can("view_analytics", "manage_admins") ? { label: "فعالیت‌های این مدیر", icon: "activity", href: `#/activity?admin=${a._id}` } : null,
        ]));
      });
    };

    function edit(a) {
      const isNew = !a;
      const self = a && isMe(a);
      const isSuper = boot.admin.role === "super_admin";
      const locked = a && a.role === "super_admin" && !isSuper;
      a = a || { fullName: "", email: "", role: "admin", permissions: [], effectivePermissions: [], isActive: true };
      const legacy = !isNew && !a.permissionsManaged && !a.permissions.length && a.role !== "super_admin";
      const current = new Set(a.permissionsManaged || a.permissions.length || isNew ? a.permissions : a.effectivePermissions);
      const m = OA.modal({
        title: isNew ? "مدیر جدید" : a.fullName, sub: isNew ? "حساب ورود به پنل با مجوزهای انتخابی" : a.email, iconName: "shield", size: "ox-dialog--l",
        body: html`<form class="ox-col" style="gap:20px" data-f novalidate>
          ${locked ? html`<div class="ox-note ox-note--warn">${icon("lock", "ox-i--s")}<span>فقط مدیر ارشد می‌تواند حساب مدیر ارشد را ویرایش کند.</span></div>` : ""}
          ${legacy ? html`<div class="ox-note">${icon("info", "ox-i--s")}<span>این حساب قبل از سیستم مجوزها ساخته شده و دسترسی کامل (به‌جز مدیریت مدیران) دارد. با ذخیره، دقیقاً مجوزهای انتخاب‌شده اعمال می‌شوند.</span></div>` : ""}
          <div class="ox-form">
            ${field({ label: "نام کامل", req: true, control: html`<input class="ox-input" name="fullName" maxlength="50" value="${a.fullName}" ${attr(locked, "disabled")}>`, err: "نام کامل حداقل ۳ کاراکتر است" })}
            ${field({ label: "ایمیل", req: isNew, control: html`<input class="ox-input ox-input--ltr" name="email" type="email" value="${a.email}" ${attr(!isNew, "disabled")}>` })}
            ${isNew ? field({ label: "رمز عبور", req: true, help: "حداقل ۱۰ کاراکتر", control: html`<input class="ox-input ox-input--ltr" name="password" type="password" autocomplete="new-password" minlength="10">`, err: "رمز عبور حداقل ۱۰ کاراکتر است" }) : ""}
            ${field({ label: "نقش", help: !isSuper ? "فقط مدیر ارشد نقش را تعیین می‌کند." : self ? "نقش حساب خودتان قابل تغییر نیست." : "", control: html`<select class="ox-select" name="role" ${attr(!isSuper || self, "disabled")}><option value="admin" ${attr(a.role !== "super_admin", "selected")}>مدیر (مجوزهای انتخابی)</option><option value="super_admin" ${attr(a.role === "super_admin", "selected")}>مدیر ارشد (همه دسترسی‌ها)</option></select>` })}
          </div>
          <div data-perms><div class="ox-row ox-row--between" style="margin-bottom:10px"><span class="ox-label" style="margin:0">مجوزهای دسترسی</span><span class="muted small" data-pcount></span></div>
            <div class="ox-permgroups">${PERM_GROUPS.map(([g, keys]) => html`<div class="ox-permgroup"><div class="ox-permgroup__h">${g}</div>${keys.map((k) => html`<label class="ox-perm"><input type="checkbox" class="ox-check" value="${k}" ${attr(current.has(k), "checked")} ${attr(locked || !(boot.permissions || []).includes(k), "disabled")}><span class="ox-perm__text"><b>${PERMS[k][0]}</b><span>${PERMS[k][1]}</span></span></label>`)}</div>`)}</div>
            <p class="ox-help" style="margin-top:8px">فقط مجوزهایی را می‌توانید اعطا کنید که خودتان دارید.</p></div>
          ${!isNew ? html`<div class="ox-setting" style="border-top:1px solid var(--line);border-bottom:0">${toggle({ name: "isActive", checked: a.isActive, title: "حساب فعال است", text: self ? "نمی‌توانید حساب خودتان را غیرفعال کنید." : "حساب غیرفعال نمی‌تواند وارد پنل شود.", attrs: self || locked ? "disabled" : "" })}</div>
            <div class="ox-row ox-row--between muted small"><span>ایجاد ${date(a.createdAt)} · آخرین ورود ${dateTime(a.lastLoginAt)}</span>${!locked ? html`<button type="button" class="ox-btn ox-btn--sm" data-reset>${icon("lock", "ox-i--s")}تعیین رمز جدید</button>` : ""}</div>` : ""}
        </form>`,
        foot: locked ? html`<button class="ox-btn" type="button" data-close>بستن</button>` : html`<button class="ox-btn" type="button" data-close>انصراف</button><button class="ox-btn ox-btn--primary" type="button" data-ok>${isNew ? "ایجاد مدیر" : "ذخیره تغییرات"}</button>`,
      });
      const f = $("[data-f]", m.el).elements;
      const count = () => ($("[data-pcount]", m.el).textContent = `${num($$("[data-perms] input:checked", m.el).length)} از ${num(Object.keys(PERMS).length)} مجوز`);
      const syncRole = () => ($("[data-perms]", m.el).hidden = f.role.value === "super_admin");
      f.role.addEventListener("change", syncRole); syncRole();
      $("[data-perms]", m.el).addEventListener("change", count); count();
      const reset = $("[data-reset]", m.el);
      if (reset) reset.addEventListener("click", () => resetPassword(a));
      const ok = $("[data-ok]", m.el);
      if (!ok) return;
      ok.addEventListener("click", async (e) => {
        $$(".is-invalid", m.el).forEach((x) => x.classList.remove("is-invalid"));
        const permissions = $$("[data-perms] input:checked", m.el).map((i) => i.value);
        const body = { fullName: f.fullName.value.trim(), role: f.role.value, permissions };
        if (body.fullName.length < 3) { f.fullName.closest(".ox-field").classList.add("is-invalid"); return toast("نام کامل حداقل ۳ کاراکتر است", "error"); }
        if (isNew) {
          body.email = f.email.value.trim();
          body.password = f.password.value;
          if (body.password.length < 10) { f.password.closest(".ox-field").classList.add("is-invalid"); return toast("رمز عبور حداقل ۱۰ کاراکتر است", "error"); }
        } else {
          if (f.role.disabled) delete body.role;
          body.isActive = f.isActive.checked;
          if (a.role === "super_admin" && body.role !== "admin") delete body.permissions;
          if (body.role && body.role !== a.role && !(await confirm({ title: "تغییر نقش مدیر", message: `نقش ${a.fullName} به «${body.role === "super_admin" ? "مدیر ارشد" : "مدیر"}» تغییر کند؟`, consequence: body.role === "super_admin" ? "مدیر ارشد به همه بخش‌ها، از جمله مدیریت سایر مدیران، دسترسی کامل دارد." : "دسترسی این حساب به مجوزهای انتخاب‌شده محدود می‌شود.", confirmText: "تغییر نقش", danger: body.role === "super_admin" }))) return;
          if (a.isActive && !body.isActive && !(await confirm({ title: "غیرفعال‌سازی حساب مدیر", message: `حساب ${a.fullName} غیرفعال شود؟`, consequence: "این مدیر دیگر نمی‌تواند وارد پنل شود. سوابق فعالیت حفظ می‌شود و هر زمان قابل فعال‌سازی است.", confirmText: "غیرفعال کن", danger: true }))) return;
        }
        if ((body.role || a.role) === "admin" && !permissions.length && !(await confirm({ title: "بدون مجوز", message: "این مدیر به هیچ بخشی دسترسی نخواهد داشت. ادامه می‌دهید؟", confirmText: "ادامه" }))) return;
        try {
          await busy(e.currentTarget, () => api(isNew ? "/admins" : `/admins/${a._id}`, { method: isNew ? "POST" : "PUT", body }), (r) => r.message || "ذخیره شد");
          m.close(true); load();
        } catch (_) {}
      });
    }

    function resetPassword(a) {
      const m = OA.modal({
        title: "تعیین رمز جدید", sub: a.fullName, iconName: "lock", size: "ox-dialog--s",
        body: html`<div class="ox-form ox-form--1">${field({ label: "رمز عبور جدید", help: "حداقل ۱۰ کاراکتر", control: html`<input class="ox-input ox-input--ltr" type="password" autocomplete="new-password" data-p1>` })}${field({ label: "تکرار رمز", control: html`<input class="ox-input ox-input--ltr" type="password" autocomplete="new-password" data-p2>` })}</div>`,
        foot: html`<button class="ox-btn" type="button" data-close>انصراف</button><button class="ox-btn ox-btn--primary" type="button" data-ok>ثبت رمز</button>`,
      });
      $("[data-ok]", m.el).addEventListener("click", async (e) => {
        const p1 = $("[data-p1]", m.el).value;
        if (p1.length < 10) return toast("رمز عبور حداقل ۱۰ کاراکتر است", "error");
        if (p1 !== $("[data-p2]", m.el).value) return toast("تکرار رمز مطابقت ندارد", "error");
        try { await busy(e.currentTarget, () => api(`/admins/${a._id}/password`, { method: "POST", body: { password: p1 } }), "رمز عبور تغییر کرد"); m.close(true); } catch (_) {}
      });
    }
    $("[data-new]", el).addEventListener("click", () => edit(null));
    load();
  }

  // --------------------------------------------------------------- activity
  const TYPES = { product: "محصول", order: "سفارش", category: "دسته‌بندی", brand: "برند", discount: "کد تخفیف", weblog: "مقاله", banner: "بنر", customer: "مشتری", admin: "مدیر" };
  const kind = (a) => (/admin_log|change_password|_admin$/.test(a) ? "auth" : /^create/.test(a) ? "create" : /^delete/.test(a) ? "delete" : /payment/.test(a) ? "money" : /inventory/.test(a) ? "stock" : "update");
  const KIND_ICON = { auth: "lock", create: "plus", delete: "trash", money: "card", stock: "layers", update: "pen" };

  function renderActivity(el) {
    const ACTIONS = OA.ACTIONS || {};
    const q0 = router.query();
    const st = { targetType: q0.targetType || "", action: q0.action || "", admin: q0.admin || "", days: q0.days || "", q: q0.q || "", page: Number(q0.page) || 1 };
    const sel = (name, label, opts) => html`<select class="ox-select" data-f="${name}" aria-label="${label}">${opts.map(([v, l]) => html`<option value="${v}" ${attr(String(st[name]) === String(v), "selected")}>${l}</option>`)}</select>`;
    set(el, html`${OA.pageHead({ title: "گزارش فعالیت‌ها", count: "", subtitle: "سابقه کامل تغییراتی که مدیران در پنل انجام داده‌اند." })}
      <div class="ox-datacard" style="margin-bottom:8px"><div class="ox-toolbar">
        <label class="ox-searchbox">${icon("search")}<span class="sr-only">جستجو</span><input class="ox-input" type="search" data-q placeholder="نام مورد…" value="${st.q}"></label>
        ${sel("targetType", "بخش", [["", "همه بخش‌ها"], ...Object.entries(TYPES)])}
        ${sel("action", "عملیات", [["", "همه عملیات‌ها"], ...Object.entries(ACTIONS)])}
        <select class="ox-select" data-f="admin" aria-label="مدیر"><option value="">همه مدیران</option></select>
        ${sel("days", "بازه", [["", "همه زمان‌ها"], ["1", "امروز"], ["7", "۷ روز اخیر"], ["30", "۳۰ روز اخیر"], ["90", "۹۰ روز اخیر"]])}
        <button class="ox-btn ox-filters-btn" type="button" data-mfilters>${icon("filter", "ox-i--s")} فیلترها<span data-fcount></span></button>
        <span class="ox-toolbar__count" data-total></span></div></div>
      <div data-feed>${OA.skeletonBlock(80)}${OA.skeletonBlock(80)}${OA.skeletonBlock(80)}</div><div class="ox-datacard" data-pager-wrap hidden><div data-pager></div></div>`);
    const feed = $("[data-feed]", el);
    let adminsLoaded = false, seq = 0;
    const load = async () => {
      const my = ++seq;
      const q = {}; Object.entries(st).forEach(([k, v]) => { if (v && !(k === "page" && v === 1)) q[k] = v; });
      router.replaceQuery(q);
      feed.style.opacity = "0.5";
      try {
        const d = await api("/activity", { query: st });
        if (my !== seq) return;
        feed.style.opacity = "";
        if (!adminsLoaded) {
          adminsLoaded = true;
          const s = $("[data-f=admin]", el);
          set(s, html`<option value="">همه مدیران</option>${d.admins.map((a) => html`<option value="${a._id}" ${attr(String(st.admin) === String(a._id), "selected")}>${a.fullName}</option>`)}`);
        }
        $("[data-total]", el).textContent = `${num(d.total)} رویداد`;
        const hc = $("[data-head-count]", el); if (hc) hc.textContent = `${num(d.total)} رویداد`;
        if (!d.items.length) { set(feed, html`<div class="ox-datacard">${OA.empty({ icon: "activity", title: "فعالیتی با این فیلترها ثبت نشده است", text: "بازه زمانی یا فیلترها را تغییر دهید." })}</div>`); $("[data-pager-wrap]", el).hidden = true; return; }
        const days = [];
        d.items.forEach((a) => { const k = OA.dayKey(a.createdAtTimestamp); const last = days[days.length - 1]; if (last && last.k === k) last.items.push(a); else days.push({ k, items: [a] }); });
        const today = OA.tehranToday();
        const link = (a) => (a.targetType === "order" && OA.can("manage_orders") ? html`<a class="ox-link" href="#/orders/${a.targetId}">مشاهده سفارش ${icon("chevron", "ox-i--s")}</a>`
          : a.targetType === "product" && OA.can("manage_products") && a.action !== "delete_product" ? html`<a class="ox-link" href="#/products/${a.targetId}">مشاهده محصول ${icon("chevron", "ox-i--s")}</a>`
          : a.targetType === "customer" && OA.can("manage_users") ? html`<a class="ox-link" href="#/customers/${a.targetId}">مشاهده مشتری ${icon("chevron", "ox-i--s")}</a>` : "");
        set(feed, html`<div class="ox-audit">${days.map((g) => html`<div class="ox-audit__day">${g.k === today ? "امروز · " : ""}${OA.dayLong(g.k)}</div>
          ${g.items.map((a) => { const k = kind(a.action); return html`<div class="ox-audit__item"><span class="ox-audit__time">${time(a.createdAtTimestamp)}</span><span class="ox-audit__ic ox-audit__ic--${k}">${icon(KIND_ICON[k])}</span>
            <div style="min-width:0"><h4>${ACTIONS[a.action] || a.action}: ${a.targetName}</h4>${a.details ? html`<p>${a.details}</p>` : ""}<p class="ox-row" style="gap:10px;margin-top:6px"><span class="ox-row" style="gap:6px"><span class="ox-avatar ox-avatar--light" style="width:22px;height:22px;font-size:11px;border-radius:5px">${(a.adminName || "؟").charAt(0)}</span>${a.adminName}</span>${OA.chip(TYPES[a.targetType] || a.targetType, "", true)}${a.ipAddress ? html`<span class="ltr small">${a.ipAddress}</span>` : ""}<span class="small">${ago(a.createdAtTimestamp)}</span></p></div>
            <div>${link(a)}</div></div>`; })}`)}</div>`);
        const pw = $("[data-pager-wrap]", el);
        pw.hidden = !(d.pages > 1);
        set($("[data-pager]", el), OA.pager(d, (p) => { st.page = p; load(); scrollTo({ top: 0 }); }));
      } catch (e) {
        if (my !== seq) return;
        feed.style.opacity = "";
        set(feed, OA.errorBox(e, load));
      }
    };
    const FILTERS = ["targetType", "action", "admin", "days"];
    const syncCount = () => { const n = FILTERS.filter((k) => st[k]).length; $("[data-fcount]", el).textContent = n ? ` (${num(n)})` : ""; };
    $$("[data-f]", el).forEach((s) => s.addEventListener("change", () => { st[s.dataset.f] = s.value; st.page = 1; syncCount(); load(); }));
    $("[data-mfilters]", el).addEventListener("click", () => {
      const labels = { targetType: "بخش", action: "عملیات", admin: "مدیر", days: "بازه زمانی" };
      const m = OA.modal({ title: "فیلترها", size: "ox-dialog--s",
        body: html`<div class="ox-form ox-form--1">${FILTERS.map((k) => html`<label class="ox-field"><span class="ox-label">${labels[k]}</span>${OA.raw($(`[data-f=${k}]`, el).outerHTML.replace("data-f=", "data-mf="))}</label>`)}</div>`,
        foot: html`<button class="ox-btn" type="button" data-reset>پاک کردن</button><button class="ox-btn ox-btn--primary" type="button" data-ok>اعمال فیلترها</button>` });
      $$("[data-mf]", m.el).forEach((s) => (s.value = st[s.dataset.mf] || ""));
      const apply = (vals) => { FILTERS.forEach((k) => { st[k] = vals[k] || ""; $(`[data-f=${k}]`, el).value = st[k]; }); st.page = 1; m.close(true); syncCount(); load(); };
      $("[data-reset]", m.el).addEventListener("click", () => apply({}));
      $("[data-ok]", m.el).addEventListener("click", () => apply(Object.fromEntries($$("[data-mf]", m.el).map((s) => [s.dataset.mf, s.value]))));
    });
    syncCount();
    const qi = $("[data-q]", el);
    qi.addEventListener("input", OA.debounce(() => { st.q = qi.value.trim(); st.page = 1; load(); }, 350));
    load();
  }

  // ---------------------------------------------------------------- account
  function renderAccount(el) {
    set(el, html`${OA.pageHead({ title: "حساب من", subtitle: "اطلاعات حساب و امنیت ورود به پنل" })}
      <div class="ox-panel" style="max-width:980px"><div class="ox-panel__body" style="padding:24px 28px">
        <section class="ox-fieldgroup"><div class="ox-fieldgroup__intro"><h3>پروفایل</h3><p>اطلاعات حساب، نقش و بخش‌هایی که به آن‌ها دسترسی دارید.</p></div><div data-me>${OA.skeletonBlock(160)}</div></section>
        <section class="ox-fieldgroup"><div class="ox-fieldgroup__intro"><h3>امنیت</h3><p>رمز عبور قوی انتخاب کنید و آن را با کسی به اشتراک نگذارید. پس از تغییر، از رمز جدید برای ورودهای بعدی استفاده می‌شود.</p></div>
          <form class="ox-form ox-form--1" style="max-width:420px" data-pw novalidate>
            ${field({ label: "رمز فعلی", control: html`<input class="ox-input ox-input--ltr" type="password" name="current" autocomplete="current-password">` })}
            ${field({ label: "رمز جدید", help: "حداقل ۱۰ کاراکتر؛ ترکیبی از حروف، عدد و نماد توصیه می‌شود.", control: html`<input class="ox-input ox-input--ltr" type="password" name="next" autocomplete="new-password">`, err: "رمز جدید حداقل ۱۰ کاراکتر است" })}
            ${field({ label: "تکرار رمز جدید", control: html`<input class="ox-input ox-input--ltr" type="password" name="again" autocomplete="new-password">`, err: "تکرار رمز مطابقت ندارد" })}
            <div><button class="ox-btn ox-btn--primary" type="submit" data-save>${icon("lock", "ox-i--s")}تغییر رمز عبور</button></div>
          </form></section>
      </div></div>`);
    api("/me").then((r) => {
      const a = r.admin;
      set($("[data-me]", el), html`<div class="ox-row" style="gap:16px;margin-bottom:18px"><span class="ox-avatar ox-avatar--xl ox-avatar--light">${(a.fullName || "؟").charAt(0)}</span><div><b style="font-size:18px;display:block">${a.fullName}</b><span class="ltr muted">${a.email}</span><div style="margin-top:6px">${roleChip(a)}</div></div></div>
        <dl class="ox-kv"><dt>آخرین ورود</dt><dd>${dateTime(a.lastLoginAt)} <span class="ltr muted small">${a.lastLoginIP || ""}</span></dd>
        <dt>دسترسی‌ها</dt><dd><div class="ox-row" style="gap:6px">${(r.permissions || []).map((p) => OA.chip((PERMS[p] || [p])[0], "", true))}</div></dd></dl>`);
    }).catch((e) => set($("[data-me]", el), OA.errorBox(e)));
    const form = $("[data-pw]", el);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = form.elements;
      $$(".is-invalid", form).forEach((x) => x.classList.remove("is-invalid"));
      if (f.next.value.length < 10) { f.next.closest(".ox-field").classList.add("is-invalid"); return toast("رمز جدید حداقل ۱۰ کاراکتر است", "error"); }
      if (f.next.value !== f.again.value) { f.again.closest(".ox-field").classList.add("is-invalid"); return toast("تکرار رمز مطابقت ندارد", "error"); }
      try { await busy($("[data-save]", form), () => api("/me/password", { method: "POST", body: { currentPassword: f.current.value, newPassword: f.next.value } }), "رمز عبور تغییر کرد"); form.reset(); } catch (_) {}
    });
  }

  OA.section("admins", { title: "مدیران و دسترسی‌ها", short: "مدیران", group: "مدیریت", nav: true, icon: "shield", perm: "manage_admins", render: renderAdmins });
  OA.section("activity", { title: "گزارش فعالیت‌ها", short: "فعالیت‌ها", group: "مدیریت", nav: true, icon: "activity", perm: ["view_analytics", "manage_admins"], render: renderActivity });
  OA.section("account", { title: "حساب من", short: "حساب من", group: "مدیریت", nav: true, icon: "user", render: renderAccount });
})();
