// Survey dashboard — vanilla JS, no runtime dependencies, no build step.
// Loads ONE pre-aggregated, disclosure-controlled file (data/aggregates.json) and renders it.
//
// Sections:  i18n · helpers · status & tooltip · data access · URL state · filters (incl. the
//            mobile modal sheet) · tiles · dot plot · table + CSV · heatmap · about · orchestration
//
// Accessibility notes (see docs/ACCESSIBILITY.md):
//   • Every visual has a text equivalent: chart rows carry full accessible names, the Table view
//     repeats the chart, heatmap cells carry screen-reader text for better/worse/suppressed.
//   • Re-renders keep keyboard focus where it was (see data-fk + restoreFocus).
//   • Changes are announced through one polite live region (#status), not by re-reading content.
//
// Most changes (indicators, groups, wording) belong in config/survey.toml, interface text in i18n.js.

import { STRINGS, LOCALES, NATIVE_NAMES } from "./i18n.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SVGNS = "http://www.w3.org/2000/svg";

const state = { lang: "en", ind: null, by: null, slice: "all", sort: "natural", view: "chart" };
let DEFAULTS, DATA, META, IND, DIM;
let activeRow = null; // level shown as the focusable row in the dot chart (roving tabindex)
const FRAMED = (() => { try { return window.top !== window.self; } catch { return true; } })();
const mobileMQ = matchMedia("(max-width: 720px)");

// ── i18n ────────────────────────────────────────────────────────────────────
function t(key, vars = {}) {
  let s = STRINGS[state.lang]?.[key] ?? STRINGS.en[key] ?? key;
  if (typeof s !== "string") return s;
  return typo(s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? "")));
}
// French typography: non-breaking spaces before : ; % $ and inside numbers (30 000 $),
// so values never wrap mid-number.
function typo(s) {
  if (state.lang !== "fr" || typeof s !== "string") return s;
  return s.replace(/ ([:;%$])/g, "\u00a0$1").replace(/(\d) (?=\d{3}\b)/g, "$1\u00a0");
}
const L = (obj) => typo(obj && typeof obj === "object" ? obj[state.lang] ?? obj[META.site.default_language] ?? "" : obj ?? "");
const locale = () => LOCALES[state.lang] || "en-CA";
const fmt1 = (v) => v.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtN = (v) => v.toLocaleString(locale());
const pct = (v) => t("pct", { v: fmt1(v) });
const signed = (d) => `${d >= 0 ? "+" : "−"}${fmt1(Math.abs(d))}`;
const levelLabel = (dim, value) => L(DIM[dim].level_labels?.[value]) || value;
const dimLabel = (dim) => L(DIM[dim].label);
const indLabel = (id, k = "label") => L(IND[id][k]);

function sliceLabel(key) {
  if (key === "all") return t("allRespondents");
  const [d, v] = splitSlice(key);
  return t("sliceFmt", { dim: dimLabel(d), level: levelLabel(d, v) });
}
const splitSlice = (key) => { const i = key.indexOf("="); return [key.slice(0, i), key.slice(i + 1)]; };

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, attrs = {}, ...children) {
  const node = tag.startsWith("svg:") ? document.createElementNS(SVGNS, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.setAttribute("class", v);
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(c));
  return node;
}
const svg = (tag, attrs, ...kids) => el("svg:" + tag, attrs, ...kids);
const srOnly = (text) => el("span", { class: "sr-only", text });

function measure(text, font = "13.5px system-ui, -apple-system, 'Segoe UI', sans-serif") {
  const ctx = (measure.ctx ||= document.createElement("canvas").getContext("2d"));
  ctx.font = font;
  return ctx.measureText(text).width;
}
function wrapLabel(text, maxW) {
  if (measure(text) <= maxW) return [text];
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const tt = line ? `${line} ${w}` : w;
    if (measure(tt) > maxW && line) { lines.push(line); line = w; } else line = tt;
  }
  lines.push(line);
  return lines.length > 3 ? [lines[0], lines[1], lines.slice(2).join(" ")] : lines;
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

// Keep focus on "the same thing" across re-renders: elements carry data-fk keys.
function focusKey() { return document.activeElement?.closest?.("[data-fk]")?.dataset.fk || null; }
function restoreFocus(key) {
  if (!key) return;
  const target = document.querySelector(`[data-fk="${CSS.escape(key)}"]`);
  if (target && target !== document.activeElement) target.focus({ preventScroll: true });
}

// ── Status (screen readers) & visual toast ──────────────────────────────────
function announce(msg) {
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => {
    const s = $("#status");
    s.textContent = "";
    requestAnimationFrame(() => (s.textContent = msg));
  }, 350);
}
function toast(msg) {
  const tt = $("#toast");
  tt.textContent = msg; tt.hidden = false;
  announce(msg);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (tt.hidden = true), 4000);
}

// ── Tooltip ─────────────────────────────────────────────────────────────────
// Visual enhancement only: everything it shows is also in the mark's accessible name and
// in the Table view. Meets WCAG 1.4.13: dismissible (Esc), hoverable, persistent.
const tip = () => $("#tooltip");
let tipOwner = null, tipHideTimer = null;
function showTip(target, build) {
  clearTimeout(tipHideTimer);
  const tt = tip();
  tt.replaceChildren(...build());
  tt.hidden = false;
  tipOwner = target;
  const r = target.getBoundingClientRect();
  const tw = tt.offsetWidth, th = tt.offsetHeight;
  const x = Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2));
  let y = r.top - th - 8;
  if (y < 8) y = r.bottom + 8;
  tt.style.left = `${x}px`; tt.style.top = `${y}px`;
}
function hideTip(now = false) {
  clearTimeout(tipHideTimer);
  const go = () => { tip().hidden = true; tipOwner = null; };
  if (now) go(); else tipHideTimer = setTimeout(go, 250);
}
function bindTip(node, build) {
  node.addEventListener("pointerenter", () => showTip(node, build));
  node.addEventListener("pointerleave", () => hideTip());
  node.addEventListener("focus", () => showTip(node, build));
  node.addEventListener("blur", () => hideTip(true));
}
function initTooltip() {
  const tt = tip();
  tt.addEventListener("pointerenter", () => clearTimeout(tipHideTimer));
  tt.addEventListener("pointerleave", () => hideTip());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !tt.hidden) { hideTip(true); e.stopPropagation(); } }, true);
  document.addEventListener("pointerdown", (e) => { if (!tt.contains(e.target) && !tipOwner?.contains(e.target)) hideTip(true); });
  window.addEventListener("scroll", () => hideTip(true), { passive: true });
}

// ── Data access ─────────────────────────────────────────────────────────────
function currentRows() {
  const rows = DATA.tables[`${state.by}|${state.slice}`] || [];
  return rows.map((r) => {
    const est = r.est ? r.est[state.ind] : null;
    return {
      level: r.level, label: levelLabel(state.by, r.level), n: r.n, est,
      reason: r.n == null ? t("reasonSmall") : est == null ? t("reasonUnreliable") : null,
    };
  });
}
function sliceEst(ind = state.ind) {
  const s = DATA.slices[state.slice];
  return s && s.est ? s.est[ind] : null;
}
function sortedRows() {
  const rows = currentRows();
  if (state.sort !== "value") return rows;
  return [...rows].sort((a, b) => (b.est ? b.est[0] : -1) - (a.est ? a.est[0] : -1));
}

// ── URL state ───────────────────────────────────────────────────────────────
function pickLanguage(p) {
  const langs = META.site.languages;
  const fromUrl = p.get("lang");
  if (langs.includes(fromUrl)) return fromUrl;
  let saved = null;
  try { saved = localStorage.getItem("lang"); } catch { /* storage unavailable */ }
  if (langs.includes(saved)) return saved;
  const nav = (navigator.languages || [navigator.language]).map((x) => (x || "").slice(0, 2).toLowerCase());
  return nav.find((x) => langs.includes(x)) || META.site.default_language;
}
function readURL() {
  const p = new URLSearchParams(location.search);
  state.lang = pickLanguage(p);
  if (IND[p.get("i")]) state.ind = p.get("i");
  if (DIM[p.get("by")]) state.by = p.get("by");
  const s = p.get("in");
  if (s && DATA.slices[s] && DATA.slices[s].n != null && !s.startsWith(state.by + "=")) state.slice = s;
  if (p.get("sort") === "value") state.sort = "value";
  if (p.get("view") === "table") state.view = "table";
}
function urlFor(overrides = {}) {
  const st = { ...state, ...overrides };
  const p = new URLSearchParams({ lang: st.lang, i: st.ind, by: st.by });
  if (st.slice !== "all") p.set("in", st.slice);
  if (st.sort !== "natural") p.set("sort", st.sort);
  if (st.view !== "chart") p.set("view", st.view);
  return `${location.pathname}?${p}`;
}
function writeURL() {
  try { history.replaceState(null, "", urlFor()); } catch { /* sandboxed */ }
}

// ── Static text & language switch ──────────────────────────────────────────
function applyStaticText() {
  document.documentElement.lang = state.lang;
  document.title = L(META.site.title);
  $$("[data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
  $("#site-title").textContent = L(META.site.title);
  $("#site-eyebrow").textContent = L(META.site.eyebrow);
  $("#site-lede").textContent = L(META.site.lede);
  $("#sort-group").setAttribute("aria-label", t("sortOrder"));
  $("#view-group").setAttribute("aria-label", t("view"));
  $("#download").textContent = FRAMED ? t("copyCsv") : t("downloadCsv");

  // Language switch: link(s) to the other language(s), each marked with its own language.
  const others = META.site.languages.filter((x) => x !== state.lang);
  const btn = $("#lang-toggle");
  if (others.length) {
    const other = others[0];
    btn.hidden = false;
    btn.textContent = NATIVE_NAMES[other] || other.toUpperCase();
    btn.lang = other;
    btn.hreflang = other;
    btn.href = urlFor({ lang: other });
  }
}
function setLanguage(lang) {
  state.lang = lang;
  try { localStorage.setItem("lang", lang); } catch { /* ignore */ }
  applyStaticText();
  buildControls();
  renderAbout();
  update();
}

// ── Filters ─────────────────────────────────────────────────────────────────
function buildControls() {
  const sel = $("#indicator");
  sel.replaceChildren();
  const themes = [...new Set(META.indicators.map((i) => L(i.theme)))];
  for (const th of themes) {
    const g = el("optgroup", { label: th });
    for (const i of META.indicators.filter((x) => L(x.theme) === th)) g.append(el("option", { value: i.id, text: L(i.label) }));
    sel.append(g);
  }

  const chips = $("#compare");
  chips.replaceChildren(...META.dimensions.map((d) => el("button", {
    type: "button", class: "chip", role: "radio", "data-dim": d.id, "data-fk": `chip-${d.id}`, text: L(d.label),
    onclick: () => update({ by: d.id }),
  })));
}

function initControls() {
  $("#indicator").addEventListener("change", (e) => update({ ind: e.target.value }));
  $("#slice").addEventListener("change", (e) => update({ slice: e.target.value }));

  // Radio group keyboard pattern (WAI-ARIA APG): arrows move and select, Home/End jump.
  $("#compare").addEventListener("keydown", (e) => {
    const ids = META.dimensions.map((d) => d.id);
    let i = ids.indexOf(state.by);
    if (["ArrowRight", "ArrowDown"].includes(e.key)) i = (i + 1) % ids.length;
    else if (["ArrowLeft", "ArrowUp"].includes(e.key)) i = (i - 1 + ids.length) % ids.length;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = ids.length - 1;
    else return;
    e.preventDefault();
    update({ by: ids[i] });
    $(`.chip[data-dim="${ids[i]}"]`).focus();
  });

  $("#reset").addEventListener("click", () => update({ ...DEFAULTS }));
  $("#share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast(t("linkCopied")); }
    catch { toast(t("linkCopyFail")); }
  });
  if (FRAMED) $("#share").hidden = true;

  $$("[data-sort]").forEach((b) => b.addEventListener("click", () => update({ sort: b.dataset.sort })));
  $$("[data-view]").forEach((b) => b.addEventListener("click", () => update({ view: b.dataset.view })));
  $("#download").addEventListener("click", downloadCSV);
  $("#lang-toggle").addEventListener("click", (e) => {
    e.preventDefault();
    const other = META.site.languages.find((x) => x !== state.lang);
    setLanguage(other);
    $("#lang-toggle").focus();
  });

  // Small screens: filters open as a modal dialog (focus moves in, rest of page is inert,
  // Escape closes, focus returns to the button that opened it).
  const sheet = $("#controls");
  const outside = () => [$(".site-header"), $("#summary-bar"), $("#main"), $(".site-footer"), $(".skip")];
  const open = () => {
    sheet.classList.add("open");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    $("#backdrop").hidden = false;
    $("#open-filters").setAttribute("aria-expanded", "true");
    outside().forEach((n) => n && (n.inert = true));
    setTimeout(() => $("#indicator").focus(), 60);
  };
  const close = (returnFocus = true) => {
    if (!sheet.classList.contains("open")) return;
    sheet.classList.remove("open");
    sheet.removeAttribute("role");
    sheet.removeAttribute("aria-modal");
    $("#backdrop").hidden = true;
    $("#open-filters").setAttribute("aria-expanded", "false");
    outside().forEach((n) => n && (n.inert = false));
    if (returnFocus) $("#open-filters").focus();
  };
  $("#open-filters").addEventListener("click", open);
  $("#close-filters").addEventListener("click", () => close());
  $("#apply-filters").addEventListener("click", () => close());
  $("#backdrop").addEventListener("click", () => close());
  sheet.addEventListener("keydown", (e) => {
    if (!sheet.classList.contains("open")) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    // Keep Tab / Shift+Tab cycling inside the dialog.
    const items = $$("button, select, a[href], [tabindex='0']", sheet).filter((n) => !n.disabled && n.offsetParent !== null);
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  mobileMQ.addEventListener("change", () => close(false));
}

function syncControls() {
  $("#indicator").value = state.ind;
  $$(".chip").forEach((c) => {
    const on = c.dataset.dim === state.by;
    c.setAttribute("aria-checked", String(on));
    c.tabIndex = on ? 0 : -1;
  });

  const s = $("#slice");
  s.replaceChildren(el("option", { value: "all", text: t("allRespondents") }));
  for (const d of META.dimensions) {
    if (d.id === state.by) continue;
    const g = el("optgroup", { label: L(d.label) });
    for (const lvl of d.levels) {
      const key = `${d.id}=${lvl}`;
      const ok = DATA.slices[key] && DATA.slices[key].n != null;
      const name = levelLabel(d.id, lvl);
      g.append(el("option", { value: key, disabled: !ok, text: ok ? name : t("tooFew", { level: name }) }));
    }
    s.append(g);
  }
  s.value = state.slice;

  $$("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)));
  $$("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));

  $("#summary-text").replaceChildren(
    el("b", { text: indLabel(state.ind, "short") }),
    el("span", { text: `${dimLabel(state.by)} · ${sliceLabel(state.slice)}` }),
  );
}

// ── Tiles ───────────────────────────────────────────────────────────────────
function valueNode(v, flag) {
  const [, num, suffix] = pct(v).match(/^(.*?)(\s?%)$/) || [null, pct(v), ""];
  return [num, el("small", { text: suffix }), flag === "E" ? [el("span", { class: "flag", "aria-hidden": "true", text: "E" }), srOnly(` (${t("srCaution")})`)] : null];
}
function renderTiles() {
  const est = sliceEst();
  const all = DATA.slices.all.est[state.ind];
  const rows = currentRows();
  const shown = rows.filter((r) => r.est);
  const hidden = rows.length - shown.length;
  const tiles = [];

  const note = [];
  if (est) note.push(t("ci", { lo: fmt1(est[1]), hi: fmt1(est[2]) }));
  if (state.slice !== "all" && est && all) note.push(t("vsAll", { diff: signed(est[0] - all[0]) }));
  tiles.push(el("div", { class: "tile hero" },
    el("p", { class: "tile-label", text: `${indLabel(state.ind, "short")} · ${sliceLabel(state.slice)}` }),
    el("p", { class: "tile-value" }, est ? valueNode(est[0], est[3]) : [el("span", { "aria-hidden": "true", text: "x" }), srOnly(t("srSuppressed"))]),
    el("p", { class: "tile-note", text: est ? note.join(" · ") : t("suppressedForConf") }),
  ));

  if (shown.length) {
    const sorted = [...shown].sort((a, b) => b.est[0] - a.est[0]);
    for (const [r, key] of [[sorted[0], "highest"], [sorted[sorted.length - 1], "lowest"]]) {
      tiles.push(el("div", { class: "tile" },
        el("p", { class: "tile-label", text: t(key) }),
        el("p", { class: "tile-value" }, valueNode(r.est[0], r.est[3])),
        el("p", { class: "tile-note", text: r.label }),
      ));
    }
  }
  const n = DATA.slices[state.slice].n;
  tiles.push(el("div", { class: "tile" },
    el("p", { class: "tile-label", text: t("respondentsInView") }),
    el("p", { class: "tile-value", text: n != null ? fmtN(n) : "x" }),
    el("p", { class: "tile-note", text: hidden ? (hidden === 1 ? t("hiddenOne") : t("hiddenMany", { n: hidden })) : t("countsRounded") }),
  ));
  $("#tiles").replaceChildren(...tiles);
}

// ── Dot plot with confidence intervals ──────────────────────────────────────
function rowName(r, ref) {
  if (!r.est) return t("rowSuppressed", { level: r.label, reason: r.reason });
  const [p, lo, hi, q] = r.est;
  const diff = ref ? t(state.slice === "all" ? "diffAll" : "diffGroup", { diff: signed(p - ref[0]) }) : "";
  return t("rowLabel", { level: r.label, p: pct(p), lo: fmt1(lo), hi: fmt1(hi), caution: q === "E" ? t("caution") : "", diff });
}

function renderDot() {
  $("#dot-title").textContent = indLabel(state.ind);
  $("#dot-sub").textContent = t("comparedBy", { dim: dimLabel(state.by), slice: sliceLabel(state.slice) });

  const host = $("#dot-chart");
  const card = host.parentElement, cs = getComputedStyle(card);
  const W = Math.max(240, card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const mobile = W < 560;
  const rows = sortedRows();
  const ref = sliceEst();
  if (!rows.some((r) => r.level === activeRow)) activeRow = rows[0]?.level;

  const valW = state.lang === "fr" ? 64 : 56;
  const labelMax = Math.min(mobile ? W * 0.36 : 210, Math.max(...rows.map((r) => measure(r.label))) + 4);
  const labelW = labelMax + 12;
  const x0 = labelW, x1 = W - valW - 10;
  const top = 30, rowH = mobile ? 44 : 36;
  const wrapped = rows.map((r) => wrapLabel(r.label, labelMax));
  const heights = wrapped.map((l) => Math.max(rowH, 16 * l.length + 14));
  const plotBottom = top + heights.reduce((a, b) => a + b, 0) + 4;
  const H = plotBottom + 22;

  const maxV = Math.max(10, ...(ref ? [ref[2]] : []), ...rows.filter((r) => r.est).map((r) => r.est[2]));
  const minV = Math.min(...(ref ? [ref[1]] : []), ...rows.filter((r) => r.est).map((r) => r.est[1]), maxV);
  const niceMax = Math.min(100, Math.ceil(maxV / 10) * 10);
  // Dot plots encode position, not length, so the axis may start above zero to use the width.
  const niceMin = Math.max(0, Math.floor((minV - 2) / 10) * 10);
  const sx = (v) => x0 + ((v - niceMin) / (niceMax - niceMin)) * (x1 - x0);
  const step = [5, 10, 20, 25, 50].find((s) => ((x1 - x0) * s) / (niceMax - niceMin) >= 44) || 50;

  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "group",
    "aria-label": t("chartLabel", { indicator: indLabel(state.ind), dim: dimLabel(state.by) }),
    "aria-describedby": "chart-help",
  });
  root.append(svg("defs", {},
    svg("pattern", { id: "supp-pattern", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
      svg("rect", { width: 6, height: 6, fill: "var(--surface-2)" }),
      svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--grid)", "stroke-width": 2 }))));

  const axis = svg("g", { "aria-hidden": "true" });
  for (let v = Math.ceil(niceMin / step) * step; v <= niceMax; v += step) {
    axis.append(svg("line", { class: "gridline", x1: sx(v), x2: sx(v), y1: top - 6, y2: plotBottom }));
    axis.append(svg("text", { class: "tick", x: sx(v), y: top - 12, "text-anchor": "middle", text: t("pct", { v: v.toLocaleString(locale()) }) }));
  }
  root.append(axis);

  let y = top;
  rows.forEach((r, i) => {
    const h = heights[i], cy = y + h / 2;
    const g = svg("g", {
      class: "row", role: "img", tabindex: r.level === activeRow ? 0 : -1,
      "aria-label": rowName(r, ref), "data-level": r.level, "data-fk": `row-${r.level}`,
    });
    g.append(svg("rect", { class: "row-bg", x: 0, y, width: W, height: h, rx: 6 }));
    const lines = wrapped[i];
    const lt = svg("text", { class: `lbl${r.est ? "" : " muted"}`, x: 4, y: cy - (lines.length - 1) * 8 + 4.5, "aria-hidden": "true" });
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
      g.append(svg("text", { class: "tick", x: x0 + 8, y: cy + 4, text: mobile ? t("suppressed") : `${t("suppressed")} · ${r.reason}` }));
      g.append(svg("text", { class: "val muted", x: W - 4, y: cy + 4.5, "text-anchor": "end", text: "x" }));
    }
    g.append(svg("rect", { class: "row-hit", x: 0, y, width: W, height: h }));
    g.addEventListener("focus", () => { activeRow = r.level; $$(".row", root).forEach((o) => (o.tabIndex = o === g ? 0 : -1)); });
    bindTip(g, () => tipContent(r, ref));
    root.append(g);
    y += h;
  });

  if (ref) {
    const rx = sx(ref[0]);
    const label = t(state.slice === "all" ? "refAll" : "refGroup", { v: fmt1(ref[0]) });
    const lw = measure(label, "600 11.5px system-ui");
    const anchorEnd = rx + lw + 6 > x1;
    root.append(svg("g", { "aria-hidden": "true" },
      svg("line", { class: "refline", x1: rx, x2: rx, y1: top - 6, y2: plotBottom + 4 }),
      svg("text", { class: "reflabel", x: anchorEnd ? rx - 5 : rx + 5, y: plotBottom + 16, "text-anchor": anchorEnd ? "end" : "start", text: label })));
  }

  // Roving focus between rows (one Tab stop for the whole chart).
  root.addEventListener("keydown", (e) => {
    const all = $$(".row", root);
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    let j = i;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") j = Math.min(all.length - 1, i + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") j = Math.max(0, i - 1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = all.length - 1;
    else return;
    e.preventDefault();
    all[j].focus();
  });

  host.replaceChildren(root);
  host.hidden = state.view !== "chart";

  $("#dot-key").replaceChildren(
    el("span", {}, el("i", { class: "k-dot", "aria-hidden": "true" }), t("keyEstimate")),
    el("span", {}, el("i", { class: "k-ci", "aria-hidden": "true" }), t("keyCI")),
    el("span", {}, el("i", { class: "k-ref", "aria-hidden": "true" }), t(state.slice === "all" ? "keyRefAll" : "keyRefGroup")),
    el("span", { text: t("keyFlags") }),
  );
}

function tipContent(r, ref) {
  const out = [el("div", { class: "tt-name", text: r.label })];
  if (!r.est) {
    out.push(el("div", { class: "tt-val", text: t("suppressed") }), el("div", { class: "tt-row", text: r.reason }));
    return out;
  }
  const [p, lo, hi, q] = r.est;
  out.push(el("div", { class: "tt-val", text: pct(p) }));
  out.push(el("div", { class: "tt-row", text: t("ci", { lo: fmt1(lo), hi: fmt1(hi) }) }));
  if (ref) out.push(el("div", { class: "tt-row", text: t(state.slice === "all" ? "vsAll" : "vsGroup", { diff: signed(p - ref[0]) }) }));
  out.push(el("div", { class: "tt-row", text: t("approxRespondents", { n: fmtN(r.n) }) }));
  if (q === "E") out.push(el("div", { class: "tt-row", text: t("eFlagTip") }));
  return out;
}

// ── Table view & CSV ────────────────────────────────────────────────────────
function cellValue(est) {
  if (!est) return [el("span", { "aria-hidden": "true", text: "x" }), srOnly(t("srSuppressed"))];
  return [fmt1(est[0]), est[3] === "E" ? [el("span", { class: "flag", "aria-hidden": "true", text: "E" }), srOnly(` (${t("srCaution")})`)] : null];
}
function renderTable() {
  const host = $("#dot-table");
  host.hidden = state.view !== "table";
  if (host.hidden) return;
  const rows = sortedRows();
  const caption = t("tableCaption", { indicator: indLabel(state.ind), dim: dimLabel(state.by), slice: sliceLabel(state.slice) });
  host.setAttribute("role", "region");
  host.setAttribute("tabindex", "0");
  host.setAttribute("aria-label", t("scrollRegion", { name: caption }));
  host.replaceChildren(
    el("table", {},
      el("caption", { class: "sr-only", text: caption }),
      el("thead", {}, el("tr", {},
        el("th", { scope: "col", text: dimLabel(state.by) }),
        el("th", { scope: "col", class: "num", text: t("colEstimate") }),
        el("th", { scope: "col", class: "num", text: t("colCI") }),
        el("th", { scope: "col", class: "num", text: t("colRespondents") }))),
      el("tbody", {}, rows.map((r) => el("tr", {},
        el("th", { scope: "row", text: r.label }),
        el("td", { class: "num" }, cellValue(r.est)),
        el("td", { class: "num", text: r.est ? `${fmt1(r.est[1])}–${fmt1(r.est[2])}` : "" }),
        el("td", { class: "num" }, r.n != null ? fmtN(r.n) : [el("span", { "aria-hidden": "true", text: "x" }), srOnly(t("srSuppressed"))]))))),
    el("p", { class: "key", text: t("tableNote") }),
  );
}

function downloadCSV() {
  // Machine-friendly: "." decimals and "," separators in every language; labels are localized.
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [t("csvHeaders").join(",")];
  for (const r of sortedRows()) {
    lines.push([indLabel(state.ind), dimLabel(state.by), r.label, sliceLabel(state.slice),
      r.est ? r.est[0] : "x", r.est ? r.est[1] : "", r.est ? r.est[2] : "", r.est ? r.est[3] : t("csvSuppressed"), r.n ?? "x"].map(esc).join(","));
  }
  const text = "﻿" + lines.join("\n"); // BOM so Excel reads accents correctly
  if (FRAMED) {
    navigator.clipboard.writeText(lines.join("\n")).then(() => toast(t("csvCopied")), () => toast(t("csvCopyFail")));
    return;
  }
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const name = `${state.ind}_${state.by}${state.slice === "all" ? "" : "_" + state.slice.replace(/[^A-Za-z0-9]+/g, "-")}_${state.lang}.csv`;
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Heatmap: every indicator × every group ──────────────────────────────────
const BINS = [2, 5, 10];
function binFor(diff) {
  const a = Math.abs(diff);
  const k = a < BINS[0] ? 0 : a < BINS[1] ? 1 : a < BINS[2] ? 2 : 3;
  return { k, dir: k === 0 ? 0 : diff > 0 ? 1 : -1, token: k === 0 ? "--div-0" : `--div-${diff > 0 ? "b" : "r"}${k}` };
}

function renderHeatmap() {
  $("#heat-sub").textContent = t("heatSub", { dim: dimLabel(state.by), slice: sliceLabel(state.slice) });
  const sw = (v, glyph) => el("span", { class: "sw", style: `background:var(${v});color:${inkOn(cssVar(v))}` }, glyph || "");
  $("#heat-legend").replaceChildren(
    el("span", { class: "legend-scale" },
      el("span", { text: t("legendWorse") }),
      el("span", { class: "swatches", "aria-hidden": "true" },
        sw("--div-r3", "▼"), sw("--div-r2", "▼"), sw("--div-r1", "▼"), sw("--div-0"), sw("--div-b1", "▲"), sw("--div-b2", "▲"), sw("--div-b3", "▲")),
      el("span", { text: t("legendBetter") })),
    el("span", { class: "muted", text: t("legendSteps") }),
    el("span", { class: "legend-scale" }, el("span", { class: "sw-s", "aria-hidden": "true" }), el("span", { text: t("srSuppressed") })),
  );

  const inds = META.indicators;
  const rows = DATA.tables[`${state.by}|${state.slice}`];
  const total = DATA.slices[state.slice];

  const cell = (rowLabel, n, est, ind, isTotal) => {
    const td = el("td");
    if (!est) {
      td.className = "s";
      td.append(el("span", { "aria-hidden": "true", text: "x" }), srOnly(t("srSuppressed")));
    } else {
      const ref = total.est && total.est[ind.id];
      const diff = isTotal || !ref ? 0 : (est[0] - ref[0]) * (ind.better === "higher" ? 1 : -1);
      const b = binFor(diff);
      td.style.background = `var(${b.token})`;
      td.style.color = isTotal ? "var(--ink)" : inkOn(cssVar(b.token));
      if (b.dir) td.append(el("span", { class: "arrow", "aria-hidden": "true", text: b.dir > 0 ? "▲" : "▼" }));
      td.append(fmt1(est[0]));
      if (est[3] === "E") td.append(el("span", { class: "flag", "aria-hidden": "true", style: "color:inherit", text: "E" }));
      const sr = [b.dir > 0 ? t("srBetter") : b.dir < 0 ? t("srWorse") : null, est[3] === "E" ? t("srCaution") : null].filter(Boolean);
      if (sr.length) td.append(srOnly(` (${sr.join(", ")})`));
    }
    bindTip(td, () => {
      const out = [el("div", { class: "tt-name", text: `${L(ind.short)} · ${rowLabel}` })];
      if (!est) { out.push(el("div", { class: "tt-val", text: t("suppressed") })); return out; }
      out.push(el("div", { class: "tt-val", text: pct(est[0]) }), el("div", { class: "tt-row", text: t("ci", { lo: fmt1(est[1]), hi: fmt1(est[2]) }) }));
      const ref = total.est && total.est[ind.id];
      if (!isTotal && ref) out.push(el("div", { class: "tt-row", text: `${t("vsGroup", { diff: signed(est[0] - ref[0]) })} (${t(ind.better === "higher" ? "higherBetter" : "lowerBetter")})` }));
      if (n != null) out.push(el("div", { class: "tt-row", text: t("approxRespondents", { n: fmtN(n) }) }));
      return out;
    });
    return td;
  };

  const caption = t("heatCaption", { dim: dimLabel(state.by), slice: sliceLabel(state.slice) });
  const table = el("table", { class: "heatmap" },
    el("caption", { class: "sr-only", text: caption }),
    el("thead", {}, el("tr", {},
      el("th", { scope: "col" }, el("span", { class: "muted", style: "font-weight:500", text: dimLabel(state.by) })),
      inds.map((i) => el("th", { scope: "col", class: i.id === state.ind ? "active" : null },
        el("button", {
          type: "button", "aria-pressed": String(i.id === state.ind), "data-fk": `heat-${i.id}`, text: L(i.short),
          onclick: () => update({ ind: i.id }),
        }))))),
    el("tbody", {},
      el("tr", { class: "total" }, el("th", { scope: "row", text: t("overall") }), inds.map((i) => cell(t("overall"), total.n, total.est && total.est[i.id], i, true))),
      rows.map((r) => {
        const name = levelLabel(state.by, r.level);
        return el("tr", {}, el("th", { scope: "row", text: name }), inds.map((i) => cell(name, r.n, r.est && r.est[i.id], i, false)));
      })));

  const wrap = $("#heatmap");
  wrap.setAttribute("role", "region");
  wrap.setAttribute("tabindex", "0");
  wrap.setAttribute("aria-label", t("scrollRegion", { name: t("heatTitle") }));
  wrap.replaceChildren(table);
}

// ── About & accessibility ───────────────────────────────────────────────────
function renderAbout() {
  const r = META.rules;
  const nf = (v) => v.toLocaleString(locale());
  $("#about").replaceChildren(
    el("div", {},
      el("h3", { text: t("aboutOnlyTitle") }),
      el("p", { text: t("aboutOnlyText") }),
      el("ol", { class: "pipeline" },
        el("li", { class: "lock", text: t("pipeMicro") }),
        el("li", { text: t("pipeBuild") }),
        el("li", { lang: "en", text: t("pipeFile") }),
        el("li", { text: t("pipeSite") }))),
    el("div", {},
      el("h3", { text: t("rulesTitle") }),
      el("ul", {},
        el("li", { text: t("ruleMinCell", { n: nf(r.min_cell) }) }),
        el("li", { text: t("ruleComp") }),
        el("li", { text: t("ruleEvents", { n: nf(r.min_event) }) }),
        el("li", { text: t("ruleRound", { n: nf(r.round_base) }) }))),
    el("div", {},
      el("h3", { text: t("readTitle") }),
      el("ul", {},
        el("li", { text: META.weighted ? t("readWeighted") : t("readUnweighted") }),
        el("li", { text: t("readE", { e: nf(r.cv_e), f: nf(r.cv_f) }) }),
        el("li", { text: t("readF", { f: nf(r.cv_f) }) }),
        el("li", { text: t("readCI") }))),
  );

  const email = META.site.accessibility_contact;
  const fb = $("#a11y-feedback");
  if (email) {
    const [before, after] = t("a11yFeedback", { email: "\u0000" }).split("\u0000");
    fb.replaceChildren(before, el("a", { href: `mailto:${email}`, text: email }), after);
    fb.hidden = false;
  } else fb.hidden = true;

  const d = new Date(META.generated_at);
  $("#footer-meta").textContent = `${L(META.site.footer) || ""} ${t("footerGenerated", { date: d.toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" }) })}`.trim();
}

// ── Orchestration ───────────────────────────────────────────────────────────
function update(patch = {}) {
  const fk = focusKey();
  Object.assign(state, patch);
  if (state.slice !== "all" && state.slice.startsWith(state.by + "=")) state.slice = "all";
  syncControls();
  renderTiles();
  renderDot();
  renderTable();
  renderHeatmap();
  writeURL();
  restoreFocus(fk);
  if (!update.ready) { update.ready = true; return; } // don't announce the initial render
  const rows = currentRows();
  announce(t("status", {
    indicator: indLabel(state.ind), dim: dimLabel(state.by), slice: sliceLabel(state.slice),
    shown: rows.filter((r) => r.est).length, total: rows.length,
  }));
}

function initTheme() {
  const root = document.documentElement;
  const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  const sync = () => $("#theme-toggle").setAttribute("aria-pressed", String(isDark()));
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch { /* storage unavailable */ }
  if (saved) root.dataset.theme = saved;
  sync();
  $("#theme-toggle").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* ignore */ }
    sync();
    renderHeatmap(); // cell ink depends on resolved colours
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { sync(); if (DATA) renderHeatmap(); });
}

async function main() {
  initTheme();
  initTooltip();
  try {
    const res = await fetch("data/aggregates.json");
    if (!res.ok) throw new Error(res.statusText);
    DATA = await res.json();
  } catch (e) {
    const lang = (navigator.language || "en").startsWith("fr") ? "fr" : "en";
    $("#main").prepend(el("p", { class: "card", role: "alert", text: STRINGS[lang].loadError }));
    throw e;
  }
  META = DATA.meta;
  META.site.languages ||= ["en"];
  META.site.default_language ||= META.site.languages[0];
  IND = Object.fromEntries(META.indicators.map((i) => [i.id, i]));
  DIM = Object.fromEntries(META.dimensions.map((d) => [d.id, d]));
  DEFAULTS = { ind: META.site.default_indicator, by: META.site.default_compare, slice: "all", sort: "natural", view: "chart" };
  Object.assign(state, DEFAULTS);
  readURL();
  applyStaticText();
  buildControls();
  initControls();
  renderAbout();
  update();

  let lastW = 0;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (w && Math.abs(w - lastW) > 2) { lastW = w; const fk = focusKey(); renderDot(); restoreFocus(fk); }
  }).observe($("#dot-chart").parentElement);
}

main();
