/* ODOUR CONTROL — SVG charts. One series per chart (cobalt or teal), real values only.
   Each chart has a hover crosshair/tooltip and an accessible data table. */
(function () {
  "use strict";
  const { html, raw, set, esc, num, compact, empty } = OA;

  const nice = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };

  /** data: [{label, full, value, tip}] · opts: {type:'area'|'line'|'bar', tone:'primary'|'teal', height, format, title, yTitle} */
  function chart(el, data, opts = {}) {
    const type = opts.type || "area";
    const teal = opts.tone === "teal";
    const color = teal ? "#0d9488" : "#4355e8";
    const fmt = opts.format || num;
    if (!data.length || data.every((d) => !Number(d.value))) {
      return set(el, empty({ icon: "chart", title: opts.emptyTitle || "در این بازه داده‌ای ثبت نشده است", text: opts.emptyText || "", compact: true }));
    }
    const W = 760, H = opts.height || 260, P = { t: 18, r: 8, b: 30, l: 64 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b, n = data.length;
    const max = nice(Math.max(0, ...data.map((d) => Number(d.value) || 0)));
    const step = type === "bar" ? iw / n : n > 1 ? iw / (n - 1) : iw;
    // RTL: time runs right → left.
    const x = (i) => (type === "bar" ? P.l + iw - (i + 0.5) * step : n > 1 ? P.l + iw - i * step : P.l + iw / 2);
    const y = (v) => P.t + ih - (v / max) * ih;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
    const every = Math.max(1, Math.ceil(n / 7));
    const gid = `g${Math.random().toString(36).slice(2, 7)}`;
    let marks = "";
    if (type === "bar") {
      const bw = Math.max(2, Math.min(26, step - 3));
      marks = data.map((d, i) => {
        const v = Number(d.value) || 0;
        const h = v > 0 ? Math.max(2, (v / max) * ih) : 0;
        const bx = x(i) - bw / 2, by = P.t + ih - h, r = Math.min(3, bw / 2, h);
        return h ? `<path class="g-bar" data-i="${i}" d="M${bx},${by + h}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + bw - r}Q${bx + bw},${by} ${bx + bw},${by + r}V${by + h}Z"/>` : "";
      }).join("");
    } else {
      const pts = data.map((d, i) => [x(i), y(Number(d.value) || 0)]);
      const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("");
      marks = `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".16"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
        ${type === "area" && n > 1 ? `<path d="${line}L${pts[n - 1][0]},${P.t + ih}L${pts[0][0]},${P.t + ih}Z" fill="url(#${gid})"/>` : ""}
        <path class="g-line" d="${line}"/>
        <line class="g-cross" data-cross y1="${P.t}" y2="${P.t + ih}"/><circle class="g-dot" data-dot r="5"/>`;
    }
    set(el, html`<div class="ox-chart ${teal ? "ox-chart--teal" : ""}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.title || ""}">
        ${raw(ticks.map((t, i) => `<line class="${i ? "g-grid" : "g-base"}" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/><text class="g-axis" x="${P.l - 10}" y="${y(t) + 4}" text-anchor="end">${esc(compact(t))}</text>`).join(""))}
        ${raw(data.map((d, i) => (i % every === 0 || (i === n - 1 && (n - 1) % every > every / 2) ? `<text class="g-axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : "")).join(""))}
        ${raw(marks)}
        <rect data-hit x="${P.l}" y="${P.t}" width="${iw}" height="${ih}" fill="transparent"/>
      </svg>
      <div class="ox-chart__tip" data-tip></div>
    </div>
    <details class="ox-chart-table"><summary>نمایش داده‌ها به صورت جدول</summary><div class="ox-table-wrap"><table class="ox-table"><thead><tr><th>${opts.xTitle || "تاریخ"}</th><th class="col-num">${opts.yTitle || "مقدار"}</th></tr></thead><tbody>${data.map((d) => html`<tr><td>${d.full || d.label}</td><td class="col-num">${fmt(d.value)}</td></tr>`)}</tbody></table></div></details>`);
    const wrap = el.querySelector(".ox-chart"), svg = el.querySelector("svg"), tip = el.querySelector("[data-tip]");
    const cross = el.querySelector("[data-cross]"), dot = el.querySelector("[data-dot]");
    const show = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let i = type === "bar" ? Math.floor((P.l + iw - px) / step) : Math.round((P.l + iw - px) / step);
      i = Math.max(0, Math.min(n - 1, i));
      const d = data[i], v = Number(d.value) || 0, cx = x(i), cy = y(v);
      if (cross) { cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); }
      if (dot) { dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); }
      el.querySelectorAll(".g-bar").forEach((b) => b.classList.toggle("is-dim", Number(b.dataset.i) !== i));
      set(tip, html`<b>${d.tip || fmt(v)}</b><span>${d.full || d.label}</span>`);
      tip.style.left = `${(cx / W) * r.width}px`;
      tip.style.top = `${(cy / H) * r.height}px`;
      tip.classList.add("is-on");
      wrap.classList.add("is-hover");
    };
    const hide = () => { tip.classList.remove("is-on"); wrap.classList.remove("is-hover"); el.querySelectorAll(".g-bar").forEach((b) => b.classList.remove("is-dim")); };
    const hit = el.querySelector("[data-hit]");
    hit.addEventListener("mousemove", show);
    hit.addEventListener("mouseleave", hide);
    hit.addEventListener("touchstart", (e) => show(e.touches[0]), { passive: true });
  }

  // Tiny trend line for KPI cards.
  function spark(values, color = "#4355e8") {
    const v = values.map((x) => Number(x) || 0);
    if (v.length < 2 || v.every((x) => !x)) return raw("");
    const W = 200, H = 40, max = Math.max(...v) || 1;
    const pts = v.map((x, i) => `${W - (i / (v.length - 1)) * W},${H - 3 - (x / max) * (H - 6)}`);
    return raw(`<svg class="ox-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="l" d="M${pts.join("L")}" stroke="${color}"/></svg>`);
  }

  /** Ranked distribution. items: [{label, value, sub, lead}] */
  function dist(el, items, opts = {}) {
    if (!items.length || items.every((i) => !Number(i.value))) return set(el, empty({ icon: opts.icon || "chart", title: opts.emptyTitle || "داده‌ای ثبت نشده است", text: opts.emptyText || "", compact: true }));
    const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
    const fmt = opts.format || num;
    set(el, html`<div class="ox-dist ${opts.tone === "teal" ? "ox-dist--teal" : ""}" role="list">${items.map((i) => html`<div class="ox-dist__row" role="listitem">
      <span class="ox-row ox-row--nowrap" style="gap:8px;min-width:0">${i.lead || ""}<span class="ellipsis" dir="auto" title="${i.label}" style="font-weight:600;font-size:13px">${i.label}</span></span>
      <div class="ox-dist__bar"><span style="width:${((Number(i.value) || 0) / max) * 100}%"></span></div>
      <span class="ox-dist__val">${fmt(i.value)}${i.sub ? html`<small>${i.sub}</small>` : ""}</span></div>`)}</div>`);
  }

  /** Part-to-whole bar with legend. parts: [{label, value, color}] */
  function stack(parts, { onClick } = {}) {
    const total = parts.reduce((s, p) => s + (Number(p.value) || 0), 0);
    const id = `st${Math.random().toString(36).slice(2, 7)}`;
    if (onClick) setTimeout(() => document.querySelectorAll(`#${id} [data-k]`).forEach((b) => b.addEventListener("click", () => onClick(b.dataset.k))));
    return html`<div id="${id}"><div class="ox-stackbar" role="img" aria-label="${parts.map((p) => `${p.label}: ${p.value}`).join("، ")}">${parts.filter((p) => p.value > 0).map((p) => html`<span style="width:${(p.value / (total || 1)) * 100}%;background:${p.color}" title="${p.label}: ${num(p.value)}"></span>`)}</div>
      <ul class="ox-list" style="margin-top:12px">${parts.map((p) => html`<li style="padding:7px 0;border:0;cursor:${onClick ? "pointer" : "default"}" data-k="${p.key || p.label}"><i style="width:10px;height:10px;border-radius:2px;background:${p.color};flex:none"></i><span class="ox-list__main" style="font-size:13px">${p.label}</span><b class="num">${num(p.value)}</b><span class="muted num small" style="width:44px;text-align:end">${total ? OA.pct(p.value / total, 0) : "—"}</span></li>`)}</ul></div>`;
  }

  Object.assign(OA, { chart, spark, dist, stack });
})();
