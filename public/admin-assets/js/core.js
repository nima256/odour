/* Odour admin — core: safe templating, API client, formatting, UI primitives, router.
   No framework; every section registers itself with OA.section(). */
(function () {
  "use strict";

  const boot = JSON.parse(document.getElementById("oa-boot").textContent || "{}");
  const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";

  // ------------------------------------------------------------- templating
  // html`...` escapes every interpolated value unless it is itself html`` / raw().
  class Raw { constructor(v) { this.v = String(v); } toString() { return this.v; } }
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"'`]/g, (c) => ESC[c]);
  const renderVal = (v) => {
    if (v instanceof Raw) return v.v;
    if (Array.isArray(v)) return v.map(renderVal).join("");
    if (v === null || v === undefined || v === false) return "";
    return esc(v);
  };
  const html = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? renderVal(vals[i]) : ""), ""));
  const raw = (v) => new Raw(v);
  const set = (el, tpl) => { el.innerHTML = tpl instanceof Raw ? tpl.v : esc(tpl); return el; };
  const icon = (name, cls = "") => raw(`<svg class="oa-icon ${esc(cls)}" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ------------------------------------------------------------- formatting
  const faNum = new Intl.NumberFormat("fa-IR");
  const num = (n) => faNum.format(Number(n) || 0);
  const money = (n) => `${num(Math.round(Number(n) || 0))} تومان`;
  const pct = (x, digits = 1) => `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: digits }).format((Number(x) || 0) * 100)}٪`;
  const dateFmt = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tehran" });
  const shortDateFmt = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { month: "short", day: "numeric", timeZone: "Asia/Tehran" });
  const timeFmt = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tehran" });
  const validDate = (d) => d && !Number.isNaN(new Date(d).getTime());
  const date = (d) => (validDate(d) ? dateFmt.format(new Date(d)) : "—");
  const dateTime = (d) => (validDate(d) ? `${dateFmt.format(new Date(d))}، ${timeFmt.format(new Date(d))}` : "—");
  // "YYYY-MM-DD" (Tehran day) → short Jalali label
  const dayLabel = (day) => shortDateFmt.format(new Date(`${day}T12:00:00+03:30`));
  const dayLong = (day) => dateFmt.format(new Date(`${day}T12:00:00+03:30`));
  function ago(d) {
    if (!validDate(d)) return "—";
    const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return "لحظاتی پیش";
    if (s < 3600) return `${num(Math.floor(s / 60))} دقیقه پیش`;
    if (s < 86400) return `${num(Math.floor(s / 3600))} ساعت پیش`;
    if (s < 30 * 86400) return `${num(Math.floor(s / 86400))} روز پیش`;
    return date(d);
  }
  const toEn = (v) => String(v == null ? "" : v).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  const intOrNull = (v) => { const s = toEn(v).replace(/[,٬\s]/g, ""); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? Math.round(n) : NaN; };
  const tehranToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  // 24-hex id generated in the browser for new colour / size rows (accepted as ObjectId by the server)
  const objectId = () => Math.floor(Date.now() / 1000).toString(16).padStart(8, "0") + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

  // -------------------------------------------------------------------- API
  class ApiError extends Error { constructor(message, status, data) { super(message); this.status = status; this.data = data; } }
  async function api(path, { method = "GET", body, query, raw: rawBody, headers = {} } = {}) {
    const url = new URL(path.startsWith("/") && !path.startsWith("/admin/") ? `/admin/api/v2${path}` : path, location.origin);
    if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v); });
    const init = { method, credentials: "same-origin", headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", ...headers } };
    if (method !== "GET" && method !== "HEAD") init.headers["X-CSRF-Token"] = csrf;
    if (rawBody) init.body = rawBody;
    else if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, init); } catch (_) { throw new ApiError("ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.", 0); }
    if (res.status === 401) { toast("نشست شما به پایان رسیده است؛ دوباره وارد شوید.", "error"); setTimeout(() => (location.href = "/admin/login"), 1200); throw new ApiError("unauthorized", 401); }
    let data = null;
    const type = res.headers.get("content-type") || "";
    if (type.includes("application/json")) { try { data = await res.json(); } catch (_) { data = null; } }
    if (!res.ok || (data && data.success === false)) {
      const msg = (data && (data.message || data.error)) || (res.status === 403 ? "به این بخش دسترسی ندارید" : res.status === 404 ? "مورد یافت نشد" : "خطای سرور. دوباره تلاش کنید.");
      throw new ApiError(msg, res.status, data);
    }
    return data || {};
  }
  async function upload(url, files, field = "images") {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append(field, f));
    return api(url, { method: "POST", raw: fd });
  }

  // ------------------------------------------------------------------ toast
  function toast(message, type = "success") {
    const box = $("#oa-toasts");
    if (!box) return;
    const el = document.createElement("div");
    el.className = `oa-toast oa-toast--${type}`;
    set(el, html`${icon(type === "error" ? "alert" : "check")}<span>${message}</span>`);
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 320); }, type === "error" ? 6000 : 3200);
  }
  const fail = (error) => { if (error && error.status !== 401) toast(error.message || "خطا", "error"); };

  // ----------------------------------------------------------- modal/drawer
  let layer = 0;
  function overlay({ kind = "modal", size = "", title = "", body = "", foot = "", tabs = null, onClose } = {}) {
    const ov = document.createElement("div");
    ov.className = `oa-overlay${kind === "drawer" ? " oa-overlay--drawer" : ""}`;
    ov.style.zIndex = String(60 + ++layer);
    const titleId = `oa-dlg-${Date.now()}`;
    const box = kind === "drawer"
      ? html`<section class="oa-drawer ${size}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
          <header class="oa-drawer__head"><h2 id="${titleId}">${title}</h2><div class="oa-actions" data-head-actions></div>
          <button class="oa-btn oa-btn--ghost oa-btn--icon" data-close aria-label="بستن">${icon("x")}</button></header>
          ${tabs ? html`<div class="oa-drawer__tabs" role="tablist">${tabs.map((t, i) => html`<button class="oa-tab" role="tab" data-tab="${t.id}" aria-selected="${i === 0}">${t.label}<span class="oa-tab__dot" data-tab-dot="${t.id}" hidden></span></button>`)}</div>` : ""}
          <div class="oa-drawer__body" data-body>${body}</div>
          ${foot ? html`<footer class="oa-drawer__foot" data-foot>${foot}</footer>` : ""}
        </section>`
      : html`<section class="oa-modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
          <header class="oa-modal__head"><h2 id="${titleId}">${title}</h2><button class="oa-btn oa-btn--ghost oa-btn--icon oa-btn--sm" data-close aria-label="بستن">${icon("x")}</button></header>
          <div class="oa-modal__body" data-body>${body}</div>
          ${foot ? html`<footer class="oa-modal__foot" data-foot>${foot}</footer>` : ""}
        </section>`;
    set(ov, box);
    document.body.appendChild(ov);
    document.body.classList.add("oa-lock");
    const prevFocus = document.activeElement;
    requestAnimationFrame(() => ov.classList.add("is-open"));
    let closed = false;
    const api_ = {
      el: ov,
      body: $("[data-body]", ov),
      foot: $("[data-foot]", ov),
      headActions: $("[data-head-actions]", ov),
      beforeClose: null,
      async close(force) {
        if (closed) return;
        if (!force && api_.beforeClose && !(await api_.beforeClose())) return;
        closed = true;
        ov.classList.remove("is-open");
        document.removeEventListener("keydown", onKey);
        setTimeout(() => { ov.remove(); layer -= 1; if (!$(".oa-overlay")) document.body.classList.remove("oa-lock"); }, 220);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        if (onClose) onClose();
      },
    };
    const onKey = (e) => {
      if (e.key === "Escape" && ov.style.zIndex === String(60 + layer)) api_.close();
      if (e.key === "Tab") { // focus trap
        const f = $$('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', ov).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) api_.close(); });
    $$("[data-close]", ov).forEach((b) => b.addEventListener("click", () => api_.close()));
    if (tabs) {
      $$("[data-tab]", ov).forEach((b) => b.addEventListener("click", () => {
        $$("[data-tab]", ov).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        $$("[data-panel]", ov).forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
      }));
    }
    setTimeout(() => { const first = $("input:not([type=hidden]):not([disabled]), select, textarea", $("[data-body]", ov)) || $("[data-close]", ov); if (first) first.focus({ preventScroll: true }); }, 60);
    return api_;
  }
  const modal = (opts) => overlay({ ...opts, kind: "modal" });
  const drawer = (opts) => overlay({ ...opts, kind: "drawer" });

  function confirm({ title = "تأیید", message = "", confirmText = "تأیید", danger = false, requireText = "" } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const m = modal({
        title,
        body: html`<p style="margin:0">${message}</p>${requireText ? html`<label class="oa-field" style="margin-top:14px"><span>برای ادامه «${requireText}» را تایپ کنید</span><input class="oa-input" data-confirm-text autocomplete="off"></label>` : ""}`,
        foot: html`<button class="oa-btn" data-close>انصراف</button><button class="oa-btn ${danger ? "oa-btn--danger-solid" : "oa-btn--primary"}" data-ok>${confirmText}</button>`,
        onClose: () => { if (!answered) resolve(false); },
      });
      const ok = $("[data-ok]", m.el);
      const input = $("[data-confirm-text]", m.el);
      if (input) { ok.disabled = true; input.addEventListener("input", () => (ok.disabled = input.value.trim() !== requireText)); }
      ok.addEventListener("click", () => { answered = true; resolve(true); m.close(true); });
    });
  }

  // run an async action on a button with busy state + toast
  async function busy(btn, fn, success) {
    if (btn) { if (btn.getAttribute("aria-busy") === "true") return; btn.setAttribute("aria-busy", "true"); btn.disabled = true; }
    try { const r = await fn(); if (success) toast(typeof success === "function" ? success(r) : success); return r; }
    catch (e) { fail(e); throw e; }
    finally { if (btn) { btn.removeAttribute("aria-busy"); btn.disabled = false; } }
  }

  // ------------------------------------------------------- states & helpers
  const skeletonRows = (n = 6, cols = 4) => html`${Array.from({ length: n }, () => html`<div class="oa-skel-row"><div class="oa-skel" style="width:40px;height:40px;border-radius:10px"></div>${Array.from({ length: cols }, (_, i) => html`<div class="oa-skel" style="flex:${i === 0 ? 2 : 1};height:12px"></div>`)}</div>`)}`;
  const empty = (title, text = "", iconName = "box", action = "") => html`<div class="oa-empty"><div class="oa-empty__icon">${icon(iconName, "oa-icon--lg")}</div><b>${title}</b>${text ? html`<span>${text}</span>` : ""}${action}</div>`;
  const errorBox = (e, retry) => {
    const id = `retry-${Math.random().toString(36).slice(2)}`;
    setTimeout(() => { const b = document.getElementById(id); if (b && retry) b.addEventListener("click", retry); });
    return html`<div class="oa-error">${icon("alert")}<p>${(e && e.message) || "خطا در دریافت اطلاعات"}</p>${retry ? html`<button class="oa-btn oa-btn--sm" id="${id}">${icon("refresh", "oa-icon--sm")} تلاش دوباره</button>` : ""}</div>`;
  };
  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const can = (...perms) => perms.some((p) => (boot.permissions || []).includes(p));

  const ORDER_TONE = { "در انتظار پرداخت": "warn", "در حال پردازش": "info", "بسته بندی شده": "olive", "در حال ارسال": "gold", "تحویل داده شد": "good", "لغو شده": "bad" };
  const PAY_TONE = { "پرداخت شده": "good", "پرداخت نشده": "warn", "در حال بررسی": "info", "لغو شده": "bad", "نامشخص": "" };
  const badge = (text, tone = "") => html`<span class="oa-badge ${tone ? `oa-badge--${tone}` : ""}">${text}</span>`;
  const orderBadge = (s) => badge(s || "—", ORDER_TONE[s] || "");
  const payBadge = (s) => badge(s || "—", PAY_TONE[s] || "");
  const channelLabel = (key) => (key ? (boot.channels || {})[key] || key : (boot.channels || {}).unknown || "نامشخص");
  const sourceBadge = (key) => (key ? badge(channelLabel(key), key === "direct" ? "" : "olive") : html`<span class="oa-muted" style="font-size:12px">${channelLabel("unknown")}</span>`);

  function pagination(meta, onPage) {
    if (!meta || meta.total === undefined) return html``;
    const { page, pages, total, limit } = meta;
    const from = total ? (page - 1) * limit + 1 : 0;
    const to = Math.min(total, page * limit);
    const nums = [];
    for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p += 1) nums.push(p);
    const id = `pg-${Math.random().toString(36).slice(2)}`;
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) $$("[data-page]", el).forEach((b) => b.addEventListener("click", () => onPage(Number(b.dataset.page))));
    });
    return html`<nav class="oa-pagination" id="${id}" aria-label="صفحه‌بندی">
      <span>${num(from)}–${num(to)} از ${num(total)}</span>
      <div class="oa-pagination__pages">
        <button class="oa-page-btn" data-page="${page - 1}" ${raw(page <= 1 ? "disabled" : "")} aria-label="صفحه قبل">${icon("chevron-r", "oa-icon--sm")}</button>
        ${nums[0] > 1 ? html`<button class="oa-page-btn" data-page="1">${num(1)}</button>${nums[0] > 2 ? html`<span>…</span>` : ""}` : ""}
        ${nums.map((p) => html`<button class="oa-page-btn" data-page="${p}" ${raw(p === page ? 'aria-current="page"' : "")}>${num(p)}</button>`)}
        ${nums[nums.length - 1] < pages ? html`${nums[nums.length - 1] < pages - 1 ? html`<span>…</span>` : ""}<button class="oa-page-btn" data-page="${pages}">${num(pages)}</button>` : ""}
        <button class="oa-page-btn" data-page="${page + 1}" ${raw(page >= pages ? "disabled" : "")} aria-label="صفحه بعد">${icon("chevron", "oa-icon--sm")}</button>
      </div>
    </nav>`;
  }

  /**
   * Generic server-paginated list: toolbar (search / selects / tabs) + table + pagination.
   * Filter state lives in the URL hash so a refresh or shared link keeps it.
   */
  function list(root, cfg) {
    const state = { ...cfg.defaults, ...router.query() };
    if (!state.page) state.page = 1;
    let selected = new Set();
    let items = [];
    let seq = 0;
    set(root, html`<div class="oa-card">
      ${cfg.tabs ? html`<div style="padding:14px 16px 0"><div class="oa-tabs" role="tablist" data-tabs>${cfg.tabs.options.map(([v, label]) => html`<button class="oa-tab" role="tab" data-tab-value="${v}" aria-selected="${String((state[cfg.tabs.name] || "") === v)}">${label}<span class="oa-tab__count" data-count="${v}"></span></button>`)}</div></div>` : ""}
      <div class="oa-toolbar">
        ${cfg.search !== false ? html`<label class="oa-search">${icon("search")}<span class="sr-only">جستجو</span><input class="oa-input" type="search" data-q placeholder="${cfg.searchPlaceholder || "جستجو…"}" value="${state.q || ""}"></label>` : ""}
        ${(cfg.filters || []).map((f) => html`<label><span class="sr-only">${f.label}</span><select class="oa-select" data-filter="${f.name}" aria-label="${f.label}">${f.options.map(([v, label]) => html`<option value="${v}" ${raw(String(state[f.name] || "") === String(v) ? "selected" : "")}>${label}</option>`)}</select></label>`)}
        ${cfg.toolbarExtra || ""}
        <span style="flex:1"></span>
        <span class="oa-muted" data-total style="font-size:12.5px"></span>
      </div>
      <div data-bulk></div>
      <div data-body>${skeletonRows(6)}</div>
      <div data-pager></div>
    </div>`);
    const body = $("[data-body]", root);
    const pager = $("[data-pager]", root);
    const bulk = $("[data-bulk]", root);

    const sync = () => {
      const q = {};
      Object.entries(state).forEach(([k, v]) => { if (v !== "" && v !== undefined && v !== null && !(k === "page" && Number(v) === 1) && cfg.defaults?.[k] !== v) q[k] = v; });
      router.replaceQuery(q);
    };

    function renderBulk() {
      if (!cfg.bulk || !selected.size) return set(bulk, "");
      set(bulk, html`<div class="oa-bulkbar"><b>${num(selected.size)} مورد انتخاب شده</b>${cfg.bulk.map((b, i) => html`<button class="oa-btn oa-btn--sm" data-bulk-action="${i}">${b.label}</button>`)}<button class="oa-btn oa-btn--ghost oa-btn--sm" data-bulk-clear>لغو انتخاب</button></div>`);
      $$("[data-bulk-action]", bulk).forEach((btn) => btn.addEventListener("click", async () => {
        const action = cfg.bulk[Number(btn.dataset.bulkAction)];
        try { await busy(btn, () => action.run([...selected])); selected = new Set(); load(); } catch (_) {}
      }));
      $("[data-bulk-clear]", bulk).addEventListener("click", () => { selected = new Set(); load(); });
    }

    async function load() {
      const my = ++seq;
      sync();
      if (!body.querySelector("table")) set(body, skeletonRows(6));
      else body.style.opacity = "0.55";
      try {
        const data = await api(cfg.endpoint, { query: state });
        if (my !== seq) return;
        items = data.items || [];
        body.style.opacity = "";
        $("[data-total]", root).textContent = data.total !== undefined ? `${num(data.total)} مورد` : "";
        if (cfg.tabs && data[cfg.tabs.countsKey]) {
          $$("[data-count]", root).forEach((el) => { const c = cfg.tabs.count(data[cfg.tabs.countsKey], el.dataset.count); el.textContent = c === null || c === undefined ? "" : num(c); });
        }
        if (cfg.onData) cfg.onData(data);
        if (!items.length) {
          set(body, cfg.empty ? cfg.empty(state) : empty("موردی یافت نشد", "فیلترها را تغییر دهید."));
          set(pager, "");
          renderBulk();
          return;
        }
        const allChecked = cfg.bulk && items.every((it) => selected.has(it._id));
        set(body, html`<div class="oa-table-wrap"><table class="oa-table oa-table--cards">
          <thead><tr>${cfg.bulk ? html`<th class="col-check"><input type="checkbox" class="oa-check" data-check-all aria-label="انتخاب همه" ${raw(allChecked ? "checked" : "")}></th>` : ""}${cfg.columns.map((c) => html`<th class="${c.cls || ""}" scope="col">${c.label}</th>`)}</tr></thead>
          <tbody>${items.map((it, i) => html`<tr class="${cfg.onRow ? "is-clickable" : ""}" data-i="${i}">
            ${cfg.bulk ? html`<td class="col-check"><input type="checkbox" data-check="${it._id}" aria-label="انتخاب" ${raw(selected.has(it._id) ? "checked" : "")}></td>` : ""}
            ${cfg.columns.map((c) => html`<td class="${c.cls || ""}" data-label="${c.main ? "" : c.label}">${c.render(it)}</td>`)}
          </tr>`)}</tbody></table></div>`);
        set(pager, pagination(data, (p) => { state.page = p; load(); root.scrollIntoView({ block: "start", behavior: "smooth" }); }));
        $$("tbody tr", body).forEach((tr) => {
          const it = items[Number(tr.dataset.i)];
          if (cfg.onRow) tr.addEventListener("click", (e) => { if (e.target.closest("button, a, input, select, label")) return; cfg.onRow(it, api_); });
          if (cfg.bind) cfg.bind(tr, it, api_);
        });
        if (cfg.bulk) {
          $$("[data-check]", body).forEach((cb) => cb.addEventListener("change", () => { cb.checked ? selected.add(cb.dataset.check) : selected.delete(cb.dataset.check); renderBulk(); }));
          const all = $("[data-check-all]", body);
          if (all) all.addEventListener("change", () => { items.forEach((it) => (all.checked ? selected.add(it._id) : selected.delete(it._id))); $$("[data-check]", body).forEach((cb) => (cb.checked = all.checked)); renderBulk(); });
        }
        renderBulk();
      } catch (e) {
        if (my !== seq) return;
        body.style.opacity = "";
        set(body, errorBox(e, load));
        set(pager, "");
      }
    }

    const q = $("[data-q]", root);
    if (q) q.addEventListener("input", debounce(() => { state.q = q.value.trim(); state.page = 1; load(); }, 350));
    $$("[data-filter]", root).forEach((s) => s.addEventListener("change", () => { state[s.dataset.filter] = s.value; state.page = 1; load(); }));
    $$("[data-tab-value]", root).forEach((b) => b.addEventListener("click", () => {
      $$("[data-tab-value]", root).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      state[cfg.tabs.name] = b.dataset.tabValue; state.page = 1; load();
    }));
    const api_ = { reload: load, state, setParam(k, v) { state[k] = v; state.page = 1; load(); }, items: () => items };
    load();
    return api_;
  }

  // ------------------------------------------------------------- router
  const sections = {};
  const NAV = [];
  const router = {
    current: null,
    parse() {
      const hash = location.hash.replace(/^#\/?/, "");
      const [path, qs] = hash.split("?");
      const parts = (path || "dashboard").split("/").filter(Boolean);
      return { name: parts[0] || "dashboard", args: parts.slice(1).map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(qs || "")) };
    },
    query() { return this.parse().query; },
    go(name, args = [], query = {}) {
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "" && v != null)).toString();
      location.hash = `#/${[name, ...args.map(encodeURIComponent)].join("/")}${qs ? `?${qs}` : ""}`;
    },
    replaceQuery(query) {
      const { name, args } = this.parse();
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "" && v != null)).toString();
      history.replaceState(null, "", `#/${[name, ...args.map(encodeURIComponent)].join("/")}${qs ? `?${qs}` : ""}`);
    },
    render() {
      const { name, args, query } = this.parse();
      const sec = sections[name] && (!sections[name].perm || can(...[].concat(sections[name].perm))) ? sections[name] : null;
      const target = sec || sections.dashboard;
      const key = sec ? name : "dashboard";
      $$(".oa-nav__link").forEach((a) => (a.getAttribute("data-nav") === key ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
      $("#oa-title").textContent = target.title;
      $("#oa-crumb").textContent = target.group ? `اودر / ${target.group}` : "اودر";
      document.title = `${target.title} · پنل مدیریت اودر`;
      document.body.classList.remove("nav-open");
      const content = $("#oa-content");
      const sameSection = this.current === key;
      this.current = key;
      if (sameSection && target.onArgs && target.onArgs(args, query)) return;
      content.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "fade-in";
      content.appendChild(wrap);
      window.scrollTo({ top: 0 });
      try { target.render(wrap, { args, query }); } catch (e) { console.error(e); set(wrap, errorBox(e)); }
    },
  };

  function section(name, def) {
    sections[name] = def;
    if (def.nav) NAV.push({ name, ...def });
  }

  function pageHead(title, subtitle, actions = "") {
    return html`<div class="oa-page-head"><div><h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ""}</div><div class="oa-actions">${actions}</div></div>`;
  }

  // Date-range picker (presets + custom), returns current {days|from,to}
  function rangePicker(el, initial, onChange) {
    const presets = [["1", "امروز"], ["7", "۷ روز"], ["30", "۳۰ روز"], ["90", "۹۰ روز"], ["365", "یک سال"]];
    const state = { days: initial.days || "30", from: initial.from || "", to: initial.to || "" };
    const draw = () => set(el, html`<div class="oa-range">
      <div class="oa-segment" role="group" aria-label="بازه زمانی">${presets.map(([v, l]) => html`<button type="button" data-days="${v}" aria-pressed="${String(!state.from && state.days === v)}">${l}</button>`)}
        <button type="button" data-custom aria-pressed="${String(Boolean(state.from))}">${icon("calendar", "oa-icon--sm")} سفارشی</button></div>
      ${state.from || state.custom ? html`<label class="oa-inline"><span class="oa-muted" style="font-size:12px">از</span><input class="oa-input" type="date" data-from value="${state.from}" max="${tehranToday()}"></label>
        <label class="oa-inline"><span class="oa-muted" style="font-size:12px">تا</span><input class="oa-input" type="date" data-to value="${state.to}" max="${tehranToday()}"></label>
        ${state.from && state.to ? html`<span class="oa-muted" style="font-size:12px">${dayLong(state.from)} تا ${dayLong(state.to)}</span>` : ""}` : ""}
    </div>`);
    const emit = () => onChange(state.from && state.to ? { from: state.from, to: state.to } : { days: state.days });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-days]");
      if (b) { state.days = b.dataset.days; state.from = ""; state.to = ""; state.custom = false; draw(); emit(); }
      if (e.target.closest("[data-custom]")) { state.custom = true; draw(); }
    });
    el.addEventListener("change", (e) => {
      if (e.target.matches("[data-from]")) state.from = e.target.value;
      if (e.target.matches("[data-to]")) state.to = e.target.value;
      if (state.from && state.to) { draw(); emit(); }
    });
    draw();
    return state;
  }

  window.OA = {
    boot, html, raw, set, esc, icon, $, $$, num, money, pct, date, dateTime, dayLabel, dayLong, ago, toEn, intOrNull, objectId, tehranToday,
    api, upload, toast, fail, modal, drawer, confirm, busy, skeletonRows, empty, errorBox, debounce, can,
    badge, orderBadge, payBadge, sourceBadge, channelLabel, pagination, list, router, section, sections, NAV, pageHead, rangePicker,
    ORDER_TONE,
  };
})();
