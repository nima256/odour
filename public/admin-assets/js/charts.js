/* Odour admin — tiny single-series SVG charts (line / bar) with hover tooltips.
   One hue (olive) per chart; titles name the series, so no legend is needed.
   Every chart is paired with a <details> table for screen readers and exact values. */
(function () {
  "use strict";
  const { html, set, num, esc } = OA;

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  const compact = (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return `${num(+(v / 1e9).toFixed(1))} میلیارد`;
    if (a >= 1e6) return `${num(+(v / 1e6).toFixed(1))} م`;
    if (a >= 1e3) return `${num(+(v / 1e3).toFixed(1))} هزار`;
    return num(v);
  };

  /**
   * data: [{ label, value, tip? }]
   * opts: { type: "line"|"bar", height, format(value) → string, ariaLabel }
   */
  function chart(el, data, opts = {}) {
    const type = opts.type || "line";
    const W = 720;
    const H = opts.height || 240;
    const pad = { top: 16, right: 12, bottom: 28, left: 58 };
    const fmt = opts.format || num;
    const values = data.map((d) => Number(d.value) || 0);
    const max = niceMax(Math.max(0, ...values));
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;
    const n = data.length;
    const step = n > 1 ? iw / (type === "bar" ? n : n - 1) : iw;
    // RTL: time flows right → left, matching the reading direction.
    const xAt = (i) => (type === "bar" ? pad.left + iw - (i + 0.5) * step : n > 1 ? pad.left + iw - i * step : pad.left + iw / 2);
    const yAt = (v) => pad.top + ih - (v / max) * ih;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
    const labelEvery = Math.max(1, Math.ceil(n / 8));

    let marks = "";
    if (type === "bar") {
      const bw = Math.max(2, Math.min(28, step - 2)); // 2px gap between adjacent bars
      marks = data.map((d, i) => {
        const v = Number(d.value) || 0;
        const h = Math.max(v > 0 ? 2 : 0, (v / max) * ih);
        const x = xAt(i) - bw / 2;
        const y = pad.top + ih - h;
        const r = Math.min(4, bw / 2, h);
        // rounded data-end (top), square at the baseline
        return `<path class="bar" data-i="${i}" d="M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z"/>`;
      }).join("");
    } else {
      const pts = data.map((d, i) => `${xAt(i)},${yAt(Number(d.value) || 0)}`);
      marks = `<defs><linearGradient id="oa-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#777c63" stop-opacity=".18"/><stop offset="1" stop-color="#777c63" stop-opacity="0"/></linearGradient></defs>
        ${n > 1 ? `<path class="area" d="M${pts.join("L")}L${xAt(n - 1)},${pad.top + ih}L${xAt(0)},${pad.top + ih}Z"/>` : ""}
        <path class="line" d="M${pts.join("L")}"/>
        <line class="cross" data-cross y1="${pad.top}" y2="${pad.top + ih}" x1="-10" x2="-10"/>
        <circle class="dot" data-dot r="4.5" cx="-10" cy="-10"/>`;
    }

    set(el, html`<div class="oa-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.ariaLabel || ""}">
        ${OA.raw(ticks.map((t) => `<line class="grid" x1="${pad.left}" x2="${W - pad.right}" y1="${yAt(t)}" y2="${yAt(t)}"/><text class="axis" x="${pad.left - 8}" y="${yAt(t) + 4}" text-anchor="end">${esc(compact(t))}</text>`).join(""))}
        ${OA.raw(data.map((d, i) => (i % labelEvery === 0 || (i === n - 1 && (n - 1) % labelEvery >= labelEvery / 2) ? `<text class="axis" x="${xAt(i)}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : "")).join(""))}
        ${OA.raw(marks)}
        <rect data-hit x="${pad.left}" y="${pad.top}" width="${iw}" height="${ih}" fill="transparent"/>
      </svg>
      <div class="oa-chart__tip" data-tip></div>
    </div>
    <details style="margin-top:6px"><summary class="oa-muted" style="font-size:12px;cursor:pointer">نمایش جدول داده‌ها</summary>
      <div class="oa-table-wrap" style="max-height:260px;overflow:auto;margin-top:8px"><table class="oa-table"><thead><tr><th>${opts.xTitle || "تاریخ"}</th><th>${opts.yTitle || "مقدار"}</th></tr></thead>
      <tbody>${data.map((d) => html`<tr><td>${d.label}</td><td class="num">${fmt(d.value)}</td></tr>`)}</tbody></table></div>
    </details>`);

    const svg = el.querySelector("svg");
    const tip = el.querySelector("[data-tip]");
    const hit = el.querySelector("[data-hit]");
    const cross = el.querySelector("[data-cross]");
    const dot = el.querySelector("[data-dot]");
    const show = (evt) => {
      const rect = svg.getBoundingClientRect();
      const scale = W / rect.width;
      const x = (evt.clientX - rect.left) * scale;
      let i = type === "bar" ? Math.floor((pad.left + iw - x) / step) : Math.round((pad.left + iw - x) / step);
      i = Math.max(0, Math.min(n - 1, i));
      const d = data[i];
      if (!d) return;
      const v = Number(d.value) || 0;
      const cx = xAt(i);
      const cy = type === "bar" ? yAt(v) : yAt(v);
      if (cross) { cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); }
      if (dot) { dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); }
      if (type === "bar") el.querySelectorAll(".bar").forEach((b) => b.classList.toggle("is-dim", Number(b.dataset.i) !== i));
      set(tip, html`<b>${d.tip || fmt(v)}</b>${d.full || d.label}`);
      tip.style.left = `${(cx / W) * rect.width - rect.width / 2 + rect.width / 2}px`;
      tip.style.top = `${(cy / H) * rect.height}px`;
      tip.style.transform = "translate(-50%, -115%)";
      tip.classList.add("is-on");
      el.querySelector(".oa-chart").classList.add("is-hover");
    };
    const hide = () => {
      tip.classList.remove("is-on");
      el.querySelector(".oa-chart").classList.remove("is-hover");
      if (cross) { cross.setAttribute("x1", -10); cross.setAttribute("x2", -10); }
      if (dot) dot.setAttribute("cx", -10);
      el.querySelectorAll(".bar").forEach((b) => b.classList.remove("is-dim"));
    };
    hit.addEventListener("mousemove", show);
    hit.addEventListener("touchstart", (e) => show(e.touches[0]), { passive: true });
    hit.addEventListener("mouseleave", hide);
  }

  // Horizontal bars for ranked categories (sources, pages…). items: [{ label, value, sub? }]
  function hbars(el, items, opts = {}) {
    const fmt = opts.format || num;
    const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
    if (!items.length) return set(el, OA.empty(opts.emptyTitle || "داده‌ای برای این بازه ثبت نشده است", opts.emptyText || "", "chart"));
    set(el, html`<div class="oa-hbars" role="list">${items.map((i) => html`<div class="oa-hbar" role="listitem">
      <span title="${i.label}" dir="auto" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:start">${i.label}</span>
      <div class="oa-hbar__track"><div class="oa-hbar__fill" style="width:${((Number(i.value) || 0) / max) * 100}%"></div></div>
      <span class="oa-hbar__val">${fmt(i.value)}${i.sub ? html` <span class="oa-muted" style="font-size:11.5px">${i.sub}</span>` : ""}</span>
    </div>`)}</div>`);
  }

  OA.chart = chart;
  OA.hbars = hbars;
  OA.compact = compact;
})();
