/* ODOUR CONTROL — shell: rail navigation, mobile tab bar, command palette, notifications. */
(function () {
  "use strict";
  const { html, set, $, $$, num, money, icon, api, router, can, ago, toast, debounce } = OA;
  const body = document.body;

  // ------------------------------------------------------------ navigation
  const GROUPS = ["نمای کلی", "تجارت", "کاتالوگ", "بازاریابی", "محتوا", "مدیریت"];
  const visible = OA.NAV.filter((s) => !s.perm || can(...[].concat(s.perm)));
  set($("#ox-nav"), html`${GROUPS.map((g) => {
    const items = visible.filter((s) => s.group === g);
    if (!items.length) return "";
    return html`<div class="ox-rail__group"><div class="ox-rail__label">${g}</div>${items.map((s) => html`<a class="ox-nav-link" href="#/${s.name}" data-nav="${s.name}" data-tip="${s.title}">${icon(s.icon)}<span class="ox-nav-link__text">${s.title}</span>${s.name === "orders" ? html`<span class="ox-nav-link__count" data-nav-count hidden></span>` : ""}</a>`)}</div>`;
  })}`);

  const toggle = $("#ox-rail-toggle");
  const setRail = (state) => {
    body.dataset.rail = state;
    document.documentElement.dataset.rail = state;
    toggle.setAttribute("aria-expanded", String(state === "expanded"));
    try { localStorage.setItem("ox-rail", state); } catch (_) {}
  };
  setRail(body.dataset.rail === "expanded" ? "expanded" : "collapsed");
  toggle.addEventListener("click", () => setRail(body.dataset.rail === "expanded" ? "collapsed" : "expanded"));

  const menuBtn = $("#ox-menu");
  const drawer = (open) => { body.classList.toggle("nav-open", open); menuBtn.setAttribute("aria-expanded", String(open)); };
  menuBtn.addEventListener("click", () => drawer(!body.classList.contains("nav-open")));
  $("#ox-scrim").addEventListener("click", () => drawer(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && body.classList.contains("nav-open")) drawer(false); });

  // mobile tab bar: up to four primary destinations + «بیشتر»
  const primary = ["dashboard", "orders", "products", "inventory", "customers", "analytics"].filter((n) => visible.some((s) => s.name === n)).slice(0, 4);
  set($("#ox-tabbar"), html`${primary.map((n) => { const s = OA.sections[n]; return html`<a href="#/${n}" data-nav="${n}">${icon(s.icon)}<span>${s.short || s.title}</span></a>`; })}<button type="button" data-more>${icon("grid")}<span>بیشتر</span></button>`);
  $("[data-more]").addEventListener("click", () => drawer(true));

  // profile menu
  const me = $("#ox-me");
  const meMenu = $("#ox-me-menu");
  me.addEventListener("click", (e) => { e.stopPropagation(); const open = !meMenu.classList.contains("is-open"); meMenu.classList.toggle("is-open", open); me.setAttribute("aria-expanded", String(open)); });
  document.addEventListener("click", (e) => { if (!e.target.closest("#ox-me-menu") && !e.target.closest("#ox-me")) { meMenu.classList.remove("is-open"); me.setAttribute("aria-expanded", "false"); } });
  $("[data-logout]").addEventListener("click", async () => {
    if (!(await OA.confirm({ title: "خروج از پنل", message: "از حساب مدیریت خارج می‌شوید؟", confirmText: "خروج" }))) return;
    try { await fetch("/api/authentication/admin/logout", { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } }); } catch (_) {}
    location.href = "/admin/login";
  });

  // back buttons on full-page workspaces
  $("#ox-main").addEventListener("click", (e) => { if (e.target.closest("[data-back]")) router.back(router.current); });

  // --------------------------------------------------------- command palette
  function palette() {
    const m = OA.modal({
      top: true,
      bare: true,
      body: html`<div class="ox-palette" role="dialog" aria-modal="true" aria-label="جستجوی سراسری">
        <div class="ox-palette__input">${icon("search")}<input type="search" data-q placeholder="شماره سفارش، نام محصول، موبایل مشتری یا نام بخش…" aria-label="جستجو" autocomplete="off"><span class="ox-kbd">Esc</span></div>
        <div class="ox-palette__body" data-results role="listbox"></div>
        <div class="ox-palette__foot"><span>↑ ↓ جابه‌جایی</span><span>Enter باز کردن</span><span>Esc بستن</span></div></div>`,
    });
    const input = $("[data-q]", m.el);
    const box = $("[data-results]", m.el);
    let results = [];
    let active = 0;
    const draw = (groups) => {
      results = groups.flatMap((g) => g.items);
      active = Math.min(active, Math.max(0, results.length - 1));
      let k = -1;
      set(box, results.length ? html`${groups.filter((g) => g.items.length).map((g) => html`<div class="ox-palette__group">${g.title}</div>${g.items.map((it) => { k += 1; return html`<div class="ox-palette__item" role="option" data-k="${k}" aria-selected="${String(k === active)}">${icon(it.icon)}<b>${it.label}</b><span>${it.sub || ""}</span></div>`; })}`)}` : OA.empty({ icon: "search", title: "نتیجه‌ای پیدا نشد", compact: true }));
      $$("[data-k]", box).forEach((el) => el.addEventListener("click", () => open(Number(el.dataset.k))));
    };
    const open = (i) => { const it = results[i]; if (!it) return; m.close(true); location.hash = it.href; };
    const nav = (term) => visible.filter((s) => !term || s.title.includes(term)).map((s) => ({ icon: s.icon, label: s.title, sub: s.group, href: `#/${s.name}` }));
    let seq = 0;
    const search = debounce(async () => {
      const term = input.value.trim();
      const my = ++seq;
      const groups = [{ title: "بخش‌ها", items: nav(term).slice(0, term ? 6 : 14) }];
      draw(groups);
      if (term.length < 2) return;
      const jobs = [];
      if (can("manage_orders")) jobs.push(api("/orders", { query: { q: term, limit: 5 } }).then((r) => ({ title: "سفارش‌ها", items: r.items.map((o) => ({ icon: "bag", label: `${o.OrderNum} · ${o.recipientName || o.user?.fullName || ""}`, sub: money(o.totalPrice), href: `#/orders/${o._id}` })) })));
      if (can("manage_products", "manage_inventory")) jobs.push(api("/products", { query: { q: term, limit: 5 } }).then((r) => ({ title: "محصولات", items: r.items.map((p) => ({ icon: "box", label: p.name, sub: p.sku || "", href: `#/products/${p._id}` })) })));
      if (can("manage_users")) jobs.push(api("/customers", { query: { q: term, limit: 5 } }).then((r) => ({ title: "مشتریان", items: r.items.map((u) => ({ icon: "user", label: u.fullName || "بدون نام", sub: u.mobile, href: `#/customers/${u._id}` })) })));
      const extra = (await Promise.allSettled(jobs)).filter((x) => x.status === "fulfilled").map((x) => x.value);
      if (my === seq) draw([...groups, ...extra]);
    }, 260);
    input.addEventListener("input", () => { active = 0; search(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(1, results.length);
        $$("[data-k]", box).forEach((el) => el.setAttribute("aria-selected", String(Number(el.dataset.k) === active)));
        const cur = $(`[data-k="${active}"]`, box);
        if (cur) cur.scrollIntoView({ block: "nearest" });
      }
      if (e.key === "Enter") { e.preventDefault(); open(active); }
    });
    search();
    setTimeout(() => input.focus(), 30);
  }
  $("#ox-search").addEventListener("click", palette);
  $("#ox-search-m").addEventListener("click", palette);
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (!$(".ox-palette")) palette(); } });

  // ---------------------------------------------------------- notifications
  const bell = $("#ox-bell"), panel = $("#ox-notify-panel"), dot = $("#ox-bell-dot");
  let last = null;
  async function poll() {
    if (document.hidden) return;
    try {
      const n = await api("/notifications");
      if (last && n.newOrders > last.newOrders) toast(`${num(n.newOrders - last.newOrders)} سفارش جدید ثبت شد`, "info");
      last = n;
      const alerts = n.newOrders + (n.stuckPayments ? 1 : 0) + (n.outOfStock ? 1 : 0);
      dot.hidden = !alerts;
      dot.textContent = n.newOrders ? num(n.newOrders) : "!";
      const c = $("[data-nav-count]");
      if (c) { c.hidden = !n.newOrders; c.textContent = num(n.newOrders); }
      drawPanel(n);
    } catch (_) { /* silent */ }
  }
  function drawPanel(n) {
    const rows = [];
    if (can("manage_orders")) {
      n.latest.forEach((o) => rows.push(html`<li data-href="#/orders/${o._id}"><span class="ox-alertrow__ic" style="background:var(--primary-soft);color:var(--primary)">${icon("bag", "ox-i--s")}</span><div class="ox-list__main"><b><span class="ox-ref">${o.OrderNum}</span> · ${money(o.totalPrice)}</b><span>${o.recipientName || ""} · ${o.paymentMethod} · ${ago(o.createdAt)}</span></div></li>`));
      if (n.needsAction) rows.push(html`<li data-href="#/orders?status=needs_action"><span class="ox-alertrow__ic" style="background:var(--info-soft);color:var(--info)">${icon("truck", "ox-i--s")}</span><div class="ox-list__main"><b>${num(n.needsAction)} سفارش منتظر پردازش یا ارسال</b><span>صف آماده‌سازی</span></div></li>`);
      if (n.stuckPayments) rows.push(html`<li data-href="#/orders?paymentStatus=در حال بررسی"><span class="ox-alertrow__ic" style="background:var(--warning-soft);color:var(--warning)">${icon("alert", "ox-i--s")}</span><div class="ox-list__main"><b>${num(n.stuckPayments)} پرداخت با وضعیت نامشخص</b><span>بیش از یک ساعت؛ از درگاه استعلام کنید</span></div></li>`);
    }
    if (n.lowStock || n.outOfStock) rows.push(html`<li data-href="#/inventory?stock=${n.outOfStock ? "out" : "low"}"><span class="ox-alertrow__ic" style="background:var(--danger-soft);color:var(--danger)">${icon("layers", "ox-i--s")}</span><div class="ox-list__main"><b>${num(n.outOfStock)} ناموجود · ${num(n.lowStock)} رو به اتمام</b><span>مدیریت موجودی</span></div></li>`);
    set(panel, html`<div class="ox-notify__head"><span>اعلان‌ها ${n.newOrders ? html`<span class="ox-chip ox-chip--primary ox-chip--plain">${num(n.newOrders)} جدید</span>` : ""}</span>${n.newOrders && can("manage_orders") ? html`<button class="ox-btn ox-btn--text ox-btn--sm" type="button" data-seen>علامت‌گذاری به عنوان دیده‌شده</button>` : ""}</div>
      ${rows.length ? html`<ul class="ox-list ox-list--link" style="max-height:420px;overflow:auto">${rows}</ul>` : OA.empty({ icon: "bell", title: "همه چیز مرتب است", text: "اعلان تازه‌ای وجود ندارد.", compact: true })}`);
    $$("[data-href]", panel).forEach((li) => li.addEventListener("click", () => { close(); location.hash = li.dataset.href; }));
    const seen = $("[data-seen]", panel);
    if (seen) seen.addEventListener("click", async () => { try { await api("/notifications/seen", { method: "POST", body: {} }); last = null; poll(); } catch (e) { OA.fail(e); } });
  }
  const close = () => { panel.classList.remove("is-open"); bell.setAttribute("aria-expanded", "false"); };
  bell.addEventListener("click", (e) => { e.stopPropagation(); const open = !panel.classList.contains("is-open"); panel.classList.toggle("is-open", open); bell.setAttribute("aria-expanded", String(open)); if (open) poll(); });
  document.addEventListener("click", (e) => { if (!e.target.closest("#ox-notify")) close(); });
  poll();
  setInterval(poll, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

  addEventListener("hashchange", () => router.onHash());
  router.render();
})();
