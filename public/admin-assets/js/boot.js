/* Builds navigation from registered sections, starts the router and notifications. */
(function () {
  "use strict";
  const { html, set, $, $$, num, money, icon, api, router, can, ago, toast } = OA;

  // ---- navigation (only sections this admin may open)
  const groups = [];
  OA.NAV.forEach((s) => {
    if (s.perm && !can(...[].concat(s.perm))) return;
    const g = s.group || "";
    let group = groups.find((x) => x.name === g);
    if (!group) groups.push((group = { name: g, items: [] }));
    group.items.push(s);
  });
  set($("#oa-nav"), html`${groups.map((g) => html`${g.name ? html`<div class="oa-nav__group">${g.name}</div>` : ""}${g.items.map((s) => html`<a class="oa-nav__link" href="#/${s.name}" data-nav="${s.name}">${icon(s.icon || "box")}<span>${s.title}</span>${s.name === "orders" ? html`<span class="oa-nav__count" data-nav-count hidden></span>` : ""}</a>`)}`)}`);

  // ---- mobile sidebar
  const menu = $("#oa-menu");
  const toggle = (open) => { document.body.classList.toggle("nav-open", open); menu.setAttribute("aria-expanded", String(open)); };
  menu.addEventListener("click", () => toggle(!document.body.classList.contains("nav-open")));
  $("#oa-scrim").addEventListener("click", () => toggle(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("nav-open")) toggle(false); });

  // ---- topbar shadow on scroll
  const topbar = $("#oa-topbar");
  addEventListener("scroll", () => topbar.classList.toggle("is-scrolled", scrollY > 4), { passive: true });

  // ---- logout
  $("#oa-logout").addEventListener("click", async () => {
    if (!(await OA.confirm({ title: "خروج از پنل", message: "از حساب مدیریت خارج می‌شوید؟", confirmText: "خروج" }))) return;
    try { await fetch("/api/authentication/admin/logout", { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } }); } catch (_) {}
    location.href = "/admin/login";
  });

  // ---- notifications
  const bell = $("#oa-bell");
  const panel = $("#oa-notify-panel");
  const dot = $("#oa-bell-dot");
  let last = null;
  async function poll() {
    if (document.hidden) return;
    try {
      const n = await api("/notifications");
      if (last && n.newOrders > last.newOrders) toast(`${num(n.newOrders - last.newOrders)} سفارش جدید ثبت شد`);
      last = n;
      const alerts = n.newOrders + (n.stuckPayments ? 1 : 0) + (n.outOfStock ? 1 : 0);
      dot.hidden = !alerts;
      dot.textContent = n.newOrders ? num(n.newOrders) : "!";
      const navCount = $("[data-nav-count]");
      if (navCount) { navCount.hidden = !n.newOrders; navCount.textContent = num(n.newOrders); }
      drawPanel(n);
    } catch (_) { /* polling errors are silent */ }
  }
  function drawPanel(n) {
    const items = [];
    if (can("manage_orders")) {
      items.push(html`<li><div class="oa-list__main"><b>${n.newOrders ? `${num(n.newOrders)} سفارش جدید` : "سفارش جدیدی نیست"}</b><span>از آخرین بازدید شما</span></div>${n.newOrders ? html`<button class="oa-btn oa-btn--sm" data-seen>دیدم</button>` : ""}</li>`);
      n.latest.forEach((o) => items.push(html`<li class="is-clickable" style="cursor:pointer" data-order="${o._id}"><div class="oa-list__main"><b class="num">${o.OrderNum} · ${money(o.totalPrice)}</b><span>${o.recipientName || ""} · ${o.paymentMethod} · ${ago(o.createdAt)}</span></div></li>`));
      if (n.needsAction) items.push(html`<li style="cursor:pointer" data-go="orders?status=needs_action">${icon("bag")}<div class="oa-list__main"><b>${num(n.needsAction)} سفارش منتظر پردازش/ارسال</b></div></li>`);
      if (n.stuckPayments) items.push(html`<li style="cursor:pointer" data-go="orders?paymentStatus=در حال بررسی">${icon("alert")}<div class="oa-list__main"><b class="oa-warn">${num(n.stuckPayments)} پرداخت با وضعیت نامشخص</b><span>بیش از یک ساعت؛ وضعیت را از درگاه استعلام کنید</span></div></li>`);
    }
    if (n.lowStock || n.outOfStock) items.push(html`<li style="cursor:pointer" data-go="inventory?stock=${n.outOfStock ? "out" : "low"}">${icon("layers")}<div class="oa-list__main"><b>${num(n.outOfStock)} ناموجود · ${num(n.lowStock)} رو به اتمام</b><span>مدیریت موجودی</span></div></li>`);
    set(panel, html`<div class="oa-popover__head">اعلان‌ها</div>${items.length ? html`<ul class="oa-list">${items}</ul>` : OA.empty("اعلانی وجود ندارد", "", "bell")}`);
    $$("[data-order]", panel).forEach((li) => li.addEventListener("click", () => { closePanel(); router.go("orders", [li.dataset.order]); }));
    $$("[data-go]", panel).forEach((li) => li.addEventListener("click", () => { closePanel(); const [name, qs] = li.dataset.go.split("?"); router.go(name, [], Object.fromEntries(new URLSearchParams(qs || ""))); }));
    const seen = $("[data-seen]", panel);
    if (seen) seen.addEventListener("click", async () => { try { await api("/notifications/seen", { method: "POST", body: {} }); last = null; poll(); } catch (e) { OA.fail(e); } });
  }
  const closePanel = () => { panel.classList.remove("is-open"); bell.setAttribute("aria-expanded", "false"); };
  bell.addEventListener("click", (e) => { e.stopPropagation(); const open = !panel.classList.contains("is-open"); panel.classList.toggle("is-open", open); bell.setAttribute("aria-expanded", String(open)); if (open) poll(); });
  document.addEventListener("click", (e) => { if (!e.target.closest("#oa-notify")) closePanel(); });
  poll();
  setInterval(poll, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

  // ---- start
  addEventListener("hashchange", () => router.render());
  router.render();
})();
