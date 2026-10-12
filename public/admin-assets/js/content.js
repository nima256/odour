/* Blog (مجله): list + article editor. */
(function () {
  "use strict";
  const { html, raw, set, $, $$, num, icon, api, upload, router, toast, busy, confirm, date, ago } = OA;

  let listApi = null;
  let editorRef = null;

  function render(el, { args }) {
    set(el, html`${OA.pageHead("مجله", "مقالات، پیش‌نویس‌ها و بازدیدها", html`<button class="oa-btn oa-btn--primary" data-new>${icon("plus", "oa-icon--sm")} مقاله جدید</button>`)}<div data-list></div>`);
    $("[data-new]", el).addEventListener("click", () => router.go("weblogs", ["new"]));
    listApi = OA.list($("[data-list]", el), {
      endpoint: "/weblogs",
      defaults: { status: "" },
      searchPlaceholder: "عنوان، برچسب یا نامک…",
      tabs: { name: "status", options: [["", "همه"], ["published", "منتشر شده"], ["draft", "پیش‌نویس"], ["featured", "ویژه"]], countsKey: "_none", count: () => null },
      filters: [{ name: "sort", label: "مرتب‌سازی", options: [["", "جدیدترین"], ["oldest", "قدیمی‌ترین"], ["views", "پربازدیدترین"]] }],
      columns: [
        { label: "مقاله", cls: "col-main", main: true, render: (w) => html`<div class="oa-media">${w.image ? html`<img class="oa-thumb" src="${w.image}" alt="" loading="lazy">` : html`<div class="oa-thumb"></div>`}<div><span class="oa-cell-title">${w.title}</span><span class="oa-cell-sub">${(w.categories || []).map((c) => c.name).join("، ") || "بدون دسته"}</span></div></div>` },
        { label: "وضعیت", render: (w) => html`${w.isPublished ? OA.badge("منتشر شده", "good") : OA.badge("پیش‌نویس", "")} ${w.isFeatured ? OA.badge("ویژه", "gold") : ""}` },
        { label: "انتشار", render: (w) => html`<span>${w.publishedAt ? date(w.publishedAt) : "—"}</span>` },
        { label: "بازدید", render: (w) => html`<span class="num">${num(w.viewCount || 0)}</span>` },
        { label: "مطالعه", render: (w) => html`<span class="num">${num(w.readingTime || 0)} دقیقه</span>` },
        { label: "", cls: "col-actions", render: (w) => html`<div class="oa-inline" style="gap:2px;justify-content:flex-end">${w.isPublished ? html`<a class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm" href="/weblog/${encodeURIComponent(w.slug)}" target="_blank" rel="noopener" aria-label="مشاهده">${icon("eye", "oa-icon--sm")}</a>` : ""}<button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm oa-btn--danger" data-del aria-label="حذف">${icon("trash", "oa-icon--sm")}</button></div>` },
      ],
      onRow: (w) => router.go("weblogs", [w._id], router.query()),
      bind(tr, w, list) {
        $("[data-del]", tr).addEventListener("click", async (e) => {
          if (!(await confirm({ title: "حذف مقاله", message: `«${w.title}» برای همیشه حذف شود؟ لینک این مقاله از دسترس خارج می‌شود.`, confirmText: "حذف", danger: true }))) return;
          try { await busy(e.currentTarget, () => api(`/admin/weblogs/delete/${w._id}`, { method: "DELETE" }), "مقاله حذف شد"); list.reload(); } catch (_) {}
        });
      },
      empty: () => OA.empty("مقاله‌ای وجود ندارد", "اولین مقاله مجله را بنویسید.", "pen"),
    });
    if (args[0]) openEditor(args[0]);
  }

  async function openEditor(id) {
    if (editorRef) await editorRef.close();
    const isNew = id === "new";
    const d = OA.drawer({
      title: isNew ? "مقاله جدید" : "ویرایش مقاله",
      size: "oa-drawer--wide",
      body: OA.skeletonRows(6),
      foot: html`<span class="oa-muted" data-dirty style="font-size:12.5px;margin-inline-end:auto"></span><button class="oa-btn" data-close>بستن</button><button class="oa-btn" data-save-draft>ذخیره پیش‌نویس</button><button class="oa-btn oa-btn--primary" data-publish>${icon("check", "oa-icon--sm")} ذخیره و انتشار</button>`,
      onClose: () => { editorRef = null; if (router.parse().args[0]) router.go("weblogs", [], router.query()); },
    });
    editorRef = d;
    try {
      const [cats, data] = await Promise.all([api("/categories", { query: { type: "weblog" } }), isNew ? Promise.resolve({ weblog: null }) : api(`/admin/weblogs/${id}`)]);
      build(d, data.weblog, cats.categories, isNew);
    } catch (e) {
      set(d.body, OA.errorBox(e, () => openEditor(id)));
    }
  }

  const toLocalDate = (v) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v)) : "");

  function build(d, w, categories, isNew) {
    w = w || { title: "", description: "", content: "", images: [], categories: [], tags: [], readingTime: 5, isFeatured: false, isPublished: false, metaTitle: "", metaDescription: "", viewCount: 0 };
    const id = w._id || w.id;
    let images = (w.images || []).map((x) => (typeof x === "string" ? x : x.url)).filter(Boolean);
    const catIds = new Set((w.categories || []).map((c) => String(c._id || c.id || c)));
    set(d.body, html`<form data-f novalidate class="oa-grid oa-grid--main">
      <div class="oa-stack">
        <div class="oa-card oa-card__body oa-stack" style="gap:14px">
          <label class="oa-field"><span>عنوان *</span><input class="oa-input" name="title" maxlength="100" value="${w.title}" style="font-size:17px;height:46px"></label>
          <label class="oa-field"><span>خلاصه * <span class="oa-muted" data-cnt></span></span><textarea class="oa-textarea" name="description" maxlength="160" rows="2">${w.description || ""}</textarea></label>
          <div class="oa-field"><span>متن مقاله * <span class="oa-muted" data-words></span></span><div data-content>${OA.skeletonRows(2, 1)}</div></div>
        </div>
        <div class="oa-card oa-card__body"><div class="oa-section-title"><h3>تصاویر</h3><small>اولین تصویر، تصویر شاخص مقاله است</small></div><div class="oa-images" data-images></div></div>
      </div>
      <div class="oa-stack">
        <div class="oa-card oa-card__body oa-stack" style="gap:12px">
          ${!isNew ? html`<div class="oa-inline">${w.isPublished ? OA.badge("منتشر شده", "good") : OA.badge("پیش‌نویس", "")}<span class="oa-muted" style="font-size:12.5px">${num(w.viewCount || 0)} بازدید · ویرایش ${ago(w.updatedAt)}</span></div>
          ${w.isPublished && w.slug ? html`<a class="oa-link" href="/weblog/${encodeURIComponent(w.slug)}" target="_blank" rel="noopener">مشاهده مقاله ${icon("external", "oa-icon--sm")}</a>` : ""}` : ""}
          <label class="oa-switch"><input type="checkbox" name="isFeatured" ${raw(w.isFeatured ? "checked" : "")}><span class="oa-switch__track"></span><span>مقاله ویژه</span></label>
          <label class="oa-field"><span>تاریخ انتشار</span><input class="oa-input" type="date" name="publishedAt" value="${toLocalDate(w.publishedAt)}" ${raw(isNew ? "disabled" : "")}><small>${isNew ? "هنگام انتشار به‌صورت خودکار ثبت می‌شود." : "خالی = زمان اولین انتشار"}</small></label>
          <label class="oa-field"><span>زمان مطالعه (دقیقه)</span><div class="oa-inline" style="flex-wrap:nowrap"><input class="oa-input num" name="readingTime" inputmode="numeric" value="${w.readingTime || 5}"><button type="button" class="oa-btn oa-btn--sm" data-estimate>محاسبه</button></div></label>
        </div>
        <div class="oa-card oa-card__body oa-stack" style="gap:12px">
          <div class="oa-field"><span>دسته‌ها</span>${categories.length ? html`<div class="oa-stack" style="gap:6px">${categories.map((c) => html`<label class="oa-check"><input type="checkbox" data-cat value="${c._id}" ${raw(catIds.has(String(c._id)) ? "checked" : "")}>${c.name}</label>`)}</div>` : html`<small>ابتدا از بخش دسته‌بندی‌ها، دسته مجله بسازید.</small>`}</div>
          <label class="oa-field"><span>برچسب‌ها</span><input class="oa-input" name="tags" value="${(w.tags || []).join("، ")}"><small>با ویرگول جدا کنید</small></label>
        </div>
        <div class="oa-card oa-card__body oa-stack" style="gap:12px">
          <div class="oa-label">سئو</div>
          <label class="oa-field"><span>عنوان متا</span><input class="oa-input" name="metaTitle" maxlength="60" value="${w.metaTitle || ""}"><small>خالی = عنوان مقاله</small></label>
          <label class="oa-field"><span>توضیحات متا</span><textarea class="oa-textarea" name="metaDescription" maxlength="160" rows="3">${w.metaDescription || ""}</textarea><small>خالی = خلاصه مقاله</small></label>
          ${!isNew && w.slug ? html`<p class="oa-help" style="margin:0">نامک: ${w.slug} (ثابت؛ تا لینک‌های قبلی خراب نشوند)</p>` : ""}
        </div>
      </div>
    </form>`);
    const f = $("[data-f]", d.body).elements;
    let dirty = false;
    const mark = () => { dirty = true; $("[data-dirty]", d.el).textContent = "تغییرات ذخیره نشده"; };
    $("[data-f]", d.body).addEventListener("input", mark);
    d.beforeClose = async () => !dirty || confirm({ title: "تغییرات ذخیره نشده", message: "بدون ذخیره خارج می‌شوید؟", confirmText: "خروج", danger: true });
    const cnt = () => ($("[data-cnt]", d.body).textContent = `(${num(f.description.value.length)}/۱۶۰)`);
    f.description.addEventListener("input", cnt); cnt();

    let content = { get: () => w.content || "" };
    const words = () => { const t = (content.get() || "").replace(/<[^>]+>/g, " ").trim(); return t ? t.split(/\s+/).length : 0; };
    const showWords = () => ($("[data-words]", d.body).textContent = `(${num(words())} کلمه)`);
    OA.richText($("[data-content]", d.body), w.content || "").then((r) => { content = r; r.onChange(() => { mark(); showWords(); }); showWords(); });
    $("[data-estimate]", d.body).addEventListener("click", () => { f.readingTime.value = Math.max(1, Math.round(words() / 200)); mark(); });

    const imgBox = $("[data-images]", d.body);
    const drawImages = () => {
      set(imgBox, html`${images.map((url, i) => html`<div class="oa-image"><img src="${url}" alt="">${i === 0 ? html`<span class="oa-image__tag oa-badge oa-badge--dark oa-badge--plain">شاخص</span>` : ""}<div class="oa-image__bar">
        <button type="button" data-mv="${i}" data-dir="-1" aria-label="قبل" ${raw(i === 0 ? "disabled" : "")}>${icon("chevron-r", "oa-icon--sm")}</button>
        <button type="button" data-rm="${i}" aria-label="حذف">${icon("trash", "oa-icon--sm")}</button>
        <button type="button" data-mv="${i}" data-dir="1" aria-label="بعد" ${raw(i === images.length - 1 ? "disabled" : "")}>${icon("chevron", "oa-icon--sm")}</button></div></div>`)}
        <button type="button" class="oa-dropzone" data-add>${icon("upload", "oa-icon--lg")}<span>افزودن تصویر</span></button>`);
      $$("[data-mv]", imgBox).forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.mv); const j = i + Number(b.dataset.dir); [images[i], images[j]] = [images[j], images[i]]; mark(); drawImages(); }));
      $$("[data-rm]", imgBox).forEach((b) => b.addEventListener("click", () => { images.splice(Number(b.dataset.rm), 1); mark(); drawImages(); }));
      $("[data-add]", imgBox).addEventListener("click", () => {
        const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = "image/jpeg,image/png,image/webp";
        inp.onchange = async () => { if (!inp.files.length) return; try { const r = await busy($("[data-add]", imgBox), () => upload("/admin/upload-images", inp.files, "images")); images.push(...(r.images || []).map((x) => x.url)); mark(); drawImages(); } catch (_) {} };
        inp.click();
      });
    };
    drawImages();

    const save = async (btn, publish) => {
      const text = (content.get() || "").replace(/<[^>]+>/g, "").trim();
      const errs = [];
      if (f.title.value.trim().length < 5) errs.push("عنوان باید حداقل ۵ کاراکتر باشد");
      if (!f.description.value.trim()) errs.push("خلاصه مقاله الزامی است");
      if ((content.get() || "").length < 100 || text.length < 20) errs.push("متن مقاله باید حداقل ۱۰۰ کاراکتر باشد");
      if (errs.length) return toast(errs[0], "error");
      const body = {
        title: f.title.value.trim(),
        description: f.description.value.trim(),
        content: content.get(),
        images,
        categories: $$("[data-cat]:checked", d.body).map((c) => c.value),
        tags: f.tags.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean),
        readingTime: Math.max(1, OA.intOrNull(f.readingTime.value) || 5),
        isFeatured: f.isFeatured.checked,
        isPublished: publish === null ? Boolean(w.isPublished) : publish,
        metaTitle: f.metaTitle.value.trim(),
        metaDescription: f.metaDescription.value.trim(),
      };
      if (!isNew && f.publishedAt.value) body.publishedAt = `${f.publishedAt.value}T09:00:00+03:30`;
      try {
        await busy(btn, () => api(isNew ? "/admin/weblogs/add" : `/admin/weblogs/edit/${id}`, { method: isNew ? "POST" : "PUT", body }), publish ? "مقاله منتشر شد" : "مقاله ذخیره شد");
        dirty = false;
        d.close(true);
        if (listApi) listApi.reload();
      } catch (_) {}
    };
    const draftBtn = $("[data-save-draft]", d.el);
    draftBtn.textContent = !isNew && w.isPublished ? "خروج از انتشار و ذخیره" : "ذخیره پیش‌نویس";
    draftBtn.addEventListener("click", (e) => save(e.currentTarget, false));
    const pubBtn = $("[data-publish]", d.el);
    if (!isNew && w.isPublished) set(pubBtn, html`${icon("check", "oa-icon--sm")} ذخیره تغییرات`);
    pubBtn.addEventListener("click", (e) => save(e.currentTarget, true));
  }

  OA.section("weblogs", {
    title: "مجله",
    group: "محتوا",
    nav: true,
    icon: "pen",
    perm: "manage_weblogs",
    render,
    onArgs(args) {
      if (!listApi) return false;
      if (args[0]) openEditor(args[0]);
      else if (editorRef) editorRef.close(true);
      return true;
    },
  });
})();
