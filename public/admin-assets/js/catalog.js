/* Categories (nested, product & blog) and brands. */
(function () {
  "use strict";
  const { html, raw, set, $, $$, num, icon, api, upload, toast, fail, busy, confirm, router } = OA;

  const ICONS = { "": "بدون آیکن", "cat-perfume-women": "عطر زنانه", "cat-perfume-men": "عطر مردانه", "cat-skin": "مراقبت پوست", "cat-hair": "مراقبت مو", "cat-lipstick": "آرایشی", "cat-brush": "ابزار آرایش", "cat-body": "بدن", "cat-device": "لوازم برقی", "cat-default": "عمومی" };

  // Single image field backed by /admin/upload-image
  function imageField(host, initial, onChange) {
    let url = initial || "";
    const draw = () => {
      set(host, html`<div class="oa-inline">${url ? html`<img class="oa-thumb" style="width:64px;height:64px" src="${url}" alt="">` : ""}<button type="button" class="oa-btn oa-btn--sm" data-up>${icon("upload", "oa-icon--sm")} ${url ? "تغییر" : "بارگذاری تصویر"}</button>${url ? html`<button type="button" class="oa-btn oa-btn--sm oa-btn--danger" data-rm>حذف</button>` : ""}</div>`);
      $("[data-up]", host).addEventListener("click", () => {
        const i = document.createElement("input"); i.type = "file"; i.accept = "image/jpeg,image/png,image/webp";
        i.onchange = async () => { if (!i.files[0]) return; const b = $("[data-up]", host); try { const r = await busy(b, () => upload("/admin/upload-image", i.files, "image")); url = r.url; onChange(url); draw(); } catch (_) {} };
        i.click();
      });
      const rm = $("[data-rm]", host);
      if (rm) rm.addEventListener("click", () => { url = ""; onChange(""); draw(); });
    };
    draw();
  }
  OA.imageField = imageField;

  // ------------------------------------------------------------ categories
  function renderCategories(el) {
    const q = router.query();
    let type = q.type === "weblog" ? "weblog" : "product";
    set(el, html`${OA.pageHead("دسته‌بندی‌ها", "ساختار درختی دسته‌های محصول و مجله", OA.can("manage_categories") ? html`<button class="oa-btn oa-btn--primary" data-new>${icon("plus", "oa-icon--sm")} دسته جدید</button>` : "")}
      <div class="oa-card"><div class="oa-toolbar"><div class="oa-tabs" role="tablist"><button class="oa-tab" role="tab" data-type="product" aria-selected="${String(type === "product")}">دسته‌های محصول</button><button class="oa-tab" role="tab" data-type="weblog" aria-selected="${String(type === "weblog")}">دسته‌های مجله</button></div>
      <label class="oa-search">${icon("search")}<input class="oa-input" type="search" data-q placeholder="جستجوی دسته…"></label></div><div data-body>${OA.skeletonRows(6)}</div></div>`);
    const body = $("[data-body]", el);
    let all = [];
    const load = async () => {
      try { all = (await api("/categories", { query: { type } })).categories; draw(); } catch (e) { set(body, OA.errorBox(e, load)); }
    };
    const draw = () => {
      const term = $("[data-q]", el).value.trim();
      const byParent = new Map();
      all.forEach((c) => { const k = c.parentId ? String(c.parentId) : ""; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(c); });
      const ids = new Set(all.map((c) => String(c._id)));
      const roots = all.filter((c) => !c.parentId || !ids.has(String(c.parentId)));
      const rows = [];
      const walk = (c, depth) => { rows.push({ c, depth }); (byParent.get(String(c._id)) || []).forEach((ch) => walk(ch, depth + 1)); };
      roots.forEach((c) => walk(c, 0));
      const shown = term ? rows.filter((r) => r.c.name.includes(term)) : rows;
      if (!shown.length) return set(body, OA.empty("دسته‌ای وجود ندارد", "", "tag"));
      set(body, html`<div class="oa-table-wrap"><table class="oa-table oa-table--cards"><thead><tr><th>نام</th><th>نامک</th><th>${type === "product" ? "محصولات" : "مقالات"}</th><th>ترتیب</th><th>وضعیت</th><th class="col-actions"></th></tr></thead><tbody>
        ${shown.map(({ c, depth }) => html`<tr class="is-clickable" data-id="${c._id}">
          <td class="col-main"><div class="oa-media" style="padding-inline-start:${depth * 22}px">${depth ? html`<span class="oa-muted">└</span>` : ""}${c.img ? html`<img class="oa-thumb oa-thumb--sm" src="${c.img}" alt="">` : ""}<div><span class="oa-cell-title">${c.name}</span>${c.metaTitle ? html`<span class="oa-cell-sub">${c.metaTitle}</span>` : ""}</div></div></td>
          <td data-label="نامک"><span class="oa-cell-sub" style="color:inherit">${c.slug}</span></td>
          <td data-label="${type === "product" ? "محصولات" : "مقالات"}" class="num">${type === "product" ? html`${num(c.productCount)} <span class="oa-muted" style="font-size:12px">(${num(c.publishedCount)} منتشر)</span>` : num(c.weblogCount)}</td>
          <td data-label="ترتیب" class="num">${num(c.displayOrder || 0)}</td>
          <td data-label="وضعیت">${c.isActive === false ? OA.badge("غیرفعال", "") : OA.badge("فعال", "good")}</td>
          <td class="col-actions">${OA.can("manage_categories") ? html`<button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm oa-btn--danger" data-del="${c._id}" aria-label="حذف">${icon("trash", "oa-icon--sm")}</button>` : ""}</td></tr>`)}
      </tbody></table></div>`);
      $$("tr[data-id]", body).forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.closest("button")) return; if (OA.can("manage_categories")) edit(all.find((c) => String(c._id) === tr.dataset.id)); }));
      $$("[data-del]", body).forEach((b) => b.addEventListener("click", async () => {
        const c = all.find((x) => String(x._id) === b.dataset.del);
        if (!(await confirm({ title: "حذف دسته‌بندی", message: `«${c.name}» حذف شود؟ دسته‌های دارای زیردسته، محصول یا مقاله قابل حذف نیستند.`, confirmText: "حذف", danger: true }))) return;
        try { await busy(b, () => api(`/admin/categories/delete/${c._id}`, { method: "DELETE" }), "دسته‌بندی حذف شد"); OA.getLookups(true).catch(() => {}); load(); } catch (_) {}
      }));
    };
    function edit(c) {
      const isNew = !c;
      c = c || { name: "", categoryType: type, parentId: "", img: "", description: "", metaTitle: "", metaDescription: "", metaKeywords: "", isActive: true, displayOrder: 0, icon: "" };
      const descendants = new Set();
      if (!isNew) { const stack = [String(c._id)]; while (stack.length) { const id = stack.pop(); descendants.add(id); all.filter((x) => String(x.parentId) === id).forEach((x) => stack.push(String(x._id))); } }
      let img = c.img || "";
      const m = OA.modal({
        title: isNew ? "دسته‌بندی جدید" : `ویرایش «${c.name}»`,
        size: "oa-modal--lg",
        body: html`<form class="oa-form-grid" data-f novalidate>
          <label class="oa-field"><span>نام *</span><input class="oa-input" name="name" maxlength="50" value="${c.name}" required></label>
          <label class="oa-field"><span>دسته والد</span><select class="oa-select" name="parentId"><option value="">— دسته اصلی —</option>${all.filter((x) => !descendants.has(String(x._id))).map((x) => html`<option value="${x._id}" ${raw(String(x._id) === String(c.parentId || "") ? "selected" : "")}>${x.name}</option>`)}</select></label>
          <label class="oa-field"><span>ترتیب نمایش</span><input class="oa-input num" name="displayOrder" inputmode="numeric" value="${c.displayOrder || 0}"><small>عدد کمتر = نمایش زودتر</small></label>
          ${type === "product" ? html`<label class="oa-field"><span>آیکن منو</span><select class="oa-select" name="icon">${Object.entries(ICONS).map(([k, l]) => html`<option value="${k}" ${raw((c.icon || "") === k ? "selected" : "")}>${l}</option>`)}</select></label>` : html`<span></span>`}
          <div class="oa-field span-all"><span>تصویر دسته</span><div data-img></div></div>
          <label class="oa-field span-all"><span>توضیحات (نمایش در صفحه دسته)</span><textarea class="oa-textarea" name="description" maxlength="1000" rows="3">${c.description || ""}</textarea></label>
          <label class="oa-field"><span>عنوان متا (سئو)</span><input class="oa-input" name="metaTitle" maxlength="60" value="${c.metaTitle || ""}"><small>حداکثر ۶۰ کاراکتر</small></label>
          <label class="oa-field"><span>کلمات کلیدی</span><input class="oa-input" name="metaKeywords" maxlength="300" value="${c.metaKeywords || ""}"></label>
          <label class="oa-field span-all"><span>توضیحات متا</span><textarea class="oa-textarea" name="metaDescription" maxlength="160" rows="2">${c.metaDescription || ""}</textarea><small>حداکثر ۱۶۰ کاراکتر</small></label>
          <label class="oa-switch span-all"><input type="checkbox" name="isActive" ${raw(c.isActive !== false ? "checked" : "")}><span class="oa-switch__track"></span><span>فعال (نمایش در فروشگاه)</span></label>
          ${!isNew ? html`<p class="oa-help span-all" style="margin:0">نامک «${c.slug}» ثابت است تا لینک‌های قبلی خراب نشوند.</p>` : ""}
        </form>`,
        foot: html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn oa-btn--primary" data-ok>${isNew ? "ایجاد" : "ذخیره"}</button>`,
      });
      imageField($("[data-img]", m.el), img, (u) => (img = u));
      $("[data-ok]", m.el).addEventListener("click", async (e) => {
        const f = $("[data-f]", m.el).elements;
        const name = f.name.value.trim();
        if (name.length < 2) { f.name.setAttribute("aria-invalid", "true"); return toast("نام دسته حداقل ۲ کاراکتر است", "error"); }
        const body = { name, categoryType: type, parentId: f.parentId.value || null, img, description: f.description.value, metaTitle: f.metaTitle.value, metaDescription: f.metaDescription.value, metaKeywords: f.metaKeywords.value, isActive: f.isActive.checked, displayOrder: OA.intOrNull(f.displayOrder.value) || 0 };
        if (f.icon) body.icon = f.icon.value;
        try {
          await busy(e.currentTarget, () => api(isNew ? "/admin/categories/add" : `/admin/categories/edit/${c._id}`, { method: isNew ? "POST" : "PUT", body }), isNew ? "دسته‌بندی ایجاد شد" : "دسته‌بندی ذخیره شد");
          m.close(true); OA.getLookups(true).catch(() => {}); load();
        } catch (_) {}
      });
    }
    $$("[data-type]", el).forEach((b) => b.addEventListener("click", () => { type = b.dataset.type; $$("[data-type]", el).forEach((x) => x.setAttribute("aria-selected", String(x === b))); router.replaceQuery(type === "weblog" ? { type } : {}); set(body, OA.skeletonRows(6)); load(); }));
    $("[data-q]", el).addEventListener("input", OA.debounce(draw, 200));
    const nb = $("[data-new]", el);
    if (nb) nb.addEventListener("click", () => edit(null));
    load();
  }

  // ---------------------------------------------------------------- brands
  function renderBrands(el) {
    set(el, html`${OA.pageHead("برندها", "برندهای فروشگاه و محصولات مرتبط", OA.can("manage_brands") ? html`<button class="oa-btn oa-btn--primary" data-new>${icon("plus", "oa-icon--sm")} برند جدید</button>` : "")}
      <div class="oa-card"><div class="oa-toolbar"><label class="oa-search">${icon("search")}<input class="oa-input" type="search" data-q placeholder="جستجوی برند…"></label><span style="flex:1"></span><span class="oa-muted" data-total style="font-size:12.5px"></span></div><div data-body>${OA.skeletonRows(6)}</div></div>`);
    const body = $("[data-body]", el);
    let all = [];
    const load = async () => { try { all = (await api("/brands")).brands; draw(); } catch (e) { set(body, OA.errorBox(e, load)); } };
    const draw = () => {
      const term = $("[data-q]", el).value.trim().toLowerCase();
      const shown = all.filter((b) => !term || b.name.toLowerCase().includes(term));
      $("[data-total]", el).textContent = `${num(all.length)} برند`;
      if (!shown.length) return set(body, OA.empty("برندی پیدا نشد", "", "award"));
      set(body, html`<div class="oa-table-wrap"><table class="oa-table oa-table--cards"><thead><tr><th>برند</th><th>محصولات</th><th>وضعیت</th><th class="col-actions"></th></tr></thead><tbody>
        ${shown.map((b) => html`<tr class="is-clickable" data-id="${b._id}"><td class="col-main"><div class="oa-media">${b.logo ? html`<img class="oa-thumb" src="${b.logo}" alt="" style="object-fit:contain;background:#fff">` : html`<div class="oa-thumb" style="display:grid;place-items:center;font-weight:700;color:var(--oa-gold)">${b.name.charAt(0)}</div>`}<div><span class="oa-cell-title">${b.name}</span><span class="oa-cell-sub">${(b.description || "").slice(0, 80)}</span></div></div></td>
          <td data-label="محصولات"><a class="oa-link num" href="#/products?brand=${b._id}">${num(b.productCount)}</a> <span class="oa-muted" style="font-size:12px">(${num(b.publishedCount)} منتشر)</span></td>
          <td data-label="وضعیت">${b.isActive === false ? OA.badge("غیرفعال", "") : OA.badge("فعال", "good")}</td>
          <td class="col-actions">${OA.can("manage_brands") ? html`<button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm oa-btn--danger" data-del="${b._id}" aria-label="حذف">${icon("trash", "oa-icon--sm")}</button>` : ""}</td></tr>`)}</tbody></table></div>`);
      $$("tr[data-id]", body).forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.closest("button, a")) return; if (OA.can("manage_brands")) edit(all.find((b) => String(b._id) === tr.dataset.id)); }));
      $$("[data-del]", body).forEach((btn) => btn.addEventListener("click", async () => {
        const b = all.find((x) => String(x._id) === btn.dataset.del);
        if (!(await confirm({ title: "حذف برند", message: `«${b.name}» حذف شود؟${b.productCount ? ` ${num(b.productCount)} محصول به این برند متصل است و حذف ممکن نیست.` : ""}`, confirmText: "حذف", danger: true }))) return;
        try { await busy(btn, () => api(`/admin/brands/delete/${b._id}`, { method: "DELETE" }), "برند حذف شد"); OA.getLookups(true).catch(() => {}); load(); } catch (_) {}
      }));
    };
    function edit(b) {
      const isNew = !b;
      b = b || { name: "", description: "", logo: "", isActive: true };
      let logo = b.logo || "";
      const m = OA.modal({
        title: isNew ? "برند جدید" : `ویرایش «${b.name}»`,
        body: html`<form class="oa-stack" style="gap:14px" data-f novalidate>
          <label class="oa-field"><span>نام برند *</span><input class="oa-input" name="name" maxlength="50" value="${b.name}" required></label>
          <div class="oa-field"><span>لوگو</span><div data-logo></div><small>JPG، PNG یا WEBP</small></div>
          <label class="oa-field"><span>توضیحات</span><textarea class="oa-textarea" name="description" maxlength="500" rows="3">${b.description || ""}</textarea></label>
          <label class="oa-switch"><input type="checkbox" name="isActive" ${raw(b.isActive !== false ? "checked" : "")}><span class="oa-switch__track"></span><span>برند فعال است</span></label>
        </form>`,
        foot: html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn oa-btn--primary" data-ok>${isNew ? "ایجاد" : "ذخیره"}</button>`,
      });
      imageField($("[data-logo]", m.el), logo, (u) => (logo = u));
      $("[data-ok]", m.el).addEventListener("click", async (e) => {
        const f = $("[data-f]", m.el).elements;
        const name = f.name.value.trim();
        if (name.length < 2) return toast("نام برند حداقل ۲ کاراکتر است", "error");
        try {
          await busy(e.currentTarget, () => api(isNew ? "/admin/brands/add" : `/admin/brands/edit/${b._id}`, { method: isNew ? "POST" : "PUT", body: { name, description: f.description.value, isActive: f.isActive.checked, logo } }), isNew ? "برند ایجاد شد" : "برند ذخیره شد");
          m.close(true); OA.getLookups(true).catch(() => {}); load();
        } catch (_) {}
      });
    }
    $("[data-q]", el).addEventListener("input", OA.debounce(draw, 200));
    const nb = $("[data-new]", el);
    if (nb) nb.addEventListener("click", () => edit(null));
    load();
  }

  OA.section("categories", { title: "دسته‌بندی‌ها", group: "کاتالوگ", nav: true, icon: "tag", perm: ["manage_categories", "manage_products", "manage_weblogs"], render: renderCategories });
  OA.section("brands", { title: "برندها", group: "کاتالوگ", nav: true, icon: "award", perm: ["manage_brands", "manage_products"], render: renderBrands });
  void fail;
})();
