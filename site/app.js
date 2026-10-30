// Survey dashboard — vanilla JS, no runtime dependencies, no build step.
// Loads ONE pre-aggregated, disclosure-controlled file (data/aggregates.json) and renders it.
//
// Sections:  helpers · tooltip · data access · URL state · controls · tiles · dot plot ·
//            table + CSV · heatmap · about · orchestration
// Most changes (indicators, groups, wording) belong in config/survey.toml, not here.
// See docs/CUSTOMIZING.md → "Changing the website".

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SVGNS = "http://www.w3.org/2000/svg";
let LOCALE = "en-CA";
const fmt1 = (v) => v.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtN = (v) => v.toLocaleString(LOCALE);

const state = { ind: null, by: null, slice: "all", sort: "natural", view: "chart" };
let DEFAULTS;
let DATA, META, IND, DIM;
const FRAMED = (() => { try { return window.top !== window.self; } catch { return true; } })();

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, attrs = {}, ...children) {
  const node = tag.startsWith("svg:") ? document.createElementNS(SVGNS, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.setAttribute("class", v);
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(c));
  return node;
}
const svg = (tag, attrs, ...kids) => el("svg:" + tag, attrs, ...kids);

function sliceLabel(key, { short = false } = {}) {
  if (key === "all") return "All respondents";
  const [d, v] = key.split("=");
  return short ? v : `${DIM[d].label}: ${v}`;
}

function measure(text, font = "13.5px system-ui, -apple-system, 'Segoe UI', sans-serif") {
  const ctx = (measure.ctx ||= document.createElement("canvas").getContext("2d"));
  ctx.font = font;
  return ctx.measureText(text).width;
}

function wrapLabel(text, maxW) {
  if (measure(text) <= maxW) return [text];
  const words = text.split(" ");
  let line = "";
  const lines = [];
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (measure(t) > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  lines.push(line);
  if (lines.length > 2) return [lines[0], lines.slice(1).join(" ")];
  return lines;
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function lum(hex) {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return 1;
  const [r, g, b] = m.map((x) => { const c = parseInt(x, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const inkOn = (bg) => (contrast(bg, "#ffffff") >= contrast(bg, "#0b0b0b") ? "#ffffff" : "#0b0b0b");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

// ── Tooltip (hover, keyboard focus, and tap) ────────────────────────────────
const tip = () => $("#tooltip");
function showTip(target, build) {
  const t = tip();
  t.replaceChildren(...build());
  t.hidden = false;
  const r = target.getBoundingClientRect();
  const tw = t.offsetWidth, th = t.offsetHeight;
  let x = Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2));
  let y = r.top - th - 8;
  if (y < 8) y = r.bottom + 8;
  t.style.left = `${x}px`; t.style.top = `${y}px`;
}
function hideTip() { tip().hidden = true; }
function bindTip(node, build) {
  node.addEventListener("pointerenter", () => showTip(node, build));
  node.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTip(); });
  node.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") { e.stopPropagation(); showTip(node, build); } });
  node.addEventListener("focus", () => showTip(node, build));
  node.addEventListener("blur", hideTip);
}
document.addEventListener("pointerdown", hideTip);
window.addEventListener("scroll", hideTip, { passive: true });

// ── Data access ─────────────────────────────────────────────────────────────
function currentRows() {
  const rows = DATA.tables[`${state.by}|${state.slice}`] || [];
  return rows.map((r) => {
    const est = r.est ? r.est[state.ind] : null;
    return {
      level: r.level, n: r.n, est,
      reason: r.n == null ? "Too few respondents to publish" : est == null ? "Estimate too unreliable to publish" : null,
    };
  });
}
function sliceEst(ind = state.ind) {
  const s = DATA.slices[state.slice];
  return s && s.est ? s.est[ind] : null;
}

// ── URL state ───────────────────────────────────────────────────────────────
function readURL() {
  const p = new URLSearchParams(location.search);
  if (IND[p.get("i")]) state.ind = p.get("i");
  if (DIM[p.get("by")]) state.by = p.get("by");
  const s = p.get("in");
  if (s && DATA.slices[s] && DATA.slices[s].n != null && !s.startsWith(state.by + "=")) state.slice = s;
  if (p.get("sort") === "value") state.sort = "value";
  if (p.get("view") === "table") state.view = "table";
}
function writeURL() {
  const p = new URLSearchParams({ i: state.ind, by: state.by });
  if (state.slice !== "all") p.set("in", state.slice);
  if (state.sort !== "natural") p.set("sort", state.sort);
  if (state.view !== "chart") p.set("view", state.view);
  try { history.replaceState(null, "", `${location.pathname}?${p}`); } catch { /* sandboxed */ }
}

// ── Controls ────────────────────────────────────────────────────────────────
function buildControls() {
  const sel = $("#indicator");
  const themes = [...new Set(META.indicators.map((i) => i.theme))];
  for (const th of themes) {
    const g = el("optgroup", { label: th });
    for (const i of META.indicators.filter((x) => x.theme === th)) g.append(el("option", { value: i.id, text: i.label }));
    sel.append(g);
  }
  sel.addEventListener("change", () => update({ ind: sel.value }));

  const chips = $("#compare");
  for (const d of META.dimensions) {
    chips.append(el("button", {
      type: "button", class: "chip", role: "radio", "data-dim": d.id, text: d.label,
      onclick: () => update({ by: d.id }),
    }));
  }
  chips.addEventListener("keydown", (e) => {
    if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const ids = META.dimensions.map((d) => d.id);
    const i = ids.indexOf(state.by) + (e.key === "ArrowRight" ? 1 : -1);
    update({ by: ids[(i + ids.length) % ids.length] });
    $(`.chip[data-dim="${state.by}"]`).focus();
  });

  $("#slice").addEventListener("change", (e) => update({ slice: e.target.value }));
  $("#reset").addEventListener("click", () => update({ ...DEFAULTS }));
  $("#share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link copied — it opens this exact view"); }
    catch { toast("Copy the page address to share this view"); }
  });

  $$("[data-sort]").forEach((b) => b.addEventListener("click", () => update({ sort: b.dataset.sort })));
  $$("[data-view]").forEach((b) => b.addEventListener("click", () => update({ view: b.dataset.view })));
  $("#download").addEventListener("click", downloadCSV);
  if (FRAMED) { $("#download").textContent = "Copy CSV"; $("#share").hidden = true; }

  // Mobile sheet
  const open = () => {
    $("#controls").classList.add("open"); $("#backdrop").hidden = false;
    $("#open-filters").setAttribute("aria-expanded", "true");
    setTimeout(() => $("#indicator").focus(), 50);
  };
  const close = () => {
    $("#controls").classList.remove("open"); $("#backdrop").hidden = true;
    $("#open-filters").setAttribute("aria-expanded", "false");
  };
  $("#open-filters").addEventListener("click", open);
  $("#close-filters").addEventListener("click", () => { close(); $("#open-filters").focus(); });
  $("#apply-filters").addEventListener("click", () => { close(); $("#open-filters").focus(); });
  $("#backdrop").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function syncControls() {
  $("#indicator").value = state.ind;
  $$(".chip").forEach((c) => c.setAttribute("aria-checked", String(c.dataset.dim === state.by)));
  $$(".chip").forEach((c) => (c.tabIndex = c.dataset.dim === state.by ? 0 : -1));

  const s = $("#slice");
  s.replaceChildren(el("option", { value: "all", text: "All respondents" }));
  for (const d of META.dimensions) {
    if (d.id === state.by) continue;
    const g = el("optgroup", { label: d.label });
    for (const lvl of d.levels) {
      const key = `${d.id}=${lvl}`;
      const ok = DATA.slices[key] && DATA.slices[key].n != null;
      g.append(el("option", { value: key, disabled: !ok, text: ok ? lvl : `${lvl} (too few to show)` }));
    }
    s.append(g);
  }
  s.value = state.slice;

  $$("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)));
  $$("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));

  const st = $("#summary-text");
  st.replaceChildren(el("b", { text: IND[state.ind].short }), el("span", { text: `by ${DIM[state.by].label.toLowerCase()} · ${sliceLabel(state.slice)}` }));
}

// ── Tiles ───────────────────────────────────────────────────────────────────
function renderTiles() {
  const ind = IND[state.ind];
  const est = sliceEst();
  const all = DATA.slices.all.est[state.ind];
  const rows = currentRows().filter((r) => r.est);
  const hidden = currentRows().length - rows.length;
  const tiles = [];

  const heroNote = [];
  if (est) heroNote.push(`95% CI ${fmt1(est[1])}–${fmt1(est[2])}`);
  if (state.slice !== "all" && est && all) {
    const d = est[0] - all[0];
    heroNote.push(`${d >= 0 ? "+" : "−"}${fmt1(Math.abs(d))} pts vs all respondents`);
  }
  tiles.push(el("div", { class: "tile hero" },
    el("p", { class: "tile-label", text: `${ind.short} · ${sliceLabel(state.slice)}` }),
    el("p", { class: "tile-value" }, est ? fmt1(est[0]) : "x", est ? el("small", { text: "%" }) : null, est && est[3] === "E" ? el("span", { class: "flag", text: "E" }) : null),
    el("p", { class: "tile-note", text: est ? heroNote.join(" · ") : "Suppressed for confidentiality" }),
  ));

  if (rows.length) {
    const sorted = [...rows].sort((a, b) => b.est[0] - a.est[0]);
    const [hi, lo] = [sorted[0], sorted[sorted.length - 1]];
    for (const r of [hi, lo]) {
      tiles.push(el("div", { class: "tile" },
        el("p", { class: "tile-label", text: `${r === hi ? "Highest" : "Lowest"} ${DIM[state.by].label.toLowerCase()}` }),
        el("p", { class: "tile-value" }, fmt1(r.est[0]), el("small", { text: "%" })),
        el("p", { class: "tile-note", text: r.level }),
      ));
    }
  }
  const n = DATA.slices[state.slice].n;
  tiles.push(el("div", { class: "tile" },
    el("p", { class: "tile-label", text: "Respondents in view" }),
    el("p", { class: "tile-value", text: n != null ? fmtN(n) : "x" }),
    el("p", { class: "tile-note", text: hidden ? `${hidden} group${hidden > 1 ? "s" : ""} not shown (privacy or reliability)` : "Counts rounded to nearest 5" }),
  ));
  $("#tiles").replaceChildren(...tiles);
}

// ── Dot plot with CIs ───────────────────────────────────────────────────────
function sortedRows() {
  const rows = currentRows();
  if (state.sort === "value") {
    return [...rows].sort((a, b) => (b.est ? b.est[0] : -1) - (a.est ? a.est[0] : -1));
  }
  return rows;
}

function renderDot() {
  const ind = IND[state.ind];
  $("#dot-title").textContent = `${ind.label}, by ${DIM[state.by].label.toLowerCase()}`;
  $("#dot-sub").textContent = `${sliceLabel(state.slice)} · weighted % with 95% confidence interval`;

  const host = $("#dot-chart");
  const card = host.parentElement, cs = getComputedStyle(card);
  const W = Math.max(280, card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const mobile = W < 560;
  const rows = sortedRows();
  const ref = sliceEst();

  const valW = 52;
  const labelMax = Math.min(mobile ? W * 0.36 : 190, Math.max(...rows.map((r) => measure(r.level))) + 4);
  const labelW = labelMax + 12;
  const x0 = labelW, x1 = W - valW - 10;
  const top = 30, rowH = mobile ? 42 : 36;
  const wrapped = rows.map((r) => wrapLabel(r.level, labelMax));
  const heights = wrapped.map((l) => (l.length > 1 ? Math.max(rowH, 44) : rowH));
  const plotBottom = top + heights.reduce((a, b) => a + b, 0) + 4;
  const H = plotBottom + 22;

  const maxV = Math.max(10, ...(ref ? [ref[2]] : []), ...rows.filter((r) => r.est).map((r) => r.est[2]));
  const minV = Math.min(...(ref ? [ref[1]] : []), ...rows.filter((r) => r.est).map((r) => r.est[1]), maxV);
  const niceMax = Math.min(100, Math.ceil(maxV / 10) * 10);
  // Dot plots encode position, not length, so the axis may start above zero to use the width.
  const niceMin = Math.max(0, Math.floor((minV - 2) / 10) * 10);
  const sx = (v) => x0 + ((v - niceMin) / (niceMax - niceMin)) * (x1 - x0);
  const step = [5, 10, 20, 25, 50].find((s) => ((x1 - x0) * s) / (niceMax - niceMin) >= 40) || 50;

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "group", "aria-label": `${ind.label} by ${DIM[state.by].label}` });
  const defs = svg("defs", {},
    svg("pattern", { id: "supp-pattern", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
      svg("rect", { width: 6, height: 6, fill: "var(--surface-2)" }),
      svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--grid)", "stroke-width": 2 })));
  root.append(defs);

  // grid + ticks
  for (let v = Math.ceil(niceMin / step) * step; v <= niceMax; v += step) {
    root.append(svg("line", { class: "gridline", x1: sx(v), x2: sx(v), y1: top - 6, y2: plotBottom }));
    root.append(svg("text", { class: "tick", x: sx(v), y: top - 12, "text-anchor": "middle", text: `${v}%` }));
  }

  let y = top;
  rows.forEach((r, i) => {
    const h = heights[i], cy = y + h / 2;
    const g = svg("g", { class: "row", tabindex: 0, role: "img",
      "aria-label": r.est ? `${r.level}: ${fmt1(r.est[0])}%, 95% confidence interval ${fmt1(r.est[1])} to ${fmt1(r.est[2])}${r.est[3] === "E" ? ", use with caution" : ""}` : `${r.level}: suppressed. ${r.reason}` });
    g.append(svg("rect", { class: "row-bg", x: 0, y, width: W, height: h, rx: 6 }));
    const lines = wrapped[i];
    const lt = svg("text", { class: `lbl${r.est ? "" : " muted"}`, x: 4, y: cy - (lines.length - 1) * 8 + 4.5 });
    lines.forEach((ln, k) => lt.append(svg("tspan", { x: 4, dy: k ? 16 : 0, text: ln })));
    g.append(lt);

    if (r.est) {
      const [p, lo, hi, q] = r.est;
      g.append(svg("line", { class: "ci", x1: sx(lo), x2: sx(hi), y1: cy, y2: cy }));
      g.append(svg("circle", { class: `dot${q === "E" ? " e" : ""}`, cx: sx(p), cy, r: 6 }));
      const vt = svg("text", { class: "val", x: W - 4, y: cy + 4.5, "text-anchor": "end", text: fmt1(p) });
      if (q === "E") vt.append(svg("tspan", { class: "flag", dx: 2, dy: -5, "font-size": 10, text: "E" }));
      g.append(vt);
    } else {
      g.append(svg("rect", { class: "supp-band", x: x0, y: cy - 9, width: x1 - x0, height: 18, rx: 4 }));
      g.append(svg("text", { class: "tick", x: x0 + 8, y: cy + 4, text: mobile ? "Suppressed" : `Suppressed · ${r.reason.toLowerCase()}` }));
      g.append(svg("text", { class: "val muted", x: W - 4, y: cy + 4.5, "text-anchor": "end", text: "x" }));
    }
    g.append(svg("rect", { class: "row-hit", x: 0, y, width: W, height: h }));
    bindTip(g, () => tipContent(r, ref));
    root.append(g);
    y += h;
  });

  // reference line on top
  if (ref) {
    const rx = sx(ref[0]);
    root.append(svg("line", { class: "refline", x1: rx, x2: rx, y1: top - 6, y2: plotBottom + 4 }));
    const label = state.slice === "all" ? `All ${fmt1(ref[0])}` : `Overall ${fmt1(ref[0])}`;
    const lw = measure(label, "600 11.5px system-ui");
    const anchorEnd = rx + lw + 6 > x1;
    root.append(svg("text", { class: "reflabel", x: anchorEnd ? rx - 5 : rx + 5, y: plotBottom + 16, "text-anchor": anchorEnd ? "end" : "start", text: label }));
  }

  host.replaceChildren(root);
  host.hidden = state.view !== "chart";

  const key = $("#dot-key");
  key.replaceChildren(
    el("span", {}, el("i", { class: "k-dot" }), "Estimate"),
    el("span", {}, el("i", { class: "k-ci" }), "95% CI"),
    el("span", {}, el("i", { class: "k-ref" }), state.slice === "all" ? "All respondents" : "Overall for this group"),
    el("span", { text: "E = use with caution · x = suppressed" }),
  );
}

function tipContent(r, ref) {
  const out = [el("div", { class: "tt-name", text: r.level })];
  if (!r.est) {
    out.push(el("div", { class: "tt-val", text: "Suppressed" }), el("div", { class: "tt-row", text: r.reason }));
    return out;
  }
  const [p, lo, hi, q] = r.est;
  out.push(el("div", { class: "tt-val", text: `${fmt1(p)}%` }));
  out.push(el("div", { class: "tt-row", text: `95% CI ${fmt1(lo)}–${fmt1(hi)}` }));
  if (ref) {
    const d = p - ref[0];
    out.push(el("div", { class: "tt-row", text: `${d >= 0 ? "+" : "−"}${fmt1(Math.abs(d))} pts vs ${state.slice === "all" ? "all respondents" : "group overall"}` }));
  }
  out.push(el("div", { class: "tt-row", text: `≈ ${fmtN(r.n)} respondents` }));
  if (q === "E") out.push(el("div", { class: "tt-row", text: "E: high sampling variability — use with caution" }));
  return out;
}

// ── Table view ──────────────────────────────────────────────────────────────
function renderTable() {
  const host = $("#dot-table");
  host.hidden = state.view !== "table";
  if (host.hidden) return;
  const rows = sortedRows();
  const t = el("table", {},
    el("caption", { class: "muted", style: "text-align:left;caption-side:bottom;padding-top:8px;font-size:12.5px", text: "Counts rounded to the nearest 5. x = suppressed. E = use with caution." }),
    el("thead", {}, el("tr", {},
      el("th", { scope: "col", text: DIM[state.by].label }),
      el("th", { scope: "col", class: "num", text: "Estimate (%)" }),
      el("th", { scope: "col", class: "num", text: "95% CI" }),
      el("th", { scope: "col", class: "num", text: "Respondents" }))),
    el("tbody", {}, rows.map((r) => el("tr", {},
      el("th", { scope: "row", text: r.level }),
      el("td", { class: "num" }, r.est ? fmt1(r.est[0]) : "x", r.est && r.est[3] === "E" ? el("span", { class: "flag", text: "E" }) : null),
      el("td", { class: "num", text: r.est ? `${fmt1(r.est[1])}–${fmt1(r.est[2])}` : "" }),
      el("td", { class: "num", text: r.n != null ? fmtN(r.n) : "x" })))));
  host.replaceChildren(t);
}

function downloadCSV() {
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const head = ["indicator", "compare_by", "group", "narrowed_to", "estimate_pct", "ci_low", "ci_high", "quality", "respondents_rounded"];
  const lines = [head.join(",")];
  for (const r of sortedRows()) {
    lines.push([IND[state.ind].label, DIM[state.by].label, r.level, sliceLabel(state.slice),
      r.est ? r.est[0] : "x", r.est ? r.est[1] : "", r.est ? r.est[2] : "", r.est ? r.est[3] : "suppressed", r.n ?? "x"].map(esc).join(","));
  }
  if (FRAMED) {
    // Embedded/sandboxed hosts block downloads: copy instead.
    navigator.clipboard.writeText(lines.join("\n"))
      .then(() => toast("CSV copied — paste into Excel or a text file"))
      .catch(() => toast("Couldn’t copy — try the Table view"));
    return;
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `${state.ind}_by_${state.by}${state.slice === "all" ? "" : "_" + state.slice.replace(/[^A-Za-z0-9]+/g, "-")}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Heatmap: every indicator × every group ──────────────────────────────────
const BINS = [2, 5, 10];
function binFor(diff) {
  const a = Math.abs(diff);
  const k = a < BINS[0] ? 0 : a < BINS[1] ? 1 : a < BINS[2] ? 2 : 3;
  return k === 0 ? "--div-0" : `--div-${diff > 0 ? "b" : "r"}${k}`;
}

function renderHeatmap() {
  $("#heat-sub").textContent = `${DIM[state.by].label} · ${sliceLabel(state.slice)} · weighted %`;
  const legend = $("#heat-legend");
  const sw = (v) => el("span", { class: "sw", style: `background:var(${v})` });
  legend.replaceChildren(
    el("span", { text: "Worse" }),
    el("span", { class: "swatches" }, sw("--div-r3"), sw("--div-r2"), sw("--div-r1"), sw("--div-0"), sw("--div-b1"), sw("--div-b2"), sw("--div-b3")),
    el("span", { text: "Better than overall" }),
    el("span", { class: "muted", text: "(±2, 5, 10 pts)" }),
    el("span", { class: "sw-s" }), el("span", { text: "Suppressed" }),
  );

  const inds = META.indicators;
  const rows = DATA.tables[`${state.by}|${state.slice}`];
  const total = DATA.slices[state.slice];
  const thead = el("thead", {}, el("tr", {},
    el("th", { scope: "col" }, el("span", { class: "muted", style: "font-weight:500", text: DIM[state.by].label })),
    inds.map((i) => el("th", { scope: "col", class: i.id === state.ind ? "active" : null },
      el("button", { type: "button", "aria-pressed": String(i.id === state.ind), text: i.short, onclick: () => {
        update({ ind: i.id });
        const card = $("#dot-title").closest(".card");
        if (card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: "smooth", block: "start" });
      } })))));

  const cell = (level, n, est, ind, isTotal) => {
    const td = el("td", { tabindex: 0 });
    if (!est) {
      td.className = "s"; td.textContent = "x";
    } else {
      const ref = total.est && total.est[ind.id];
      const diff = isTotal || !ref ? 0 : (est[0] - ref[0]) * (ind.better === "higher" ? 1 : -1);
      const v = binFor(diff);
      const bg = cssVar(v);
      td.style.background = `var(${v})`;
      td.style.color = isTotal ? "var(--ink)" : inkOn(bg);
      td.append(fmt1(est[0]));
      if (est[3] === "E") td.append(el("span", { class: "flag", style: "color:inherit", text: "E" }));
    }
    bindTip(td, () => {
      const out = [el("div", { class: "tt-name", text: `${ind.short} · ${level}` })];
      if (!est) { out.push(el("div", { class: "tt-val", text: "Suppressed" })); return out; }
      out.push(el("div", { class: "tt-val", text: `${fmt1(est[0])}%` }), el("div", { class: "tt-row", text: `95% CI ${fmt1(est[1])}–${fmt1(est[2])}` }));
      const ref = total.est && total.est[ind.id];
      if (!isTotal && ref) {
        const d = est[0] - ref[0];
        out.push(el("div", { class: "tt-row", text: `${d >= 0 ? "+" : "−"}${fmt1(Math.abs(d))} pts vs overall (${ind.better} is better)` }));
      }
      if (n != null) out.push(el("div", { class: "tt-row", text: `≈ ${fmtN(n)} respondents` }));
      return out;
    });
    return td;
  };

  const tbody = el("tbody", {},
    el("tr", { class: "total" }, el("th", { scope: "row", text: "Overall" }), inds.map((i) => cell("Overall", total.n, total.est && total.est[i.id], i, true))),
    rows.map((r) => el("tr", {}, el("th", { scope: "row", title: r.level, text: r.level }),
      inds.map((i) => cell(r.level, r.n, r.est && r.est[i.id], i, false)))));

  $("#heatmap").replaceChildren(el("table", { class: "heatmap" }, thead, tbody));
}

// ── About ───────────────────────────────────────────────────────────────────
function renderAbout() {
  const r = META.rules;
  $("#about").replaceChildren(
    el("div", {},
      el("h3", { text: "Only summaries reach this page" }),
      el("p", { text: "Respondent-level answers never leave the secure environment. A build step aggregates them and publishes one small file of percentages and rounded counts — that file is all your browser downloads." }),
      el("div", { class: "pipeline" },
        el("span", { class: "lock", text: "🔒 Microdata" }), el("i", { text: "→" }),
        el("span", { text: "DuckDB build" }), el("i", { text: "→" }),
        el("span", { text: "aggregates.json" }), el("i", { text: "→" }),
        el("span", { text: "This site" }))),
    el("div", {},
      el("h3", { text: "Disclosure rules" }),
      el("ul", {},
        el("li", { text: `Groups with fewer than ${r.min_cell} respondents are hidden (x).` }),
        el("li", { text: `Extra groups are hidden where needed so a hidden value can’t be worked out from the total.` }),
        el("li", { text: `Estimates with fewer than ${r.min_event} people on either side are hidden.` }),
        el("li", { text: `Counts are rounded to the nearest ${r.round_base}.` }))),
    el("div", {},
      el("h3", { text: "Reading the estimates" }),
      el("ul", {},
        el("li", { text: META.weighted ? "Percentages are weighted to represent the population." : "Percentages are unweighted." }),
        el("li", { text: `E: coefficient of variation ${r.cv_e}–${r.cv_f}% — use with caution.` }),
        el("li", { text: `Above ${r.cv_f}% the estimate is too unreliable and is hidden.` }),
        el("li", { text: "Overlapping confidence intervals mean a difference may not be real." }))),
  );
  const d = new Date(META.generated_at);
  $("#footer-meta").textContent = `${META.site.footer || ""} Aggregates generated ${d.toLocaleDateString(LOCALE, { year: "numeric", month: "long", day: "numeric" })}.`.trim();
}

// ── Orchestration ───────────────────────────────────────────────────────────
function update(patch = {}) {
  Object.assign(state, patch);
  if (state.slice !== "all" && state.slice.startsWith(state.by + "=")) state.slice = "all";
  syncControls();
  renderTiles();
  renderDot();
  renderTable();
  renderHeatmap();
  writeURL();
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch { /* storage unavailable */ }
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* ignore */ }
    renderHeatmap(); // cell ink depends on resolved colours
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => DATA && renderHeatmap());
}

async function main() {
  initTheme();
  try {
    DATA = await (await fetch("data/aggregates.json")).json();
  } catch (e) {
    $("#main").prepend(el("p", { class: "card", text: "Couldn’t load the data. Please refresh the page." }));
    throw e;
  }
  META = DATA.meta;
  LOCALE = META.site.locale || "en-CA";
  DEFAULTS = { ind: META.site.default_indicator, by: META.site.default_compare, slice: "all", sort: "natural", view: "chart" };
  Object.assign(state, DEFAULTS);
  document.title = META.site.title;
  $("#site-title").textContent = META.site.title;
  $("#site-eyebrow").textContent = META.site.eyebrow || "";
  $("#site-lede").textContent = META.site.lede || "";
  IND = Object.fromEntries(META.indicators.map((i) => [i.id, i]));
  DIM = Object.fromEntries(META.dimensions.map((d) => [d.id, d]));
  readURL();
  buildControls();
  renderAbout();
  update();
  let lastW = 0;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (w && Math.abs(w - lastW) > 2) { lastW = w; renderDot(); }
  }).observe($("#dot-chart").parentElement);
}

main();
