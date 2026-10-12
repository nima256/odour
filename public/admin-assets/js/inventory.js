/* Inventory: per-variant stock with atomic adjustments, pausing, thresholds and CSV. */
(function () {
  "use strict";
  const { html, raw, set, $, $$, num, icon, api, router, toast, fail, busy, intOrNull } = OA;

  let listApi = null;
  const rowLabel = (r) => (r.kind === "total" ? "موجودی کل" : [r.color, r.size].filter(Boolean).join(" / ") || (r.kind === "matrix" ? "تک تنوع" : "—"));

  function render(el) {
    set(el, html`${OA.pageHead("انبار و موجودی", "تغییر موجودی به‌صورت اتمیک انجام می‌شود و با رزرو سفارش‌ها تداخل ندارد", html`
      <a class="oa-btn" data-export href="/admin/api/v2/inventory/export.csv" download>${icon("download", "oa-icon--sm")} خروجی CSV</a>
      <button class="oa-btn" data-import>${icon("upload", "oa-icon--sm")} ورود CSV</button>`)}
      <div class="oa-grid oa-grid--stats" data-summary style="margin-bottom:16px"></div>
      <div data-list></div>`);
    $("[data-import]", el).addEventListener("click", importCsv);
    listApi = OA.list($("[data-list]", el), {
      endpoint: "/inventory",
      defaults: { stock: "" },
      searchPlaceholder: "نام محصول یا SKU…",
      tabs: { name: "stock", options: [["", "همه"], ["low", "رو به اتمام"], ["out", "ناموجود"], ["in", "موجود"]], countsKey: "summary", count: (s, v) => (v === "low" ? s.low : v === "out" ? s.out : v === "" ? s.total : null) },
      filters: [
        { name: "mode", label: "نوع موجودی", options: [["", "همه انواع"], ["matrix", "ماتریس رنگ × سایز"], ["simple", "موجودی ساده"]] },
        { name: "status", label: "انتشار", options: [["", "منتشر و پیش‌نویس"], ["published", "منتشر شده"], ["draft", "پیش‌نویس"]] },
      ],
      onData: (d) => {
        const s = d.summary;
        set($("[data-summary]", el), html`
          <div class="oa-card oa-stat"><span class="oa-stat__label">کل محصولات</span><span class="oa-stat__value">${num(s.total)}</span></div>
          <div class="oa-card oa-stat oa-stat--link" data-go="low"><span class="oa-stat__label">رو به اتمام</span><span class="oa-stat__value oa-warn">${num(s.low)}</span><span class="oa-stat__meta">زیر حد هشدار هر محصول</span></div>
          <div class="oa-card oa-stat oa-stat--link" data-go="out"><span class="oa-stat__label">ناموجود</span><span class="oa-stat__value oa-bad">${num(s.out)}</span></div>
          <div class="oa-card oa-stat"><span class="oa-stat__label">دارای ماتریس رنگ × سایز</span><span class="oa-stat__value">${num(s.matrix)}</span></div>`);
        $$("[data-go]", el).forEach((c) => c.addEventListener("click", () => $(`[data-tab-value="${c.dataset.go}"]`, el).click()));
        const exp = $("[data-export]", el);
        const qs = new URLSearchParams(Object.entries(listApi.state).filter(([k, v]) => v && !["page", "limit"].includes(k))).toString();
        exp.href = `/admin/api/v2/inventory/export.csv${qs ? `?${qs}` : ""}`;
      },
      columns: [
        { label: "محصول", cls: "col-main", main: true, render: (p) => html`<div class="oa-media">${p.image ? html`<img class="oa-thumb" src="${p.image}" alt="" loading="lazy">` : html`<div class="oa-thumb"></div>`}<div><span class="oa-cell-title">${p.name}</span><span class="oa-cell-sub">${[p.sku && `SKU ${p.sku}`, p.matrix ? "ماتریس رنگ × سایز" : "موجودی ساده", !p.isPublished && "پیش‌نویس"].filter(Boolean).join(" · ")}</span></div></div>` },
        { label: "موجودی تنوع‌ها", render: (p) => html`<div class="oa-stack" style="gap:6px;min-width:280px" data-rows>${rowsView(p)}</div>` },
        { label: "کل", render: (p) => html`<span class="oa-stockcell ${p.isOutOfStock || p.countInStock <= 0 ? "is-out" : p.countInStock <= p.lowStockThreshold ? "is-low" : ""}"><span class="num" data-total>${num(p.countInStock)}</span></span>` },
        { label: "حد هشدار", render: (p) => html`<button class="oa-link num" data-threshold>${num(p.lowStockThreshold)}</button>` },
        { label: "", cls: "col-actions", render: (p) => (OA.can("manage_products") ? html`<a class="oa-btn oa-btn--ghost oa-btn--sm" href="#/products/${p._id}">${icon("pen", "oa-icon--sm")} ویرایش</a>` : "") },
      ],
      bind: bindRow,
      empty: () => OA.empty("محصولی با این وضعیت موجودی نیست", "", "layers"),
    });
  }

  function rowsView(p) {
    return html`${p.rows.map((r, i) => html`<div class="oa-inline" style="justify-content:space-between;gap:8px;flex-wrap:nowrap">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${r.colorRgb ? html`<span class="oa-swatch" style="background:${r.colorRgb}"></span> ` : ""}${rowLabel(r)}${r.kind === "color" || r.kind === "size" ? html` <span class="oa-muted" style="font-size:11px">(سقف ${r.kind === "color" ? "رنگ" : "سایز"})</span>` : ""}</span>
      <span class="oa-inline" style="gap:4px;flex-wrap:nowrap">
        ${r.paused ? OA.badge("متوقف", "warn") : ""}
        <button class="oa-btn oa-btn--sm oa-btn--icon" data-adj="${i}" data-delta="-1" aria-label="کاهش یک عدد" ${raw(r.stock <= 0 ? "disabled" : "")}>${icon("minus", "oa-icon--sm")}</button>
        <button class="oa-btn oa-btn--sm num" style="min-width:56px" data-set="${i}" title="ثبت مقدار دقیق">${num(r.stock)}</button>
        <button class="oa-btn oa-btn--sm oa-btn--icon" data-adj="${i}" data-delta="1" aria-label="افزایش یک عدد">${icon("plus", "oa-icon--sm")}</button>
        ${r.kind === "matrix" ? html`<button class="oa-btn oa-btn--sm oa-btn--icon oa-btn--ghost" data-pause="${i}" title="${r.paused ? "ازسرگیری فروش" : "توقف فروش این تنوع"}" aria-label="${r.paused ? "ازسرگیری فروش" : "توقف فروش"}">${icon(r.paused ? "play" : "pause", "oa-icon--sm")}</button>` : ""}
      </span></div>`)}`;
  }

  function bindRow(tr, p) {
    const refresh = (product) => {
      p.rows = product.rows;
      p.countInStock = product.countInStock;
      p.isOutOfStock = product.isOutOfStock;
      set($("[data-rows]", tr), rowsView(p));
      $("[data-total]", tr).textContent = num(product.countInStock);
      wire();
    };
    const adjust = async (btn, r, body) => {
      try {
        const res = await busy(btn, () => api(`/inventory/${p._id}/adjust`, { method: "POST", body: { colorId: r.colorId, sizeId: r.sizeId, ...body } }));
        toast(`${p.name} — ${rowLabel(r)}: ${num(res.before)} ← ${num(res.after)}`);
        refresh(res.product);
      } catch (e) {
        if (e.status === 409) listApi.reload();
      }
    };
    function wire() {
      $$("[data-adj]", tr).forEach((b) => b.addEventListener("click", () => adjust(b, p.rows[Number(b.dataset.adj)], { mode: "delta", value: Number(b.dataset.delta) })));
      $$("[data-set]", tr).forEach((b) => b.addEventListener("click", () => {
        const r = p.rows[Number(b.dataset.set)];
        const m = OA.modal({
          title: `موجودی ${rowLabel(r)}`,
          body: html`<p class="oa-muted" style="margin-top:0">${p.name}</p>
            <div class="oa-segment" role="group" style="margin-bottom:14px"><button type="button" data-mode="set" aria-pressed="true">ثبت مقدار شمارش‌شده</button><button type="button" data-mode="delta" aria-pressed="false">افزودن / کسر</button></div>
            <label class="oa-field"><span data-label>موجودی جدید (فعلی: ${num(r.stock)})</span><input class="oa-input num" inputmode="numeric" data-val value="${r.stock}"></label>
            <label class="oa-field" style="margin-top:12px"><span>علت (اختیاری، در گزارش فعالیت ثبت می‌شود)</span><input class="oa-input" data-reason maxlength="120" placeholder="مثلاً: ورود بار جدید، انبارگردانی"></label>`,
          foot: html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn oa-btn--primary" data-ok>ثبت</button>`,
        });
        let mode = "set";
        $$("[data-mode]", m.el).forEach((x) => x.addEventListener("click", () => {
          mode = x.dataset.mode;
          $$("[data-mode]", m.el).forEach((y) => y.setAttribute("aria-pressed", String(y === x)));
          $("[data-label]", m.el).textContent = mode === "set" ? `موجودی جدید (فعلی: ${num(r.stock)})` : "تعداد افزوده (+) یا کسر شده (−)";
          $("[data-val]", m.el).value = mode === "set" ? r.stock : "";
        }));
        $("[data-ok]", m.el).addEventListener("click", async (e) => {
          const v = intOrNull($("[data-val]", m.el).value);
          if (v === null || Number.isNaN(v) || (mode === "set" && v < 0)) return toast("عدد معتبر وارد کنید", "error");
          if (mode === "delta" && r.stock + v < 0) return toast("موجودی نمی‌تواند منفی شود", "error");
          try {
            const res = await busy(e.currentTarget, () => api(`/inventory/${p._id}/adjust`, { method: "POST", body: { colorId: r.colorId, sizeId: r.sizeId, mode, value: v, expected: r.stock, reason: $("[data-reason]", m.el).value } }));
            toast(`${rowLabel(r)}: ${num(res.before)} ← ${num(res.after)}`);
            m.close(true);
            refresh(res.product);
          } catch (err) {
            if (err.status === 409) { m.close(true); listApi.reload(); }
          }
        });
      }));
      $$("[data-pause]", tr).forEach((b) => b.addEventListener("click", async () => {
        const r = p.rows[Number(b.dataset.pause)];
        try { const res = await busy(b, () => api(`/inventory/${p._id}/pause`, { method: "POST", body: { colorId: r.colorId, sizeId: r.sizeId, paused: !r.paused } }), (x) => x.message); refresh(res.product); } catch (_) {}
      }));
    }
    wire();
    const th = $("[data-threshold]", tr);
    th.addEventListener("click", () => {
      const m = OA.modal({ title: "حد هشدار موجودی", body: html`<label class="oa-field"><span>وقتی موجودی «${p.name}» به این عدد یا کمتر برسد، در هشدارها نمایش داده می‌شود.</span><input class="oa-input num" inputmode="numeric" data-val value="${p.lowStockThreshold}"></label>`, foot: html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn oa-btn--primary" data-ok>ذخیره</button>` });
      $("[data-ok]", m.el).addEventListener("click", async (e) => {
        const v = intOrNull($("[data-val]", m.el).value);
        try { const r = await busy(e.currentTarget, () => api(`/inventory/${p._id}/threshold`, { method: "POST", body: { lowStockThreshold: v } }), "حد هشدار ذخیره شد"); p.lowStockThreshold = r.lowStockThreshold; th.textContent = num(r.lowStockThreshold); m.close(true); } catch (_) {}
      });
    });
  }

  function importCsv() {
    const m = OA.modal({
      title: "ورود موجودی از CSV",
      size: "oa-modal--lg",
      body: html`<ol style="margin:0 0 14px;padding-inline-start:18px;font-size:13.5px;line-height:2">
          <li>از دکمه «خروجی CSV» فایل موجودی فعلی را دریافت کنید.</li>
          <li>فقط ستون <b class="ltr">new_stock</b> را برای ردیف‌هایی که می‌خواهید تغییر کنند پر کنید (سایر ستون‌ها را تغییر ندهید).</li>
          <li>فایل را با کدگذاری UTF-8 ذخیره و اینجا بارگذاری کنید. پیش از اعمال، پیش‌نمایش تغییرات نمایش داده می‌شود.</li></ol>
        <div class="oa-note oa-note--info" style="margin-bottom:14px">${icon("info")}<span>اگر موجودی یک ردیف بعد از گرفتن خروجی تغییر کرده باشد (مثلاً سفارشی ثبت شده)، آن ردیف اعمال نمی‌شود تا موجودی رزرو شده از بین نرود.</span></div>
        <label class="oa-dropzone oa-dropzone--wide" style="cursor:pointer">${icon("upload", "oa-icon--lg")}<span data-fname>انتخاب فایل CSV</span><input type="file" accept=".csv,text/csv" hidden data-file></label>
        <div data-preview style="margin-top:16px"></div>`,
      foot: html`<button class="oa-btn" data-close>بستن</button><button class="oa-btn oa-btn--primary" data-apply disabled>اعمال تغییرات</button>`,
    });
    let csv = "";
    const preview = $("[data-preview]", m.el);
    const apply = $("[data-apply]", m.el);
    $("[data-file]", m.el).addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) return toast("حجم فایل بیش از ۵ مگابایت است", "error");
      $("[data-fname]", m.el).textContent = file.name;
      csv = await file.text();
      set(preview, OA.skeletonRows(3, 3));
      apply.disabled = true;
      try {
        const r = await api("/inventory/import", { method: "POST", body: { csv } });
        set(preview, html`
          <div class="oa-inline" style="margin-bottom:10px">${OA.badge(`${num(r.changes.length)} تغییر`, "olive")}${r.errors.length ? OA.badge(`${num(r.errors.length)} خطا`, "bad") : ""}<span class="oa-muted" style="font-size:12.5px">${num(r.considered)} ردیف دارای new_stock</span></div>
          ${r.errors.length ? html`<div class="oa-note oa-note--bad" style="margin-bottom:10px;display:block"><b>این خطاها را برطرف کنید؛ تا وقتی خطا وجود دارد هیچ تغییری اعمال نمی‌شود:</b><ul style="margin:6px 0 0;padding-inline-start:18px">${r.errors.slice(0, 30).map((x) => html`<li>سطر ${num(x.line)} — ${x.product || ""}: ${x.message}</li>`)}</ul></div>` : ""}
          ${r.changes.length ? html`<div class="oa-table-wrap" style="max-height:300px;overflow:auto"><table class="oa-table"><thead><tr><th>محصول</th><th>تنوع</th><th>فعلی</th><th>جدید</th></tr></thead><tbody>${r.changes.map((c) => html`<tr><td>${c.name}</td><td>${[c.color, c.size].filter(Boolean).join(" / ") || "کل"}</td><td class="num">${num(c.before)}</td><td class="num" style="font-weight:700">${num(c.after)}</td></tr>`)}</tbody></table></div>` : OA.empty("تغییری برای اعمال وجود ندارد", "", "layers")}`);
        apply.disabled = !r.changes.length || r.errors.length > 0;
      } catch (err) {
        set(preview, OA.errorBox(err));
      }
    });
    apply.addEventListener("click", async () => {
      try {
        const r = await busy(apply, () => api("/inventory/import", { method: "POST", body: { csv, apply: true } }));
        toast(r.message, r.failed && r.failed.length ? "error" : "success");
        m.close(true);
        listApi.reload();
      } catch (_) {}
    });
  }

  OA.section("inventory", { title: "انبار و موجودی", group: "کاتالوگ", nav: true, icon: "layers", perm: ["manage_inventory", "manage_products"], render });
  void router; void fail;
})();
