/* Blog — editorial article list + full-page writing workspace. */
(function () {
  "use strict";
  const { html, set, $, $$, num, icon, api, upload, router, toast, busy, confirm, date, ago, attr, field, toggle } = OA;

  const STATUS = [["", "همه مقاله‌ها"], ["published", "منتشر شده"], ["draft", "پیش‌نویس"], ["featured", "ویژه"]];
  const statusChips = (w) => html`${w.isPublished ? OA.chip("منتشر شده", "success") : OA.chip("پیش‌نویس", "")}${w.isFeatured ? OA.chip("ویژه", "primary") : ""}`;

  // ------------------------------------------------------------------ list
  function renderList(el) {
    const q0 = router.query();
    const st = { status: q0.status || "", sort: q0.sort || "", q: q0.q || "", page: Number(q0.page) || 1 };
    set(el, html`${OA.pageHead({ title: "مجله", count: "", subtitle: "مقالات، پیش‌نویس‌ها و عملکرد محتوا", actions: html`<a class="ox-btn ox-btn--primary" href="#/weblogs/new">${icon("plus", "ox-i--s")}مقاله جدید</a>` })}
      <div class="ox-tabs" role="tablist" style="margin-bottom:16px">${STATUS.map(([v, l]) => html`<button class="ox-tab" type="button" role="tab" data-tab="${v}" aria-selected="${String(st.status === v)}">${l}</button>`)}</div>
      <div class="ox-datacard">
        <div class="ox-toolbar">
          <label class="ox-searchbox">${icon("search")}<span class="sr-only">جستجو</span><input class="ox-input" type="search" data-q placeholder="عنوان، برچسب یا نامک…" value="${st.q}"></label>
          <select class="ox-select ox-keep" style="width:auto" data-sort aria-label="مرتب‌سازی">${[["", "جدیدترین"], ["oldest", "قدیمی‌ترین"], ["views", "پربازدیدترین"]].map(([v, l]) => html`<option value="${v}" ${attr(st.sort === v, "selected")}>${l}</option>`)}</select>
          <span class="ox-toolbar__count" data-total></span>
        </div>
        <div data-body>${OA.skeletonTable(5)}</div><div data-pager></div>
      </div>`);
    const body = $("[data-body]", el);
    let seq = 0;
    const load = async () => {
      const my = ++seq;
      const q = {}; Object.entries(st).forEach(([k, v]) => { if (v && !(k === "page" && v === 1)) q[k] = v; });
      router.replaceQuery(q);
      body.style.opacity = "0.5";
      try {
        const d = await api("/weblogs", { query: st });
        if (my !== seq) return;
        body.style.opacity = "";
        $("[data-total]", el).textContent = `${num(d.total)} مقاله`;
        const hc = $("[data-head-count]", el); if (hc) hc.textContent = `${num(d.total)} مقاله`;
        if (!d.items.length) {
          set(body, OA.empty({ icon: "pen", title: st.q || st.status ? "مقاله‌ای با این فیلتر پیدا نشد" : "هنوز مقاله‌ای ننوشته‌اید", text: st.q || st.status ? "عبارت جستجو یا وضعیت را تغییر دهید." : "اولین مقاله مجله را بنویسید.", action: st.q || st.status ? "" : html`<a class="ox-btn ox-btn--primary" href="#/weblogs/new">${icon("plus", "ox-i--s")}نوشتن مقاله</a>` }));
          set($("[data-pager]", el), "");
          return;
        }
        set(body, html`<div class="ox-articles">${d.items.map((w, i) => html`<article class="ox-article" data-i="${i}" tabindex="0">
          ${w.image ? html`<img class="ox-article__cover" src="${w.image}" alt="" loading="lazy">` : html`<span class="ox-article__cover ox-thumb--empty">${icon("image")}</span>`}
          <div style="min-width:0"><div class="ox-row" style="gap:6px;margin-bottom:4px">${statusChips(w)}</div><h3>${w.title}</h3>
            <div class="ox-article__meta"><span>${(w.categories || []).map((c) => c.name).join("، ") || "بدون دسته"}</span><span>${w.isPublished ? `انتشار ${date(w.publishedAt)}` : `ویرایش ${ago(w.updatedAt)}`}</span><span>${icon("eye", "ox-i--s")} ${num(w.viewCount || 0)}</span><span>${num(w.readingTime || 0)} دقیقه مطالعه</span></div></div>
          <div class="ox-row ox-row--nowrap" style="gap:4px"><a class="ox-btn ox-btn--sm" href="#/weblogs/${w._id}">${icon("pen", "ox-i--s")}ویرایش</a><button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-menu aria-label="عملیات">${icon("more")}</button></div>
        </article>`)}</div>`);
        set($("[data-pager]", el), OA.pager(d, (p) => { st.page = p; load(); el.scrollIntoView({ block: "start" }); }));
        $$("[data-i]", body).forEach((row) => {
          const w = d.items[Number(row.dataset.i)];
          const open = () => router.go("weblogs", [w._id]);
          row.addEventListener("click", (e) => { if (!e.target.closest("a, button")) open(); });
          row.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === row) open(); });
          $("[data-menu]", row).addEventListener("click", (e) => OA.menu(e.currentTarget, [
            { label: "ویرایش مقاله", icon: "pen", run: open },
            w.isPublished && w.slug ? { label: "مشاهده در سایت", icon: "external", href: `/weblog/${encodeURIComponent(w.slug)}`, external: true } : null,
            "-",
            { label: "حذف مقاله", icon: "trash", danger: true, run: async () => {
              if (!(await confirm({ title: "حذف مقاله", message: `«${w.title}» برای همیشه حذف شود؟`, consequence: "لینک این مقاله از دسترس خارج می‌شود و قابل بازگشت نیست.", confirmText: "حذف مقاله", danger: true }))) return;
              try { await busy(null, () => api(`/admin/weblogs/delete/${w._id}`, { method: "DELETE" }), "مقاله حذف شد"); load(); } catch (_) {}
            } },
          ]));
        });
      } catch (e) {
        if (my !== seq) return;
        body.style.opacity = "";
        set(body, OA.errorBox(e, load));
      }
    };
    $$("[data-tab]", el).forEach((b) => b.addEventListener("click", () => { $$("[data-tab]", el).forEach((x) => x.setAttribute("aria-selected", String(x === b))); st.status = b.dataset.tab; st.page = 1; load(); }));
    $("[data-sort]", el).addEventListener("change", (e) => { st.sort = e.target.value; st.page = 1; load(); });
    const qi = $("[data-q]", el);
    qi.addEventListener("input", OA.debounce(() => { st.q = qi.value.trim(); st.page = 1; load(); }, 350));
    load();
  }

  // ---------------------------------------------------------------- editor
  const toLocalDate = (v) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v)) : "");

  async function renderEditor(el, id) {
    const isNew = id === "new";
    set(el, html`<div class="ox-workhead"><span class="ox-skel" style="width:260px;height:28px"></span></div><div class="ox-workspace ox-workspace--2"><div>${OA.skeletonBlock(560)}</div><div>${OA.skeletonBlock(360)}</div></div>`);
    let cats, w;
    try {
      const [c, d] = await Promise.all([api("/categories", { query: { type: "weblog" } }), isNew ? Promise.resolve({ weblog: null }) : api(`/admin/weblogs/${id}`)]);
      cats = c.categories || []; w = d.weblog;
    } catch (e) { return set(el, html`${OA.workHead({ title: "مقاله" })}${OA.errorBox(e, () => renderEditor(el, id))}`); }
    if (!isNew && !w) return set(el, html`${OA.workHead({ title: "مقاله" })}${OA.empty({ icon: "pen", title: "مقاله یافت نشد" })}`);
    draw(el, w, cats, isNew);
  }

  function draw(el, w, categories, isNew) {
    w = w || { title: "", description: "", content: "", images: [], categories: [], tags: [], readingTime: 5, isFeatured: false, isPublished: false, metaTitle: "", metaDescription: "", viewCount: 0 };
    const id = w._id || w.id;
    let images = (w.images || []).map((x) => (typeof x === "string" ? x : x.url)).filter(Boolean);
    let tags = [...(w.tags || [])];
    const catIds = new Set((w.categories || []).map((c) => String(c._id || c.id || c)));
    let dirty = false;

    set(el, html`${OA.workHead({
      title: isNew ? "مقاله جدید" : w.title,
      meta: isNew ? html`<span>پیش‌نویس جدید</span>` : html`${statusChips(w)}<span>${num(w.viewCount || 0)} بازدید</span><span>آخرین ویرایش ${ago(w.updatedAt)}</span>`,
      actions: !isNew && w.isPublished && w.slug ? html`<a class="ox-btn" href="/weblog/${encodeURIComponent(w.slug)}" target="_blank" rel="noopener">${icon("external", "ox-i--s")}مشاهده در سایت</a>` : "",
    })}
      <form data-f novalidate><div class="ox-workspace ox-workspace--2">
        <div class="ox-editor-sheet ox-col" style="gap:22px">
          <div class="ox-field" data-title-f><input class="ox-title-input" name="title" maxlength="100" placeholder="عنوان مقاله" value="${w.title}" aria-label="عنوان مقاله"><span class="ox-error">عنوان باید حداقل ۵ کاراکتر باشد</span></div>
          ${field({ label: "خلاصه", req: true, count: html`<span data-cnt></span>`, help: "در فهرست مجله و نتایج جستجو نمایش داده می‌شود.", control: html`<textarea class="ox-textarea" name="description" maxlength="160" rows="2">${w.description || ""}</textarea>` })}
          <div class="ox-field"><span class="ox-label">متن مقاله<span class="req" aria-hidden="true">*</span><span class="count" data-words></span></span><div data-content>${OA.skeletonBlock(320)}</div></div>
          <div class="ox-field"><span class="ox-label">تصاویر مقاله<span class="opt">اولین تصویر، تصویر شاخص است</span></span><div class="ox-media__grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))" data-images></div></div>
          <div class="ox-field"><span class="ox-label">برچسب‌ها</span><div class="ox-row" data-tags></div><input class="ox-input" data-tag-input placeholder="برچسب را بنویسید و Enter بزنید"></div>
        </div>
        <aside class="ox-stack" style="gap:16px">
          <section class="ox-panel"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("eye")}انتشار</div></div><div class="ox-panel__body ox-col" style="gap:14px">
            <dl class="ox-kv"><dt>وضعیت</dt><dd>${isNew ? "ذخیره نشده" : w.isPublished ? "منتشر شده" : "پیش‌نویس"}</dd>${!isNew ? html`<dt>ایجاد</dt><dd>${date(w.createdAt)}</dd>` : ""}</dl>
            ${toggle({ name: "isFeatured", checked: w.isFeatured, title: "مقاله ویژه", text: "در بخش برگزیده مجله نمایش داده می‌شود." })}
            ${field({ label: "تاریخ انتشار", help: isNew ? "هنگام اولین انتشار ثبت می‌شود." : "خالی = زمان اولین انتشار", control: html`<input class="ox-input" type="date" name="publishedAt" value="${toLocalDate(w.publishedAt)}" ${attr(isNew, "disabled")}>` })}
          </div></section>
          <section class="ox-panel"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("layers")}دسته‌ها</div></div><div class="ox-panel__body">
            ${categories.length ? html`<div class="ox-row" style="gap:6px">${categories.map((c) => html`<label class="ox-chipcheck"><input type="checkbox" data-cat value="${c._id}" ${attr(catIds.has(String(c._id)), "checked")}><span>${c.name}</span></label>`)}</div>` : html`<p class="ox-help">دسته مجله‌ای وجود ندارد. از <a class="ox-link" href="#/categories?type=weblog">دسته‌بندی‌ها</a> بسازید.</p>`}
          </div></section>
          <section class="ox-panel"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("calendar")}زمان مطالعه</div></div><div class="ox-panel__body">
            <div class="ox-row ox-row--nowrap"><input class="ox-input num" style="width:90px" name="readingTime" inputmode="numeric" value="${w.readingTime || 5}" aria-label="زمان مطالعه (دقیقه)"><span class="muted small">دقیقه</span><span class="ox-spacer"></span><button type="button" class="ox-btn ox-btn--sm" data-estimate>${icon("refresh", "ox-i--s")}محاسبه از متن</button></div>
          </div></section>
          <section class="ox-panel"><div class="ox-panel__head ox-panel__head--line"><div class="ox-panel__title">${icon("globe")}سئو</div></div><div class="ox-panel__body ox-col" style="gap:14px">
            ${field({ label: "عنوان متا", opt: true, help: "خالی = عنوان مقاله", control: html`<input class="ox-input" name="metaTitle" maxlength="60" value="${w.metaTitle || ""}">` })}
            ${field({ label: "توضیحات متا", opt: true, help: "خالی = خلاصه مقاله", control: html`<textarea class="ox-textarea" name="metaDescription" maxlength="160" rows="3">${w.metaDescription || ""}</textarea>` })}
            ${!isNew && w.slug ? html`<p class="ox-help">نامک ثابت: <span class="ltr">${w.slug}</span> — تا لینک‌های قبلی خراب نشوند تغییر نمی‌کند.</p>` : ""}
          </div></section>
        </aside>
      </div>
      <div class="ox-actionbar"><span class="ox-actionbar__state" data-state>${isNew ? "مقاله هنوز ذخیره نشده است" : "همه تغییرات ذخیره شده‌اند"}</span><span class="ox-spacer"></span>
        <button class="ox-btn" type="button" data-cancel>بازگشت</button>
        <button class="ox-btn" type="button" data-save-draft>${!isNew && w.isPublished ? "خروج از انتشار" : "ذخیره پیش‌نویس"}</button>
        <button class="ox-btn ox-btn--primary" type="button" data-publish>${icon("check", "ox-i--s")}${!isNew && w.isPublished ? "ذخیره تغییرات" : "ذخیره و انتشار"}</button></div>
      </form>`);

    const formEl = $("[data-f]", el), f = formEl.elements;
    const mark = () => { dirty = true; const s = $("[data-state]", el); s.textContent = "تغییرات ذخیره نشده"; s.classList.add("is-dirty"); };
    formEl.addEventListener("input", (e) => { if (!e.target.matches("[data-tag-input]")) mark(); });
    OA.protect(() => dirty);
    const cnt = () => ($("[data-cnt]", el).textContent = `${num(f.description.value.length)}/۱۶۰`);
    f.description.addEventListener("input", cnt); cnt();

    let content = { get: () => w.content || "" };
    const words = () => { const t = (content.get() || "").replace(/<[^>]+>/g, " ").trim(); return t ? t.split(/\s+/).length : 0; };
    const showWords = () => ($("[data-words]", el).textContent = `${num(words())} کلمه`);
    OA.richText($("[data-content]", el), w.content || "").then((r) => { content = r; r.onChange(() => { mark(); showWords(); }); showWords(); });
    $("[data-estimate]", el).addEventListener("click", () => { f.readingTime.value = Math.max(1, Math.round(words() / 200)); mark(); });

    // Tags
    const tagBox = $("[data-tags]", el), tagInput = $("[data-tag-input]", el);
    const drawTags = () => {
      set(tagBox, html`${tags.map((t, i) => html`<span class="ox-chip ox-chip--primary">${t}<button type="button" data-rm-tag="${i}" aria-label="حذف برچسب ${t}" style="border:0;background:none;color:inherit;cursor:pointer;padding:0;margin-inline-start:2px;display:inline-flex">${icon("x", "ox-i--s")}</button></span>`)}`);
      tagBox.hidden = !tags.length;
      $$("[data-rm-tag]", tagBox).forEach((b) => b.addEventListener("click", () => { tags.splice(Number(b.dataset.rmTag), 1); mark(); drawTags(); }));
    };
    const addTags = () => { const v = tagInput.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean); v.forEach((t) => { if (!tags.includes(t)) tags.push(t); }); tagInput.value = ""; if (v.length) { mark(); drawTags(); } };
    tagInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTags(); } });
    tagInput.addEventListener("blur", addTags);
    drawTags();

    // Images
    const imgBox = $("[data-images]", el);
    const drawImages = () => {
      set(imgBox, html`${images.map((url, i) => html`<div class="ox-media__item" style="cursor:default"><img src="${url}" alt="">${i === 0 ? html`<span class="ox-media__n">شاخص</span>` : ""}
        <div class="ox-row ox-row--nowrap" style="position:absolute;top:4px;inset-inline-end:4px;gap:2px">
          <button class="ox-btn ox-btn--sm ox-btn--icon" type="button" data-mv="${i}" data-dir="-1" aria-label="انتقال به قبل" ${attr(i === 0, "disabled")}>${icon("chevron-r", "ox-i--s")}</button>
          <button class="ox-btn ox-btn--sm ox-btn--icon" type="button" data-mv="${i}" data-dir="1" aria-label="انتقال به بعد" ${attr(i === images.length - 1, "disabled")}>${icon("chevron", "ox-i--s")}</button>
          <button class="ox-btn ox-btn--sm ox-btn--icon ox-btn--danger" type="button" data-rm="${i}" aria-label="حذف تصویر">${icon("trash", "ox-i--s")}</button></div></div>`)}
        <button type="button" class="ox-drop" data-add>${icon("upload", "ox-i--l")}<span>افزودن تصویر</span></button>`);
      $$("[data-mv]", imgBox).forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.mv), j = i + Number(b.dataset.dir); [images[i], images[j]] = [images[j], images[i]]; mark(); drawImages(); }));
      $$("[data-rm]", imgBox).forEach((b) => b.addEventListener("click", () => { images.splice(Number(b.dataset.rm), 1); mark(); drawImages(); }));
      $("[data-add]", imgBox).addEventListener("click", () => {
        const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = "image/jpeg,image/png,image/webp";
        inp.onchange = async () => { if (!inp.files.length) return; try { const r = await busy($("[data-add]", imgBox), () => upload("/admin/upload-images", inp.files, "images")); images.push(...(r.images || []).map((x) => (typeof x === "string" ? x : x.url))); mark(); drawImages(); } catch (_) {} };
        inp.click();
      });
    };
    drawImages();

    $("[data-cancel]", el).addEventListener("click", () => router.back("weblogs"));
    const save = async (btn, publish) => {
      addTags();
      $$(".is-invalid", el).forEach((x) => x.classList.remove("is-invalid"));
      const text = (content.get() || "").replace(/<[^>]+>/g, "").trim();
      if (f.title.value.trim().length < 5) { $("[data-title-f]", el).classList.add("is-invalid"); f.title.focus(); return toast("عنوان باید حداقل ۵ کاراکتر باشد", "error"); }
      if (!f.description.value.trim()) { f.description.closest(".ox-field").classList.add("is-invalid"); return toast("خلاصه مقاله الزامی است", "error"); }
      if ((content.get() || "").length < 100 || text.length < 20) return toast("متن مقاله باید حداقل ۱۰۰ کاراکتر باشد", "error");
      const body = {
        title: f.title.value.trim(),
        description: f.description.value.trim(),
        content: content.get(),
        images,
        categories: $$("[data-cat]:checked", el).map((c) => c.value),
        tags,
        readingTime: Math.max(1, OA.intOrNull(f.readingTime.value) || 5),
        isFeatured: f.isFeatured.checked,
        isPublished: publish,
        metaTitle: f.metaTitle.value.trim(),
        metaDescription: f.metaDescription.value.trim(),
      };
      if (!isNew && f.publishedAt.value) body.publishedAt = `${f.publishedAt.value}T09:00:00+03:30`;
      try {
        await busy(btn, () => api(isNew ? "/admin/weblogs/add" : `/admin/weblogs/edit/${id}`, { method: isNew ? "POST" : "PUT", body }), publish ? "مقاله منتشر شد" : "مقاله ذخیره شد");
        dirty = false;
        router.go("weblogs");
      } catch (_) {}
    };
    $("[data-save-draft]", el).addEventListener("click", (e) => save(e.currentTarget, false));
    $("[data-publish]", el).addEventListener("click", (e) => save(e.currentTarget, true));
  }

  OA.section("weblogs", {
    title: "مجله", short: "مجله", group: "محتوا", nav: true, icon: "pen", perm: "manage_weblogs",
    quick: { label: "مقاله جدید", icon: "plus", href: "#/weblogs/new" },
    render(el, { args }) { if (args[0]) renderEditor(el, args[0]); else renderList(el); },
  });
})();
