/* Inventory — master/detail stock workspace. Adjustments use the atomic, conflict-checked
   /inventory/:id/adjust endpoint; CSV uses the existing preview → apply import. */
(function () {
  "use strict";
  const { html, set, $, $$, num, icon, api, router, toast, busy, intOrNull, attr } = OA;
  const label = (r) => (r.kind === "total" ? "موجودی کل محصول" : [r.color, r.size].filter(Boolean).join(" / ") || "تک تنوع");
  const stockTone = (n, low) => (n <= 0 ? "danger" : n <= low ? "warning" : "success");

  function render(el) {
    const q = router.query();
    let selectedId = null;
    let current = [];
    let pendingSelect = q.select || null;
    set(el, html`${OA.pageHead({ eyebrow: "STOCK", title: "انبار و موجودی", subtitle: "تغییرات موجودی اتمیک‌اند و با رزرو سفارش‌ها تداخل ندارند.", actions: html`<button class="ox-btn" type="button" data-csv>${icon("file", "ox-i--s")}ورود و خروج CSV</button>` })}
      <div class="ox-health" data-health>${[1, 2, 3, 4].map(() => html`<div class="ox-health__item"><div class="ox-skel" style="width:60%"></div><div class="ox-skel" style="width:40%;height:22px;margin-top:8px"></div></div>`)}</div>
      <div class="ox-md" data-md>
        <div class="ox-md__list" data-list></div>
        <aside class="ox-md__detail" data-detail><div class="ox-panel">${OA.empty({ icon: "layers", title: "یک محصول را انتخاب کنید", text: "تنوع‌ها و کنترل‌های موجودی محصول اینجا نمایش داده می‌شود." })}</div></aside>
      </div>`);
    $("[data-csv]", el).addEventListener("click", () => csvDialog(listApi));
    const md = $("[data-md]", el);
    const detail = $("[data-detail]", el);

    const listApi = OA.list($("[data-list]", el), {
      endpoint: "/inventory",
      defaults: { stock: "", limit: 25 },
      searchPlaceholder: "نام محصول یا SKU…",
      filters: [
        { name: "stock", label: "وضعیت موجودی", options: [["", "همه وضعیت‌ها"], ["low", "رو به اتمام"], ["out", "ناموجود"], ["in", "موجود"]] },
        { name: "mode", label: "نوع موجودی", options: [["", "همه انواع"], ["matrix", "ماتریس رنگ × سایز"], ["simple", "موجودی ساده"]] },
        { name: "status", label: "انتشار", options: [["", "منتشر و پیش‌نویس"], ["published", "منتشر شده"], ["draft", "پیش‌نویس"]] },
      ],
      onData: (d) => {
        current = d.items || [];
        const s = d.summary, st = listApi ? listApi.state.stock || "" : q.stock || "";
        const cell = (k, l, v, ic, tone) => html`<button class="ox-health__item" type="button" data-health-k="${k}" aria-pressed="${String(st === k && k !== "matrix")}"><span>${icon(ic, "ox-i--s")}${l}</span><b class="${tone}">${num(v)}</b></button>`;
        set($("[data-health]", el), html`${cell("", "کل محصولات", s.total, "box", "")}${cell("low", "رو به اتمام", s.low, "alert", "t-warning")}${cell("out", "ناموجود", s.out, "x", "t-danger")}${cell("matrix", "دارای ماتریس رنگ × سایز", s.matrix, "grid", "")}`);
        $$("[data-health-k]", el).forEach((b) => b.addEventListener("click", () => (b.dataset.healthK === "matrix" ? listApi.setParam("mode", "matrix") : listApi.setParam("stock", b.dataset.healthK))));
        if (pendingSelect) { const id = pendingSelect; pendingSelect = null; if (current.some((p) => p._id === id)) { setTimeout(() => select(id)); return; } }
        if (selectedId && !current.some((p) => p._id === selectedId)) select(null);
        else if (selectedId) markActive();
      },
      columns: [
        { label: "محصول", render: (p) => html`<div class="ox-entity">${p.image ? html`<img class="ox-thumb ox-thumb--s" src="${p.image}" alt="" loading="lazy">` : html`<span class="ox-thumb ox-thumb--s ox-thumb--empty">${icon("box", "ox-i--s")}</span>`}<div><span class="ox-cell-main">${p.name}</span><span class="ox-cell-sub"><span class="ltr">${p.sku || "بدون SKU"}</span>${p.isPublished ? "" : " · پیش‌نویس"}</span></div></div>` },
        { label: "تنوع", render: (p) => html`<span class="small">${p.matrix ? `${num(p.rows.length)} ترکیب` : p.rows.length > 1 ? `ساده + ${num(p.rows.length - 1)} سقف` : "ساده"}</span>` },
        { label: "وضعیت", render: (p) => OA.chip(p.isOutOfStock || p.countInStock <= 0 ? "ناموجود" : p.countInStock <= p.lowStockThreshold ? "رو به اتمام" : "موجود", stockTone(p.isOutOfStock ? 0 : p.countInStock, p.lowStockThreshold)) },
        { label: "موجودی کل", cls: "col-num", render: (p) => html`<b data-total>${num(p.countInStock)}</b>` },
      ],
      record: (p) => html`<div class="ox-record__top">${p.image ? html`<img class="ox-thumb ox-thumb--s" src="${p.image}" alt="">` : ""}<div class="ox-record__main"><span class="ox-cell-main">${p.name}</span><span class="ox-cell-sub ltr">${p.sku || ""}</span></div><div class="ox-record__side"><b class="num">${num(p.countInStock)}</b><span class="ox-cell-sub">عدد</span></div></div>
        <div class="ox-record__row">${OA.chip(p.isOutOfStock || p.countInStock <= 0 ? "ناموجود" : p.countInStock <= p.lowStockThreshold ? "رو به اتمام" : "موجود", stockTone(p.isOutOfStock ? 0 : p.countInStock, p.lowStockThreshold))}<span class="ox-btn ox-btn--sm">مدیریت موجودی</span></div>`,
      onRow: (p) => select(p._id),
      empty: () => OA.empty({ icon: "layers", title: "محصولی با این وضعیت موجودی نیست" }),
    });

    function markActive() { $$("[data-i]", el).forEach((row) => { const it = current[Number(row.dataset.i)]; row.classList.toggle("is-active", Boolean(it && it._id === selectedId)); }); }
    function select(id) {
      selectedId = id;
      md.classList.toggle("has-selection", Boolean(id));
      markActive();
      if (!id) return set(detail, html`<div class="ox-panel">${OA.empty({ icon: "layers", title: "یک محصول را انتخاب کنید", text: "تنوع‌ها و کنترل‌های موجودی محصول اینجا نمایش داده می‌شود." })}</div>`);
      drawDetail(current.find((p) => p._id === id));
      if (innerWidth <= 1024) el.scrollIntoView({ block: "start" });
    }

    function drawDetail(p) {
      set(detail, html`<div class="ox-panel">
        <div class="ox-panel__head ox-panel__head--line"><div class="ox-entity">${p.image ? html`<img class="ox-thumb" src="${p.image}" alt="">` : html`<span class="ox-thumb ox-thumb--empty">${icon("box")}</span>`}<div><div class="ox-panel__title">${p.name}</div><div class="ox-panel__sub"><span class="ltr">${p.sku || "بدون SKU"}</span> · ${p.matrix ? "ماتریس رنگ × سایز" : "موجودی ساده"}</div></div></div>
          <button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-close-detail aria-label="بستن">${icon("x")}</button></div>
        <div class="ox-statline" style="border-radius:0;border-inline:0;border-top:0"><div><span>موجودی کل</span><b data-dtotal>${num(p.countInStock)}</b></div><div><span>حد هشدار</span><b>${num(p.lowStockThreshold)}</b></div><div><span>${p.matrix ? "ترکیب‌ها" : "ردیف‌ها"}</span><b>${num(p.rows.length)}</b></div></div>
        <div data-rows></div>
        <div class="ox-panel__foot ox-row ox-row--between"><button class="ox-btn ox-btn--sm" type="button" data-threshold>${icon("alert", "ox-i--s")}تغییر حد هشدار</button>${OA.can("manage_products") ? html`<a class="ox-btn ox-btn--sm ox-btn--text" href="#/products/${p._id}">ویرایش محصول ${icon("chevron", "ox-i--s")}</a>` : ""}</div>
      </div>`);
      drawRows(p);
      $("[data-close-detail]", detail).addEventListener("click", () => select(null));
      $("[data-threshold]", detail).addEventListener("click", () => {
        const m = OA.modal({ title: "حد هشدار موجودی", sub: p.name, iconName: "alert", size: "ox-dialog--s", body: OA.field({ label: "هشدار وقتی موجودی به این عدد یا کمتر برسد", control: html`<input class="ox-input ox-input--num" inputmode="numeric" data-val value="${p.lowStockThreshold}">` }), foot: html`<button class="ox-btn" type="button" data-close>انصراف</button><button class="ox-btn ox-btn--primary" type="button" data-ok>ذخیره</button>` });
        $("[data-ok]", m.el).addEventListener("click", async (e) => { try { const r = await busy(e.currentTarget, () => api(`/inventory/${p._id}/threshold`, { method: "POST", body: { lowStockThreshold: intOrNull($("[data-val]", m.el).value) } }), "حد هشدار ذخیره شد"); p.lowStockThreshold = r.lowStockThreshold; m.close(true); drawDetail(p); } catch (_) {} });
      });
    }

    function drawRows(p) {
      const host = $("[data-rows]", detail);
      set(host, html`${p.rows.map((r, i) => html`<div class="ox-varrow"><div style="min-width:0"><div class="ox-row ox-row--nowrap" style="gap:8px">${r.colorRgb ? html`<span class="ox-swatch" style="background:${r.colorRgb}"></span>` : ""}<b class="ellipsis">${label(r)}</b>${r.paused ? OA.chip("فروش متوقف", "warning") : ""}</div>
          <span class="ox-cell-sub">${r.kind === "color" ? "سقف موجودی این رنگ" : r.kind === "size" ? "سقف موجودی این سایز" : r.kind === "matrix" ? "ترکیب رنگ و سایز" : "همه تنوع‌ها"}</span></div>
        <div class="ox-row ox-row--nowrap" style="gap:6px">
          <div class="ox-stepper"><button type="button" data-adj="${i}" data-d="-1" aria-label="کاهش یک عدد" ${attr(r.stock <= 0, "disabled")}>${icon("minus", "ox-i--s")}</button><button type="button" class="ox-stepper__val ${r.stock <= 0 ? "t-danger" : r.stock <= p.lowStockThreshold ? "t-warning" : ""}" data-set="${i}" title="ثبت مقدار دقیق">${num(r.stock)}</button><button type="button" data-adj="${i}" data-d="1" aria-label="افزایش یک عدد">${icon("plus", "ox-i--s")}</button></div>
          ${r.kind === "matrix" ? html`<button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-pause="${i}" aria-label="${r.paused ? "ازسرگیری فروش" : "توقف فروش"}" title="${r.paused ? "ازسرگیری فروش" : "توقف فروش این ترکیب"}">${icon(r.paused ? "play" : "pause", "ox-i--s")}</button>` : ""}
        </div></div>`)}`);
      const refresh = (prod) => { Object.assign(p, { rows: prod.rows, countInStock: prod.countInStock, isOutOfStock: prod.isOutOfStock }); $("[data-dtotal]", detail).textContent = num(prod.countInStock); drawRows(p); const row = $$("[data-i]", el).find((x) => current[Number(x.dataset.i)] === p); if (row) { const t = $("[data-total]", row); if (t) t.textContent = num(prod.countInStock); } };
      const send = async (btn, r, body) => {
        try { const res = await busy(btn, () => api(`/inventory/${p._id}/adjust`, { method: "POST", body: { colorId: r.colorId, sizeId: r.sizeId, ...body } })); toast(`${label(r)}: ${num(res.before)} ← ${num(res.after)}`); refresh(res.product); return true; }
        catch (e) { if (e.status === 409) listApi.reload(); return false; }
      };
      $$("[data-adj]", host).forEach((b) => b.addEventListener("click", () => send(b, p.rows[Number(b.dataset.adj)], { mode: "delta", value: Number(b.dataset.d) })));
      $$("[data-pause]", host).forEach((b) => b.addEventListener("click", async () => { const r = p.rows[Number(b.dataset.pause)]; try { const res = await busy(b, () => api(`/inventory/${p._id}/pause`, { method: "POST", body: { colorId: r.colorId, sizeId: r.sizeId, paused: !r.paused } }), (x) => x.message); refresh(res.product); } catch (_) {} }));
      $$("[data-set]", host).forEach((b) => b.addEventListener("click", () => adjustDialog(p, p.rows[Number(b.dataset.set)], send)));
    }
  }

  function adjustDialog(p, r, send) {
    let mode = "set";
    const m = OA.modal({
      title: "تنظیم موجودی", sub: `${p.name} — ${label(r)}`, iconName: "layers",
      body: html`<div class="ox-statline" style="margin-bottom:18px"><div><span>موجودی فعلی</span><b>${num(r.stock)}</b></div><div><span>پس از ثبت</span><b data-after>${num(r.stock)}</b></div><div><span>تغییر</span><b data-delta>۰</b></div></div>
        <div class="ox-btn-group ox-btn-group--soft" role="group" aria-label="نوع تغییر" style="margin-bottom:16px"><button type="button" data-mode="set" aria-pressed="true">ثبت عدد شمارش‌شده</button><button type="button" data-mode="delta" aria-pressed="false">افزودن / کسر</button></div>
        <div class="ox-form ox-form--1">${OA.field({ label: html`<span data-label>موجودی جدید</span>`, control: html`<input class="ox-input ox-input--num" inputmode="numeric" data-val value="${r.stock}">`, help: html`<span data-help>اگر در این فاصله سفارشی ثبت شود، ثبت انجام نمی‌شود تا موجودی رزرو شده از بین نرود.</span>` })}
        ${OA.field({ label: "علت تغییر", opt: true, control: html`<input class="ox-input" data-reason maxlength="120" placeholder="مثلاً: ورود بار جدید، انبارگردانی">`, help: "در گزارش فعالیت‌ها ثبت می‌شود." })}</div>`,
      foot: html`<button class="ox-btn" type="button" data-close>انصراف</button><button class="ox-btn ox-btn--primary" type="button" data-ok>ثبت موجودی</button>`,
    });
    const v = $("[data-val]", m.el);
    const calc = () => { const n = intOrNull(v.value); const after = mode === "set" ? n : r.stock + (n || 0); $("[data-after]", m.el).textContent = Number.isFinite(after) ? num(after) : "—"; $("[data-delta]", m.el).textContent = Number.isFinite(after) ? `${after - r.stock > 0 ? "+" : ""}${num(after - r.stock)}` : "—"; $("[data-after]", m.el).className = after < 0 ? "t-danger" : ""; };
    v.addEventListener("input", calc);
    $$("[data-mode]", m.el).forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; $$("[data-mode]", m.el).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); $("[data-label]", m.el).textContent = mode === "set" ? "موجودی جدید" : "تعداد افزوده (+) یا کسر شده (−)"; v.value = mode === "set" ? r.stock : ""; calc(); v.focus(); }));
    $("[data-ok]", m.el).addEventListener("click", async (e) => {
      const n = intOrNull(v.value);
      if (n === null || Number.isNaN(n) || (mode === "set" && n < 0)) return toast("عدد معتبر وارد کنید", "error");
      if (mode === "delta" && r.stock + n < 0) return toast("موجودی نمی‌تواند منفی شود", "error");
      if (await send(e.currentTarget, r, { mode, value: n, expected: r.stock, reason: $("[data-reason]", m.el).value })) m.close(true);
      else m.close(true);
    });
  }

  function csvDialog(listApi) {
    let csv = "";
    let stage = 1;
    const m = OA.modal({
      title: "ورود و خروج موجودی با CSV", iconName: "file", size: "ox-dialog--l",
      body: html`<div class="ox-grid" style="gap:16px;margin-bottom:20px">
          <div class="ox-panel c-6" style="padding:16px"><b>۱. خروجی بگیرید</b><p class="ox-help" style="margin:6px 0 12px">فایل موجودی فعلی با فیلترهای همین صفحه. فقط ستون <span class="ltr">new_stock</span> را پر کنید.</p><a class="ox-btn ox-btn--sm" data-export href="#" download>${icon("download", "ox-i--s")}دانلود CSV</a></div>
          <div class="ox-panel c-6" style="padding:16px"><b>۲. فایل ویرایش‌شده را بارگذاری کنید</b><p class="ox-help" style="margin:6px 0 12px">UTF-8، حداکثر ۵ مگابایت. ردیف‌هایی که موجودی‌شان پس از خروجی تغییر کرده اعمال نمی‌شوند.</p><label class="ox-btn ox-btn--sm ox-btn--primary">${icon("upload", "ox-i--s")}<span data-fname>انتخاب فایل</span><input type="file" accept=".csv,text/csv" hidden data-file></label></div></div>
        <ol class="ox-steps" data-steps></ol><div data-preview></div>`,
      foot: html`<button class="ox-btn" type="button" data-close>بستن</button><button class="ox-btn ox-btn--primary" type="button" data-apply disabled>اعمال تغییرات</button>`,
    });
    const steps = ["انتخاب فایل", "پیش‌نمایش", "اعتبارسنجی", "اعمال", "نتیجه"];
    const drawSteps = () => set($("[data-steps]", m.el), html`${steps.map((s, i) => html`<li class="${i + 1 < stage ? "is-done" : i + 1 === stage ? "is-current" : ""}">${s}</li>`)}`);
    drawSteps();
    const qs = new URLSearchParams(Object.entries(listApi.state).filter(([k, v]) => v && !["page", "limit"].includes(k))).toString();
    $("[data-export]", m.el).href = `/admin/api/v2/inventory/export.csv${qs ? `?${qs}` : ""}`;
    const preview = $("[data-preview]", m.el), apply = $("[data-apply]", m.el);
    $("[data-file]", m.el).addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) return toast("حجم فایل بیش از ۵ مگابایت است", "error");
      $("[data-fname]", m.el).textContent = file.name;
      csv = await file.text();
      stage = 2; drawSteps();
      set(preview, OA.skeletonTable(3));
      apply.disabled = true;
      try {
        const r = await api("/inventory/import", { method: "POST", body: { csv } });
        stage = 3; drawSteps();
        set(preview, html`<div class="ox-row" style="margin-bottom:12px">${OA.chip(`${num(r.changes.length)} تغییر`, "primary")}${r.errors.length ? OA.chip(`${num(r.errors.length)} خطا`, "danger") : OA.chip("بدون خطا", "success")}<span class="muted small">${num(r.considered)} ردیف دارای new_stock</span></div>
          ${r.errors.length ? html`<div class="ox-note ox-note--danger" style="margin-bottom:12px;display:block"><b>تا وقتی خطا وجود دارد هیچ تغییری اعمال نمی‌شود:</b><ul style="margin:6px 0 0;padding-inline-start:18px">${r.errors.slice(0, 30).map((x) => html`<li>سطر ${num(x.line)} — ${x.product || ""}: ${x.message}</li>`)}</ul></div>` : ""}
          ${r.changes.length ? html`<div class="ox-table-wrap" style="max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="ox-table"><thead><tr><th>محصول</th><th>تنوع</th><th class="col-num">فعلی</th><th class="col-num">جدید</th><th class="col-num">تغییر</th></tr></thead><tbody>${r.changes.map((c) => html`<tr><td>${c.name}</td><td>${[c.color, c.size].filter(Boolean).join(" / ") || "کل"}</td><td class="col-num">${num(c.before)}</td><td class="col-num strong">${num(c.after)}</td><td class="col-num ${c.after > c.before ? "t-success" : "t-danger"}">${c.after > c.before ? "+" : ""}${num(c.after - c.before)}</td></tr>`)}</tbody></table></div>` : OA.empty({ icon: "layers", title: "تغییری برای اعمال وجود ندارد", compact: true })}`);
        apply.disabled = !r.changes.length || r.errors.length > 0;
      } catch (err) { set(preview, OA.errorBox(err)); }
    });
    apply.addEventListener("click", async () => {
      stage = 4; drawSteps();
      try {
        const r = await busy(apply, () => api("/inventory/import", { method: "POST", body: { csv, apply: true } }));
        stage = 5; drawSteps();
        set(preview, html`<div class="ox-note ${r.failed && r.failed.length ? "ox-note--warn" : ""}">${icon(r.failed && r.failed.length ? "alert" : "check", "ox-i--s")}<span>${r.message}</span></div>`);
        apply.disabled = true;
        listApi.reload();
      } catch (_) { stage = 3; drawSteps(); }
    });
  }

  OA.section("inventory", { title: "انبار و موجودی", short: "انبار", group: "کاتالوگ", nav: true, icon: "layers", perm: ["manage_inventory", "manage_products"], render });
})();
