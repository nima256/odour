/* Admin accounts & permissions, activity history, own account. */
(function () {
  "use strict";
  const { html, raw, set, $, $$, num, icon, api, router, toast, busy, confirm, date, dateTime, ago, boot } = OA;

  const PERMS = {
    manage_orders: ["سفارش‌ها", "مشاهده و پردازش سفارش‌ها، عملیات درگاه"],
    manage_products: ["محصولات", "ایجاد، ویرایش و حذف محصولات"],
    manage_inventory: ["انبار", "تغییر موجودی و ورود CSV"],
    manage_categories: ["دسته‌بندی‌ها", "مدیریت دسته‌های محصول و مجله"],
    manage_brands: ["برندها", "مدیریت برندها"],
    manage_discounts: ["کدهای تخفیف", "ایجاد و ویرایش کدها"],
    manage_banners: ["بنرها", "بنرهای صفحه اصلی و فروشگاه"],
    manage_weblogs: ["مجله", "نوشتن و انتشار مقالات"],
    manage_users: ["مشتریان", "مشاهده پروفایل، آدرس و وضعیت حساب مشتریان"],
    view_analytics: ["گزارش‌ها", "درآمد، منابع ورودی و فعالیت‌ها"],
    manage_admins: ["مدیران", "ایجاد و ویرایش حساب‌های مدیریت"],
  };
  OA.PERMS = PERMS;

  // ----------------------------------------------------------------- admins
  function renderAdmins(el) {
    set(el, html`${OA.pageHead("مدیران و دسترسی‌ها", "حساب‌های پنل، نقش‌ها و مجوزها — همه مجوزها در سرور بررسی می‌شوند", html`<button class="oa-btn oa-btn--primary" data-new>${icon("plus", "oa-icon--sm")} مدیر جدید</button>`)}<div class="oa-card" data-body>${OA.skeletonRows(4)}</div>`);
    const body = $("[data-body]", el);
    let admins = [];
    const load = async () => { try { admins = (await api("/admins")).admins; draw(); } catch (e) { set(body, OA.errorBox(e, load)); } };
    const draw = () => {
      set(body, html`<div class="oa-table-wrap"><table class="oa-table oa-table--cards"><thead><tr><th>مدیر</th><th>نقش</th><th>دسترسی‌ها</th><th>آخرین ورود</th><th>وضعیت</th><th class="col-actions"></th></tr></thead><tbody>
        ${admins.map((a) => html`<tr class="is-clickable" data-id="${a._id}">
          <td class="col-main"><div class="oa-media"><div class="oa-avatar">${a.fullName.charAt(0)}</div><div><span class="oa-cell-title">${a.fullName}${String(a._id) === boot.admin.id ? " (شما)" : ""}</span><span class="oa-cell-sub ltr">${a.email}</span></div></div></td>
          <td data-label="نقش">${a.role === "super_admin" ? OA.badge("مدیر ارشد", "dark") : OA.badge("مدیر", "olive")}</td>
          <td data-label="دسترسی‌ها">${a.role === "super_admin" ? html`<span class="oa-muted">همه بخش‌ها</span>` : !a.permissionsManaged && !a.permissions.length ? html`${OA.badge("دسترسی کامل (حساب قدیمی)", "warn")}` : html`<span class="oa-cell-sub" style="color:inherit">${a.effectivePermissions.map((p) => (PERMS[p] || [p])[0]).join("، ") || "بدون دسترسی"}</span>`}</td>
          <td data-label="آخرین ورود">${a.lastLoginAt ? html`<span>${ago(a.lastLoginAt)}</span><span class="oa-cell-sub ltr">${a.lastLoginIP}</span>` : "—"}</td>
          <td data-label="وضعیت">${a.isActive ? OA.badge("فعال", "good") : OA.badge("غیرفعال", "bad")}</td>
          <td class="col-actions"><a class="oa-btn oa-btn--ghost oa-btn--sm" href="#/activity?admin=${a._id}">${icon("activity", "oa-icon--sm")} فعالیت</a></td></tr>`)}
      </tbody></table></div>`);
      $$("tr[data-id]", body).forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a, button")) edit(admins.find((a) => String(a._id) === tr.dataset.id)); }));
    };
    function edit(a) {
      const isNew = !a;
      const self = a && String(a._id) === boot.admin.id;
      const isSuper = boot.admin.role === "super_admin";
      const locked = a && a.role === "super_admin" && !isSuper;
      a = a || { fullName: "", email: "", role: "admin", permissions: [], effectivePermissions: [], isActive: true };
      const current = new Set(a.permissionsManaged || a.permissions.length || isNew ? a.permissions : a.effectivePermissions);
      const m = OA.modal({
        title: isNew ? "مدیر جدید" : `ویرایش ${a.fullName}`,
        size: "oa-modal--lg",
        body: html`<form class="oa-stack" style="gap:16px" data-f novalidate>
          ${locked ? html`<div class="oa-note">${icon("lock")}<span>فقط مدیر ارشد می‌تواند حساب مدیر ارشد را ویرایش کند.</span></div>` : ""}
          ${!isNew && !a.permissionsManaged && !a.permissions.length && a.role !== "super_admin" ? html`<div class="oa-note">${icon("info")}<span>این حساب قبل از سیستم مجوزها ساخته شده و دسترسی کامل (به‌جز مدیریت مدیران) دارد. با ذخیره، دقیقاً مجوزهای انتخاب‌شده اعمال می‌شوند.</span></div>` : ""}
          <div class="oa-form-grid">
            <label class="oa-field"><span>نام کامل *</span><input class="oa-input" name="fullName" maxlength="50" value="${a.fullName}" ${raw(locked ? "disabled" : "")}></label>
            <label class="oa-field"><span>ایمیل ${isNew ? "*" : ""}</span><input class="oa-input ltr" name="email" type="email" value="${a.email}" ${raw(isNew ? "" : "disabled")}></label>
            ${isNew ? html`<label class="oa-field"><span>رمز عبور *</span><input class="oa-input ltr" name="password" type="password" autocomplete="new-password" minlength="10"><small>حداقل ۱۰ کاراکتر</small></label>` : ""}
            <label class="oa-field"><span>نقش</span><select class="oa-select" name="role" ${raw(!isSuper || self ? "disabled" : "")}><option value="admin" ${raw(a.role !== "super_admin" ? "selected" : "")}>مدیر (با مجوزهای انتخابی)</option><option value="super_admin" ${raw(a.role === "super_admin" ? "selected" : "")}>مدیر ارشد (همه دسترسی‌ها)</option></select>${!isSuper ? html`<small>فقط مدیر ارشد نقش را تعیین می‌کند.</small>` : ""}</label>
          </div>
          <div data-perms><div class="oa-label" style="margin-bottom:8px">مجوزها</div><div class="oa-perm-grid">${Object.entries(PERMS).map(([k, [t, s]]) => html`<label class="oa-perm"><input type="checkbox" value="${k}" ${raw(current.has(k) ? "checked" : "")} ${raw(locked || !boot.permissions.includes(k) ? "disabled" : "")}><div><b>${t}</b><span>${s}</span></div></label>`)}</div></div>
          ${!isNew ? html`<label class="oa-switch"><input type="checkbox" name="isActive" ${raw(a.isActive ? "checked" : "")} ${raw(self || locked ? "disabled" : "")}><span class="oa-switch__track"></span><span>حساب فعال است ${self ? "(نمی‌توانید حساب خودتان را غیرفعال کنید)" : ""}</span></label>
          <div class="oa-inline" style="justify-content:space-between;border-top:1px solid var(--oa-border);padding-top:14px"><span class="oa-muted" style="font-size:12.5px">ایجاد: ${date(a.createdAt)} · آخرین ورود: ${dateTime(a.lastLoginAt)}</span>${!locked ? html`<button type="button" class="oa-btn oa-btn--sm" data-reset>${icon("lock", "oa-icon--sm")} تعیین رمز جدید</button>` : ""}</div>` : ""}
        </form>`,
        foot: locked ? html`<button class="oa-btn" data-close>بستن</button>` : html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn oa-btn--primary" data-ok>${isNew ? "ایجاد مدیر" : "ذخیره"}</button>`,
      });
      const f = $("[data-f]", m.el).elements;
      const syncRole = () => ($("[data-perms]", m.el).hidden = f.role.value === "super_admin");
      f.role.addEventListener("change", syncRole); syncRole();
      const reset = $("[data-reset]", m.el);
      if (reset) reset.addEventListener("click", () => resetPassword(a));
      const ok = $("[data-ok]", m.el);
      if (ok) ok.addEventListener("click", async (e) => {
        const permissions = $$("[data-perms] input:checked", m.el).map((i) => i.value);
        const body = { fullName: f.fullName.value.trim(), role: f.role.value, permissions };
        if (f.fullName.value.trim().length < 3) return toast("نام کامل حداقل ۳ کاراکتر است", "error");
        if (isNew) {
          body.email = f.email.value.trim();
          body.password = f.password.value;
          if (body.password.length < 10) return toast("رمز عبور حداقل ۱۰ کاراکتر است", "error");
        } else {
          if (f.role.disabled) delete body.role;
          body.isActive = f.isActive.checked;
          if (a.role === "super_admin" && body.role !== "admin") delete body.permissions;
        }
        if (body.role === "admin" && !permissions.length && !(await confirm({ title: "بدون مجوز", message: "این مدیر به هیچ بخشی دسترسی نخواهد داشت. ادامه می‌دهید؟", confirmText: "ادامه" }))) return;
        try {
          await busy(e.currentTarget, () => api(isNew ? "/admins" : `/admins/${a._id}`, { method: isNew ? "POST" : "PUT", body }), (r) => r.message);
          m.close(true); load();
        } catch (_) {}
      });
    }
    function resetPassword(a) {
      const m = OA.modal({ title: `رمز جدید برای ${a.fullName}`, body: html`<label class="oa-field"><span>رمز عبور جدید (حداقل ۱۰ کاراکتر)</span><input class="oa-input ltr" type="password" autocomplete="new-password" data-p1></label><label class="oa-field" style="margin-top:12px"><span>تکرار رمز</span><input class="oa-input ltr" type="password" autocomplete="new-password" data-p2></label>`, foot: html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn oa-btn--primary" data-ok>ثبت رمز</button>` });
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
  function renderActivity(el) {
    set(el, html`${OA.pageHead("فعالیت‌ها", "تاریخچه کامل تغییرات انجام‌شده توسط مدیران")}<div data-list></div>`);
    const ACTIONS = OA.ACTIONS || {};
    const TYPES = { product: "محصول", order: "سفارش", category: "دسته‌بندی", brand: "برند", discount: "کد تخفیف", weblog: "مقاله", banner: "بنر", customer: "مشتری", admin: "مدیر" };
    let adminsLoaded = false;
    const list = OA.list($("[data-list]", el), {
      endpoint: "/activity",
      defaults: {},
      searchPlaceholder: "نام مورد…",
      filters: [
        { name: "targetType", label: "بخش", options: [["", "همه بخش‌ها"], ...Object.entries(TYPES)] },
        { name: "action", label: "عملیات", options: [["", "همه عملیات‌ها"], ...Object.entries(ACTIONS)] },
        { name: "days", label: "بازه", options: [["", "همه زمان‌ها"], ["1", "امروز"], ["7", "۷ روز"], ["30", "۳۰ روز"], ["90", "۹۰ روز"]] },
      ],
      toolbarExtra: html`<label><span class="sr-only">مدیر</span><select class="oa-select" data-admin aria-label="مدیر"><option value="">همه مدیران</option></select></label>`,
      onData: (d) => {
        if (adminsLoaded) return;
        adminsLoaded = true;
        const sel = $("[data-admin]", el);
        set(sel, html`<option value="">همه مدیران</option>${d.admins.map((a) => html`<option value="${a._id}" ${raw(String(list.state.admin || "") === String(a._id) ? "selected" : "")}>${a.fullName}</option>`)}`);
        sel.addEventListener("change", () => list.setParam("admin", sel.value));
      },
      columns: [
        { label: "عملیات", cls: "col-main", main: true, render: (a) => html`<span class="oa-cell-title">${ACTIONS[a.action] || a.action}: ${a.targetName}</span><span class="oa-cell-sub">${a.details || ""}</span>` },
        { label: "بخش", render: (a) => OA.badge(TYPES[a.targetType] || a.targetType, "") },
        { label: "مدیر", render: (a) => html`${a.adminName}` },
        { label: "زمان", render: (a) => html`<span>${dateTime(a.createdAtTimestamp)}</span><span class="oa-cell-sub">${ago(a.createdAtTimestamp)}</span>` },
        { label: "IP", render: (a) => html`<span class="oa-cell-sub ltr">${a.ipAddress || ""}</span>` },
        { label: "", cls: "col-actions", render: (a) => (a.targetType === "order" && OA.can("manage_orders") ? html`<a class="oa-link" href="#/orders/${a.targetId}">سفارش</a>` : a.targetType === "product" && OA.can("manage_products") && a.action !== "delete_product" ? html`<a class="oa-link" href="#/products/${a.targetId}">محصول</a>` : "") },
      ],
      empty: () => OA.empty("فعالیتی با این فیلترها ثبت نشده است", "", "activity"),
    });
  }

  // ---------------------------------------------------------------- account
  function renderAccount(el) {
    set(el, html`${OA.pageHead("حساب من", "اطلاعات ورود و امنیت حساب")}
      <div class="oa-grid oa-grid--2">
        <section class="oa-card"><div class="oa-card__head"><h3>اطلاعات حساب</h3></div><div class="oa-card__body" data-me>${OA.skeletonRows(3, 1)}</div></section>
        <section class="oa-card"><div class="oa-card__head"><h3>تغییر رمز عبور</h3></div><form class="oa-card__body oa-stack" style="gap:12px" data-pw novalidate>
          <label class="oa-field"><span>رمز فعلی</span><input class="oa-input ltr" type="password" name="current" autocomplete="current-password"></label>
          <label class="oa-field"><span>رمز جدید</span><input class="oa-input ltr" type="password" name="next" autocomplete="new-password"><small>حداقل ۱۰ کاراکتر؛ ترکیبی از حروف، عدد و نماد توصیه می‌شود.</small></label>
          <label class="oa-field"><span>تکرار رمز جدید</span><input class="oa-input ltr" type="password" name="again" autocomplete="new-password"></label>
          <div><button class="oa-btn oa-btn--primary" data-save>تغییر رمز</button></div>
        </form></section>
      </div>`);
    api("/me").then((r) => {
      set($("[data-me]", el), html`<dl class="oa-kv"><dt>نام</dt><dd>${r.admin.fullName}</dd><dt>ایمیل</dt><dd class="ltr">${r.admin.email}</dd><dt>نقش</dt><dd>${r.admin.role === "super_admin" ? "مدیر ارشد" : "مدیر"}</dd><dt>آخرین ورود</dt><dd>${dateTime(r.admin.lastLoginAt)} <span class="ltr oa-muted">${r.admin.lastLoginIP || ""}</span></dd>
        <dt>دسترسی‌ها</dt><dd>${r.permissions.map((p) => (PERMS[p] || [p])[0]).join("، ")}</dd></dl>`);
    }).catch((e) => set($("[data-me]", el), OA.errorBox(e)));
    const form = $("[data-pw]", el);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = form.elements;
      if (f.next.value.length < 10) return toast("رمز جدید حداقل ۱۰ کاراکتر است", "error");
      if (f.next.value !== f.again.value) return toast("تکرار رمز مطابقت ندارد", "error");
      try { await busy($("[data-save]", form), () => api("/me/password", { method: "POST", body: { currentPassword: f.current.value, newPassword: f.next.value } }), "رمز عبور تغییر کرد"); form.reset(); } catch (_) {}
    });
    void num; void router;
  }

  OA.section("admins", { title: "مدیران و دسترسی‌ها", group: "تنظیمات", nav: true, icon: "shield", perm: "manage_admins", render: renderAdmins });
  OA.section("activity", { title: "فعالیت‌ها", group: "تنظیمات", nav: true, icon: "activity", perm: ["view_analytics", "manage_admins"], render: renderActivity });
  OA.section("account", { title: "حساب من", group: "تنظیمات", nav: true, icon: "user", render: renderAccount });
})();
