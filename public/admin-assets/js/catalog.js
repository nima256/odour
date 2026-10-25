/* Catalog structure — category tree with side editor, brand gallery. */
(function () {
  "use strict";
  const { html, set, $, $$, num, icon, api, upload, toast, busy, confirm, router, attr, field, toggle } = OA;
  const ICONS = { "": "بدون آیکن", "cat-perfume-women": "عطر زنانه", "cat-perfume-men": "عطر مردانه", "cat-skin": "مراقبت پوست", "cat-hair": "مراقبت مو", "cat-lipstick": "آرایشی", "cat-brush": "ابزار آرایش", "cat-body": "بدن", "cat-device": "لوازم برقی", "cat-default": "عمومی" };

  // Single uploaded image (/admin/upload-image → /uploads/…).
  function imageField(host, initial, onChange, { wide = false } = {}) {
    let url = initial || "";
    const draw = () => {
      set(host, html`<div class="ox-row" style="gap:12px">${url ? html`<img class="ox-thumb" style="width:${wide ? 120 : 72}px;height:72px;object-fit:contain;background:#fff" src="${url}" alt="">` : html`<span class="ox-thumb ox-thumb--empty" style="width:72px;height:72px">${icon("image")}</span>`}
        <div class="ox-col" style="gap:6px"><button class="ox-btn ox-btn--sm" type="button" data-up>${icon("upload", "ox-i--s")}${url ? "تغییر تصویر" : "بارگذاری تصویر"}</button>${url ? html`<button class="ox-btn ox-btn--sm ox-btn--text" type="button" data-rm style="color:var(--danger)">حذف تصویر</button>` : ""}</div></div>`);
      $("[data-up]", host).addEventListener("click", () => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/jpeg,image/png,image/webp"; i.onchange = async () => { if (!i.files[0]) return; try { const r = await busy($("[data-up]", host), () => upload("/admin/upload-image", i.files, "image")); url = r.url; onChange(url); draw(); } catch (_) {} }; i.click(); });
      const rm = $("[data-rm]", host); if (rm) rm.addEventListener("click", () => { url = ""; onChange(""); draw(); });
    };
    draw();
  }
  OA.imageField = imageField;

  // -------------------------------------------------------------- categories
  function renderCategories(el) {
    const q = router.query();
    let type = q.type === "weblog" ? "weblog" : "product";
    let all = [];
    let active = null;
    const canEdit = OA.can("manage_categories");
    set(el, html`${OA.pageHead({ title: "دسته‌بندی‌ها", subtitle: "ساختار درختی دسته‌های محصول و مجله", actions: canEdit ? html`<button class="ox-btn ox-btn--primary" type="button" data-new>${icon("plus", "ox-i--s")}دسته جدید</button>` : "" })}
      <div class="ox-tabs" role="tablist" style="margin-bottom:16px"><button class="ox-tab" type="button" role="tab" data-type="product" aria-selected="${String(type === "product")}">دسته‌های محصول</button><button class="ox-tab" type="button" role="tab" data-type="weblog" aria-selected="${String(type === "weblog")}">دسته‌های مجله</button></div>
      <div class="ox-split"><div class="ox-datacard"><div class="ox-toolbar"><label class="ox-searchbox">${icon("search")}<input class="ox-input" type="search" data-q placeholder="جستجوی دسته…" aria-label="جستجوی دسته"></label><span class="ox-toolbar__count" data-total></span></div><div data-tree>${OA.skeletonTable(5)}</div></div>
        <aside data-editor style="position:sticky;top:calc(var(--header-h) + 20px)"></aside></div>`);
    const tree = $("[data-tree]", el), editor = $("[data-editor]", el);
    const idle = () => set(editor, html`<div class="ox-panel">${OA.empty({ icon: "tag", title: "دسته‌ای را برای ویرایش انتخاب کنید", text: canEdit ? "یا یک دسته جدید بسازید." : "", action: canEdit ? html`<button class="ox-btn ox-btn--primary" type="button" data-new2>${icon("plus", "ox-i--s")}دسته جدید</button>` : "" })}</div>`) && $("[data-new2]", editor) && $("[data-new2]", editor).addEventListener("click", () => edit(null));
    const load = async () => { try { all = (await api("/categories", { query: { type } })).categories; draw(); } catch (e) { set(tree, OA.errorBox(e, load)); } };
    function draw() {
      const term = $("[data-q]", el).value.trim();
      const kids = new Map();
      all.forEach((c) => { const k = c.parentId ? String(c.parentId) : ""; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(c); });
      const ids = new Set(all.map((c) => String(c._id)));
      const rows = [];
      const walk = (c, d) => { rows.push({ c, d }); (kids.get(String(c._id)) || []).forEach((x) => walk(x, d + 1)); };
      all.filter((c) => !c.parentId || !ids.has(String(c.parentId))).forEach((c) => walk(c, 0));
      const shown = term ? rows.filter((r) => r.c.name.includes(term)) : rows;
      $("[data-total]", el).textContent = `${num(all.length)} دسته`;
      if (!shown.length) return set(tree, OA.empty({ icon: "tag", title: "دسته‌ای وجود ندارد", compact: true }));
      set(tree, html`<ul class="ox-tree" role="tree">${shown.map(({ c, d }) => html`<li role="treeitem" aria-level="${d + 1}"><div class="ox-tree__node ${active && String(active._id) === String(c._id) ? "is-active" : ""}" data-id="${c._id}" tabindex="0">
        ${Array.from({ length: d }, () => html`<span class="ox-tree__guide"></span>`)}
        ${c.img ? html`<img class="ox-thumb ox-thumb--xs" src="${c.img}" alt="">` : html`<span class="ox-thumb ox-thumb--xs ox-thumb--empty">${icon(d ? "chevron" : "tag", "ox-i--s")}</span>`}
        <span class="ox-tree__name">${c.name}</span>
        ${c.isActive === false ? OA.chip("غیرفعال", "", true) : ""}
        <span class="ox-tree__meta">${type === "product" ? `${num(c.productCount)} محصول` : `${num(c.weblogCount)} مقاله`}</span>
      </div></li>`)}</ul>`);
      $$("[data-id]", tree).forEach((n) => { const go = () => canEdit && edit(all.find((c) => String(c._id) === n.dataset.id)); n.addEventListener("click", go); n.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); });
    }
    function edit(c) {
      const isNew = !c;
      active = c;
      draw();
      c = c || { name: "", parentId: "", img: "", description: "", metaTitle: "", metaDescription: "", metaKeywords: "", isActive: true, displayOrder: 0, icon: "" };
      const desc = new Set();
      if (!isNew) { const st = [String(c._id)]; while (st.length) { const id = st.pop(); desc.add(id); all.filter((x) => String(x.parentId) === id).forEach((x) => st.push(String(x._id))); } }
      let img = c.img || "";
      set(editor, html`<form class="ox-panel" data-f novalidate>
        <div class="ox-panel__head ox-panel__head--line"><div><div class="ox-panel__title">${isNew ? "دسته جدید" : c.name}</div><div class="ox-panel__sub">${isNew ? (type === "product" ? "دسته محصول" : "دسته مجله") : html`نامک ثابت: <span>${c.slug}</span>`}</div></div><button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-x aria-label="بستن ویرایشگر">${icon("x")}</button></div>
        <div class="ox-panel__body ox-form ox-form--1" style="max-height:calc(100vh - 300px);overflow:auto">
          ${field({ label: "نام دسته", req: true, control: html`<input class="ox-input" name="name" maxlength="50" value="${c.name}">`, err: "نام دسته حداقل ۲ کاراکتر است" })}
          <div class="ox-form">
            ${field({ label: "دسته والد", control: html`<select class="ox-select" name="parentId"><option value="">— دسته اصلی —</option>${all.filter((x) => !desc.has(String(x._id))).map((x) => html`<option value="${x._id}" ${attr(String(x._id) === String(c.parentId || ""), "selected")}>${x.name}</option>`)}</select>` })}
            ${field({ label: "ترتیب نمایش", help: "عدد کمتر = زودتر", control: html`<input class="ox-input ox-input--num" name="displayOrder" inputmode="numeric" value="${c.displayOrder || 0}">` })}
          </div>
          ${type === "product" ? field({ label: "آیکن منوی فروشگاه", control: html`<select class="ox-select" name="icon">${Object.entries(ICONS).map(([k, l]) => html`<option value="${k}" ${attr((c.icon || "") === k, "selected")}>${l}</option>`)}</select>` }) : ""}
          <div class="ox-field"><span class="ox-label">تصویر دسته</span><div data-img></div></div>
          ${field({ label: "توضیحات صفحه دسته", control: html`<textarea class="ox-textarea" name="description" maxlength="1000" rows="3">${c.description || ""}</textarea>` })}
          <div class="ox-label" style="margin-top:6px">سئو</div>
          ${field({ label: "عنوان متا", count: "۶۰", control: html`<input class="ox-input" name="metaTitle" maxlength="60" value="${c.metaTitle || ""}">` })}
          ${field({ label: "توضیحات متا", count: "۱۶۰", control: html`<textarea class="ox-textarea" name="metaDescription" maxlength="160" rows="2">${c.metaDescription || ""}</textarea>` })}
          ${field({ label: "کلمات کلیدی", control: html`<input class="ox-input" name="metaKeywords" maxlength="300" value="${c.metaKeywords || ""}">` })}
          <div class="ox-setting" style="border:0">${toggle({ name: "isActive", checked: c.isActive !== false, title: "فعال", text: "نمایش در فروشگاه و منوها" })}</div>
        </div>
        <div class="ox-panel__foot ox-row">${!isNew ? html`<button class="ox-btn ox-btn--danger ox-btn--sm" type="button" data-del>${icon("trash", "ox-i--s")}حذف</button>` : ""}<span class="ox-spacer"></span><button class="ox-btn ox-btn--primary" type="submit" data-ok>${isNew ? "ایجاد دسته" : "ذخیره تغییرات"}</button></div>
      </form>`);
      imageField($("[data-img]", editor), img, (u) => (img = u));
      $("[data-x]", editor).addEventListener("click", () => { active = null; draw(); idle(); });
      const formEl = $("[data-f]", editor);
      formEl.addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = formEl.elements, name = f.name.value.trim();
        if (name.length < 2) { f.name.closest(".ox-field").classList.add("is-invalid"); return; }
        const body = { name, categoryType: type, parentId: f.parentId.value || null, img, description: f.description.value, metaTitle: f.metaTitle.value, metaDescription: f.metaDescription.value, metaKeywords: f.metaKeywords.value, isActive: f.isActive.checked, displayOrder: OA.intOrNull(f.displayOrder.value) || 0 };
        if (f.icon) body.icon = f.icon.value;
        try {
          const r = await busy($("[data-ok]", editor), () => api(isNew ? "/admin/categories/add" : `/admin/categories/edit/${c._id}`, { method: isNew ? "POST" : "PUT", body }), isNew ? "دسته‌بندی ایجاد شد" : "دسته‌بندی ذخیره شد");
          OA.getLookups && OA.getLookups(true).catch(() => {});
          await load();
          const saved = all.find((x) => String(x._id) === String((r.category && (r.category._id || r.category.id)) || c._id));
          if (saved) edit(saved); else idle();
        } catch (_) {}
      });
      const del = $("[data-del]", editor);
      if (del) del.addEventListener("click", async () => {
        if (!(await confirm({ title: "حذف دسته‌بندی", message: `«${c.name}» حذف شود؟`, consequence: "دسته‌هایی که زیردسته، محصول یا مقاله دارند حذف نمی‌شوند؛ ابتدا آن‌ها را منتقل کنید یا دسته را غیرفعال کنید.", confirmText: "حذف دسته", danger: true }))) return;
        try { await busy(del, () => api(`/admin/categories/delete/${c._id}`, { method: "DELETE" }), "دسته‌بندی حذف شد"); active = null; await load(); idle(); } catch (_) {}
      });
      if (innerWidth <= 1024) editor.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    $$("[data-type]", el).forEach((b) => b.addEventListener("click", () => { type = b.dataset.type; active = null; $$("[data-type]", el).forEach((x) => x.setAttribute("aria-selected", String(x === b))); router.replaceQuery(type === "weblog" ? { type } : {}); set(tree, OA.skeletonTable(5)); idle(); load(); }));
    $("[data-q]", el).addEventListener("input", OA.debounce(draw, 200));
    const nb = $("[data-new]", el); if (nb) nb.addEventListener("click", () => edit(null));
    idle();
    load();
  }

  // ------------------------------------------------------------------ brands
  function renderBrands(el) {
    let view = (() => { try { return localStorage.getItem("ox-brand-view") || "grid"; } catch (_) { return "grid"; } })();
    let all = [];
    const canEdit = OA.can("manage_brands");
    set(el, html`${OA.pageHead({ title: "برندها", count: "", subtitle: "برندهای فروشگاه و محصولات مرتبط", actions: canEdit ? html`<button class="ox-btn ox-btn--primary" type="button" data-new>${icon("plus", "ox-i--s")}برند جدید</button>` : "" })}
      <div class="ox-row" style="margin-bottom:16px;justify-content:space-between"><label class="ox-searchbox">${icon("search")}<input class="ox-input" type="search" data-q placeholder="جستجوی برند…" aria-label="جستجوی برند"></label>
        <div class="ox-btn-group" role="group" aria-label="نمایش"><button type="button" data-view="grid" aria-pressed="${String(view === "grid")}">${icon("grid", "ox-i--s")}کارت</button><button type="button" data-view="list" aria-pressed="${String(view === "list")}">${icon("list", "ox-i--s")}فهرست</button></div></div>
      <div data-body>${OA.skeletonTable(4)}</div>`);
    const body = $("[data-body]", el);
    const load = async () => { try { all = (await api("/brands")).brands; draw(); } catch (e) { set(body, OA.errorBox(e, load)); } };
    const logo = (b, size = 48) => (b.logo ? html`<img src="${b.logo}" alt="" style="max-height:${size}px">` : html`<span>${b.name.charAt(0)}</span>`);
    function draw() {
      const t = $("[data-q]", el).value.trim().toLowerCase();
      const shown = all.filter((b) => !t || b.name.toLowerCase().includes(t));
      const c = $("[data-head-count]", el); if (c) c.textContent = `${num(all.length)} برند`;
      if (!shown.length) return set(body, html`<div class="ox-datacard">${OA.empty({ icon: "award", title: "برندی پیدا نشد", action: canEdit ? html`<button class="ox-btn ox-btn--primary" type="button" data-new2>${icon("plus", "ox-i--s")}برند جدید</button>` : "" })}</div>`) && $("[data-new2]", body) && $("[data-new2]", body).addEventListener("click", () => edit(null));
      if (view === "grid") {
        set(body, html`<div class="ox-cards">${shown.map((b) => html`<button class="ox-brand" type="button" data-id="${b._id}"><div class="ox-brand__logo">${logo(b)}</div>
          <div class="ox-row ox-row--between ox-row--nowrap"><b class="ellipsis" style="font-size:15px">${b.name}</b>${b.isActive === false ? OA.chip("غیرفعال") : OA.chip("فعال", "success")}</div>
          <span class="muted small" style="min-height:38px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${b.description || "بدون توضیحات"}</span>
          <div class="ox-row ox-row--between small"><span class="muted">محصولات</span><span><b class="num">${num(b.productCount)}</b> <span class="faint">(${num(b.publishedCount)} منتشر)</span></span></div></button>`)}</div>`);
      } else {
        set(body, html`<div class="ox-datacard"><div class="ox-table-wrap"><table class="ox-table"><thead><tr><th>برند</th><th>توضیحات</th><th class="col-num">محصولات</th><th>وضعیت</th></tr></thead><tbody>${shown.map((b) => html`<tr class="is-link" tabindex="0" data-id="${b._id}"><td><div class="ox-entity"><span class="ox-brand__logo" style="width:52px;height:40px;font-size:15px">${logo(b, 28)}</span><span class="ox-cell-main">${b.name}</span></div></td><td><span class="muted small ellipsis" style="display:block;max-width:420px">${b.description || "—"}</span></td><td class="col-num"><b>${num(b.productCount)}</b> <span class="faint small">(${num(b.publishedCount)})</span></td><td>${b.isActive === false ? OA.chip("غیرفعال") : OA.chip("فعال", "success")}</td></tr>`)}</tbody></table></div></div>`);
      }
      $$("[data-id]", body).forEach((n) => { const go = () => edit(all.find((b) => String(b._id) === n.dataset.id)); n.addEventListener("click", go); n.addEventListener("keydown", (e) => { if (e.key === "Enter" && n.tagName === "TR") go(); }); });
    }
    function edit(b) {
      const isNew = !b;
      if (!isNew && !canEdit) return router.go("products", [], { brand: b._id });
      b = b || { name: "", description: "", logo: "", isActive: true };
      let logoUrl = b.logo || "";
      const m = OA.modal({
        title: isNew ? "برند جدید" : b.name, sub: isNew ? "" : `${num(b.productCount)} محصول متصل`, iconName: "award",
        body: html`<form class="ox-form ox-form--1" data-f novalidate>
          ${field({ label: "نام برند", req: true, control: html`<input class="ox-input" name="name" maxlength="50" value="${b.name}">`, err: "نام برند حداقل ۲ کاراکتر است" })}
          <div class="ox-field"><span class="ox-label">لوگو</span><div data-logo></div><span class="ox-help">JPG، PNG یا WEBP</span></div>
          ${field({ label: "توضیحات", count: "۵۰۰", control: html`<textarea class="ox-textarea" name="description" maxlength="500" rows="3">${b.description || ""}</textarea>` })}
          <div class="ox-setting" style="border:0;padding:4px 0">${toggle({ name: "isActive", checked: b.isActive !== false, title: "برند فعال است" })}</div></form>`,
        foot: html`${!isNew ? html`<a class="ox-btn ox-btn--ghost" href="#/products?brand=${b._id}" style="margin-inline-end:auto">${icon("box", "ox-i--s")}محصولات برند</a>${b.productCount ? "" : html`<button class="ox-btn ox-btn--danger" type="button" data-del>حذف</button>`}` : ""}<button class="ox-btn" type="button" data-close>انصراف</button><button class="ox-btn ox-btn--primary" type="button" data-ok>${isNew ? "ایجاد برند" : "ذخیره"}</button>`,
      });
      imageField($("[data-logo]", m.el), logoUrl, (u) => (logoUrl = u), { wide: true });
      $("[data-ok]", m.el).addEventListener("click", async (e) => {
        const f = $("[data-f]", m.el).elements, name = f.name.value.trim();
        if (name.length < 2) { f.name.closest(".ox-field").classList.add("is-invalid"); return; }
        try { await busy(e.currentTarget, () => api(isNew ? "/admin/brands/add" : `/admin/brands/edit/${b._id}`, { method: isNew ? "POST" : "PUT", body: { name, description: f.description.value, isActive: f.isActive.checked, logo: logoUrl } }), isNew ? "برند ایجاد شد" : "برند ذخیره شد"); m.close(true); OA.getLookups && OA.getLookups(true).catch(() => {}); load(); } catch (_) {}
      });
      const del = $("[data-del]", m.el);
      if (del) del.addEventListener("click", async () => {
        if (!(await confirm({ title: "حذف برند", message: `«${b.name}» حذف شود؟`, consequence: "برندهایی که محصول دارند حذف نمی‌شوند.", confirmText: "حذف برند", danger: true }))) return;
        try { await busy(del, () => api(`/admin/brands/delete/${b._id}`, { method: "DELETE" }), "برند حذف شد"); m.close(true); load(); } catch (_) {}
      });
    }
    $$("[data-view]", el).forEach((b) => b.addEventListener("click", () => { view = b.dataset.view; try { localStorage.setItem("ox-brand-view", view); } catch (_) {} $$("[data-view]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
    $("[data-q]", el).addEventListener("input", OA.debounce(draw, 200));
    const nb = $("[data-new]", el); if (nb) nb.addEventListener("click", () => edit(null));
    load();
  }

  OA.section("categories", { title: "دسته‌بندی‌ها", group: "کاتالوگ", nav: true, icon: "tag", perm: ["manage_categories", "manage_products", "manage_weblogs"], render: renderCategories });
  OA.section("brands", { title: "برندها", group: "کاتالوگ", nav: true, icon: "award", perm: ["manage_brands", "manage_products"], render: renderBrands });
  void toast;
})();
