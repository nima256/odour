/* ODOUR CONTROL — core runtime: escaped templates, API client, formatting, components, router. */
(function () {
  "use strict";

  const boot = JSON.parse(document.getElementById("ox-boot").textContent || "{}");
  const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";

  // ---------------------------------------------------------- templating
  // html`` escapes every interpolation unless it is itself html``/raw().
  class Raw { constructor(v) { this.v = String(v); } toString() { return this.v; } }
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"'`]/g, (c) => ESC[c]);
  const val = (v) => (v instanceof Raw ? v.v : Array.isArray(v) ? v.map(val).join("") : v === null || v === undefined || v === false ? "" : esc(v));
  const html = (s, ...v) => new Raw(s.reduce((o, str, i) => o + str + (i < v.length ? val(v[i]) : ""), ""));
  const raw = (v) => new Raw(v);
  const set = (el, t) => { el.innerHTML = t instanceof Raw ? t.v : esc(t); return el; };
  const icon = (n, c = "") => raw(`<svg class="ox-i ${esc(c)}" aria-hidden="true"><use href="#i-${esc(n)}"/></svg>`);
  const attr = (cond, a) => raw(cond ? a : "");
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => `ox${Math.random().toString(36).slice(2, 9)}`;

  // ---------------------------------------------------------- formatting
  const NF = new Intl.NumberFormat("fa-IR");
  const num = (n) => NF.format(Number(n) || 0);
  const money = (n) => `${num(Math.round(Number(n) || 0))} تومان`;
  const pct = (x, d = 1) => `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: d }).format((Number(x) || 0) * 100)}٪`;
  const compact = (v) => {
    const a = Math.abs(Number(v) || 0);
    if (a >= 1e9) return `${num(+(v / 1e9).toFixed(1))} میلیارد`;
    if (a >= 1e6) return `${num(+(v / 1e6).toFixed(1))} میلیون`;
    if (a >= 1e3) return `${num(+(v / 1e3).toFixed(1))} هزار`;
    return num(v);
  };
  const TZ = "Asia/Tehran";
  const F = {
    date: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "long", day: "numeric", timeZone: TZ }),
    short: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { month: "short", day: "numeric", timeZone: TZ }),
    weekday: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: TZ }),
    time: new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }),
    dayKey: new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }),
  };
  const ok = (d) => d && !Number.isNaN(new Date(d).getTime());
  const date = (d) => (ok(d) ? F.date.format(new Date(d)) : "—");
  const time = (d) => (ok(d) ? F.time.format(new Date(d)) : "—");
  const dateTime = (d) => (ok(d) ? `${F.date.format(new Date(d))} · ${F.time.format(new Date(d))}` : "—");
  const dayLabel = (day) => F.short.format(new Date(`${day}T12:00:00+03:30`));
  const dayLong = (day) => F.date.format(new Date(`${day}T12:00:00+03:30`));
  const todayLong = () => F.weekday.format(new Date());
  const tehranToday = () => F.dayKey.format(new Date());
  const dayKey = (d) => F.dayKey.format(new Date(d));
  function ago(d) {
    if (!ok(d)) return "—";
    const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return "همین الان";
    if (s < 3600) return `${num(Math.floor(s / 60))} دقیقه پیش`;
    if (s < 86400) return `${num(Math.floor(s / 3600))} ساعت پیش`;
    if (s < 30 * 86400) return `${num(Math.floor(s / 86400))} روز پیش`;
    return date(d);
  }
  const toEn = (v) => String(v == null ? "" : v).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  const intOrNull = (v) => { const s = toEn(v).replace(/[,٬\s]/g, ""); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? Math.round(n) : NaN; };
  const objectId = () => Math.floor(Date.now() / 1000).toString(16).padStart(8, "0") + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

  // ----------------------------------------------------------------- API
  class ApiError extends Error { constructor(m, s, d) { super(m); this.status = s; this.data = d; } }
  async function api(path, { method = "GET", body, query, raw: rawBody } = {}) {
    const url = new URL(path.startsWith("/") && !path.startsWith("/admin/") ? `/admin/api/v2${path}` : path, location.origin);
    if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v); });
    const init = { method, credentials: "same-origin", headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } };
    if (method !== "GET" && method !== "HEAD") init.headers["X-CSRF-Token"] = csrf;
    if (rawBody) init.body = rawBody;
    else if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, init); } catch (_) { throw new ApiError("ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.", 0); }
    if (res.status === 401) { toast("نشست شما به پایان رسیده است؛ دوباره وارد شوید.", "error"); setTimeout(() => (location.href = "/admin/login"), 1200); throw new ApiError("unauthorized", 401); }
    let data = null;
    if ((res.headers.get("content-type") || "").includes("application/json")) { try { data = await res.json(); } catch (_) { data = null; } }
    if (!res.ok || (data && data.success === false)) {
      throw new ApiError((data && (data.message || data.error)) || (res.status === 403 ? "به این بخش دسترسی ندارید" : res.status === 404 ? "مورد یافت نشد" : "خطای سرور. دوباره تلاش کنید."), res.status, data);
    }
    return data || {};
  }
  const upload = (url, files, field = "images") => { const fd = new FormData(); Array.from(files).forEach((f) => fd.append(field, f)); return api(url, { method: "POST", raw: fd }); };

  // ------------------------------------------------------------- toasts
  function toast(message, type = "success") {
    const box = $("#ox-toasts");
    if (!box) return;
    const el = document.createElement("div");
    el.className = `ox-toast ox-toast--${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    set(el, html`${icon(type === "error" ? "alert" : type === "info" ? "info" : "check")}<span class="ox-toast__msg">${message}</span><button class="ox-toast__x" type="button" aria-label="بستن">${icon("x", "ox-i--s")}</button>`);
    const close = () => { el.style.transition = "opacity .2s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 220); };
    $(".ox-toast__x", el).addEventListener("click", close);
    box.prepend(el);
    setTimeout(close, type === "error" ? 7000 : 3600);
  }
  const fail = (e) => { if (e && e.status !== 401) toast(e.message || "خطا", "error"); };

  // ------------------------------------------------------------ dialogs
  let depth = 0;
  function modal({ title = "", sub = "", body = "", foot = "", size = "", iconName = "", danger = false, top = false, onClose, bare = false } = {}) {
    const ov = document.createElement("div");
    ov.className = `ox-overlay${top ? " ox-overlay--top" : ""}`;
    ov.style.zIndex = String(80 + ++depth);
    const tid = uid();
    set(ov, bare ? html`${body}` : html`<section class="ox-dialog ${size} ${danger ? "ox-dialog--danger" : ""}" role="dialog" aria-modal="true" aria-labelledby="${tid}">
      <header class="ox-dialog__head">${iconName ? html`<span class="ox-dialog__icon">${icon(iconName)}</span>` : ""}<div><h2 id="${tid}">${title}</h2>${sub ? html`<p>${sub}</p>` : ""}</div>
        <button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-close aria-label="بستن">${icon("x")}</button></header>
      <div class="ox-dialog__body" data-body>${body}</div>
      ${foot ? html`<footer class="ox-dialog__foot" data-foot>${foot}</footer>` : ""}
    </section>`);
    document.body.appendChild(ov);
    document.body.classList.add("ox-lock");
    const prev = document.activeElement;
    requestAnimationFrame(() => ov.classList.add("is-open"));
    let closed = false;
    const m = {
      el: ov, body: $("[data-body]", ov), foot: $("[data-foot]", ov), beforeClose: null,
      async close(force) {
        if (closed) return;
        if (!force && m.beforeClose && !(await m.beforeClose())) return;
        closed = true;
        ov.classList.remove("is-open");
        document.removeEventListener("keydown", key);
        setTimeout(() => { ov.remove(); depth -= 1; if (!$(".ox-overlay")) document.body.classList.remove("ox-lock"); }, 180);
        if (prev && prev.focus) prev.focus({ preventScroll: true });
        if (onClose) onClose();
      },
    };
    const key = (e) => {
      if (ov.style.zIndex !== String(80 + depth)) return;
      if (e.key === "Escape") m.close();
      if (e.key === "Tab") {
        const f = $$('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])', ov).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", key);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) m.close(); });
    $$("[data-close]", ov).forEach((b) => b.addEventListener("click", () => m.close()));
    setTimeout(() => { const f = $("input:not([type=hidden]):not([disabled]):not([type=checkbox]), select, textarea", ov) || $("[data-ok]", ov) || $("[data-close]", ov); if (f) f.focus({ preventScroll: true }); }, 50);
    return m;
  }

  function confirm({ title = "تأیید عملیات", message = "", consequence = "", confirmText = "تأیید", danger = false, requireText = "" } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const m = modal({
        title, size: "ox-dialog--s", danger, iconName: danger ? "alert" : "info",
        body: html`<p style="font-size:13.5px;line-height:1.9">${message}</p>${consequence ? html`<div class="ox-consequence">${consequence}</div>` : ""}
          ${requireText ? html`<label class="ox-field" style="margin-top:14px"><span class="ox-label">برای تأیید، «<span class="ltr">${requireText}</span>» را تایپ کنید</span><input class="ox-input" data-confirm autocomplete="off"></label>` : ""}`,
        foot: html`<button class="ox-btn" type="button" data-close>انصراف</button><button class="ox-btn ${danger ? "ox-btn--danger-solid" : "ox-btn--primary"}" type="button" data-ok>${confirmText}</button>`,
        onClose: () => { if (!answered) resolve(false); },
      });
      const okBtn = $("[data-ok]", m.el);
      const input = $("[data-confirm]", m.el);
      if (input) { okBtn.disabled = true; input.addEventListener("input", () => (okBtn.disabled = input.value.trim() !== requireText)); }
      okBtn.addEventListener("click", () => { answered = true; resolve(true); m.close(true); });
    });
  }

  async function busy(btn, fn, success) {
    if (btn) { if (btn.getAttribute("aria-busy") === "true") return undefined; btn.setAttribute("aria-busy", "true"); btn.disabled = true; }
    try { const r = await fn(); if (success) toast(typeof success === "function" ? success(r) : success); return r; }
    catch (e) { fail(e); throw e; }
    finally { if (btn) { btn.removeAttribute("aria-busy"); btn.disabled = false; } }
  }

  // Overflow / action menu anchored to a button.
  let openMenu = null;
  function menu(anchor, items) {
    if (openMenu) { openMenu.remove(); const same = openMenu.anchor === anchor; openMenu = null; if (same) return; }
    const pop = document.createElement("div");
    pop.className = "ox-pop is-open";
    pop.setAttribute("role", "menu");
    pop.anchor = anchor;
    set(pop, html`${items.filter(Boolean).map((it, i) => (it === "-" ? html`<div class="ox-menu-sep"></div>` : it.href ? html`<a class="ox-menu-item" role="menuitem" href="${it.href}" ${attr(it.external, 'target="_blank" rel="noopener"')}>${icon(it.icon || "arrow-right", "ox-i--s")}${it.label}</a>` : html`<button class="ox-menu-item ${it.danger ? "ox-menu-item--danger" : ""}" role="menuitem" type="button" data-i="${i}">${icon(it.icon || "arrow-right", "ox-i--s")}${it.label}</button>`))}`);
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.position = "fixed";
    pop.style.top = `${Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8)}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    $$("[data-i]", pop).forEach((b) => b.addEventListener("click", () => { pop.remove(); openMenu = null; items.filter(Boolean)[Number(b.dataset.i)].run(); }));
    openMenu = pop;
    const first = $(".ox-menu-item", pop);
    if (first) first.focus();
  }
  document.addEventListener("mousedown", (e) => { if (openMenu && !openMenu.contains(e.target) && !openMenu.anchor.contains(e.target)) { openMenu.remove(); openMenu = null; } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openMenu) { openMenu.anchor.focus(); openMenu.remove(); openMenu = null; } });
  addEventListener("scroll", () => { if (openMenu) { openMenu.remove(); openMenu = null; } }, { passive: true, capture: true });

  // ------------------------------------------------------------- states
  const skeletonTable = (rows = 6) => html`<div class="ox-skel-table" aria-busy="true" aria-label="در حال بارگذاری">${Array.from({ length: rows }, () => html`<div><div class="ox-skel sq"></div><div><div class="ox-skel" style="width:70%"></div><div class="ox-skel" style="width:40%;margin-top:8px;height:9px"></div></div><div class="ox-skel"></div><div class="ox-skel" style="width:60%"></div><div class="ox-skel" style="width:50%"></div></div>`)}</div>`;
  const skeletonBlock = (h = 120) => html`<div class="ox-skel" style="height:${h}px;border-radius:10px"></div>`;
  const empty = ({ icon: ic = "box", title, text = "", action = "", compact = false }) => html`<div class="ox-empty ${compact ? "ox-empty--compact" : ""}"><div class="ox-empty__art">${icon(ic, "ox-i--l")}</div><b>${title}</b>${text ? html`<p>${text}</p>` : ""}${action}</div>`;
  function errorBox(e, retry) {
    const id = uid();
    setTimeout(() => { const b = document.getElementById(id); if (b && retry) b.addEventListener("click", retry); });
    return html`<div class="ox-fail" role="alert">${icon("alert", "ox-i--l")}<b>${(e && e.message) || "خطا در دریافت اطلاعات"}</b>${retry ? html`<button class="ox-btn ox-btn--sm" type="button" id="${id}">${icon("refresh", "ox-i--s")} تلاش دوباره</button>` : ""}</div>`;
  }
  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const can = (...p) => p.some((x) => (boot.permissions || []).includes(x));

  // --------------------------------------------------------- semantics
  const ORDER_TONE = { "در انتظار پرداخت": "warning", "در حال پردازش": "info", "بسته بندی شده": "primary", "در حال ارسال": "teal", "تحویل داده شد": "success", "لغو شده": "danger" };
  const ORDER_COLOR = { "در انتظار پرداخت": "#d97706", "در حال پردازش": "#2563eb", "بسته بندی شده": "#4355e8", "در حال ارسال": "#0d9488", "تحویل داده شد": "#059669", "لغو شده": "#dc3545" };
  const PAY_TONE = { "پرداخت شده": "success", "پرداخت نشده": "warning", "در حال بررسی": "info", "لغو شده": "danger", "نامشخص": "" };
  const chip = (t, tone = "", plain = false) => html`<span class="ox-chip ${tone ? `ox-chip--${tone}` : ""} ${plain ? "ox-chip--plain" : ""}">${t}</span>`;
  const orderChip = (s) => chip(s || "—", ORDER_TONE[s]);
  const payChip = (s) => chip(s || "—", PAY_TONE[s]);
  const CHANNEL_GLYPH = { google: ["G", "#4355e8"], torob: ["T", "#e1484f"], snapp: ["S", "#0d9488"], instagram: ["IG", "#b4447d"], other_search: ["SE", "#5b6b88"], social: ["SN", "#3b6fb6"], referral: ["R", "#7a6a3a"], campaign: ["UTM", "#111827"], direct: ["D", "#334155"], unknown: ["?", "#94a3b8"] };
  const channelLabel = (k) => (boot.channels || {})[k || "unknown"] || k || "نامشخص";
  const glyph = (k) => { const [g, c] = CHANNEL_GLYPH[k] || CHANNEL_GLYPH.unknown; return html`<span class="ox-src__glyph" style="background:${c}">${g}</span>`; };
  const source = (k, { label = true } = {}) => (k ? html`<span class="ox-src">${glyph(k)}${label ? channelLabel(k) : ""}</span>` : html`<span class="ox-src ox-src--none">${glyph("unknown")}${label ? "ردیابی نشده" : ""}</span>`);

  function pageHead({ eyebrow = "", title, count = null, subtitle = "", actions = "" }) {
    return html`<div class="ox-page-head"><div>${eyebrow ? html`<div class="ox-page-head__eyebrow">${eyebrow}</div>` : ""}<h1>${title}${count !== null ? html`<span class="ox-count" data-head-count>${count}</span>` : ""}</h1>${subtitle ? html`<p>${subtitle}</p>` : ""}</div><div class="ox-page-head__actions">${actions}</div></div>`;
  }
  function workHead({ back, title, meta = "", actions = "" }) {
    return html`<div class="ox-workhead"><button class="ox-back" type="button" data-back aria-label="بازگشت">${icon("arrow-right")}</button><div style="flex:1;min-width:0"><h1>${title}</h1>${meta ? html`<div class="ox-workhead__meta">${meta}</div>` : ""}</div><div class="ox-page-head__actions">${actions}</div></div>`;
  }

  function pager(meta, onPage) {
    if (!meta || meta.total === undefined || meta.pages <= 1) return meta && meta.total ? html`<div class="ox-pager"><span>${num(meta.total)} مورد</span></div>` : html``;
    const { page, pages, total, limit } = meta;
    const nums = [];
    for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p += 1) nums.push(p);
    const id = uid();
    setTimeout(() => { const el = document.getElementById(id); if (el) $$("[data-page]", el).forEach((b) => b.addEventListener("click", () => onPage(Number(b.dataset.page)))); });
    return html`<nav class="ox-pager" id="${id}" aria-label="صفحه‌بندی"><span>نمایش ${num((page - 1) * limit + 1)}–${num(Math.min(total, page * limit))} از ${num(total)}</span>
      <div class="ox-pager__nums"><button class="ox-pager__btn" type="button" data-page="${page - 1}" ${attr(page <= 1, "disabled")} aria-label="صفحه قبل">${icon("chevron-r", "ox-i--s")}</button>
      ${nums[0] > 1 ? html`<button class="ox-pager__btn" type="button" data-page="1">${num(1)}</button>${nums[0] > 2 ? "…" : ""}` : ""}
      ${nums.map((p) => html`<button class="ox-pager__btn" type="button" data-page="${p}" ${attr(p === page, 'aria-current="page"')}>${num(p)}</button>`)}
      ${nums[nums.length - 1] < pages ? html`${nums[nums.length - 1] < pages - 1 ? "…" : ""}<button class="ox-pager__btn" type="button" data-page="${pages}">${num(pages)}</button>` : ""}
      <button class="ox-pager__btn" type="button" data-page="${page + 1}" ${attr(page >= pages, "disabled")} aria-label="صفحه بعد">${icon("chevron", "ox-i--s")}</button></div></nav>`;
  }

  /**
   * Server-paginated data list. Desktop: table with sticky header and row menus.
   * Mobile: record cards (cfg.record). Filter state is mirrored into the URL hash.
   *  tabs: { name, options: [[value, label, extraParams?]], countsKey, count(counts, value) }
   */
  function list(root, cfg) {
    const q0 = router.query();
    const state = { ...cfg.defaults, ...q0 };
    if (!state.page) state.page = 1;
    const tabKey = cfg.tabs ? cfg.tabs.name : null;
    let selected = new Set();
    let items = [];
    let seq = 0;
    const filterSelect = (f) => html`<select class="ox-select" data-filter="${f.name}" aria-label="${f.label}">${f.options.map(([v, l]) => html`<option value="${v}" ${attr(String(state[f.name] ?? "") === String(v), "selected")}>${l}</option>`)}</select>`;
    set(root, html`
      ${cfg.tabs ? html`<div class="ox-tabs" role="tablist" style="margin-bottom:16px">${cfg.tabs.options.map(([v, l]) => html`<button class="ox-tab" type="button" role="tab" data-tab="${v}" aria-selected="${String((state[tabKey] || "") === v)}">${l}<span class="ox-tab__n" data-count="${v}" hidden></span></button>`)}</div>` : ""}
      <div class="ox-datacard">
        <div class="ox-toolbar">
          ${cfg.search !== false ? html`<label class="ox-searchbox">${icon("search")}<span class="sr-only">جستجو</span><input class="ox-input" type="search" data-q placeholder="${cfg.searchPlaceholder || "جستجو…"}" value="${state.q || ""}"></label>` : ""}
          ${(cfg.filters || []).map(filterSelect)}
          ${cfg.toolbarExtra || ""}
          ${(cfg.filters || []).length ? html`<button class="ox-btn ox-filters-btn" type="button" data-filters>${icon("filter", "ox-i--s")} فیلترها<span data-fcount></span></button>` : ""}
          <span class="ox-toolbar__count" data-total></span>
        </div>
        <div data-bulk></div>
        <div data-body>${skeletonTable()}</div>
        <div data-pager></div>
      </div>`);
    const body = $("[data-body]", root);
    const sync = () => {
      const q = {};
      Object.entries(state).forEach(([k, v]) => { if (v !== "" && v !== undefined && v !== null && !(k === "page" && Number(v) === 1) && cfg.defaults?.[k] !== v) q[k] = v; });
      router.replaceQuery(q);
      const active = (cfg.filters || []).filter((f) => state[f.name] && String(state[f.name]) !== String(cfg.defaults?.[f.name] ?? "")).length;
      const fc = $("[data-fcount]", root);
      if (fc) fc.textContent = active ? ` (${num(active)})` : "";
    };
    const actionsBtn = (it) => (cfg.actions ? html`<button class="ox-btn ox-btn--ghost ox-btn--sm ox-btn--icon" type="button" data-menu aria-label="عملیات">${icon("more")}</button>` : "");

    function renderBulk() {
      const bulk = $("[data-bulk]", root);
      if (!cfg.bulk || !selected.size) return set(bulk, "");
      set(bulk, html`<div class="ox-bulk"><b>${num(selected.size)} مورد انتخاب شده</b>${cfg.bulk.map((b, i) => html`<button class="ox-btn ox-btn--sm" type="button" data-bulk="${i}">${b.label}</button>`)}<span class="ox-spacer"></span><button class="ox-btn ox-btn--sm" type="button" data-bulk-clear>لغو انتخاب</button></div>`);
      $$("[data-bulk]", bulk).forEach((b) => b.addEventListener("click", async () => { try { await busy(b, () => cfg.bulk[Number(b.dataset.bulk)].run([...selected])); selected = new Set(); load(); } catch (_) {} }));
      $("[data-bulk-clear]", bulk).addEventListener("click", () => { selected = new Set(); load(); });
    }

    async function load() {
      const my = ++seq;
      sync();
      if (!$("table", body)) set(body, skeletonTable()); else body.style.opacity = "0.5";
      try {
        const query = { ...state };
        if (cfg.tabs) { const opt = cfg.tabs.options.find(([v]) => v === (state[tabKey] || "")); if (opt && opt[2]) { delete query[tabKey]; Object.assign(query, opt[2]); } }
        const data = await api(cfg.endpoint, { query });
        if (my !== seq) return;
        items = data.items || [];
        body.style.opacity = "";
        $("[data-total]", root).textContent = data.total !== undefined ? `${num(data.total)} نتیجه` : "";
        if (cfg.tabs && cfg.tabs.count) $$("[data-count]", root).forEach((el) => { const c = cfg.tabs.count(data, el.dataset.count); el.hidden = c === null || c === undefined; el.textContent = num(c); });
        if (cfg.onData) cfg.onData(data, api_);
        if (!items.length) { set(body, cfg.empty ? cfg.empty(state) : empty({ title: "موردی یافت نشد", text: "فیلترها یا عبارت جستجو را تغییر دهید.", icon: "search" })); set($("[data-pager]", root), ""); renderBulk(); return; }
        const all = cfg.bulk && items.every((it) => selected.has(it._id));
        set(body, html`<div class="ox-table-wrap ${cfg.record ? "has-records" : ""}"><table class="ox-table">
          <thead><tr>${cfg.bulk ? html`<th class="col-check"><input type="checkbox" class="ox-check" data-all aria-label="انتخاب همه" ${attr(all, "checked")}></th>` : ""}${cfg.columns.map((c) => html`<th class="${c.cls || ""}" scope="col">${c.label}</th>`)}${cfg.actions ? html`<th class="col-actions"><span class="sr-only">عملیات</span></th>` : ""}</tr></thead>
          <tbody>${items.map((it, i) => html`<tr class="${cfg.onRow ? "is-link" : ""} ${selected.has(it._id) ? "is-selected" : ""}" data-i="${i}" ${attr(cfg.onRow, 'tabindex="0"')}>
            ${cfg.bulk ? html`<td class="col-check"><input type="checkbox" data-sel="${it._id}" aria-label="انتخاب" ${attr(selected.has(it._id), "checked")}></td>` : ""}
            ${cfg.columns.map((c) => html`<td class="${c.cls || ""}">${c.render(it)}</td>`)}
            ${cfg.actions ? html`<td class="col-actions">${actionsBtn(it)}</td>` : ""}</tr>`)}</tbody></table></div>
          ${cfg.record ? html`<div class="ox-records">${items.map((it, i) => html`<div class="ox-record ${cfg.onRow ? "is-link" : ""}" data-i="${i}">${cfg.record(it)}</div>`)}</div>` : ""}`);
        set($("[data-pager]", root), pager(data, (p) => { state.page = p; load(); root.scrollIntoView({ behavior: "smooth", block: "start" }); }));
        $$("[data-i]", body).forEach((row) => {
          const it = items[Number(row.dataset.i)];
          if (cfg.onRow) {
            row.addEventListener("click", (e) => { if (e.target.closest("button, a, input, select, label, summary")) return; cfg.onRow(it, api_); });
            row.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === row) cfg.onRow(it, api_); });
          }
          $$("[data-menu]", row).forEach((b) => b.addEventListener("click", () => menu(b, cfg.actions(it, api_))));
          if (cfg.bind) cfg.bind(row, it, api_);
        });
        if (cfg.bulk) {
          $$("[data-sel]", body).forEach((cb) => cb.addEventListener("change", () => { cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel); cb.closest("tr").classList.toggle("is-selected", cb.checked); renderBulk(); }));
          const a = $("[data-all]", body);
          if (a) a.addEventListener("change", () => { items.forEach((it) => (a.checked ? selected.add(it._id) : selected.delete(it._id))); $$("[data-sel]", body).forEach((cb) => { cb.checked = a.checked; cb.closest("tr").classList.toggle("is-selected", a.checked); }); renderBulk(); });
        }
        renderBulk();
      } catch (e) {
        if (my !== seq) return;
        body.style.opacity = "";
        set(body, errorBox(e, load));
        set($("[data-pager]", root), "");
      }
    }
    const qInput = $("[data-q]", root);
    if (qInput) qInput.addEventListener("input", debounce(() => { state.q = qInput.value.trim(); state.page = 1; load(); }, 350));
    $$("[data-filter]", root).forEach((s) => s.addEventListener("change", () => { state[s.dataset.filter] = s.value; state.page = 1; load(); }));
    $$("[data-tab]", root).forEach((b) => b.addEventListener("click", () => { $$("[data-tab]", root).forEach((x) => x.setAttribute("aria-selected", String(x === b))); state[tabKey] = b.dataset.tab; state.page = 1; load(); }));
    const fb = $("[data-filters]", root);
    if (fb) fb.addEventListener("click", () => {
      const m = modal({
        title: "فیلترها", size: "ox-dialog--s",
        body: html`<div class="ox-form ox-form--1">${(cfg.filters || []).map((f) => html`<label class="ox-field"><span class="ox-label">${f.label}</span>${filterSelect(f)}</label>`)}</div>`,
        foot: html`<button class="ox-btn" type="button" data-reset>پاک کردن</button><button class="ox-btn ox-btn--primary" type="button" data-ok>اعمال فیلترها</button>`,
      });
      $("[data-reset]", m.el).addEventListener("click", () => { (cfg.filters || []).forEach((f) => (state[f.name] = cfg.defaults?.[f.name] ?? "")); state.page = 1; m.close(true); syncSelects(); load(); });
      $("[data-ok]", m.el).addEventListener("click", () => { $$("[data-filter]", m.el).forEach((s) => (state[s.dataset.filter] = s.value)); state.page = 1; m.close(true); syncSelects(); load(); });
    });
    const syncSelects = () => $$(".ox-toolbar [data-filter]", root).forEach((s) => (s.value = state[s.dataset.filter] ?? ""));
    const api_ = { reload: load, state, setParam(k, v) { state[k] = v; state.page = 1; syncSelects(); load(); }, items: () => items };
    load();
    return api_;
  }

  // ------------------------------------------------------------- router
  const sections = {};
  const NAV = [];
  let lastHash = location.hash;
  const router = {
    current: null,
    guard: null,
    parse(hash = location.hash) {
      const [path, qs] = hash.replace(/^#\/?/, "").split("?");
      const parts = (path || "dashboard").split("/").filter(Boolean);
      return { name: parts[0] || "dashboard", args: parts.slice(1).map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(qs || "")) };
    },
    query() { return this.parse().query; },
    href(name, args = [], query = {}) {
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "" && v != null)).toString();
      return `#/${[name, ...args.map(encodeURIComponent)].join("/")}${qs ? `?${qs}` : ""}`;
    },
    go(name, args = [], query = {}) { location.hash = this.href(name, args, query); },
    back(name) {
      const prev = this.parse(this.prev || "");
      if (this.prev && prev.name === name && !prev.args.length) history.back();
      else this.go(name);
    },
    replaceQuery(query) { const { name, args } = this.parse(); history.replaceState(null, "", this.href(name, args, query)); lastHash = location.hash; },
    async onHash() {
      if (this.guard && location.hash !== lastHash) {
        const target = location.hash;
        history.replaceState(null, "", lastHash);
        if (!(await this.guard())) return;
        this.guard = null;
        history.pushState(null, "", target);
      }
      this.prev = lastHash;
      lastHash = location.hash;
      this.render();
    },
    render() {
      const { name, args, query } = this.parse();
      const ok_ = sections[name] && (!sections[name].perm || can(...[].concat(sections[name].perm)));
      const key = ok_ ? name : "dashboard";
      const sec = sections[key];
      this.guard = null;
      $$("[data-nav]").forEach((a) => (a.dataset.nav === key ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
      $("#ox-title").textContent = sec.title;
      set($("#ox-crumb"), html`<span>ODOUR</span>${sec.group ? html`${icon("chevron")}<span>${sec.group}</span>` : ""}${args[0] ? html`${icon("chevron")}<span>${args[0] === "new" ? "جدید" : "جزئیات"}</span>` : ""}`);
      document.title = `${sec.title} · Odour Control`;
      document.body.classList.remove("nav-open");
      setQuick(sec.quick && (!sec.quick.perm || can(sec.quick.perm)) ? sec.quick : defaultQuick());
      const main = $("#ox-main");
      main.innerHTML = "";
      const wrap = document.createElement("div");
      main.appendChild(wrap);
      window.scrollTo({ top: 0 });
      this.current = key;
      try { sec.render(wrap, { args, query }); } catch (e) { console.error(e); set(wrap, errorBox(e)); }
    },
  };
  // Leaving a page with unsaved changes asks first (in-app and on tab close).
  addEventListener("beforeunload", (e) => { if (router.guard && router.dirty && router.dirty()) { e.preventDefault(); e.returnValue = ""; } });
  function protect(isDirty) {
    router.dirty = isDirty;
    router.guard = async () => !isDirty() || confirm({ title: "تغییرات ذخیره نشده", message: "تغییرات این صفحه ذخیره نشده‌اند. بدون ذخیره خارج می‌شوید؟", confirmText: "خروج بدون ذخیره", danger: true });
  }

  function defaultQuick() {
    if (can("manage_products")) return { label: "محصول جدید", icon: "plus", href: "#/products/new" };
    if (can("manage_orders")) return { label: "سفارش‌های در انتظار اقدام", icon: "bag", href: "#/orders?status=needs_action" };
    return null;
  }
  function setQuick(q) {
    const el = $("#ox-quick");
    if (!el) return;
    set(el, q ? html`<a class="ox-btn ox-btn--primary" href="${q.href}">${icon(q.icon || "plus", "ox-i--s")}${q.label}</a>` : "");
  }

  function section(name, def) { sections[name] = def; if (def.nav) NAV.push({ name, ...def }); }

  // Date range control (button group + custom dates).
  function rangePicker(el, initial, onChange) {
    const presets = [["1", "امروز"], ["7", "۷ روز"], ["30", "۳۰ روز"], ["90", "۹۰ روز"], ["365", "۱ سال"]];
    const st = { days: initial.days || "30", from: initial.from || "", to: initial.to || "", custom: Boolean(initial.from) };
    const draw = () => set(el, html`<div class="ox-row" style="gap:8px">
      <div class="ox-btn-group" role="group" aria-label="بازه زمانی">${presets.map(([v, l]) => html`<button type="button" data-days="${v}" aria-pressed="${String(!st.custom && st.days === v)}">${l}</button>`)}<button type="button" data-custom aria-pressed="${String(st.custom)}">${icon("calendar", "ox-i--s")}بازه دلخواه</button></div>
      ${st.custom ? html`<div class="ox-row" style="gap:6px"><input class="ox-input ox-input--sm" style="width:148px" type="date" aria-label="از تاریخ" data-from value="${st.from}" max="${tehranToday()}"><span class="muted small">تا</span><input class="ox-input ox-input--sm" style="width:148px" type="date" aria-label="تا تاریخ" data-to value="${st.to}" max="${tehranToday()}"></div>` : ""}
    </div>`);
    const emit = () => onChange(st.custom && st.from && st.to ? { from: st.from, to: st.to } : { days: st.days });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-days]");
      if (b) { st.days = b.dataset.days; st.custom = false; st.from = st.to = ""; draw(); emit(); }
      if (e.target.closest("[data-custom]")) { st.custom = true; draw(); }
    });
    el.addEventListener("change", (e) => {
      if (e.target.matches("[data-from]")) st.from = e.target.value;
      if (e.target.matches("[data-to]")) st.to = e.target.value;
      if (st.from && st.to) emit();
    });
    draw();
    return st;
  }

  // Field markup helper.
  const field = ({ label, req = false, opt = false, help = "", count = "", cls = "", control, err = "" }) => html`<label class="ox-field ${cls}"><span class="ox-label">${label}${req ? html`<span class="req" aria-hidden="true">*</span>` : ""}${opt ? html`<span class="opt">(اختیاری)</span>` : ""}${count ? html`<span class="count">${count}</span>` : ""}</span>${control}${help ? html`<span class="ox-help">${help}</span>` : ""}<span class="ox-error">${err}</span></label>`;
  const toggle = ({ name = "", checked = false, title, text = "", attrs = "" }) => html`<label class="ox-toggle"><input type="checkbox" ${raw(name ? `name="${esc(name)}"` : "")} ${attr(checked, "checked")} ${raw(attrs)}><span class="ox-toggle__ui"></span><span class="ox-toggle__text"><b>${title}</b>${text ? html`<span>${text}</span>` : ""}</span></label>`;

  window.OA = {
    boot, html, raw, set, esc, icon, attr, $, $$, uid,
    num, money, pct, compact, date, time, dateTime, dayLabel, dayLong, todayLong, tehranToday, dayKey, ago, toEn, intOrNull, objectId,
    api, upload, toast, fail, modal, confirm, busy, menu,
    skeletonTable, skeletonBlock, empty, errorBox, debounce, can,
    chip, orderChip, payChip, source, glyph, channelLabel, ORDER_TONE, ORDER_COLOR,
    pageHead, workHead, pager, list, router, section, sections, NAV, rangePicker, protect, setQuick, field, toggle,
  };
})();
