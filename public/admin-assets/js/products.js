/* Products — catalog manager + full-page product workspace. Saves through the existing
   /admin/products/add and /admin/products/edit/:id endpoints (same payloads as before). */
(function () {
  "use strict";
  const { html, raw, set, $, $$, num, money, icon, api, upload, router, toast, fail, busy, confirm, intOrNull, objectId, ago, attr, field, toggle } = OA;

  let lookups = null;
  OA.getLookups = async (force) => { if (!lookups || force) lookups = await api("/lookups"); return lookups; };

  // Quill loads from cdnjs only when an editor opens; textarea fallback when unavailable.
  let quillP = null;
  OA.loadQuill = () => {
    if (window.Quill) return Promise.resolve(window.Quill);
    if (!quillP) quillP = new Promise((res, rej) => {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/quill.snow.min.css"; document.head.appendChild(css);
      const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/quill.min.js";
      s.onload = () => res(window.Quill); s.onerror = () => { quillP = null; rej(new Error("quill")); }; document.head.appendChild(s);
    });
    return quillP;
  };
  OA.richText = async (host, initial) => {
    try {
      const Quill = await OA.loadQuill();
      set(host, html`<div class="ox-richtext"><div data-q></div></div>`);
      const q = new Quill($("[data-q]", host), { theme: "snow", modules: { toolbar: { container: [[{ header: [2, 3, 4, false] }], ["bold", "italic", "underline", "link"], [{ list: "ordered" }, { list: "bullet" }], [{ align: [] }, { direction: "rtl" }], ["blockquote", "image", "clean"]], handlers: { image: () => pickImage(q) } } } });
      q.root.innerHTML = initial || "";
      q.root.setAttribute("dir", "rtl");
      return { get: () => (q.getText().trim() || q.root.querySelector("img") ? q.root.innerHTML : ""), onChange: (fn) => q.on("text-change", fn) };
    } catch (_) {
      set(host, html`<div class="ox-note" style="margin-bottom:8px">${icon("info", "ox-i--s")}<span>ویرایشگر پیشرفته در دسترس نیست؛ متن را به صورت HTML وارد کنید.</span></div><textarea class="ox-textarea" rows="12" data-fallback dir="auto"></textarea>`);
      const ta = $("[data-fallback]", host); ta.value = initial || "";
      return { get: () => ta.value.trim(), onChange: (fn) => ta.addEventListener("input", fn) };
    }
  };
  function pickImage(q) {
    const i = document.createElement("input"); i.type = "file"; i.accept = "image/*";
    i.onchange = async () => { if (!i.files[0]) return; try { const r = await upload("/admin/upload-image", i.files, "image"); const range = q.getSelection(true); q.insertEmbed(range ? range.index : q.getLength(), "image", r.url, "user"); } catch (e) { fail(e); } };
    i.click();
  }

  const BADGES = { "": "خودکار", new: "جدید", bestseller: "پرفروش", limited: "محدود", exclusive: "انحصاری" };
  const stockCell = (p) => {
    if (p.isOutOfStock || p.countInStock <= 0) return html`<span class="ox-chip ox-chip--danger">ناموجود</span>`;
    const low = p.countInStock <= (p.lowStockThreshold ?? 3);
    return html`<span class="strong num ${low ? "t-warning" : ""}">${num(p.countInStock)}</span> <span class="muted small">عدد${low ? " · کم" : ""}</span>`;
  };
  const priceCell = (p) => (Number(p.offerPrice) > 0 && Number(p.offerPrice) < Number(p.price)
    ? html`<span class="strong">${money(p.offerPrice)}</span><span class="ox-cell-sub" style="text-decoration:line-through">${money(p.price)}</span>`
    : html`<span class="strong">${money(p.price)}</span>`);

  // ------------------------------------------------------------------ list
  async function renderList(el) {
    set(el, html`${OA.pageHead({ title: "محصولات", count: "", subtitle: "کاتالوگ، قیمت‌گذاری، تصاویر و تنوع‌ها", actions: OA.can("manage_products") ? html`<a class="ox-btn ox-btn--primary ox-btn--lg" href="#/products/new">${icon("plus", "ox-i--s")}افزودن محصول</a>` : "" })}<div data-list>${OA.skeletonTable()}</div>`);
    let lk = { brands: [], categories: [] };
    try { lk = await OA.getLookups(); } catch (e) { fail(e); }
    const cats = lk.categories.filter((c) => c.categoryType === "product");
    OA.list($("[data-list]", el), {
      endpoint: "/products",
      defaults: { view: "", sort: "newest" },
      searchPlaceholder: "نام، نام انگلیسی، SKU یا شناسه محصول…",
      tabs: { name: "view", options: [["", "همه محصولات"], ["published", "منتشر شده", { status: "published" }], ["draft", "پیش‌نویس", { status: "draft" }], ["low", "رو به اتمام", { stock: "low" }], ["out", "ناموجود", { stock: "out" }]] },
      filters: [
        { name: "category", label: "دسته‌بندی", options: [["", "همه دسته‌ها"], ...cats.map((c) => [c._id, c.name])] },
        { name: "brand", label: "برند", options: [["", "همه برندها"], ...lk.brands.map((b) => [b._id, b.name])] },
        { name: "flag", label: "ویژگی", options: [["", "همه ویژگی‌ها"], ["featured", "پیشنهاد ویژه"], ["discounted", "تخفیف‌دار"], ["new", "جدید"], ["matrix", "ماتریس رنگ × سایز"]] },
        { name: "sort", label: "مرتب‌سازی", options: [["newest", "جدیدترین"], ["updated", "آخرین ویرایش"], ["name", "نام"], ["price_desc", "گران‌ترین"], ["price_asc", "ارزان‌ترین"], ["stock_asc", "کمترین موجودی"], ["priority", "اولویت نمایش"]] },
      ],
      onData: (d) => { const c = $("[data-head-count]", el); if (c) c.textContent = `${num(d.total)} محصول`; },
      bulk: OA.can("manage_products") ? [
        { label: "انتشار", run: (ids) => api("/products/bulk", { method: "POST", body: { ids, action: "publish" } }).then((r) => toast(r.message)) },
        { label: "خروج از انتشار", run: (ids) => api("/products/bulk", { method: "POST", body: { ids, action: "unpublish" } }).then((r) => toast(r.message)) },
      ] : null,
      columns: [
        { label: "محصول", render: (p) => html`<div class="ox-entity">${p.image ? html`<img class="ox-thumb" src="${p.image}" alt="" loading="lazy">` : html`<span class="ox-thumb ox-thumb--empty">${icon("image")}</span>`}<div><span class="ox-cell-main">${p.name}</span><span class="ox-cell-sub">${p.englishName || ""}${p.specialOfferPosition ? ` · پیشنهاد ویژه ${num(p.specialOfferPosition)}` : ""}${p.badge ? ` · ${BADGES[p.badge]}` : ""}</span></div></div>` },
        { label: "SKU", render: (p) => html`<span class="ltr muted small">${p.sku || "—"}</span>` },
        { label: "دسته / برند", render: (p) => html`<span class="ox-cell-main" style="font-weight:500">${(p.category || []).map((c) => c.name).join("، ") || "—"}</span><span class="ox-cell-sub">${p.brand?.name || ""}</span>` },
        { label: "قیمت", cls: "col-num", render: priceCell },
        { label: "موجودی", render: (p) => html`${stockCell(p)}${p.variantInventoryConfigured ? html`<span class="ox-cell-sub">ماتریس تنوع</span>` : ""}` },
        { label: "انتشار", render: (p) => html`<label class="ox-toggle" title="انتشار در فروشگاه"><input type="checkbox" data-publish ${attr(p.isPublished, "checked")} ${attr(!OA.can("manage_products"), "disabled")}><span class="ox-toggle__ui"></span><span class="sr-only">انتشار</span></label>` },
      ],
      record: (p) => html`<div class="ox-record__top">${p.image ? html`<img class="ox-thumb" src="${p.image}" alt="" loading="lazy">` : html`<span class="ox-thumb ox-thumb--empty">${icon("image")}</span>`}<div class="ox-record__main"><span class="ox-cell-main">${p.name}</span><span class="ox-cell-sub">${p.brand?.name || ""} · <span class="ltr">${p.sku || ""}</span></span></div><div class="ox-record__side">${priceCell(p)}</div></div>
        <div class="ox-record__row"><span>${stockCell(p)}</span>${p.isPublished ? OA.chip("منتشر شده", "success") : OA.chip("پیش‌نویس")}</div>`,
      actions: (p, list) => [
        { label: "ویرایش", icon: "pen", run: () => router.go("products", [p._id]) },
        p.slug ? { label: "مشاهده در فروشگاه", icon: "external", href: `/productDetails/${encodeURIComponent(p.slug)}`, external: true } : null,
        OA.can("manage_inventory", "manage_products") ? { label: "مدیریت موجودی", icon: "layers", run: () => router.go("inventory", [], { q: p.sku || p.name }) } : null,
        OA.can("manage_products") ? { label: "ایجاد کپی", icon: "copy", run: async () => { try { const r = await api(`/admin/products/duplicate/${p._id}`, { method: "POST", body: {} }); toast("کپی محصول ساخته شد (پیش‌نویس)"); router.go("products", [r.product._id || r.product.id]); } catch (e) { fail(e); } } } : null,
        OA.can("manage_products") ? "-" : null,
        OA.can("manage_products") ? { label: "حذف محصول", icon: "trash", danger: true, run: () => deleteProduct(p, () => list.reload()) } : null,
      ],
      onRow: (p) => router.go("products", [p._id]),
      bind(row, p) {
        const sw = $("[data-publish]", row);
        if (sw) sw.addEventListener("change", async () => {
          try { await api(`/products/${p._id}/flags`, { method: "PATCH", body: { isPublished: sw.checked } }); toast(sw.checked ? "محصول منتشر شد" : "محصول از انتشار خارج شد"); }
          catch (e) { sw.checked = !sw.checked; fail(e); }
        });
      },
      empty: (st) => OA.empty({ icon: "box", title: "محصولی پیدا نشد", text: st.q ? "عبارت جستجو یا فیلترها را تغییر دهید." : "اولین محصول را به کاتالوگ اضافه کنید.", action: OA.can("manage_products") ? html`<a class="ox-btn ox-btn--primary" href="#/products/new">${icon("plus", "ox-i--s")}افزودن محصول</a>` : "" }),
    });
  }

  async function deleteProduct(p, done) {
    let info = { orderCount: 0, openOrders: 0 };
    try { info = await api(`/products/${p._id}`); } catch (_) {}
    if (info.openOrders) {
      return OA.modal({ title: "حذف ممکن نیست", iconName: "alert", danger: true, body: html`<p>«${p.name}» در ${num(info.openOrders)} سفارش باز با موجودی رزرو شده وجود دارد. به‌جای حذف، آن را از حالت انتشار خارج کنید.</p>`, foot: html`<button class="ox-btn ox-btn--primary" type="button" data-close>متوجه شدم</button>` });
    }
    const ok = await confirm({ title: "حذف دائمی محصول", message: `«${p.name}» و تصاویر اختصاصی آن حذف می‌شود.`, consequence: info.orderCount ? `این محصول در ${num(info.orderCount)} سفارش قبلی وجود دارد؛ سفارش‌ها با نام ذخیره‌شده باقی می‌مانند. پیشنهاد: به‌جای حذف، محصول را از انتشار خارج کنید.` : "این عملیات برگشت‌پذیر نیست.", confirmText: "حذف دائمی", danger: true, requireText: info.orderCount ? "حذف" : "" });
    if (!ok) return;
    try { await api(`/admin/products/delete/${p._id}`, { method: "DELETE" }); toast("محصول حذف شد"); done(); } catch (e) { fail(e); }
  }

  // ============================================================ workspace
  const SECTIONS = [
    ["basic", "اطلاعات پایه", "file", "نام، برند، دسته‌بندی و توضیحات محصول"],
    ["media", "تصاویر", "image", "تصویر اصلی، گالری، ترتیب و متن جایگزین"],
    ["pricing", "قیمت‌گذاری", "card", "قیمت، قیمت ویژه و شناسه انبار"],
    ["inventory", "موجودی", "layers", "موجودی کل، حد هشدار و وزن"],
    ["variants", "تنوع‌ها", "grid", "رنگ‌ها، سایزها و ماتریس موجودی"],
    ["fragrance", "شناسنامه رایحه", "flask", "خانواده، نت‌ها، آکوردها و داستان رایحه"],
    ["specs", "مشخصات", "list", "مشخصات فنی، برچسب‌ها و گارانتی"],
    ["storefront", "نمایش در فروشگاه", "store", "انتشار، نشان، جایگاه پیشنهاد ویژه و سئو"],
  ];

  async function renderEditor(el, id) {
    const isNew = id === "new";
    set(el, html`<div class="ox-workhead"><span class="ox-skel" style="width:260px;height:28px"></span></div><div class="ox-workspace"><div>${OA.skeletonBlock(300)}</div><div>${OA.skeletonBlock(520)}</div><div>${OA.skeletonBlock(340)}</div></div>`);
    try {
      const [lk, data] = await Promise.all([OA.getLookups(), isNew ? { product: null } : api(`/products/${id}`)]);
      build(el, data.product, lk, isNew, data);
    } catch (e) { set(el, html`${OA.workHead({ title: "محصول" })}${OA.errorBox(e, () => renderEditor(el, id))}`); }
  }

  const blank = () => ({ name: "", englishName: "", slug: "", lilDescription: "", description: "", images: [], price: "", offerPrice: "", sku: "", brand: "", category: [], countInStock: 0, lowStockThreshold: 3, colors: [], sizes: [], specifications: [], tags: [], guarantee: "گارانتی اصالت و سلامت فیزیکی کالا", weight: "", product_group_id: "", isPublished: false, isNewProduct: true, badge: "", collectionName: "", sortPriority: 0, specialOfferPosition: null, fragrance: {}, variantInventoryConfigured: false, variantStocks: [] });

  function build(el, product, lk, isNew, meta) {
    const p = product ? JSON.parse(JSON.stringify(product)) : blank();
    const f = p.fragrance || {};
    const s = {
      images: (p.images || []).map((i) => ({ url: i.url, filename: i.filename, caption: i.caption || i.alt || "" })),
      cover: 0,
      colors: (p.colors || []).map((c) => ({ _id: c._id, name: c.name || "", rgb: c.rgb || "#000000", image: c.image?.url ? { url: c.image.url, filename: c.image.filename } : null, countInStock: c.countInStock ?? "", isOutOfStock: !!c.isOutOfStock })),
      sizes: (p.sizes || []).map((x) => ({ _id: x._id, size: x.size || "", usage: x.usage || "", countInStock: x.countInStock ?? "", isOutOfStock: !!x.isOutOfStock })),
      specs: (p.specifications || []).map((x) => ({ key: x.key, value: x.value })),
      accords: (f.accords || []).map((a) => ({ name: a.name, strength: a.strength ?? 50 })),
      matrix: p.variantInventoryConfigured === true,
      rows: new Map((p.variantStocks || []).map((r) => [`${r.colorId || ""}|${r.sizeId || ""}`, { countInStock: r.countInStock, isOutOfStock: !!r.isOutOfStock }])),
      stockDirty: false, variantsDirty: false, dirty: false,
      frImage: f.identityImage?.url ? f.identityImage : null,
    };
    const cats = lk.categories.filter((c) => c.categoryType === "product");
    const catName = (c) => { const pa = cats.find((x) => String(x._id) === String(c.parentId)); return pa ? `${pa.name} › ${c.name}` : c.name; };
    const catIds = new Set((p.category || []).map((c) => String(c._id || c)));
    const brandId = String(p.brand?._id || p.brand || "");
    const join = (a) => (Array.isArray(a) ? a.join("، ") : a || "");
    const canEdit = OA.can("manage_products");
    const sheet = (key, body) => { const sec = SECTIONS.find((x) => x[0] === key); return html`<section class="ox-editor-sheet" data-panel="${key}" ${attr(key !== "basic", "hidden")}><header><h2>${sec[1]}</h2><p>${sec[3]}</p></header>${body}</section>`; };

    set(el, html`
      ${OA.workHead({
        title: isNew ? "محصول جدید" : html`<span data-live-name>${p.name}</span>`,
        meta: isNew ? html`<span>پیش‌نویس جدید</span>` : html`${p.isPublished ? OA.chip("منتشر شده", "success") : OA.chip("پیش‌نویس")}<span>آخرین ویرایش ${ago(p.updatedAt)}</span>${meta.orderCount ? html`<span>· ${num(meta.orderCount)} سفارش</span>` : ""}${p.sku ? html`<span class="ltr">· ${p.sku}</span>` : ""}`,
        actions: !isNew && p.slug ? html`<a class="ox-btn" href="/productDetails/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">${icon("external", "ox-i--s")}مشاهده در فروشگاه</a>` : "",
      })}
      <form data-form novalidate autocomplete="off">
      <div class="ox-workspace">
        <nav class="ox-sectionnav" aria-label="بخش‌های فرم محصول"><div class="ox-sectionnav__label">بخش‌ها</div>${SECTIONS.map(([k, label, ic], i) => html`<button type="button" data-sec="${k}" aria-current="${String(i === 0)}">${icon(ic, "ox-i--s")}${label}<span class="ox-sectionnav__err" data-err="${k}" hidden></span></button>`)}</nav>
        <div>
          ${sheet("basic", html`<div class="ox-form">
            ${field({ label: "نام محصول", req: true, cls: "span-2", count: html`<span data-cnt-name></span>`, control: html`<input class="ox-input" name="name" maxlength="100" value="${p.name}" required>`, err: "نام محصول باید حداقل ۳ کاراکتر باشد" })}
            ${field({ label: "نام انگلیسی", opt: true, control: html`<input class="ox-input ox-input--ltr" name="englishName" maxlength="100" value="${p.englishName || ""}">` })}
            ${field({ label: "برند", req: true, control: html`<select class="ox-select" name="brand"><option value="">انتخاب برند</option>${lk.brands.map((b) => html`<option value="${b._id}" ${attr(String(b._id) === brandId, "selected")}>${b.name}${b.isActive === false ? " (غیرفعال)" : ""}</option>`)}</select>`, err: "برند را انتخاب کنید" })}
            <div class="ox-field span-2" data-catfield><span class="ox-label">دسته‌بندی‌ها<span class="req">*</span></span><div class="ox-chipset" data-cats>${cats.map((c) => html`<label class="ox-chipcheck"><input type="checkbox" value="${c._id}" ${attr(catIds.has(String(c._id)), "checked")}><span>${catName(c)}${c.isActive === false ? " · غیرفعال" : ""}</span></label>`)}</div><span class="ox-help">اولین دسته انتخاب‌شده دسته اصلی در فیدهاست.</span><span class="ox-error">حداقل یک دسته‌بندی انتخاب کنید</span></div>
            ${field({ label: "توضیح کوتاه", cls: "span-2", count: html`<span data-cnt-lil></span>`, help: "در کارت محصول و توضیحات متای گوگل نمایش داده می‌شود.", control: html`<textarea class="ox-textarea" name="lilDescription" maxlength="160" rows="2">${p.lilDescription || ""}</textarea>` })}
            <div class="ox-field span-2"><span class="ox-label">توضیحات کامل</span><div data-desc>${OA.skeletonBlock(220)}</div></div>
          </div>`)}

          ${sheet("media", html`<div class="ox-media"><div><div class="ox-media__cover" data-cover></div><div class="ox-field" style="margin-top:12px" data-alt-wrap></div></div><div><div class="ox-media__grid" data-gallery></div><div data-upload-state style="margin-top:12px"></div><p class="ox-help" style="margin-top:12px">اولین تصویر، تصویر اصلی محصول است. JPG، PNG یا WEBP تا ۱۰ مگابایت؛ می‌توانید فایل‌ها را روی کادر رها کنید.</p></div></div>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden data-file>`)}

          ${sheet("pricing", html`<div class="ox-form">
            ${field({ label: "قیمت", req: true, control: html`<span class="ox-affix"><input class="ox-input ox-input--num" name="price" inputmode="numeric" value="${p.price}"><span class="ox-affix__text">تومان</span></span>`, err: "قیمت معتبر وارد کنید" })}
            ${field({ label: "قیمت ویژه", opt: true, control: html`<span class="ox-affix"><input class="ox-input ox-input--num" name="offerPrice" inputmode="numeric" value="${p.offerPrice || ""}"><span class="ox-affix__text">تومان</span></span>`, help: html`<span data-discount></span>`, err: "قیمت ویژه باید کمتر از قیمت اصلی باشد" })}
            ${field({ label: "SKU", opt: true, control: html`<input class="ox-input ox-input--ltr" name="sku" maxlength="60" value="${p.sku || ""}">`, help: "شناسه انبار؛ در جستجو و خروجی CSV استفاده می‌شود." })}
          </div>`)}

          ${sheet("inventory", html`<div class="ox-form ox-form--3">
            ${field({ label: "موجودی کل", control: html`<input class="ox-input ox-input--num" name="countInStock" inputmode="numeric" value="${p.countInStock ?? 0}" ${attr(s.matrix && s.colors.length + s.sizes.length > 1, "disabled")}>`, help: s.matrix ? "با ماتریس تنوع‌ها محاسبه می‌شود." : "برای تغییرات روزانه از صفحه انبار استفاده کنید.", err: "موجودی باید عدد نامنفی باشد" })}
            ${field({ label: "حد هشدار موجودی", control: html`<input class="ox-input ox-input--num" name="lowStockThreshold" inputmode="numeric" value="${p.lowStockThreshold ?? 3}">`, help: "در این مقدار یا کمتر، کالا «رو به اتمام» است." })}
            ${field({ label: "وزن", opt: true, control: html`<span class="ox-affix"><input class="ox-input ox-input--num" name="weight" inputmode="numeric" value="${p.weight ?? ""}"><span class="ox-affix__text">گرم</span></span>` })}
          </div>
          ${!isNew ? html`<div class="ox-note" style="margin-top:20px">${icon("info", "ox-i--s")}<span>موجودی فقط وقتی ارسال می‌شود که آن را در همین فرم تغییر دهید؛ ذخیره بقیه فیلدها موجودی رزرو شده سفارش‌ها را بازنویسی نمی‌کند.</span></div>` : ""}`)}

          ${sheet("variants", html`<div class="ox-col" style="gap:22px">
            <div><div class="ox-row ox-row--between" style="margin-bottom:10px"><b>رنگ‌ها</b><button class="ox-btn ox-btn--sm" type="button" data-add-color>${icon("plus", "ox-i--s")}افزودن رنگ</button></div><div data-colors></div></div>
            <div><div class="ox-row ox-row--between" style="margin-bottom:10px"><b>سایزها</b><button class="ox-btn ox-btn--sm" type="button" data-add-size>${icon("plus", "ox-i--s")}افزودن سایز</button></div><div data-sizes></div></div>
            <div><div class="ox-row ox-row--between" style="margin-bottom:6px"><b>ماتریس موجودی رنگ × سایز</b>${toggle({ title: "موجودی دقیق هر ترکیب", attrs: `data-matrix ${s.matrix ? "checked" : ""} ${p.variantInventoryConfigured ? "disabled" : ""}` })}</div>
              <p class="ox-help" style="margin-bottom:12px">${p.variantInventoryConfigured ? "ماتریس برای این محصول فعال و منبع اصلی موجودی است (برای سلامت سفارش‌ها و فید ترب از اینجا غیرفعال نمی‌شود)." : "با فعال‌سازی، موجودی هر ترکیب جداگانه ثبت و موجودی کل از جمع ردیف‌ها محاسبه می‌شود."}</p>
              <div data-matrix-grid></div></div></div>`)}

          ${sheet("fragrance", html`<div class="ox-col" style="gap:24px">
            <div class="ox-form ox-form--3">
              ${field({ label: "خانواده بویایی", control: html`<input class="ox-input" data-fr="family" maxlength="60" value="${f.family || ""}" placeholder="چوبی شرقی">` })}
              ${field({ label: "غلظت", control: html`<input class="ox-input" data-fr="concentration" maxlength="40" list="ox-conc" value="${f.concentration || ""}">` })}
              ${field({ label: "حجم", control: html`<input class="ox-input" data-fr="volume" maxlength="40" value="${f.volume || ""}" placeholder="۱۰۰ میلی‌لیتر">` })}
              ${field({ label: "جنسیت", control: html`<select class="ox-select" data-fr="gender">${["", "زنانه", "مردانه", "یونیسکس"].map((g) => html`<option value="${g}" ${attr((f.gender || "") === g, "selected")}>${g || "—"}</option>`)}</select>` })}
              ${field({ label: "ماندگاری", control: html`<input class="ox-input" data-fr="longevity" maxlength="40" value="${f.longevity || ""}" placeholder="۸ تا ۱۰ ساعت">` })}
              ${field({ label: "پخش بو", control: html`<input class="ox-input" data-fr="sillage" maxlength="40" list="ox-sillage" value="${f.sillage || ""}">` })}
            </div>
            <datalist id="ox-conc"><option>ادو کلن</option><option>ادو تویلت</option><option>ادو پرفیوم</option><option>پرفیوم</option><option>اکستریت د پرفیوم</option></datalist>
            <datalist id="ox-sillage"><option>ملایم</option><option>متوسط</option><option>متوسط تا قوی</option><option>قوی</option></datalist>
            <div><div class="ox-label" style="margin-bottom:10px">هرم نت‌ها <span class="opt">(با ویرگول جدا کنید)</span></div><div class="ox-notes">
              ${[["top", "نت‌های آغازین", "۱", "#4355e8", "ترنج، فلفل صورتی"], ["heart", "نت‌های میانی", "۲", "#0d9488", "رز، زنبق"], ["base", "نت‌های پایه", "۳", "#111827", "عود، عنبر، مشک"]].map(([k, t, n, c, ph]) => html`<div class="ox-note-card"><div class="ox-note-card__h"><i style="background:${c}">${n}</i>${t}</div><textarea class="ox-textarea" data-fr="${k}" rows="3" placeholder="${ph}">${join(f[k])}</textarea></div>`)}</div></div>
            <div><div class="ox-row ox-row--between" style="margin-bottom:6px"><span class="ox-label">آکوردهای اصلی <span class="opt">(حداکثر ۸، به ترتیب اهمیت)</span></span><button class="ox-btn ox-btn--sm" type="button" data-add-accord>${icon("plus", "ox-i--s")}آکورد</button></div><div data-accords></div></div>
            <div class="ox-form">
              <div class="ox-field"><span class="ox-label">فصل مناسب</span><div class="ox-chipset">${["بهار", "تابستان", "پاییز", "زمستان"].map((x) => html`<label class="ox-chipcheck"><input type="checkbox" data-fr-list="seasons" value="${x}" ${attr((f.seasons || []).includes(x), "checked")}><span>${x}</span></label>`)}</div></div>
              <div class="ox-field"><span class="ox-label">زمان استفاده</span><div class="ox-chipset">${["روز", "شب"].map((x) => html`<label class="ox-chipcheck"><input type="checkbox" data-fr-list="dayNight" value="${x}" ${attr((f.dayNight || []).includes(x), "checked")}><span>${x}</span></label>`)}</div></div>
              ${field({ label: "مناسب برای", cls: "span-2", control: html`<input class="ox-input" data-fr="occasions" value="${join(f.occasions)}" placeholder="محل کار، مهمانی">` })}
              ${field({ label: "داستان رایحه", cls: "span-2", control: html`<textarea class="ox-textarea" data-fr="story" maxlength="2000" rows="3">${f.story || ""}</textarea>` })}
              ${field({ label: "نحوه استفاده", control: html`<textarea class="ox-textarea" data-fr="usage" maxlength="1000" rows="3">${f.usage || ""}</textarea>` })}
              ${field({ label: "ترکیبات", control: html`<textarea class="ox-textarea" data-fr="ingredients" maxlength="2000" rows="3">${f.ingredients || ""}</textarea>` })}
              <div class="ox-field span-2"><span class="ox-label">تصویر شناسنامه رایحه</span><div data-fr-image></div></div>
            </div></div>`)}

          ${sheet("specs", html`<div class="ox-col" style="gap:22px">
            <div><div class="ox-row ox-row--between" style="margin-bottom:10px"><b>مشخصات فنی</b><button class="ox-btn ox-btn--sm" type="button" data-add-spec>${icon("plus", "ox-i--s")}افزودن ردیف</button></div><div data-specs></div></div>
            <div class="ox-form">
              ${field({ label: "برچسب‌ها", cls: "span-2", help: "با ویرگول جدا کنید.", control: html`<input class="ox-input" name="tags" value="${join(p.tags)}">` })}
              ${field({ label: "گارانتی", control: html`<input class="ox-input" name="guarantee" value="${p.guarantee || ""}">` })}
              ${field({ label: "شناسه گروه محصول (فید ترب)", opt: true, control: html`<input class="ox-input ox-input--ltr" name="product_group_id" value="${p.product_group_id || ""}">` })}
            </div></div>`)}

          ${sheet("storefront", html`<div class="ox-col" style="gap:4px;margin-bottom:22px">
              <div class="ox-setting">${toggle({ name: "isPublished", checked: p.isPublished, title: "انتشار در فروشگاه", text: "فقط محصولات منتشر شده در سایت و فیدها نمایش داده می‌شوند." })}</div>
              <div class="ox-setting">${toggle({ name: "isNewProduct", checked: p.isNewProduct, title: "محصول جدید", text: "نمایش در بخش «محصولات جدید» صفحه اصلی" })}</div></div>
            <div class="ox-form">
              ${field({ label: "نشان کارت محصول", control: html`<select class="ox-select" name="badge">${Object.entries(BADGES).map(([v, l]) => html`<option value="${v}" ${attr((p.badge || "") === v, "selected")}>${v ? l : "خودکار (تخفیف یا جدید)"}</option>`)}</select>` })}
              ${field({ label: "جایگاه پیشنهاد ویژه صفحه اصلی", help: isNew ? "پس از ایجاد محصول قابل تنظیم است." : "نیازمند قیمت ویژه معتبر؛ محصول قبلی همان جایگاه خارج می‌شود.", control: html`<select class="ox-select" name="specialOfferPosition" ${attr(isNew, "disabled")}><option value="">نمایش داده نشود</option>${[1, 2, 3, 4, 5, 6].map((n) => html`<option value="${n}" ${attr(Number(p.specialOfferPosition) === n, "selected")}>جایگاه ${num(n)}</option>`)}</select>`, err: "برای جایگاه پیشنهاد ویژه، قیمت ویژه معتبر لازم است" })}
              ${field({ label: "اولویت نمایش", help: "عدد بزرگ‌تر = نمایش زودتر (−۱۰۰۰ تا ۱۰۰۰)", control: html`<input class="ox-input ox-input--num" name="sortPriority" inputmode="numeric" value="${p.sortPriority || 0}">` })}
              ${field({ label: "کالکشن", opt: true, control: html`<input class="ox-input" name="collectionName" maxlength="60" value="${p.collectionName || ""}" placeholder="مثلاً کالکشن پاییز">` })}
            </div>
            <hr class="ox-sep" style="margin:26px 0">
            <div class="ox-form">
              ${field({ label: "نامک (Slug)", cls: "span-2", help: `${isNew ? "خالی = ساخت خودکار از نام." : "تغییر نامک، نامک قبلی را برای ریدایرکت ۳۰۱ نگه می‌دارد."}${p.oldSlugs?.length ? ` نامک‌های قبلی: ${p.oldSlugs.join("، ")}` : ""}`, control: html`<input class="ox-input" name="slug" value="${p.slug || ""}" placeholder="به‌صورت خودکار از نام ساخته می‌شود">` })}
              <div class="ox-field span-2"><span class="ox-label">پیش‌نمایش در نتایج جستجو</span><div data-serp style="padding:14px 16px;border:1px solid var(--line);border-radius:8px;font-family:Arial,Vazirmatn,sans-serif"></div></div>
            </div>`)}
        </div>

        <aside class="ox-preview" aria-label="پیش‌نمایش محصول">
          <div class="ox-preview__card"><div class="ox-preview__img" data-pv-img></div><div class="ox-preview__body"><div class="ox-preview__name" data-pv-name></div><div class="muted small" data-pv-brand></div><div class="ox-preview__price" data-pv-price></div><div style="margin-top:12px" data-pv-status></div></div></div>
          <div class="ox-panel"><div class="ox-panel__body ox-col" style="gap:10px"><div class="ox-label">خلاصه موجودی</div><div data-pv-stock></div></div></div>
          ${!isNew && p.slug ? html`<a class="ox-btn ox-btn--block" href="/productDetails/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">${icon("external", "ox-i--s")}صفحه محصول در فروشگاه</a>` : ""}
        </aside>
      </div>
      <div class="ox-actionbar"><span class="ox-actionbar__state" data-state>${isNew ? "محصول هنوز ذخیره نشده است" : "همه تغییرات ذخیره شده‌اند"}</span><span class="ox-spacer"></span>
        <button class="ox-btn" type="button" data-cancel>${isNew ? "انصراف" : "بازگشت"}</button>
        ${canEdit ? html`<button class="ox-btn ${p.isPublished ? "ox-btn--primary" : ""}" type="button" data-save>${icon("save", "ox-i--s")}${isNew ? "ذخیره پیش‌نویس" : "ذخیره"}</button>${!p.isPublished ? html`<button class="ox-btn ox-btn--primary" type="button" data-save-publish>${icon("check", "ox-i--s")}ذخیره و انتشار</button>` : ""}` : ""}
      </div>
      </form>`);

    const form = $("[data-form]", el);
    const E = form.elements;
    // ---------- navigation between sections
    const showSec = (k) => {
      $$("[data-sec]", el).forEach((b) => b.setAttribute("aria-current", String(b.dataset.sec === k)));
      $$("[data-panel]", el).forEach((pn) => (pn.hidden = pn.dataset.panel !== k));
      if (innerWidth <= 1024) form.scrollIntoView({ block: "start" });
    };
    $$("[data-sec]", el).forEach((b) => b.addEventListener("click", () => showSec(b.dataset.sec)));
    // ---------- dirty tracking + leave guard
    const markDirty = () => { s.dirty = true; const st = $("[data-state]", el); st.textContent = "تغییرات ذخیره نشده"; st.classList.add("is-dirty"); };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    OA.protect(() => s.dirty);
    $("[data-cancel]", el).addEventListener("click", () => router.back("products"));

    // ---------- live preview
    const preview = () => {
      const img = s.images[0];
      set($("[data-pv-img]", el), img ? html`<img src="${img.url}" alt="">` : icon("image", "ox-i--l"));
      $("[data-pv-name]", el).textContent = E.name.value.trim() || "نام محصول";
      const live = $("[data-live-name]", el); if (live) live.textContent = E.name.value.trim() || p.name;
      const b = lk.brands.find((x) => String(x._id) === E.brand.value);
      $("[data-pv-brand]", el).textContent = b ? b.name : "برند انتخاب نشده";
      const price = intOrNull(E.price.value), offer = intOrNull(E.offerPrice.value);
      set($("[data-pv-price]", el), price ? (offer && offer < price ? html`<b>${money(offer)}</b><s>${money(price)}</s><span class="ox-chip ox-chip--danger ox-chip--plain">${num(Math.round(((price - offer) / price) * 100))}٪</span>` : html`<b>${money(price)}</b>`) : html`<span class="muted small">قیمت تعیین نشده</span>`);
      set($("[data-pv-status]", el), html`${E.isPublished.checked ? OA.chip("منتشر می‌شود", "success") : OA.chip("پیش‌نویس")} ${E.isNewProduct.checked ? OA.chip("جدید", "info") : ""}`);
      const total = s.matrix ? [...s.rows.values()].filter((r) => !r.removed).reduce((a, r) => a + (Number(OA.toEn(r.countInStock)) || 0), 0) : intOrNull(E.countInStock.value) || 0;
      const vcount = s.colors.length * Math.max(1, s.sizes.length) || s.sizes.length;
      set($("[data-pv-stock]", el), html`<div class="ox-row ox-row--between"><span class="muted small">موجودی کل</span><b class="num ${total <= 0 ? "t-danger" : total <= (intOrNull(E.lowStockThreshold.value) ?? 3) ? "t-warning" : ""}">${num(total)} عدد</b></div>
        <div class="ox-row ox-row--between"><span class="muted small">رنگ / سایز</span><span class="num small">${num(s.colors.length)} / ${num(s.sizes.length)}</span></div>
        <div class="ox-row ox-row--between"><span class="muted small">نوع موجودی</span><span class="small">${s.matrix ? `ماتریس (${num(vcount)} ترکیب)` : "ساده"}</span></div>`);
      $("[data-cnt-name]", el).textContent = `${num(E.name.value.length)}/۱۰۰`;
      $("[data-cnt-lil]", el).textContent = `${num(E.lilDescription.value.length)}/۱۶۰`;
      const dh = $("[data-discount]", el);
      dh.textContent = offer && price && offer < price ? `${num(Math.round(((price - offer) / price) * 100))}٪ تخفیف نسبت به قیمت اصلی` : "خالی = بدون تخفیف";
      set($("[data-serp]", el), html`<div style="color:#1a0dab;font-size:17px">${E.name.value || "نام محصول"} | اودر</div><div style="color:#006621;font-size:12.5px" class="ltr">${location.host}/productDetails/${E.slug.value || "…"}</div><div style="color:#545454;font-size:13px">${E.lilDescription.value || "توضیح کوتاه محصول در اینجا نمایش داده می‌شود."}</div>`);
    };
    form.addEventListener("input", preview);
    form.addEventListener("change", preview);
    E.countInStock.addEventListener("input", () => (s.stockDirty = true));

    // ---------- rich description
    let desc = { get: () => p.description || "" };
    OA.richText($("[data-desc]", el), p.description || "").then((r) => { desc = r; r.onChange(markDirty); });

    // ---------- media manager
    const fileInput = $("[data-file]", el);
    const drawMedia = () => {
      const cur = s.images[s.cover];
      set($("[data-cover]", el), cur ? html`<img src="${cur.url}" alt="${cur.caption}">${s.cover === 0 ? html`<span class="ox-media__badge ox-chip ox-chip--dark ox-chip--plain">تصویر اصلی</span>` : html`<span class="ox-media__badge ox-chip ox-chip--outline ox-chip--plain">تصویر ${num(s.cover + 1)}</span>`}` : html`<div class="ox-empty ox-empty--compact"><div class="ox-empty__art">${icon("image", "ox-i--l")}</div><b>هنوز تصویری اضافه نشده</b><p>تصاویر را از کادر کنار اضافه کنید.</p></div>`);
      set($("[data-alt-wrap]", el), cur ? html`<span class="ox-label">متن جایگزین (alt) تصویر انتخاب‌شده</span><div class="ox-row ox-row--nowrap"><input class="ox-input" data-alt value="${cur.caption}" maxlength="120" placeholder="توضیح تصویر برای سئو و دسترس‌پذیری">
        <button class="ox-btn ox-btn--icon" type="button" data-mv="1" aria-label="جابجایی به جلو" ${attr(s.cover === 0, "disabled")}>${icon("chevron-r", "ox-i--s")}</button>
        <button class="ox-btn ox-btn--icon" type="button" data-mv="-1" aria-label="جابجایی به عقب" ${attr(s.cover === s.images.length - 1, "disabled")}>${icon("chevron", "ox-i--s")}</button>
        <button class="ox-btn" type="button" data-primary ${attr(s.cover === 0, "disabled")}>اصلی کن</button>
        <button class="ox-btn ox-btn--danger ox-btn--icon" type="button" data-rm aria-label="حذف تصویر">${icon("trash", "ox-i--s")}</button></div>` : "");
      set($("[data-gallery]", el), html`${s.images.map((img, i) => html`<button type="button" class="ox-media__item ${i === s.cover ? "is-active" : ""}" data-pick="${i}" aria-label="تصویر ${num(i + 1)}"><img src="${img.url}" alt="" loading="lazy"><span class="ox-media__n">${num(i + 1)}</span></button>`)}<button type="button" class="ox-drop" data-drop>${icon("upload", "ox-i--l")}<span>افزودن تصویر</span></button>`);
      $$("[data-pick]", el).forEach((b) => b.addEventListener("click", () => { s.cover = Number(b.dataset.pick); drawMedia(); }));
      const alt = $("[data-alt]", el); if (alt) alt.addEventListener("input", () => (s.images[s.cover].caption = alt.value));
      $$("[data-mv]", el).forEach((b) => b.addEventListener("click", () => { const i = s.cover, j = i - Number(b.dataset.mv); [s.images[i], s.images[j]] = [s.images[j], s.images[i]]; s.cover = j; markDirty(); drawMedia(); drawColors(); preview(); }));
      const pr = $("[data-primary]", el); if (pr) pr.addEventListener("click", () => { const [img] = s.images.splice(s.cover, 1); s.images.unshift(img); s.cover = 0; markDirty(); drawMedia(); preview(); });
      const rm = $("[data-rm]", el); if (rm) rm.addEventListener("click", () => { s.images.splice(s.cover, 1); s.cover = Math.max(0, s.cover - 1); markDirty(); drawMedia(); drawColors(); preview(); });
      const drop = $("[data-drop]", el);
      drop.addEventListener("click", () => fileInput.click());
      ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
      drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); addFiles(e.dataTransfer.files); });
    };
    async function addFiles(files) {
      if (!files || !files.length) return;
      const st = $("[data-upload-state]", el);
      set(st, html`<div class="ox-row" style="gap:10px"><span class="small muted">در حال بارگذاری ${num(files.length)} تصویر…</span></div><div class="ox-progress" style="margin-top:6px"><span></span></div>`);
      try {
        const r = await upload("/admin/upload-images", files, "images");
        (r.images || []).forEach((img) => s.images.push({ url: img.url, filename: img.filename, caption: E.name.value.trim() }));
        markDirty(); toast(`${num((r.images || []).length)} تصویر اضافه شد`);
      } catch (e) { fail(e); }
      set(st, ""); drawMedia(); drawColors(); preview();
    }
    fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });

    // ---------- colours / sizes / matrix
    const variantsChanged = () => { s.variantsDirty = true; markDirty(); drawMatrix(); preview(); };
    const drawMatrixSoon = OA.debounce(() => { s.variantsDirty = true; markDirty(); drawMatrix(); preview(); }, 300);
    function drawColors() {
      const cols = `44px minmax(0,1.3fr) minmax(0,1fr) ${s.matrix ? "" : "96px"} auto 36px`;
      set($("[data-colors]", el), s.colors.length ? html`<div class="ox-repeat"><div class="ox-repeat__head" style="grid-template-columns:${cols}"><span>رنگ</span><span>نام</span><span>تصویر رنگ</span>${s.matrix ? "" : html`<span>موجودی</span>`}<span>وضعیت</span><span></span></div>
        ${s.colors.map((c, i) => html`<div class="ox-repeat__row" style="grid-template-columns:${cols}">
          <input class="ox-input ox-input--color" type="color" value="${/^#[0-9a-f]{6}$/i.test(c.rgb) ? c.rgb : "#000000"}" data-c="${i}" data-k="rgb" aria-label="کد رنگ">
          <input class="ox-input ox-input--sm" placeholder="نام رنگ" value="${c.name}" data-c="${i}" data-k="name" aria-label="نام رنگ">
          <select class="ox-select ox-select--sm" data-c="${i}" data-k="image" aria-label="تصویر رنگ"><option value="">بدون تصویر</option>${s.images.map((img, j) => html`<option value="${img.url}" ${attr(c.image && c.image.url === img.url, "selected")}>تصویر ${num(j + 1)}</option>`)}${c.image && !s.images.some((img) => img.url === c.image.url) ? html`<option value="${c.image.url}" selected>تصویر فعلی</option>` : ""}</select>
          ${s.matrix ? "" : html`<input class="ox-input ox-input--sm ox-input--num" inputmode="numeric" placeholder="—" value="${c.countInStock}" data-c="${i}" data-k="countInStock" aria-label="موجودی رنگ">`}
          <label class="ox-check small"><input type="checkbox" data-c="${i}" data-k="isOutOfStock" ${attr(c.isOutOfStock, "checked")} ${attr(s.matrix, "disabled")}>ناموجود</label>
          <button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-c-del="${i}" aria-label="حذف رنگ">${icon("trash", "ox-i--s")}</button></div>`)}</div>` : html`<div class="ox-repeat"><div class="ox-repeat__empty">رنگی تعریف نشده است.</div></div>`);
      $$("[data-c]", el).forEach((inp) => inp.addEventListener(inp.type === "checkbox" || inp.tagName === "SELECT" ? "change" : "input", () => {
        const c = s.colors[Number(inp.dataset.c)], k = inp.dataset.k;
        if (k === "isOutOfStock") c[k] = inp.checked; else if (k === "image") c.image = inp.value ? { url: inp.value, filename: inp.value.split("/").pop() } : null; else c[k] = inp.value;
        if (k === "name" || k === "rgb") drawMatrixSoon();
        if (k === "countInStock") s.stockDirty = true;
      }));
      $$("[data-c-del]", el).forEach((b) => b.addEventListener("click", () => { s.colors.splice(Number(b.dataset.cDel), 1); drawColors(); variantsChanged(); }));
    }
    function drawSizes() {
      const cols = `minmax(0,1fr) minmax(0,1.3fr) ${s.matrix ? "" : "96px"} auto 36px`;
      set($("[data-sizes]", el), s.sizes.length ? html`<div class="ox-repeat"><div class="ox-repeat__head" style="grid-template-columns:${cols}"><span>سایز</span><span>کاربرد / توضیح</span>${s.matrix ? "" : html`<span>موجودی</span>`}<span>وضعیت</span><span></span></div>
        ${s.sizes.map((x, i) => html`<div class="ox-repeat__row" style="grid-template-columns:${cols}">
          <input class="ox-input ox-input--sm" placeholder="مثلاً ۱۰۰ میل" value="${x.size}" data-s="${i}" data-k="size" aria-label="سایز">
          <input class="ox-input ox-input--sm" placeholder="کاربرد" value="${x.usage}" data-s="${i}" data-k="usage" aria-label="کاربرد سایز">
          ${s.matrix ? "" : html`<input class="ox-input ox-input--sm ox-input--num" inputmode="numeric" placeholder="—" value="${x.countInStock}" data-s="${i}" data-k="countInStock" aria-label="موجودی سایز">`}
          <label class="ox-check small"><input type="checkbox" data-s="${i}" data-k="isOutOfStock" ${attr(x.isOutOfStock, "checked")} ${attr(s.matrix, "disabled")}>ناموجود</label>
          <button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-s-del="${i}" aria-label="حذف سایز">${icon("trash", "ox-i--s")}</button></div>`)}</div>` : html`<div class="ox-repeat"><div class="ox-repeat__empty">سایزی تعریف نشده است.</div></div>`);
      $$("[data-s]", el).forEach((inp) => inp.addEventListener(inp.type === "checkbox" ? "change" : "input", () => {
        const x = s.sizes[Number(inp.dataset.s)], k = inp.dataset.k;
        x[k] = k === "isOutOfStock" ? inp.checked : inp.value;
        if (k === "size") drawMatrixSoon();
        if (k === "countInStock") s.stockDirty = true;
      }));
      $$("[data-s-del]", el).forEach((b) => b.addEventListener("click", () => { s.sizes.splice(Number(b.dataset.sDel), 1); drawSizes(); variantsChanged(); }));
    }
    $("[data-add-color]", el).addEventListener("click", () => { s.colors.push({ _id: objectId(), name: "", rgb: "#000000", image: null, countInStock: "", isOutOfStock: false }); drawColors(); variantsChanged(); });
    $("[data-add-size]", el).addEventListener("click", () => { s.sizes.push({ _id: objectId(), size: "", usage: "", countInStock: "", isOutOfStock: false }); drawSizes(); variantsChanged(); });
    const vColors = () => s.colors.filter((c) => c.name.trim());
    const vSizes = () => s.sizes.filter((x) => x.size.trim());
    function drawMatrix() {
      const host = $("[data-matrix-grid]", el);
      if (!s.matrix) return set(host, "");
      const cs = vColors().length ? vColors() : [null], zs = vSizes().length ? vSizes() : [null];
      const low = intOrNull(E.lowStockThreshold.value) ?? 3;
      let total = 0;
      set(host, html`<div class="ox-matrix-wrap"><table class="ox-matrix"><thead><tr><th scope="col">رنگ \\ سایز</th>${zs.map((z) => html`<th scope="col">${z ? z.size : "بدون سایز"}</th>`)}</tr></thead><tbody>
        ${cs.map((c) => html`<tr><th scope="row" style="font-weight:600;color:var(--ink)">${c ? html`<span class="ox-row ox-row--nowrap"><span class="ox-swatch" style="background:${c.rgb}"></span>${c.name}</span>` : "بدون رنگ"}</th>${zs.map((z) => {
          const key = `${c ? c._id : ""}|${z ? z._id : ""}`, r = s.rows.get(key), on = r && !r.removed;
          const n = on ? Number(OA.toEn(r.countInStock)) || 0 : 0; if (on) total += n;
          return html`<td><div class="ox-cell ${!on ? "is-off" : n <= 0 ? "is-zero" : n <= low ? "is-low" : ""}">
            <label class="ox-check small"><input type="checkbox" data-offer="${key}" ${attr(on, "checked")}>عرضه</label>
            ${on ? html`<input class="ox-input ox-input--num" inputmode="numeric" data-mx="${key}" value="${r.countInStock}" aria-label="موجودی ${c ? c.name : ""} ${z ? z.size : ""}"><label class="ox-check small"><input type="checkbox" data-pause="${key}" ${attr(r.isOutOfStock, "checked")}>توقف فروش</label>` : html`<span class="faint small">عرضه نمی‌شود</span>`}
          </div></td>`;
        })}</tr>`)}</tbody></table></div>
        ${!p.variantInventoryConfigured && Number(p.countInStock) > 0 ? html`<div class="ox-note ox-note--warn" style="margin-top:12px">${icon("alert", "ox-i--s")}<span>موجودی ثبت‌شده فعلی <b class="num">${num(p.countInStock)}</b> عدد است. پس از ذخیره، موجودی کل برابر جمع ردیف‌های این جدول می‌شود؛ موجودی واقعی را بین ترکیب‌ها تقسیم کنید.</span></div>` : ""}
        <p class="ox-help" style="margin-top:10px">موجودی کل ماتریس: <b class="num">${num(total)}</b> عدد · برای تغییرات روزانه از صفحه انبار استفاده کنید.</p>`);
      $$("[data-offer]", host).forEach((cb) => cb.addEventListener("change", () => { const r = s.rows.get(cb.dataset.offer); if (cb.checked) s.rows.set(cb.dataset.offer, { countInStock: r ? r.countInStock : 0, isOutOfStock: r ? r.isOutOfStock : false }); else if (r) r.removed = true; s.stockDirty = true; markDirty(); drawMatrix(); preview(); }));
      $$("[data-mx]", host).forEach((inp) => inp.addEventListener("input", () => { s.rows.get(inp.dataset.mx).countInStock = inp.value; s.stockDirty = true; preview(); }));
      $$("[data-pause]", host).forEach((cb) => cb.addEventListener("change", () => { s.rows.get(cb.dataset.pause).isOutOfStock = cb.checked; s.stockDirty = true; }));
    }
    $("[data-matrix]", el).addEventListener("change", (e) => {
      s.matrix = e.target.checked;
      if (s.matrix) { const cs = vColors().length ? vColors() : [null], zs = vSizes().length ? vSizes() : [null]; cs.forEach((c) => zs.forEach((z) => { const k = `${c ? c._id : ""}|${z ? z._id : ""}`; if (!s.rows.has(k)) s.rows.set(k, { countInStock: 0, isOutOfStock: false }); })); }
      s.stockDirty = true; s.variantsDirty = true;
      drawColors(); drawSizes(); drawMatrix(); preview();
    });

    // ---------- specs
    function drawSpecs() {
      set($("[data-specs]", el), s.specs.length ? html`<div class="ox-repeat"><div class="ox-repeat__head" style="grid-template-columns:1fr 1.4fr 36px"><span>عنوان</span><span>مقدار</span><span></span></div>${s.specs.map((x, i) => html`<div class="ox-repeat__row" style="grid-template-columns:1fr 1.4fr 36px"><input class="ox-input ox-input--sm" placeholder="مثلاً کشور سازنده" value="${x.key}" data-sp="${i}" data-k="key" aria-label="عنوان"><input class="ox-input ox-input--sm" placeholder="مقدار" value="${x.value}" data-sp="${i}" data-k="value" aria-label="مقدار"><button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-sp-del="${i}" aria-label="حذف ردیف">${icon("trash", "ox-i--s")}</button></div>`)}</div>` : html`<div class="ox-repeat"><div class="ox-repeat__empty">مشخصه‌ای ثبت نشده است.</div></div>`);
      $$("[data-sp]", el).forEach((inp) => inp.addEventListener("input", () => (s.specs[Number(inp.dataset.sp)][inp.dataset.k] = inp.value)));
      $$("[data-sp-del]", el).forEach((b) => b.addEventListener("click", () => { s.specs.splice(Number(b.dataset.spDel), 1); markDirty(); drawSpecs(); }));
    }
    $("[data-add-spec]", el).addEventListener("click", () => { s.specs.push({ key: "", value: "" }); drawSpecs(); });

    // ---------- accords (editable strength bars)
    function drawAccords() {
      set($("[data-accords]", el), s.accords.length ? html`<div>${s.accords.map((a, i) => html`<div class="ox-accord"><input class="ox-input ox-input--sm" value="${a.name}" data-ac="${i}" placeholder="نام آکورد" aria-label="نام آکورد"><input type="range" min="0" max="100" step="5" value="${a.strength}" data-acs="${i}" aria-label="شدت ${a.name}"><output class="num">${num(a.strength)}</output><button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-ac-del="${i}" aria-label="حذف آکورد">${icon("x", "ox-i--s")}</button></div>`)}</div>` : html`<div class="ox-repeat"><div class="ox-repeat__empty">آکوردی ثبت نشده است.</div></div>`);
      $$("[data-ac]", el).forEach((i) => i.addEventListener("input", () => (s.accords[Number(i.dataset.ac)].name = i.value)));
      $$("[data-acs]", el).forEach((i) => i.addEventListener("input", () => { s.accords[Number(i.dataset.acs)].strength = Number(i.value); i.nextElementSibling.textContent = num(i.value); }));
      $$("[data-ac-del]", el).forEach((b) => b.addEventListener("click", () => { s.accords.splice(Number(b.dataset.acDel), 1); markDirty(); drawAccords(); }));
    }
    $("[data-add-accord]", el).addEventListener("click", () => { if (s.accords.length >= 8) return toast("حداکثر ۸ آکورد", "error"); s.accords.push({ name: "", strength: 60 }); drawAccords(); });

    // ---------- fragrance identity image
    function drawFrImage() {
      const host = $("[data-fr-image]", el);
      set(host, html`<div class="ox-row">${s.frImage ? html`<img class="ox-thumb" style="width:72px;height:72px" src="${s.frImage.url}" alt="">` : ""}<button class="ox-btn ox-btn--sm" type="button" data-up>${icon("upload", "ox-i--s")}${s.frImage ? "تغییر تصویر" : "بارگذاری تصویر"}</button>${s.frImage ? html`<button class="ox-btn ox-btn--sm ox-btn--danger" type="button" data-rm>حذف</button>` : ""}</div>`);
      $("[data-up]", host).addEventListener("click", () => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.onchange = async () => { if (!i.files[0]) return; try { const r = await busy($("[data-up]", host), () => upload("/admin/upload-image", i.files, "image")); s.frImage = { url: r.url, filename: r.filename }; markDirty(); drawFrImage(); } catch (_) {} }; i.click(); });
      const rm = $("[data-rm]", host); if (rm) rm.addEventListener("click", () => { s.frImage = null; markDirty(); drawFrImage(); });
    }

    drawMedia(); drawColors(); drawSizes(); drawMatrix(); drawSpecs(); drawAccords(); drawFrImage(); preview();

    // ---------- validation + payload (same shape the endpoints accepted before)
    function collect() {
      const errors = [];
      $$(".ox-field.is-invalid", el).forEach((x) => x.classList.remove("is-invalid"));
      const bad = (sec, msg, input) => { errors.push([sec, msg]); const fld = input && input.closest(".ox-field"); if (fld) fld.classList.add("is-invalid"); };
      const name = E.name.value.trim();
      if (name.length < 3) bad("basic", "نام محصول باید حداقل ۳ کاراکتر باشد", E.name);
      if (!E.brand.value) bad("basic", "برند را انتخاب کنید", E.brand);
      const category = $$("[data-cats] input:checked", el).map((i) => i.value);
      if (!category.length) { errors.push(["basic", "حداقل یک دسته‌بندی انتخاب کنید"]); $("[data-catfield]", el).classList.add("is-invalid"); }
      const price = intOrNull(E.price.value), offer = intOrNull(E.offerPrice.value), stock = intOrNull(E.countInStock.value);
      if (price === null || Number.isNaN(price) || price < 0) bad("pricing", "قیمت معتبر وارد کنید", E.price);
      if (Number.isNaN(offer) || (offer !== null && offer < 0) || (offer && price !== null && offer >= price)) bad("pricing", "قیمت ویژه باید کمتر از قیمت اصلی باشد", E.offerPrice);
      if (!E.countInStock.disabled && (stock === null || Number.isNaN(stock) || stock < 0)) bad("inventory", "موجودی باید عدد نامنفی باشد", E.countInStock);
      const sop = E.specialOfferPosition.value;
      if (sop && !(offer && offer < price)) bad("storefront", "برای جایگاه پیشنهاد ویژه، قیمت ویژه معتبر لازم است", E.specialOfferPosition);
      if (s.colors.some((c) => !c.name.trim())) errors.push(["variants", "نام همه رنگ‌ها را وارد کنید یا ردیف خالی را حذف کنید"]);
      if (s.sizes.some((x) => !x.size.trim())) errors.push(["variants", "عنوان همه سایزها را وارد کنید یا ردیف خالی را حذف کنید"]);
      const badNum = (v) => v !== "" && v !== null && v !== undefined && (Number.isNaN(intOrNull(v)) || intOrNull(v) < 0);
      if (s.colors.some((c) => badNum(c.countInStock)) || s.sizes.some((x) => badNum(x.countInStock))) errors.push(["variants", "موجودی رنگ/سایز باید عدد نامنفی باشد"]);
      const specs = s.specs.filter((x) => x.key.trim() || x.value.trim());
      if (specs.some((x) => !x.key.trim() || !x.value.trim())) errors.push(["specs", "عنوان و مقدار همه مشخصات را کامل کنید"]);
      const split = (v) => String(v || "").split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);
      const fr = {};
      $$("[data-fr]", form).forEach((x) => (fr[x.dataset.fr] = x.value.trim()));
      ["seasons", "dayNight"].forEach((k) => (fr[k] = $$(`[data-fr-list="${k}"]:checked`, form).map((i) => i.value)));
      const body = {
        name, englishName: E.englishName.value.trim(), slug: E.slug.value.trim(), brand: E.brand.value, category,
        lilDescription: E.lilDescription.value.trim(), description: desc.get(), price, offerPrice: offer || null, sku: E.sku.value.trim(),
        lowStockThreshold: intOrNull(E.lowStockThreshold.value) ?? 3, weight: intOrNull(E.weight.value),
        images: s.images.map((i) => ({ url: i.url, filename: i.filename, caption: i.caption, alt: i.caption })),
        colors: s.colors.map((c) => ({ _id: c._id, name: c.name.trim(), rgb: c.rgb, image: c.image || undefined, countInStock: c.countInStock === "" || c.countInStock === null ? "" : intOrNull(c.countInStock), isOutOfStock: c.isOutOfStock })),
        sizes: s.sizes.map((x) => ({ _id: x._id, size: x.size.trim(), usage: x.usage.trim(), countInStock: x.countInStock === "" || x.countInStock === null ? "" : intOrNull(x.countInStock), isOutOfStock: x.isOutOfStock })),
        specifications: specs.map((x) => ({ key: x.key.trim(), value: x.value.trim() })),
        tags: split(E.tags.value), guarantee: E.guarantee.value.trim(), product_group_id: E.product_group_id.value.trim(),
        isPublished: E.isPublished.checked, isNewProduct: E.isNewProduct.checked, badge: E.badge.value, collectionName: E.collectionName.value.trim(), sortPriority: intOrNull(E.sortPriority.value) || 0,
        fragrance: { ...fr, top: split(fr.top), heart: split(fr.heart), base: split(fr.base), occasions: split(fr.occasions), accords: s.accords.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), strength: a.strength })), identityImage: s.frImage || undefined },
      };
      if (!isNew) body.specialOfferPosition = sop ? Number(sop) : null;
      // Stock is only sent when edited here, so concurrent reservations are never overwritten.
      if (isNew || (s.stockDirty && !E.countInStock.disabled)) body.countInStock = stock ?? 0;
      if (s.matrix && (s.stockDirty || s.variantsDirty || !p.variantInventoryConfigured)) {
        const cIds = new Set(vColors().map((c) => String(c._id))), zIds = new Set(vSizes().map((x) => String(x._id)));
        const rows = [];
        s.rows.forEach((r, key) => {
          if (r.removed) return;
          const [colorId, sizeId] = key.split("|");
          if ((colorId && !cIds.has(colorId)) || (sizeId && !zIds.has(sizeId)) || (cIds.size && !colorId) || (zIds.size && !sizeId)) return;
          const nn = intOrNull(r.countInStock);
          if (nn === null || Number.isNaN(nn) || nn < 0) errors.push(["variants", "موجودی ترکیب‌ها باید عدد نامنفی باشد"]);
          rows.push({ colorId, sizeId, countInStock: nn || 0, isOutOfStock: r.isOutOfStock });
        });
        if (!rows.length) errors.push(["variants", "در ماتریس حداقل یک ترکیب باید عرضه شود"]);
        body.variantInventoryConfigured = true;
        body.variantStocks = rows;
        delete body.countInStock;
      }
      return { body, errors };
    }

    async function save(btn, publish) {
      $$("[data-err]", el).forEach((x) => (x.hidden = true));
      if (publish) E.isPublished.checked = true;
      const { body, errors } = collect();
      if (errors.length) {
        if (publish && !p.isPublished) E.isPublished.checked = false;
        errors.forEach(([k]) => { const d = $(`[data-err="${k}"]`, el); if (d) d.hidden = false; });
        showSec(errors[0][0]);
        toast(errors[0][1], "error");
        return;
      }
      try {
        await busy(btn, async () => {
          if (isNew) {
            const matrixBody = body.variantInventoryConfigured ? { variantStocks: body.variantStocks } : null;
            const createBody = { ...body };
            delete createBody.variantInventoryConfigured; delete createBody.variantStocks;
            if (matrixBody) createBody.countInStock = 0;
            const r = await api("/admin/products/add", { method: "POST", body: createBody });
            const created = r.product, newId = created._id || created.id;
            if (matrixBody) {
              // colours/sizes receive their final ids on creation (same order): remap the matrix.
              const cMap = new Map(vColors().map((c, i) => [String(c._id), String(created.colors[i]?._id || "")]));
              const zMap = new Map(vSizes().map((x, i) => [String(x._id), String(created.sizes[i]?._id || "")]));
              await api(`/admin/products/edit/${newId}`, { method: "PUT", body: { variantInventoryConfigured: true, variantStocks: matrixBody.variantStocks.map((row) => ({ ...row, colorId: row.colorId ? cMap.get(row.colorId) : "", sizeId: row.sizeId ? zMap.get(row.sizeId) : "" })), colors: created.colors, sizes: created.sizes } });
            }
            s.dirty = false; lookups = null;
            toast(publish ? "محصول ایجاد و منتشر شد" : "محصول ایجاد شد");
            router.go("products", [newId]);
          } else {
            await api(`/admin/products/edit/${p._id}`, { method: "PUT", body });
            s.dirty = false;
            toast(publish ? "محصول ذخیره و منتشر شد" : "تغییرات محصول ذخیره شد");
            renderEditor(el, p._id);
          }
        });
      } catch (e) {
        if (publish && !p.isPublished) E.isPublished.checked = false;
        const errs = e.data && e.data.errors;
        if (Array.isArray(errs) && errs.length) toast(errs.map((x) => x.msg).join("، "), "error");
      }
    }
    const sb = $("[data-save]", el); if (sb) sb.addEventListener("click", () => save(sb, false));
    const sp = $("[data-save-publish]", el); if (sp) sp.addEventListener("click", () => save(sp, true));
  }

  OA.section("products", {
    title: "محصولات", short: "محصولات", group: "کاتالوگ", nav: true, icon: "box", perm: ["manage_products", "manage_inventory"],
    quick: { label: "افزودن محصول", icon: "plus", href: "#/products/new", perm: "manage_products" },
    render(el, { args }) { if (args[0]) renderEditor(el, args[0]); else renderList(el); },
  });
  void raw;
})();
