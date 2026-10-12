/* Products: list + tabbed editor covering every Product field. */
(function () {
  "use strict";
  const { html, raw, set, $, $$, num, money, icon, api, upload, router, toast, fail, busy, confirm, toEn, intOrNull, objectId, ago } = OA;

  let lookups = null;
  async function getLookups(force) {
    if (!lookups || force) lookups = await api("/lookups");
    return lookups;
  }
  OA.getLookups = getLookups;

  // Quill is only downloaded when a rich-text editor is opened.
  let quillPromise = null;
  OA.loadQuill = function () {
    if (window.Quill) return Promise.resolve(window.Quill);
    if (!quillPromise) {
      quillPromise = new Promise((resolve, reject) => {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = "https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/quill.snow.min.css";
        document.head.appendChild(css);
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/quill.min.js";
        s.onload = () => resolve(window.Quill);
        s.onerror = () => { quillPromise = null; reject(new Error("بارگذاری ویرایشگر متن ممکن نشد")); };
        document.head.appendChild(s);
      });
    }
    return quillPromise;
  };
  // Rich text editor with a plain <textarea> fallback when the CDN is unreachable.
  OA.richText = async function (host, initial) {
    try {
      const Quill = await OA.loadQuill();
      set(host, html`<div class="oa-editor"><div data-q></div></div>`);
      const q = new Quill($("[data-q]", host), {
        theme: "snow",
        modules: { toolbar: { container: [[{ header: [2, 3, 4, false] }], ["bold", "italic", "underline", "link"], [{ list: "ordered" }, { list: "bullet" }], [{ align: [] }, { direction: "rtl" }], ["blockquote", "image", "clean"]], handlers: { image: () => pickImage(q) } } },
      });
      q.root.innerHTML = initial || "";
      q.root.setAttribute("dir", "rtl");
      return { get: () => (q.getText().trim() ? q.root.innerHTML : ""), onChange: (fn) => q.on("text-change", fn) };
    } catch (e) {
      set(host, html`<div class="oa-note" style="margin-bottom:8px">${icon("info")}<span>ویرایشگر پیشرفته در دسترس نیست؛ متن را به صورت HTML وارد کنید.</span></div><textarea class="oa-textarea" rows="12" data-fallback></textarea>`);
      const ta = $("[data-fallback]", host);
      ta.value = initial || "";
      return { get: () => ta.value.trim(), onChange: (fn) => ta.addEventListener("input", fn) };
    }
  };
  function pickImage(q) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      if (!input.files[0]) return;
      try {
        const r = await upload("/admin/upload-image", input.files, "image");
        const range = q.getSelection(true);
        q.insertEmbed(range ? range.index : q.getLength(), "image", r.url, "user");
      } catch (e) { fail(e); }
    };
    input.click();
  }

  const stockBadge = (p) => {
    if (p.isOutOfStock || p.countInStock <= 0) return OA.badge("ناموجود", "bad");
    if (p.countInStock <= (p.lowStockThreshold ?? 3)) return OA.badge(`${num(p.countInStock)} عدد · رو به اتمام`, "warn");
    return OA.badge(`${num(p.countInStock)} عدد`, "good");
  };
  const priceCell = (p) => {
    const sale = Number(p.offerPrice) > 0 && Number(p.offerPrice) < Number(p.price);
    return sale ? html`<span class="num" style="font-weight:600">${money(p.offerPrice)}</span><span class="oa-cell-sub num" style="text-decoration:line-through">${money(p.price)}</span>` : html`<span class="num" style="font-weight:600">${money(p.price)}</span>`;
  };
  const BADGES = { "": "خودکار", new: "جدید", bestseller: "پرفروش", limited: "محدود", exclusive: "انحصاری" };

  let listApi = null;
  async function render(el, { args }) {
    set(el, html`${OA.pageHead("محصولات", "مدیریت کاتالوگ، قیمت، تصاویر و تنوع‌ها", html`${OA.can("manage_products") ? html`<button class="oa-btn oa-btn--primary" data-new>${icon("plus", "oa-icon--sm")} محصول جدید</button>` : ""}`)}<div data-list>${OA.skeletonRows(6)}</div>`);
    const btn = $("[data-new]", el);
    if (btn) btn.addEventListener("click", () => router.go("products", ["new"]));
    let lk = { brands: [], categories: [] };
    try { lk = await getLookups(); } catch (e) { fail(e); }
    const productCats = lk.categories.filter((c) => c.categoryType === "product");
    listApi = OA.list($("[data-list]", el), {
      endpoint: "/products",
      defaults: { status: "", sort: "newest" },
      searchPlaceholder: "نام، نام انگلیسی، SKU یا شناسه…",
      tabs: { name: "status", options: [["", "همه"], ["published", "منتشر شده"], ["draft", "پیش‌نویس"]], countsKey: "_none", count: () => null },
      filters: [
        { name: "brand", label: "برند", options: [["", "همه برندها"], ...lk.brands.map((b) => [b._id, b.name])] },
        { name: "category", label: "دسته‌بندی", options: [["", "همه دسته‌ها"], ...productCats.map((c) => [c._id, c.name])] },
        { name: "stock", label: "موجودی", options: [["", "همه موجودی‌ها"], ["in", "موجود"], ["low", "رو به اتمام"], ["out", "ناموجود"]] },
        { name: "flag", label: "ویژگی", options: [["", "همه"], ["featured", "پیشنهاد ویژه"], ["discounted", "تخفیف‌دار"], ["new", "جدید"], ["matrix", "ماتریس رنگ×سایز"]] },
        { name: "sort", label: "مرتب‌سازی", options: [["newest", "جدیدترین"], ["updated", "آخرین ویرایش"], ["name", "نام"], ["price_desc", "گران‌ترین"], ["price_asc", "ارزان‌ترین"], ["stock_asc", "کمترین موجودی"], ["priority", "اولویت نمایش"]] },
      ],
      bulk: OA.can("manage_products") ? [
        { label: "انتشار", run: (ids) => api("/products/bulk", { method: "POST", body: { ids, action: "publish" } }).then((r) => toast(r.message)) },
        { label: "خروج از انتشار", run: (ids) => api("/products/bulk", { method: "POST", body: { ids, action: "unpublish" } }).then((r) => toast(r.message)) },
      ] : null,
      columns: [
        { label: "محصول", cls: "col-main", main: true, render: (p) => html`<div class="oa-media">${p.image ? html`<img class="oa-thumb" src="${p.image}" alt="" loading="lazy">` : html`<div class="oa-thumb"></div>`}<div><span class="oa-cell-title">${p.name}</span><span class="oa-cell-sub">${[p.brand?.name, p.sku && `SKU ${p.sku}`].filter(Boolean).join(" · ")}</span></div></div>` },
        { label: "دسته", render: (p) => html`<span class="oa-cell-sub" style="font-size:13px;color:inherit">${(p.category || []).map((c) => c.name).join("، ") || "—"}</span>` },
        { label: "قیمت", render: priceCell },
        { label: "موجودی", render: (p) => html`${stockBadge(p)}${p.variantInventoryConfigured ? html`<span class="oa-cell-sub">ماتریس تنوع</span>` : ""}` },
        { label: "نمایش", render: (p) => html`<div class="oa-inline" style="gap:4px">${p.specialOfferPosition ? OA.badge(`پیشنهاد ویژه ${num(p.specialOfferPosition)}`, "gold") : ""}${p.badge ? OA.badge(BADGES[p.badge], "olive") : ""}${p.isNewProduct ? OA.badge("جدید", "info") : ""}</div>` },
        { label: "انتشار", render: (p) => html`<label class="oa-switch" title="انتشار در فروشگاه"><input type="checkbox" data-publish ${raw(p.isPublished ? "checked" : "")} ${raw(OA.can("manage_products") ? "" : "disabled")}><span class="oa-switch__track"></span><span class="sr-only">انتشار</span></label>` },
        { label: "", cls: "col-actions", render: (p) => html`<div class="oa-inline" style="gap:2px;justify-content:flex-end">
          ${p.slug ? html`<a class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm" href="/productDetails/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener" title="مشاهده در فروشگاه" aria-label="مشاهده">${icon("eye", "oa-icon--sm")}</a>` : ""}
          ${OA.can("manage_products") ? html`<button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm" data-dup title="کپی محصول" aria-label="کپی">${icon("copy", "oa-icon--sm")}</button>
          <button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm oa-btn--danger" data-del title="حذف" aria-label="حذف">${icon("trash", "oa-icon--sm")}</button>` : ""}</div>` },
      ],
      onRow: (p) => router.go("products", [p._id], router.query()),
      bind(tr, p, list) {
        const sw = $("[data-publish]", tr);
        if (sw) sw.addEventListener("change", async () => {
          try { await api(`/products/${p._id}/flags`, { method: "PATCH", body: { isPublished: sw.checked } }); toast(sw.checked ? "محصول منتشر شد" : "محصول از انتشار خارج شد"); }
          catch (e) { sw.checked = !sw.checked; fail(e); }
        });
        const dup = $("[data-dup]", tr);
        if (dup) dup.addEventListener("click", async () => {
          try { const r = await busy(dup, () => api(`/admin/products/duplicate/${p._id}`, { method: "POST", body: {} }), "کپی محصول ساخته شد (پیش‌نویس)"); list.reload(); router.go("products", [r.product._id || r.product.id]); } catch (_) {}
        });
        const del = $("[data-del]", tr);
        if (del) del.addEventListener("click", () => deleteProduct(p, () => list.reload()));
      },
      empty: () => OA.empty("محصولی پیدا نشد", "فیلترها را تغییر دهید یا محصول جدید بسازید.", "box"),
    });
    if (args[0]) openEditor(args[0]);
  }

  async function deleteProduct(p, done) {
    let info = { orderCount: 0, openOrders: 0 };
    try { info = await api(`/products/${p._id}`); } catch (_) {}
    if (info.openOrders) {
      return OA.modal({ title: "حذف ممکن نیست", body: html`<p style="margin:0">«${p.name}» در ${num(info.openOrders)} سفارش باز با موجودی رزرو شده وجود دارد. به‌جای حذف، آن را از حالت انتشار خارج کنید.</p>`, foot: html`<button class="oa-btn oa-btn--primary" data-close>باشه</button>` });
    }
    const ok = await confirm({
      title: "حذف محصول",
      message: `«${p.name}» و تصاویر اختصاصی آن برای همیشه حذف می‌شود.${info.orderCount ? ` این محصول در ${num(info.orderCount)} سفارش قبلی وجود دارد؛ سفارش‌ها با نام ذخیره‌شده باقی می‌مانند. پیشنهاد می‌شود به‌جای حذف، محصول را از انتشار خارج کنید.` : ""}`,
      confirmText: "حذف دائمی",
      danger: true,
      requireText: info.orderCount ? "حذف" : "",
    });
    if (!ok) return;
    try { await api(`/admin/products/delete/${p._id}`, { method: "DELETE" }); toast("محصول حذف شد"); done(); } catch (e) { fail(e); }
  }

  // ================================================================ editor
  let editor = null;
  const TABS = [
    { id: "general", label: "اطلاعات اصلی" },
    { id: "pricing", label: "قیمت و موجودی" },
    { id: "media", label: "تصاویر" },
    { id: "variants", label: "رنگ و سایز" },
    { id: "details", label: "مشخصات" },
    { id: "fragrance", label: "شناسنامه رایحه" },
    { id: "merch", label: "نمایش در فروشگاه" },
    { id: "seo", label: "سئو و آدرس" },
  ];

  async function openEditor(id) {
    if (editor) await editor.close();
    const isNew = id === "new";
    const d = OA.drawer({
      title: isNew ? "محصول جدید" : "ویرایش محصول",
      size: "oa-drawer--wide",
      tabs: TABS,
      body: OA.skeletonRows(8),
      foot: html`<span class="oa-muted" data-dirty style="font-size:12.5px;margin-inline-end:auto"></span><button class="oa-btn" data-close>بستن</button>${OA.can("manage_products") ? html`<button class="oa-btn oa-btn--primary" data-save>${icon("check", "oa-icon--sm")} ${isNew ? "ایجاد محصول" : "ذخیره تغییرات"}</button>` : ""}`,
      onClose: () => { editor = null; if (router.parse().args[0]) router.go("products", [], router.query()); },
    });
    editor = d;
    try {
      const [lk, data] = await Promise.all([getLookups(), isNew ? Promise.resolve({ product: null }) : api(`/products/${id}`)]);
      buildEditor(d, data.product, lk, isNew, data);
    } catch (e) {
      set(d.body, OA.errorBox(e, () => openEditor(id)));
    }
  }

  function blankProduct() {
    return { name: "", englishName: "", slug: "", lilDescription: "", description: "", images: [], price: "", offerPrice: "", sku: "", brand: "", category: [], countInStock: 0, lowStockThreshold: 3, colors: [], sizes: [], specifications: [], tags: [], guarantee: "گارانتی اصالت و سلامت فیزیکی کالا", weight: "", product_group_id: "", isPublished: false, isNewProduct: true, badge: "", collectionName: "", sortPriority: 0, specialOfferPosition: null, fragrance: {}, variantInventoryConfigured: false, variantStocks: [] };
  }

  function buildEditor(d, product, lk, isNew, meta) {
    const p = product ? JSON.parse(JSON.stringify(product)) : blankProduct();
    const s = {
      images: (p.images || []).map((i) => ({ url: i.url, filename: i.filename, caption: i.caption || i.alt || "" })),
      colors: (p.colors || []).map((c) => ({ _id: c._id, name: c.name || "", rgb: c.rgb || "#000000", image: c.image && c.image.url ? { url: c.image.url, filename: c.image.filename } : null, countInStock: c.countInStock ?? "", isOutOfStock: !!c.isOutOfStock })),
      sizes: (p.sizes || []).map((x) => ({ _id: x._id, size: x.size || "", usage: x.usage || "", countInStock: x.countInStock ?? "", isOutOfStock: !!x.isOutOfStock })),
      specs: (p.specifications || []).map((x) => ({ key: x.key, value: x.value })),
      matrix: p.variantInventoryConfigured === true,
      rows: new Map((p.variantStocks || []).map((r) => [`${r.colorId || ""}|${r.sizeId || ""}`, { countInStock: r.countInStock, isOutOfStock: !!r.isOutOfStock }])),
      stockDirty: false,
      variantsDirty: false,
      fragranceImage: p.fragrance?.identityImage?.url ? p.fragrance.identityImage : null,
    };
    const f = p.fragrance || {};
    const productCats = lk.categories.filter((c) => c.categoryType === "product");
    const catLabel = (c) => { const parent = productCats.find((x) => String(x._id) === String(c.parentId)); return parent ? `${parent.name} › ${c.name}` : c.name; };
    const catIds = new Set((p.category || []).map((c) => String(c._id || c)));
    const brandId = String(p.brand?._id || p.brand || "");
    const join = (a) => (Array.isArray(a) ? a.join("، ") : a || "");

    set(d.body, html`<form data-form novalidate autocomplete="off">
      ${!isNew ? html`<div class="oa-inline" style="margin-bottom:16px">${p.isPublished ? OA.badge("منتشر شده", "good") : OA.badge("پیش‌نویس", "")}${meta.orderCount ? html`<span class="oa-muted" style="font-size:12.5px">${num(meta.orderCount)} سفارش</span>` : ""}<span class="oa-muted" style="font-size:12.5px">آخرین ویرایش ${ago(p.updatedAt)}</span>${p.slug ? html`<a class="oa-link" style="font-size:12.5px" href="/productDetails/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">مشاهده در فروشگاه ${icon("external", "oa-icon--sm")}</a>` : ""}</div>` : ""}

      <div data-panel="general" class="oa-stack">
        <div class="oa-card oa-card__body"><div class="oa-form-grid">
          <label class="oa-field span-2"><span>نام محصول *</span><input class="oa-input" name="name" maxlength="100" required value="${p.name}"></label>
          <label class="oa-field"><span>نام انگلیسی</span><input class="oa-input ltr" style="text-align:left" name="englishName" maxlength="100" value="${p.englishName || ""}"></label>
          <label class="oa-field"><span>برند *</span><select class="oa-select" name="brand" required><option value="">انتخاب برند</option>${lk.brands.map((b) => html`<option value="${b._id}" ${raw(String(b._id) === brandId ? "selected" : "")}>${b.name}${b.isActive === false ? " (غیرفعال)" : ""}</option>`)}</select></label>
          <div class="oa-field span-2"><span>دسته‌بندی‌ها *</span>
            <div class="oa-perm-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))" data-cats>${productCats.map((c) => html`<label class="oa-check" style="padding:6px 10px;border:1px solid var(--oa-border);border-radius:10px;background:#fff"><input type="checkbox" value="${c._id}" ${raw(catIds.has(String(c._id)) ? "checked" : "")}>${catLabel(c)}${c.isActive === false ? html` <span class="oa-muted">(غیرفعال)</span>` : ""}</label>`)}</div>
            <small>اولین دسته انتخاب‌شده به عنوان دسته اصلی در فیدها استفاده می‌شود.</small></div>
          <label class="oa-field span-2"><span>توضیح کوتاه <span class="oa-muted" data-count-lil></span></span><textarea class="oa-textarea" name="lilDescription" maxlength="160" rows="2">${p.lilDescription || ""}</textarea><small>در کارت محصول و توضیحات متای گوگل نمایش داده می‌شود (حداکثر ۱۶۰ کاراکتر).</small></label>
        </div></div>
        <div class="oa-card oa-card__body"><div class="oa-label" style="margin-bottom:8px">توضیحات کامل</div><div data-desc>${OA.skeletonRows(2, 1)}</div></div>
      </div>

      <div data-panel="pricing" class="oa-stack" hidden>
        <div class="oa-card oa-card__body"><div class="oa-form-grid--3 oa-form-grid">
          <label class="oa-field"><span>قیمت (تومان) *</span><input class="oa-input num" name="price" inputmode="numeric" value="${p.price}"></label>
          <label class="oa-field"><span>قیمت ویژه (تومان)</span><input class="oa-input num" name="offerPrice" inputmode="numeric" value="${p.offerPrice || ""}"><small data-discount-hint></small></label>
          <label class="oa-field"><span>SKU</span><input class="oa-input ltr" style="text-align:left" name="sku" maxlength="60" value="${p.sku || ""}"></label>
        </div></div>
        <div class="oa-card oa-card__body"><div class="oa-form-grid--3 oa-form-grid">
          <label class="oa-field"><span>موجودی کل</span><input class="oa-input num" name="countInStock" inputmode="numeric" value="${p.countInStock ?? 0}" ${raw(s.matrix && (s.colors.length + s.sizes.length) > 1 ? "disabled" : "")}><small data-stock-hint>${s.matrix ? "با ماتریس رنگ × سایز محاسبه می‌شود؛ از تب «رنگ و سایز» ویرایش کنید." : "برای تغییرات روزانه موجودی از بخش «انبار» استفاده کنید؛ آنجا تغییر هم‌زمان با سفارش‌ها امن است."}</small></label>
          <label class="oa-field"><span>حد هشدار موجودی</span><input class="oa-input num" name="lowStockThreshold" inputmode="numeric" value="${p.lowStockThreshold ?? 3}"></label>
          <label class="oa-field"><span>وزن (گرم)</span><input class="oa-input num" name="weight" inputmode="numeric" value="${p.weight ?? ""}"></label>
        </div></div>
      </div>

      <div data-panel="media" hidden>
        <div class="oa-card oa-card__body">
          <div class="oa-section-title"><h3>تصاویر محصول</h3><small>اولین تصویر، تصویر اصلی است. با دکمه‌ها ترتیب را تغییر دهید.</small></div>
          <div class="oa-images" data-images></div>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden data-file>
        </div>
      </div>

      <div data-panel="variants" class="oa-stack" hidden>
        <div class="oa-card oa-card__body"><div class="oa-section-title"><h3>رنگ‌ها</h3><button type="button" class="oa-btn oa-btn--sm" data-add-color>${icon("plus", "oa-icon--sm")} رنگ</button></div><div data-colors class="oa-repeat"></div></div>
        <div class="oa-card oa-card__body"><div class="oa-section-title"><h3>سایزها</h3><button type="button" class="oa-btn oa-btn--sm" data-add-size>${icon("plus", "oa-icon--sm")} سایز</button></div><div data-sizes class="oa-repeat"></div></div>
        <div class="oa-card oa-card__body">
          <div class="oa-section-title"><h3>ماتریس موجودی رنگ × سایز</h3>
            <label class="oa-switch"><input type="checkbox" data-matrix ${raw(s.matrix ? "checked" : "")} ${raw(p.variantInventoryConfigured ? "disabled" : "")}><span class="oa-switch__track"></span><span>موجودی دقیق هر ترکیب</span></label></div>
          <p class="oa-help" style="margin-top:0">${p.variantInventoryConfigured ? "ماتریس برای این محصول فعال است و منبع اصلی موجودی است (غیرقابل بازگشت از اینجا تا موجودی سفارش‌ها و ترب سالم بماند)." : "با فعال کردن، موجودی هر ترکیب رنگ و سایز جداگانه ثبت می‌شود و موجودی کل از جمع ردیف‌ها محاسبه می‌شود."}</p>
          <div data-matrix-grid></div>
        </div>
      </div>

      <div data-panel="details" class="oa-stack" hidden>
        <div class="oa-card oa-card__body"><div class="oa-section-title"><h3>مشخصات فنی</h3><button type="button" class="oa-btn oa-btn--sm" data-add-spec>${icon("plus", "oa-icon--sm")} ردیف</button></div><div data-specs class="oa-repeat"></div></div>
        <div class="oa-card oa-card__body"><div class="oa-form-grid">
          <label class="oa-field span-2"><span>برچسب‌ها</span><input class="oa-input" name="tags" value="${join(p.tags)}"><small>با ویرگول جدا کنید.</small></label>
          <label class="oa-field"><span>گارانتی</span><input class="oa-input" name="guarantee" value="${p.guarantee || ""}"></label>
          <label class="oa-field"><span>شناسه گروه محصول (فید ترب)</span><input class="oa-input ltr" style="text-align:left" name="product_group_id" value="${p.product_group_id || ""}"></label>
        </div></div>
      </div>

      <div data-panel="fragrance" class="oa-stack" hidden>
        <div class="oa-card oa-card__body"><div class="oa-form-grid--3 oa-form-grid">
          <label class="oa-field"><span>خانواده بویایی</span><input class="oa-input" data-fr="family" maxlength="60" value="${f.family || ""}" placeholder="چوبی شرقی"></label>
          <label class="oa-field"><span>غلظت</span><input class="oa-input" data-fr="concentration" maxlength="40" list="oa-conc" value="${f.concentration || ""}"></label>
          <label class="oa-field"><span>جنسیت</span><select class="oa-select" data-fr="gender">${["", "زنانه", "مردانه", "یونیسکس"].map((g) => html`<option value="${g}" ${raw((f.gender || "") === g ? "selected" : "")}>${g || "—"}</option>`)}</select></label>
          <label class="oa-field"><span>حجم</span><input class="oa-input" data-fr="volume" maxlength="40" value="${f.volume || ""}" placeholder="۱۰۰ میلی‌لیتر"></label>
          <label class="oa-field"><span>ماندگاری</span><input class="oa-input" data-fr="longevity" maxlength="40" value="${f.longevity || ""}"></label>
          <label class="oa-field"><span>پخش بو</span><input class="oa-input" data-fr="sillage" maxlength="40" list="oa-sillage" value="${f.sillage || ""}"></label>
          <label class="oa-field"><span>نت‌های آغازین</span><input class="oa-input" data-fr="top" value="${join(f.top)}"><small>با ویرگول جدا کنید</small></label>
          <label class="oa-field"><span>نت‌های میانی</span><input class="oa-input" data-fr="heart" value="${join(f.heart)}"></label>
          <label class="oa-field"><span>نت‌های پایه</span><input class="oa-input" data-fr="base" value="${join(f.base)}"></label>
          <label class="oa-field span-all"><span>آکوردها</span><input class="oa-input" data-fr="accords" value="${(f.accords || []).map((a) => `${a.name}:${a.strength}`).join("، ")}" placeholder="چوبی:100، گلی:80"><small>نام و شدت (۰ تا ۱۰۰) با «:» — حداکثر ۸ آکورد</small></label>
          <div class="oa-field"><span>فصل</span><div class="oa-inline">${["بهار", "تابستان", "پاییز", "زمستان"].map((x) => html`<label class="oa-check"><input type="checkbox" data-fr-list="seasons" value="${x}" ${raw((f.seasons || []).includes(x) ? "checked" : "")}>${x}</label>`)}</div></div>
          <div class="oa-field"><span>زمان استفاده</span><div class="oa-inline">${["روز", "شب"].map((x) => html`<label class="oa-check"><input type="checkbox" data-fr-list="dayNight" value="${x}" ${raw((f.dayNight || []).includes(x) ? "checked" : "")}>${x}</label>`)}</div></div>
          <label class="oa-field"><span>مناسب برای</span><input class="oa-input" data-fr="occasions" value="${join(f.occasions)}"></label>
          <label class="oa-field span-all"><span>داستان رایحه</span><textarea class="oa-textarea" data-fr="story" maxlength="2000" rows="3">${f.story || ""}</textarea></label>
          <label class="oa-field"><span>نحوه استفاده</span><textarea class="oa-textarea" data-fr="usage" maxlength="1000" rows="3">${f.usage || ""}</textarea></label>
          <label class="oa-field span-2"><span>ترکیبات</span><textarea class="oa-textarea" data-fr="ingredients" maxlength="2000" rows="3">${f.ingredients || ""}</textarea></label>
          <div class="oa-field span-all"><span>تصویر شناسنامه رایحه</span><div class="oa-inline" data-fr-image></div></div>
        </div>
        <datalist id="oa-conc"><option>ادو کلن</option><option>ادو تویلت</option><option>ادو پرفیوم</option><option>پرفیوم</option><option>اکستریت د پرفیوم</option></datalist>
        <datalist id="oa-sillage"><option>ملایم</option><option>متوسط</option><option>متوسط تا قوی</option><option>قوی</option></datalist>
        </div>
      </div>

      <div data-panel="merch" class="oa-stack" hidden>
        <div class="oa-card oa-card__body oa-stack" style="gap:14px">
          <label class="oa-switch"><input type="checkbox" name="isPublished" ${raw(p.isPublished ? "checked" : "")}><span class="oa-switch__track"></span><span><b>انتشار در فروشگاه</b> — فقط محصولات منتشر شده در سایت و فیدها نمایش داده می‌شوند.</span></label>
          <label class="oa-switch"><input type="checkbox" name="isNewProduct" ${raw(p.isNewProduct ? "checked" : "")}><span class="oa-switch__track"></span><span>نمایش در «محصولات جدید» صفحه اصلی</span></label>
        </div>
        <div class="oa-card oa-card__body"><div class="oa-form-grid">
          <label class="oa-field"><span>نشان کارت محصول</span><select class="oa-select" name="badge">${Object.entries(BADGES).map(([v, l]) => html`<option value="${v}" ${raw((p.badge || "") === v ? "selected" : "")}>${v ? l : "خودکار (تخفیف یا جدید)"}</option>`)}</select></label>
          <label class="oa-field"><span>جایگاه پیشنهاد ویژه صفحه اصلی</span><select class="oa-select" name="specialOfferPosition" ${raw(isNew ? "disabled" : "")}><option value="">نمایش داده نشود</option>${[1, 2, 3, 4, 5, 6].map((n) => html`<option value="${n}" ${raw(Number(p.specialOfferPosition) === n ? "selected" : "")}>جایگاه ${num(n)}</option>`)}</select><small>${isNew ? "پس از ایجاد محصول قابل تنظیم است." : "نیازمند قیمت ویژه معتبر؛ محصول قبلی همان جایگاه خارج می‌شود."}</small></label>
          <label class="oa-field"><span>اولویت نمایش</span><input class="oa-input num" name="sortPriority" inputmode="numeric" value="${p.sortPriority || 0}"><small>عدد بزرگ‌تر = نمایش زودتر در مرتب‌سازی «پیشنهاد اودر» (−۱۰۰۰ تا ۱۰۰۰)</small></label>
          <label class="oa-field"><span>کالکشن</span><input class="oa-input" name="collectionName" maxlength="60" value="${p.collectionName || ""}" placeholder="مثلاً کالکشن پاییز"></label>
        </div></div>
      </div>

      <div data-panel="seo" class="oa-stack" hidden>
        <div class="oa-card oa-card__body"><div class="oa-form-grid">
          <label class="oa-field span-2"><span>نامک (Slug)</span><input class="oa-input" name="slug" value="${p.slug || ""}" placeholder="به‌صورت خودکار از نام ساخته می‌شود"><small>${!isNew ? "تغییر نامک، نامک قبلی را برای ریدایرکت ۳۰۱ نگه می‌دارد." : "فقط حروف فارسی/انگلیسی، عدد و خط تیره."}${p.oldSlugs?.length ? ` نامک‌های قبلی: ${p.oldSlugs.join("، ")}` : ""}</small></label>
        </div></div>
        <div class="oa-card oa-card__body"><div class="oa-label" style="margin-bottom:8px">پیش‌نمایش در نتایج جستجو</div><div data-serp style="font-family:Arial,Vazirmatn,sans-serif"></div></div>
      </div>
    </form>`);

    const form = $("[data-form]", d.body);
    let dirty = false;
    const markDirty = () => { dirty = true; const el = $("[data-dirty]", d.el); if (el) el.textContent = "تغییرات ذخیره نشده"; };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    d.beforeClose = async () => !dirty || confirm({ title: "تغییرات ذخیره نشده", message: "تغییرات این محصول ذخیره نشده‌اند. بدون ذخیره خارج می‌شوید؟", confirmText: "خروج بدون ذخیره", danger: true });

    // rich description
    let desc = { get: () => p.description || "", onChange() {} };
    OA.richText($("[data-desc]", d.body), p.description || "").then((r) => { desc = r; r.onChange(markDirty); });

    // counters / hints
    const lil = form.elements.lilDescription;
    const lilCount = () => ($("[data-count-lil]", d.body).textContent = `(${num(lil.value.length)}/۱۶۰)`);
    lil.addEventListener("input", lilCount); lilCount();
    const discountHint = () => {
      const price = intOrNull(form.elements.price.value);
      const offer = intOrNull(form.elements.offerPrice.value);
      const el = $("[data-discount-hint]", d.body);
      if (offer && price && offer < price) el.textContent = `${num(Math.round(((price - offer) / price) * 100))}٪ تخفیف`;
      else if (offer && price && offer >= price) { el.textContent = "قیمت ویژه باید کمتر از قیمت اصلی باشد"; el.className = "oa-bad"; return; }
      else el.textContent = "خالی = بدون تخفیف";
      el.className = "";
    };
    form.elements.price.addEventListener("input", discountHint);
    form.elements.offerPrice.addEventListener("input", discountHint);
    discountHint();
    form.elements.countInStock.addEventListener("input", () => (s.stockDirty = true));
    const serp = () => set($("[data-serp]", d.body), html`<div style="color:#1a0dab;font-size:18px">${form.elements.name.value || "نام محصول"} | اودر</div><div style="color:#006621;font-size:13px" class="ltr">${location.host}/productDetails/${form.elements.slug.value || "…"}</div><div style="color:#545454;font-size:13px">${form.elements.lilDescription.value || "توضیح کوتاه محصول در اینجا نمایش داده می‌شود."}</div>`);
    ["name", "slug", "lilDescription"].forEach((n) => form.elements[n].addEventListener("input", serp));
    serp();

    // ---------- images
    const imagesBox = $("[data-images]", d.body);
    const fileInput = $("[data-file]", d.body);
    const drawImages = () => {
      set(imagesBox, html`${s.images.map((img, i) => html`<div class="oa-image">
          <img src="${img.url}" alt="${img.caption}" loading="lazy">
          ${i === 0 ? html`<span class="oa-image__tag oa-badge oa-badge--dark oa-badge--plain">اصلی</span>` : ""}
          <div class="oa-image__bar">
            <button type="button" data-img-move="${i}" data-dir="-1" title="جلوتر" aria-label="جابجایی به قبل" ${raw(i === 0 ? "disabled" : "")}>${icon("chevron-r", "oa-icon--sm")}</button>
            <button type="button" data-img-alt="${i}" title="متن جایگزین" aria-label="ویرایش متن جایگزین">${icon("pen", "oa-icon--sm")}</button>
            <button type="button" data-img-del="${i}" title="حذف از محصول" aria-label="حذف تصویر">${icon("trash", "oa-icon--sm")}</button>
            <button type="button" data-img-move="${i}" data-dir="1" title="عقب‌تر" aria-label="جابجایی به بعد" ${raw(i === s.images.length - 1 ? "disabled" : "")}>${icon("chevron", "oa-icon--sm")}</button>
          </div></div>`)}
        <button type="button" class="oa-dropzone" data-drop>${icon("upload", "oa-icon--lg")}<span>افزودن تصویر<br><small>JPG، PNG، WEBP تا ۱۰ مگابایت</small></span></button>`);
      $("[data-drop]", imagesBox).addEventListener("click", () => fileInput.click());
      $$("[data-img-move]", imagesBox).forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.imgMove); const j = i + Number(b.dataset.dir); [s.images[i], s.images[j]] = [s.images[j], s.images[i]]; markDirty(); drawImages(); }));
      $$("[data-img-del]", imagesBox).forEach((b) => b.addEventListener("click", () => { s.images.splice(Number(b.dataset.imgDel), 1); markDirty(); drawImages(); drawColors(); }));
      $$("[data-img-alt]", imagesBox).forEach((b) => b.addEventListener("click", () => {
        const i = Number(b.dataset.imgAlt);
        const m = OA.modal({ title: "متن جایگزین تصویر", body: html`<label class="oa-field"><span>توضیح تصویر (برای سئو و دسترس‌پذیری)</span><input class="oa-input" data-alt value="${s.images[i].caption}" maxlength="120"></label>`, foot: html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn oa-btn--primary" data-ok>ذخیره</button>` });
        $("[data-ok]", m.el).addEventListener("click", () => { s.images[i].caption = $("[data-alt]", m.el).value.trim(); markDirty(); m.close(true); drawImages(); });
      }));
      const drop = $("[data-drop]", imagesBox);
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); addFiles(e.dataTransfer.files); });
    };
    async function addFiles(files) {
      if (!files || !files.length) return;
      const drop = $("[data-drop]", imagesBox);
      drop.setAttribute("aria-busy", "true");
      set(drop, html`<span>در حال بارگذاری…</span>`);
      try {
        const r = await upload("/admin/upload-images", files, "images");
        (r.images || []).forEach((img) => s.images.push({ url: img.url, filename: img.filename, caption: form.elements.name.value.trim() }));
        markDirty();
        toast(`${num((r.images || []).length)} تصویر اضافه شد`);
      } catch (e) { fail(e); }
      drawImages(); drawColors();
    }
    fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
    drawImages();

    // ---------- colors / sizes / matrix
    const colorsBox = $("[data-colors]", d.body);
    const sizesBox = $("[data-sizes]", d.body);
    const variantsChanged = () => { s.variantsDirty = true; markDirty(); drawMatrix(); };
    function drawColors() {
      set(colorsBox, s.colors.length ? html`${s.colors.map((c, i) => html`<div class="oa-repeat__row" style="grid-template-columns:52px 1.3fr 1fr ${s.matrix ? "" : "110px"} auto auto">
          <input class="oa-input" type="color" value="${/^#[0-9a-f]{6}$/i.test(c.rgb) ? c.rgb : "#000000"}" data-c="${i}" data-k="rgb" aria-label="کد رنگ">
          <input class="oa-input" placeholder="نام رنگ" value="${c.name}" data-c="${i}" data-k="name" aria-label="نام رنگ">
          <select class="oa-select" data-c="${i}" data-k="image" aria-label="تصویر رنگ"><option value="">بدون تصویر اختصاصی</option>${s.images.map((img, j) => html`<option value="${img.url}" ${raw(c.image && c.image.url === img.url ? "selected" : "")}>تصویر ${num(j + 1)}</option>`)}${c.image && !s.images.some((img) => img.url === c.image.url) ? html`<option value="${c.image.url}" selected>تصویر فعلی رنگ</option>` : ""}</select>
          ${s.matrix ? "" : html`<input class="oa-input num" placeholder="موجودی" title="موجودی اختیاری این رنگ" inputmode="numeric" value="${c.countInStock}" data-c="${i}" data-k="countInStock" aria-label="موجودی رنگ">`}
          <label class="oa-check" title="توقف فروش این رنگ"><input type="checkbox" data-c="${i}" data-k="isOutOfStock" ${raw(c.isOutOfStock ? "checked" : "")} ${raw(s.matrix ? "disabled" : "")}>ناموجود</label>
          <button type="button" class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm oa-btn--danger" data-c-del="${i}" aria-label="حذف رنگ">${icon("trash", "oa-icon--sm")}</button></div>`)}` : html`<p class="oa-muted" style="margin:0">رنگی تعریف نشده است.</p>`);
      $$("[data-c]", colorsBox).forEach((inp) => inp.addEventListener(inp.type === "checkbox" || inp.tagName === "SELECT" ? "change" : "input", () => {
        const c = s.colors[Number(inp.dataset.c)];
        const k = inp.dataset.k;
        if (k === "isOutOfStock") c[k] = inp.checked;
        else if (k === "image") c.image = inp.value ? { url: inp.value, filename: inp.value.split("/").pop() } : null;
        else c[k] = inp.value;
        if (k === "name") drawMatrixSoon(); else markDirty();
        if (k === "countInStock") s.stockDirty = true;
      }));
      $$("[data-c-del]", colorsBox).forEach((b) => b.addEventListener("click", () => { s.colors.splice(Number(b.dataset.cDel), 1); drawColors(); variantsChanged(); }));
    }
    function drawSizes() {
      set(sizesBox, s.sizes.length ? html`${s.sizes.map((x, i) => html`<div class="oa-repeat__row" style="grid-template-columns:1fr 1.3fr ${s.matrix ? "" : "110px"} auto auto">
          <input class="oa-input" placeholder="سایز (مثلاً ۱۰۰ میل)" value="${x.size}" data-s="${i}" data-k="size" aria-label="سایز">
          <input class="oa-input" placeholder="کاربرد / توضیح" value="${x.usage}" data-s="${i}" data-k="usage" aria-label="کاربرد سایز">
          ${s.matrix ? "" : html`<input class="oa-input num" placeholder="موجودی" inputmode="numeric" value="${x.countInStock}" data-s="${i}" data-k="countInStock" aria-label="موجودی سایز">`}
          <label class="oa-check"><input type="checkbox" data-s="${i}" data-k="isOutOfStock" ${raw(x.isOutOfStock ? "checked" : "")} ${raw(s.matrix ? "disabled" : "")}>ناموجود</label>
          <button type="button" class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm oa-btn--danger" data-s-del="${i}" aria-label="حذف سایز">${icon("trash", "oa-icon--sm")}</button></div>`)}` : html`<p class="oa-muted" style="margin:0">سایزی تعریف نشده است.</p>`);
      $$("[data-s]", sizesBox).forEach((inp) => inp.addEventListener(inp.type === "checkbox" ? "change" : "input", () => {
        const x = s.sizes[Number(inp.dataset.s)];
        const k = inp.dataset.k;
        x[k] = k === "isOutOfStock" ? inp.checked : inp.value;
        if (k === "size") drawMatrixSoon(); else markDirty();
        if (k === "countInStock") s.stockDirty = true;
      }));
      $$("[data-s-del]", sizesBox).forEach((b) => b.addEventListener("click", () => { s.sizes.splice(Number(b.dataset.sDel), 1); drawSizes(); variantsChanged(); }));
    }
    const drawMatrixSoon = OA.debounce(() => { s.variantsDirty = true; markDirty(); drawMatrix(); }, 300);
    $("[data-add-color]", d.body).addEventListener("click", () => { s.colors.push({ _id: objectId(), name: "", rgb: "#000000", image: null, countInStock: "", isOutOfStock: false }); drawColors(); variantsChanged(); });
    $("[data-add-size]", d.body).addEventListener("click", () => { s.sizes.push({ _id: objectId(), size: "", usage: "", countInStock: "", isOutOfStock: false }); drawSizes(); variantsChanged(); });

    const matrixGrid = $("[data-matrix-grid]", d.body);
    const validColors = () => s.colors.filter((c) => c.name.trim());
    const validSizes = () => s.sizes.filter((x) => x.size.trim());
    function drawMatrix() {
      if (!s.matrix) return set(matrixGrid, "");
      const cs = validColors().length ? validColors() : [null];
      const ss = validSizes().length ? validSizes() : [null];
      const total = cs.reduce((sum, c) => sum + ss.reduce((t, z) => { const r = s.rows.get(`${c ? c._id : ""}|${z ? z._id : ""}`); return t + (r && !r.removed ? Number(r.countInStock) || 0 : 0); }, 0), 0);
      set(matrixGrid, html`<div class="oa-table-wrap"><table class="oa-matrix"><thead><tr><th>رنگ \\ سایز</th>${ss.map((z) => html`<th>${z ? z.size : "بدون سایز"}</th>`)}</tr></thead><tbody>
        ${cs.map((c) => html`<tr><td>${c ? html`<span class="oa-swatch" style="background:${c.rgb}"></span> ${c.name}` : "بدون رنگ"}</td>${ss.map((z) => {
          const key = `${c ? c._id : ""}|${z ? z._id : ""}`;
          const r = s.rows.get(key);
          const offered = r && !r.removed;
          return html`<td><div class="oa-stack" style="gap:4px;align-items:center">
            <label class="oa-check" style="font-size:12px"><input type="checkbox" data-offer="${key}" ${raw(offered ? "checked" : "")}>عرضه</label>
            ${offered ? html`<input class="oa-input num" inputmode="numeric" data-mx="${key}" value="${r.countInStock}" aria-label="موجودی ترکیب">
            <label class="oa-check" style="font-size:12px"><input type="checkbox" data-pause="${key}" ${raw(r.isOutOfStock ? "checked" : "")}>توقف فروش</label>` : ""}
          </div></td>`;
        })}</tr>`)}</tbody></table></div>
        ${!p.variantInventoryConfigured && Number(p.countInStock) > 0 ? html`<div class="oa-note" style="margin-top:10px">${icon("alert")}<span>موجودی ثبت‌شده فعلی این محصول <b class="num">${num(p.countInStock)}</b> عدد است. پس از ذخیره، موجودی کل برابر جمع ردیف‌های این جدول می‌شود؛ موجودی واقعی را بین ترکیب‌ها تقسیم کنید.</span></div>` : ""}
        <p class="oa-help">موجودی کل: <b class="num">${num(total)}</b> عدد. برای تغییرات روزانه از بخش انبار استفاده کنید؛ ذخیره این فرم موجودی ماتریس را با مقادیر همین جدول جایگزین می‌کند.</p>`);
      $$("[data-offer]", matrixGrid).forEach((cb) => cb.addEventListener("change", () => {
        const r = s.rows.get(cb.dataset.offer);
        if (cb.checked) s.rows.set(cb.dataset.offer, { countInStock: r ? r.countInStock : 0, isOutOfStock: r ? r.isOutOfStock : false });
        else if (r) r.removed = true;
        s.stockDirty = true; markDirty(); drawMatrix();
      }));
      $$("[data-mx]", matrixGrid).forEach((inp) => inp.addEventListener("input", () => { s.rows.get(inp.dataset.mx).countInStock = inp.value; s.stockDirty = true; markDirty(); }));
      $$("[data-pause]", matrixGrid).forEach((cb) => cb.addEventListener("change", () => { s.rows.get(cb.dataset.pause).isOutOfStock = cb.checked; s.stockDirty = true; markDirty(); }));
    }
    $("[data-matrix]", d.body).addEventListener("change", (e) => {
      s.matrix = e.target.checked;
      if (s.matrix) {
        // seed every combination with 0 so the admin only types real quantities
        const cs = validColors().length ? validColors() : [null];
        const ss = validSizes().length ? validSizes() : [null];
        cs.forEach((c) => ss.forEach((z) => { const k = `${c ? c._id : ""}|${z ? z._id : ""}`; if (!s.rows.has(k)) s.rows.set(k, { countInStock: 0, isOutOfStock: false }); }));
      }
      s.stockDirty = true; s.variantsDirty = true;
      drawColors(); drawSizes(); drawMatrix();
    });
    drawColors(); drawSizes(); drawMatrix();

    // ---------- specs
    const specsBox = $("[data-specs]", d.body);
    function drawSpecs() {
      set(specsBox, s.specs.length ? html`${s.specs.map((x, i) => html`<div class="oa-repeat__row"><input class="oa-input" placeholder="عنوان (مثلاً کشور سازنده)" value="${x.key}" data-sp="${i}" data-k="key" aria-label="عنوان مشخصه"><input class="oa-input" placeholder="مقدار" value="${x.value}" data-sp="${i}" data-k="value" aria-label="مقدار مشخصه"><button type="button" class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm oa-btn--danger" data-sp-del="${i}" aria-label="حذف ردیف">${icon("trash", "oa-icon--sm")}</button></div>`)}` : html`<p class="oa-muted" style="margin:0">مشخصه‌ای ثبت نشده است.</p>`);
      $$("[data-sp]", specsBox).forEach((inp) => inp.addEventListener("input", () => (s.specs[Number(inp.dataset.sp)][inp.dataset.k] = inp.value)));
      $$("[data-sp-del]", specsBox).forEach((b) => b.addEventListener("click", () => { s.specs.splice(Number(b.dataset.spDel), 1); markDirty(); drawSpecs(); }));
    }
    $("[data-add-spec]", d.body).addEventListener("click", () => { s.specs.push({ key: "", value: "" }); drawSpecs(); });
    drawSpecs();

    // ---------- fragrance image
    const frBox = $("[data-fr-image]", d.body);
    function drawFrImage() {
      set(frBox, html`${s.fragranceImage ? html`<img class="oa-thumb" style="width:72px;height:72px" src="${s.fragranceImage.url}" alt=""><button type="button" class="oa-btn oa-btn--sm oa-btn--danger" data-fr-rm>حذف</button>` : ""}<button type="button" class="oa-btn oa-btn--sm" data-fr-up>${icon("upload", "oa-icon--sm")} ${s.fragranceImage ? "تغییر تصویر" : "بارگذاری تصویر"}</button>`);
      $("[data-fr-up]", frBox).addEventListener("click", () => {
        const i = document.createElement("input"); i.type = "file"; i.accept = "image/*";
        i.onchange = async () => { if (!i.files[0]) return; try { const r = await upload("/admin/upload-image", i.files, "image"); s.fragranceImage = { url: r.url, filename: r.filename }; markDirty(); drawFrImage(); } catch (e) { fail(e); } };
        i.click();
      });
      const rm = $("[data-fr-rm]", frBox);
      if (rm) rm.addEventListener("click", () => { s.fragranceImage = null; markDirty(); drawFrImage(); });
    }
    drawFrImage();

    // ---------- validation + save
    function collect() {
      const errors = [];
      const E = form.elements;
      const name = E.name.value.trim();
      if (name.length < 3) errors.push(["general", "نام محصول باید حداقل ۳ کاراکتر باشد", E.name]);
      if (!E.brand.value) errors.push(["general", "برند را انتخاب کنید", E.brand]);
      const category = $$("[data-cats] input:checked", d.body).map((i) => i.value);
      if (!category.length) errors.push(["general", "حداقل یک دسته‌بندی انتخاب کنید", null]);
      const price = intOrNull(E.price.value);
      if (price === null || Number.isNaN(price) || price < 0) errors.push(["pricing", "قیمت معتبر وارد کنید", E.price]);
      const offer = intOrNull(E.offerPrice.value);
      if (Number.isNaN(offer) || (offer !== null && offer < 0)) errors.push(["pricing", "قیمت ویژه نامعتبر است", E.offerPrice]);
      if (offer && price !== null && offer >= price) errors.push(["pricing", "قیمت ویژه باید کمتر از قیمت اصلی باشد", E.offerPrice]);
      const stock = intOrNull(E.countInStock.value);
      if (!E.countInStock.disabled && (stock === null || Number.isNaN(stock) || stock < 0)) errors.push(["pricing", "موجودی باید عدد نامنفی باشد", E.countInStock]);
      const sop = E.specialOfferPosition.value;
      if (sop && !(offer && offer < price)) errors.push(["merch", "برای جایگاه پیشنهاد ویژه، قیمت ویژه معتبر لازم است", E.specialOfferPosition]);
      if (s.colors.some((c) => !c.name.trim())) errors.push(["variants", "نام همه رنگ‌ها را وارد کنید یا ردیف خالی را حذف کنید", null]);
      if (s.sizes.some((x) => !x.size.trim())) errors.push(["variants", "عنوان همه سایزها را وارد کنید یا ردیف خالی را حذف کنید", null]);
      const badStock = (v) => v !== "" && v !== null && v !== undefined && (Number.isNaN(intOrNull(v)) || intOrNull(v) < 0);
      if (s.colors.some((c) => badStock(c.countInStock)) || s.sizes.some((x) => badStock(x.countInStock))) errors.push(["variants", "موجودی رنگ/سایز باید عدد نامنفی باشد", null]);
      const specs = s.specs.filter((x) => x.key.trim() || x.value.trim());
      if (specs.some((x) => !x.key.trim() || !x.value.trim())) errors.push(["details", "عنوان و مقدار همه مشخصات را کامل کنید", null]);
      const split = (v) => String(v || "").split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);
      const fr = {};
      $$("[data-fr]", form).forEach((el) => (fr[el.dataset.fr] = el.value.trim()));
      ["seasons", "dayNight"].forEach((k) => (fr[k] = $$(`[data-fr-list="${k}"]:checked`, form).map((i) => i.value)));
      fr.identityImage = s.fragranceImage || undefined;

      const body = {
        name,
        englishName: E.englishName.value.trim(),
        slug: E.slug.value.trim(),
        brand: E.brand.value,
        category,
        lilDescription: E.lilDescription.value.trim(),
        description: desc.get(),
        price,
        offerPrice: offer || null,
        sku: E.sku.value.trim(),
        lowStockThreshold: intOrNull(E.lowStockThreshold.value) ?? 3,
        weight: intOrNull(E.weight.value),
        images: s.images.map((i) => ({ url: i.url, filename: i.filename, caption: i.caption, alt: i.caption })),
        colors: s.colors.map((c) => ({ _id: c._id, name: c.name.trim(), rgb: c.rgb, image: c.image || undefined, countInStock: c.countInStock === "" || c.countInStock === null ? "" : intOrNull(c.countInStock), isOutOfStock: c.isOutOfStock })),
        sizes: s.sizes.map((x) => ({ _id: x._id, size: x.size.trim(), usage: x.usage.trim(), countInStock: x.countInStock === "" || x.countInStock === null ? "" : intOrNull(x.countInStock), isOutOfStock: x.isOutOfStock })),
        specifications: specs.map((x) => ({ key: x.key.trim(), value: x.value.trim() })),
        tags: split(E.tags.value),
        guarantee: E.guarantee.value.trim(),
        product_group_id: E.product_group_id.value.trim(),
        isPublished: E.isPublished.checked,
        isNewProduct: E.isNewProduct.checked,
        badge: E.badge.value,
        collectionName: E.collectionName.value.trim(),
        sortPriority: intOrNull(E.sortPriority.value) || 0,
        fragrance: { ...fr, top: split(fr.top), heart: split(fr.heart), base: split(fr.base), occasions: split(fr.occasions) },
      };
      if (!isNew) body.specialOfferPosition = sop ? Number(sop) : null;
      // Stock is only sent when the admin actually edited it, so a concurrent order's
      // reservation is never overwritten by a stale number from this form.
      if (isNew || (s.stockDirty && !E.countInStock.disabled)) body.countInStock = stock ?? 0;
      if (s.matrix && (s.stockDirty || s.variantsDirty || !p.variantInventoryConfigured)) {
        const cIds = new Set(s.colors.filter((c) => c.name.trim()).map((c) => String(c._id)));
        const zIds = new Set(s.sizes.filter((x) => x.size.trim()).map((x) => String(x._id)));
        const rows = [];
        s.rows.forEach((r, key) => {
          if (r.removed) return;
          const [colorId, sizeId] = key.split("|");
          if ((colorId && !cIds.has(colorId)) || (sizeId && !zIds.has(sizeId))) return;
          if ((cIds.size && !colorId) || (zIds.size && !sizeId)) return;
          const n = intOrNull(r.countInStock);
          if (n === null || Number.isNaN(n) || n < 0) errors.push(["variants", "موجودی ترکیب‌ها باید عدد نامنفی باشد", null]);
          rows.push({ colorId, sizeId, countInStock: n || 0, isOutOfStock: r.isOutOfStock });
        });
        if (!rows.length) errors.push(["variants", "در ماتریس حداقل یک ترکیب باید عرضه شود", null]);
        body.variantInventoryConfigured = true;
        body.variantStocks = rows;
        delete body.countInStock;
      }
      return { body, errors };
    }

    const saveBtn = $("[data-save]", d.el);
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      $$("[aria-invalid]", form).forEach((x) => x.removeAttribute("aria-invalid"));
      $$("[data-tab-dot]", d.el).forEach((x) => (x.hidden = true));
      const { body, errors } = collect();
      if (errors.length) {
        errors.forEach(([tab, , el]) => { if (el) el.setAttribute("aria-invalid", "true"); const dot = $(`[data-tab-dot="${tab}"]`, d.el); if (dot) dot.hidden = false; });
        $(`[data-tab="${errors[0][0]}"]`, d.el).click();
        toast(errors[0][1], "error");
        return;
      }
      try {
        await busy(saveBtn, async () => {
          if (isNew) {
            const matrixBody = body.variantInventoryConfigured ? { variantInventoryConfigured: true, variantStocks: body.variantStocks } : null;
            const createBody = { ...body };
            delete createBody.variantInventoryConfigured;
            delete createBody.variantStocks;
            if (matrixBody) createBody.countInStock = 0;
            const r = await api("/admin/products/add", { method: "POST", body: createBody });
            const created = r.product;
            const newId = created._id || created.id;
            if (matrixBody) {
              // Colours/sizes get their final ids on creation (same order); remap the matrix.
              const cMap = new Map(s.colors.filter((c) => c.name.trim()).map((c, i) => [String(c._id), String(created.colors[i]?._id || "")]));
              const zMap = new Map(s.sizes.filter((x) => x.size.trim()).map((x, i) => [String(x._id), String(created.sizes[i]?._id || "")]));
              const variantStocks = matrixBody.variantStocks.map((row) => ({ ...row, colorId: row.colorId ? cMap.get(row.colorId) : "", sizeId: row.sizeId ? zMap.get(row.sizeId) : "" }));
              await api(`/admin/products/edit/${newId}`, { method: "PUT", body: { variantInventoryConfigured: true, variantStocks, colors: created.colors, sizes: created.sizes } });
            }
            dirty = false;
            toast("محصول ایجاد شد");
            lookups = null;
            d.close(true);
            if (listApi) listApi.reload();
            router.go("products", [newId]);
          } else {
            await api(`/admin/products/edit/${p._id}`, { method: "PUT", body });
            dirty = false;
            toast("تغییرات محصول ذخیره شد");
            d.close(true);
            if (listApi) listApi.reload();
          }
        });
      } catch (e) {
        const errs = e.data && e.data.errors;
        if (Array.isArray(errs) && errs.length) toast(errs.map((x) => x.msg).join("، "), "error");
      }
    });
    void toEn;
  }

  OA.section("products", {
    title: "محصولات",
    group: "کاتالوگ",
    nav: true,
    icon: "box",
    perm: ["manage_products", "manage_inventory"],
    render,
    onArgs(args) {
      if (!listApi) return false;
      if (args[0]) openEditor(args[0]);
      else if (editor) editor.close(true);
      return true;
    },
  });
})();
