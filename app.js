/* Inventario Mueblería · app (Supabase) */
(function () {
"use strict";

/* ---------- constantes ---------- */
const UB = { M: "Mueblería", B: "Bodega", T: "Taller" };
const UKEYS = ["M", "B", "T"];
const TIPOS = [
  { t: "Venta", s: -1 }, { t: "Compra / recepción", s: 1 }, { t: "Traspaso", s: 0 }, { t: "Producción terminada", s: 1 },
  { t: "Devolución de cliente", s: 1 }, { t: "Consumo en producción", s: -1 }, { t: "Merma / dañado", s: -1 },
  { t: "Ajuste (+)", s: 1 }, { t: "Ajuste (−)", s: -1 }
];
const ALL_TIPOS = TIPOS.map(x => x.t).concat(["Ajuste por conteo"]);
const CAT_ORDER = ["Salas", "Camas de pestañas", "Recámaras y tocadores", "Comedores", "Cojines", "Telas", "Materiales varios", "Madera", "Triplay"];
const RECENT_DAYS = 90;

const S = {
  products: new Map(), stock: new Map(), movs: [], gotP: false, gotM: false,
  view: "tablero", detail: null, detailNew: false, email: "", started: false, hRows: []
};

/* ---------- utilidades ---------- */
const $ = id => document.getElementById(id);
const el = (tag, props, ...kids) => {
  const n = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v === undefined || v === null) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids) { if (c == null) continue; n.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return n;
};
const nf = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });
const mf = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const fq = n => nf.format(Math.round((Number(n) || 0) * 100) / 100);
const pl = (n, s, p) => fq(n) + " " + (Math.abs(n) === 1 ? s : p);
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const today = () => ymd(new Date());
const daysAgo = n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - n); return ymd(d); };
const fdate = f => { if (!f) return ""; const [y, m, d] = f.split("-"); return d + "/" + m + "/" + y.slice(2); };
const isNum = v => typeof v === "number" && isFinite(v);
const numOrNull = v => (v === null || v === undefined || v === "") ? null : Number(v);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
function toast(msg) {
  const t = el("div", { class: "toast", role: "status", text: msg });
  const dl = $("dlg"); (dl && dl.open ? dl : document.body).append(t);
  setTimeout(() => t.remove(), 3400);
}
function setStatus(kind, text) { $("status").className = "status " + (kind || ""); $("statusText").textContent = text; }

/* ---------- configuración y cliente ---------- */
const CFG = window.INVENTARIO_CONFIG || {};
const configured = /^https:\/\/.+\.supabase\.co\/?$/.test(CFG.url || "") && (CFG.anonKey || "").length > 20;
const sb = configured && window.supabase ? window.supabase.createClient(CFG.url.replace(/\/$/, ""), CFG.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

function dbError(err, ctx) {
  console.error(ctx, err);
  const msg = String((err && (err.message || err.error_description)) || "");
  if (/JWT|session|not authenticated|401/i.test(msg)) return "Tu sesión expiró. Vuelve a entrar.";
  if (/no se editan|ya estaba anulado/i.test(msg)) return msg;
  if (/duplicate key.*nombre|productos_nombre_key/i.test(msg)) return "Ya existe un artículo con ese nombre.";
  if (/violates check constraint/i.test(msg)) return "Algún dato no es válido. Revisa cantidades y campos.";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "Sin conexión. Revisa tu internet e intenta de nuevo.";
  return "No se pudo guardar. Intenta de nuevo.";
}

/* ---------- carga de datos ---------- */
async function loadProducts() {
  const [pr, ex] = await Promise.all([
    sb.from("productos").select("*").order("codigo").range(0, 4999),
    sb.from("existencias").select("*").range(0, 4999)
  ]);
  if (pr.error) throw pr.error;
  if (ex.error) throw ex.error;
  const m = new Map();
  for (const r of pr.data) m.set(r.codigo, {
    codigo: r.codigo, nombre: r.nombre, tipo: r.tipo, categoria: r.categoria, unidad: r.unidad,
    ini: { M: Number(r.ini_m) || 0, B: Number(r.ini_b) || 0, T: Number(r.ini_t) || 0 },
    min: numOrNull(r.minimo), costo: numOrNull(r.costo), precio: numOrNull(r.precio)
  });
  const st = new Map();
  for (const r of ex.data) { const M = Number(r.m) || 0, B = Number(r.b) || 0, T = Number(r.t) || 0; st.set(r.codigo, { M, B, T, tot: M + B + T }); }
  for (const c of m.keys()) if (!st.has(c)) { const p = m.get(c); st.set(c, { M: p.ini.M, B: p.ini.B, T: p.ini.T, tot: p.ini.M + p.ini.B + p.ini.T }); }
  S.products = m; S.stock = st; S.gotP = true; S.prodVer = (S.prodVer || 0) + 1;
}
const mapMov = r => ({ id: r.id, f: r.fecha, t: r.tipo, s: r.signo, c: r.codigo, u: r.ubic, d: r.destino, q: Number(r.cantidad), n: r.nota || "", by: r.usuario_email || "", at: r.creado, anulado: r.anulado, anuladoPor: r.anulado_por });
async function loadRecent() {
  const { data, error } = await sb.from("movimientos").select("*").eq("anulado", false).gte("fecha", daysAgo(RECENT_DAYS))
    .order("fecha", { ascending: false }).order("creado", { ascending: false }).range(0, 1999);
  if (error) throw error;
  S.movs = data.map(mapMov); S.gotM = true;
}
let loading = null, again = false;
async function refreshAll() {
  if (!sb || !S.started) return;
  if (loading) { again = true; return loading; }
  loading = (async () => {
    try { await Promise.all([loadProducts(), loadRecent()]); setStatus("ok", "En línea"); }
    catch (e) { console.error(e); setStatus("err", "Sin conexión"); if (/JWT/i.test(e.message || "")) await sb.auth.signOut(); }
    renderView(); refreshDetail(); fillDatalists();
    if (S.view === "historial") loadHistorial();
  })();
  await loading; loading = null;
  if (again) { again = false; return refreshAll(); }
}
let rt = null;
function scheduleRefresh() { clearTimeout(rt); rt = setTimeout(refreshAll, 400); }

/* ---------- cálculo ---------- */
function statusOf(code) {
  const p = S.products.get(code), s = S.stock.get(code) || { tot: 0, M: 0, B: 0, T: 0 };
  const rev = p.unidad === "pza" && UKEYS.some(k => s[k] < 0 || Math.abs(s[k] - Math.round(s[k])) > 1e-9);
  if (s.tot <= 0) return { k: "out", label: "Agotado", rev };
  if (!isNum(p.min)) return { k: "none", label: "Sin mínimo", rev };
  if (s.tot <= p.min) return { k: "low", label: "Reabastecer", rev };
  return { k: "ok", label: "OK", rev };
}
const catRank = c => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
function sortedProducts() { return [...S.products.values()].sort((a, b) => catRank(a.categoria) - catRank(b.categoria) || a.categoria.localeCompare(b.categoria) || String(a.codigo).localeCompare(String(b.codigo))); }
function categories() { const set = new Set(); for (const p of S.products.values()) set.add(p.categoria); return [...set].sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b)); }
function pill(st) { const f = document.createDocumentFragment(); f.append(el("span", { class: "pill " + st.k, text: st.label })); if (st.rev) { f.append(" "); f.append(el("span", { class: "pill rev", text: "Revisar" })); } return f; }
const prodLabel = p => p.codigo + " · " + p.nombre;

/* ---------- navegación ---------- */
const VIEWS = ["tablero", "buscar", "registrar", "conteo", "historial"];
function route() {
  const h = (location.hash || "").slice(1); const v = VIEWS.includes(h) ? h : "tablero"; S.view = v;
  for (const x of VIEWS) $("v-" + x).hidden = x !== v;
  document.querySelectorAll("nav.menu a").forEach(a => { if (a.dataset.v === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  renderView(); if (v === "historial") loadHistorial(); window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
let rzT = null; window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => { if (S.view === "tablero" && S.gotP) drawDaysChart(); }, 150); });
function renderView() {
  if (S.view === "tablero") renderTablero(S.gotP);
  else if (S.view === "buscar") renderBuscar(S.gotP);
  else if (S.view === "registrar") renderStockBox();
  else if (S.view === "conteo") renderConteo(false);
}

/* ---------- tablero ---------- */
function renderTablero(ready) {
  const K = $("kpis"); K.textContent = "";
  if (!ready) { K.append(el("div", { class: "kpi", style: "grid-column:1/-1" }, el("span", { text: "Cargando" }), el("small", { text: "Leyendo el catálogo y los movimientos…" }))); ["chartCat", "chartDays", "lowList", "lastList"].forEach(i => $(i).textContent = ""); return; }
  let pzM = 0, pzB = 0, valC = 0, valP = 0, withCost = 0, low = 0, out = 0, nomin = 0, rev = 0, prods = 0, mats = 0;
  for (const p of S.products.values()) {
    const s = S.stock.get(p.codigo), st = statusOf(p.codigo);
    if (p.tipo === "Producto terminado") { prods++; if (p.categoria !== "Cojines") { pzM += s.M; pzB += s.B; } } else mats++;
    if (isNum(p.costo)) { withCost++; valC += Math.max(0, s.tot) * p.costo; }
    if (isNum(p.precio)) valP += Math.max(0, s.tot) * p.precio;
    if (st.k === "low") low++; if (st.k === "out") out++; if (st.k === "none") nomin++; if (st.rev) rev++;
  }
  const k = (label, val, sub, cls, filt) => {
    const a = el(filt != null ? "a" : "div", { class: "kpi" + (cls ? " " + cls : ""), href: filt != null ? "#buscar" : null, style: filt != null ? "text-decoration:none;color:inherit" : null, onclick: filt != null ? () => { $("fEstado").value = filt; } : null });
    a.append(el("span", { text: label }), el("b", { text: val }), el("small", { text: sub || "" })); return a;
  };
  K.append(
    k("Muebles en Mueblería", fq(pzM), "piezas en exhibición"),
    k("Muebles en Bodega", fq(pzB), "piezas guardadas"),
    k("Por reabastecer", String(low), pl(nomin, "artículo", "artículos") + " sin mínimo definido", low ? "alert" : "", "low"),
    k("Agotados", String(out), "existencia en 0 o menos", out ? "attn" : "", "out"),
    k("Valor a costo", mf.format(valC), withCost + " de " + S.products.size + " con costo", "money"),
    k("Valor a precio de venta", mf.format(valP), "muebles con precio capturado", "money"),
    k("Catálogo", prods + " + " + mats, "productos + materiales"),
    k("A revisar", String(rev), "decimales o negativos en piezas", rev ? "attn" : "", "rev")
  );
  drawCatChart(); drawDaysChart();
  const L = $("lowList"); L.textContent = "";
  const lows = sortedProducts().filter(p => statusOf(p.codigo).k === "low").slice(0, 8);
  if (!lows.length) L.append(el("div", { class: "empty" }, el("b", { text: "Nada por reabastecer" }), "Captura el stock mínimo de cada producto en Buscar para que aparezcan aquí las alertas."));
  for (const p of lows) { const s = S.stock.get(p.codigo); L.append(el("div", { class: "row tap", onclick: () => openDetail(p.codigo) }, el("div", { class: "l" }, el("div", { text: p.nombre, title: p.nombre }), el("small", { text: p.categoria + " · mínimo " + fq(p.min) })), el("b", { class: "neg num", text: fq(s.tot) + " " + p.unidad }))); }
  const M = $("lastList"); M.textContent = "";
  if (!S.movs.length) M.append(el("div", { class: "empty" }, el("b", { text: "Todavía no hay movimientos" }), "Registra una venta, compra o traspaso en el menú Registrar."));
  for (const m of S.movs.slice(0, 8)) M.append(movRow(m, true));
}
const movQtyText = m => { if (m.t === "Traspaso") return fq(m.q); const v = (m.s || 0) * (+m.q || 0); return (v > 0 ? "+" : "") + fq(v); };
function movRow(m, tap) {
  const p = S.products.get(m.c); const where = m.t === "Traspaso" ? UB[m.u] + " → " + UB[m.d] : UB[m.u];
  const name = p ? p.nombre : m.c;
  return el("div", { class: "row" + (tap && p ? " tap" : ""), onclick: tap && p ? () => openDetail(p.codigo) : null },
    el("div", { class: "l" }, el("div", { text: name, title: name }), el("small", { text: fdate(m.f) + " · " + m.t + " · " + where + (m.anulado ? " · ANULADO" : "") })),
    el("b", { class: "num " + (m.anulado ? "muted" : m.t === "Traspaso" ? "" : (m.s > 0 ? "pos" : "neg")), style: m.anulado ? "text-decoration:line-through" : null, text: movQtyText(m) }));
}
function svgEl(tag, attrs) { const n = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; }
function drawCatChart() {
  const box = $("chartCat"); box.textContent = "";
  const colors = { M: "var(--accent)", B: "var(--oak)", T: "var(--plum)" };
  const cats = categories().filter(c => [...S.products.values()].some(p => p.categoria === c && p.tipo === "Producto terminado"));
  const data = cats.map(c => { const o = { c, M: 0, B: 0, T: 0 }; for (const p of S.products.values()) { if (p.categoria !== c || p.tipo !== "Producto terminado") continue; const s = S.stock.get(p.codigo); for (const k of UKEYS) o[k] += Math.max(0, s[k]); } return o; });
  const max = Math.max(1, ...data.map(d => d.M + d.B + d.T));
  if (!data.length) box.append(el("div", { class: "empty", text: "Sin productos terminados en el catálogo." }));
  const wrap = el("div", { class: "hbars", role: "img", "aria-label": "Piezas por categoría" });
  for (const d of data) {
    const track = el("div", { class: "track" });
    for (const k of UKEYS) if (d[k] > 0) track.append(el("span", { style: "width:" + (d[k] / max * 100).toFixed(2) + "%;background:" + colors[k], title: UB[k] + ": " + fq(d[k]) }));
    wrap.append(el("div", { class: "hrow" }, el("div", { class: "hl", text: d.c }), track, el("div", { class: "hv num", text: fq(d.M + d.B + d.T) })));
  }
  box.append(wrap);
  const lg = $("legendCat"); lg.textContent = ""; for (const k of UKEYS) lg.append(el("span", null, el("i", { style: "background:" + colors[k] }), UB[k]));
}
function drawDaysChart() {
  const box = $("chartDays"); box.textContent = "";
  const days = []; for (let i = 29; i >= 0; i--) days.push(daysAgo(i));
  const idx = new Map(days.map((d, i) => [d, i])); const inn = days.map(() => 0), outv = days.map(() => 0);
  for (const m of S.movs) { const i = idx.get(m.f); if (i == null || m.t === "Traspaso" || m.t === "Ajuste por conteo") continue; const p = S.products.get(m.c); if (p && p.tipo !== "Producto terminado") continue; if (m.s > 0) inn[i] += +m.q || 0; else if (m.s < 0) outv[i] += +m.q || 0; }
  const max = Math.max(...inn, ...outv);
  if (max === 0) { box.append(el("div", { class: "empty" }, el("b", { text: "Sin movimientos de muebles en los últimos 30 días" }), "Aquí verás cada día las piezas que entran y salen.")); return; }
  const W = Math.max(280, Math.round(box.clientWidth || 560)), H = 200, top = 10, bottom = 28, left = 32, right = 8, every = W < 440 ? 7 : 5;
  const ph = H - top - bottom, bw = (W - left - right) / days.length;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Entradas y salidas por día" });
  const step = Math.max(1, Math.ceil(max / 4)), topv = step * 4;
  for (let v = 0; v <= topv; v += step) { const y = top + ph - ph * v / topv; svg.append(svgEl("line", { x1: left, x2: W - right, y1: y, y2: y, stroke: "var(--line)", "stroke-width": 1 })); const t = svgEl("text", { x: left - 6, y: y + 4, "text-anchor": "end" }); t.textContent = v; svg.append(t); }
  days.forEach((d, i) => {
    const x = left + i * bw, hi = ph * inn[i] / topv, ho = ph * outv[i] / topv, w = Math.max(2, bw / 2 - 1.5);
    if (hi > 0) { const r = svgEl("rect", { x: x + 1, y: top + ph - hi, width: w, height: hi, fill: "var(--good)", rx: 1.5 }); const tt = svgEl("title", {}); tt.textContent = fdate(d) + ": entraron " + fq(inn[i]); r.append(tt); svg.append(r); }
    if (ho > 0) { const r = svgEl("rect", { x: x + 2 + w, y: top + ph - ho, width: w, height: ho, fill: "var(--bad)", rx: 1.5 }); const tt = svgEl("title", {}); tt.textContent = fdate(d) + ": salieron " + fq(outv[i]); r.append(tt); svg.append(r); }
    if ((29 - i) % every === 0) { const t = svgEl("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle" }); t.textContent = d.slice(8) + "/" + d.slice(5, 7); svg.append(t); }
  });
  box.append(svg);
}

/* ---------- buscar ---------- */
function fillSelect(sel, opts, keep) { const v = sel.value; sel.textContent = ""; for (const [val, lab] of opts) sel.append(el("option", { value: val, text: lab })); if (keep && [...sel.options].some(o => o.value === v)) sel.value = v; }
let lastCats = "";
function refreshCatSelects() {
  const cs = categories(), key = cs.join("|"); if (key === lastCats) return; lastCats = key;
  fillSelect($("fCat"), [["", "Todas"]].concat(cs.map(c => [c, c])), true);
  fillSelect($("cCat"), [["", "Todas"]].concat(cs.map(c => [c, c])), true);
  const dl = $("catList"); dl.textContent = ""; for (const c of cs) dl.append(el("option", { value: c }));
}
function renderBuscar(ready) {
  refreshCatSelects();
  const body = $("resBody"); body.textContent = "";
  if (!ready) { body.append(el("tr", null, el("td", { colspan: 8, class: "empty", text: "Cargando catálogo…" }))); return; }
  const q = norm($("q").value).split(/\s+/).filter(Boolean), cat = $("fCat").value, est = $("fEstado").value;
  const rows = sortedProducts().filter(p => {
    if (cat && p.categoria !== cat) return false;
    const hay = norm(p.codigo + " " + p.nombre + " " + p.categoria); if (q.some(w => !hay.includes(w))) return false;
    const s = S.stock.get(p.codigo), st = statusOf(p.codigo);
    if (est === "low" && st.k !== "low") return false; if (est === "out" && st.k !== "out") return false;
    if (est === "rev" && !st.rev) return false; if (est === "nocost" && isNum(p.costo)) return false;
    if (UKEYS.includes(est) && !(s[est] > 0)) return false;
    return true;
  });
  $("resCount").textContent = fq(rows.length) + " de " + pl(S.products.size, "artículo", "artículos") + (rows.length > 400 ? " · se muestran los primeros 400, escribe más para afinar la búsqueda" : "");
  if (!rows.length) { body.append(el("tr", null, el("td", { colspan: 8 }, el("div", { class: "empty" }, el("b", { text: "No encontré nada con esa búsqueda" }), "Prueba con menos palabras o cambia los filtros.")))); return; }
  const frag = document.createDocumentFragment();
  for (const p of rows.slice(0, 400)) {
    const s = S.stock.get(p.codigo), st = statusOf(p.codigo);
    const c = v => el("td", { class: "n" + (v < 0 ? " neg" : ""), text: v ? fq(v) : "–" });
    frag.append(el("tr", { class: "click", tabindex: "0", onclick: () => openDetail(p.codigo), onkeydown: e => { if (e.key === "Enter") openDetail(p.codigo); } },
      el("td", { class: "code c-code", text: p.codigo }),
      el("td", null, el("div", { text: p.nombre, style: "font-weight:600;overflow-wrap:anywhere" }), el("small", { class: "muted", text: p.codigo + " · " + p.unidad })),
      el("td", { class: "muted c-cat", text: p.categoria }), c(s.M), c(s.B), c(s.T), el("td", { class: "n", style: "font-weight:700", text: fq(s.tot) }), el("td", null, pill(st))));
  }
  body.append(frag);
}
["q", "fCat", "fEstado"].forEach(id => $(id).addEventListener("input", () => renderBuscar(S.gotP)));

/* ---------- ficha ---------- */
function openDetail(code) {
  const p = S.products.get(code); if (!p) return;
  S.detail = code; S.detailNew = false;
  $("dNombre").value = p.nombre || ""; $("dCat").value = p.categoria || ""; $("dTipo").value = p.tipo || "Producto terminado"; $("dUnidad").value = p.unidad || "";
  $("dMin").value = isNum(p.min) ? p.min : ""; $("dCosto").value = isNum(p.costo) ? p.costo : ""; $("dPrecio").value = isNum(p.precio) ? p.precio : "";
  $("dMove").hidden = false;
  const d = $("dlg"); if (!d.open) d.showModal();
  d.querySelector(".body").scrollTop = 0; refreshDetail(); loadDetailHistory(code);
}
function openNew() {
  S.detail = null; S.detailNew = true;
  $("dCode").textContent = "Código nuevo"; $("dTitle").textContent = "Producto nuevo"; $("dSub").textContent = "Se crea con existencia 0. Después registra una entrada o un ajuste.";
  ["dStock", "dFlags", "dHist"].forEach(i => $(i).textContent = "");
  for (const id of ["dNombre", "dCat", "dUnidad", "dMin", "dCosto", "dPrecio"]) $(id).value = "";
  $("dUnidad").value = "pza"; $("dTipo").value = "Producto terminado"; $("dMove").hidden = true;
  $("dlg").showModal(); $("dNombre").focus();
}
function refreshDetail() {
  if (!S.detail || !$("dlg").open) return; const p = S.products.get(S.detail); if (!p) return;
  const s = S.stock.get(p.codigo), st = statusOf(p.codigo);
  $("dCode").textContent = p.codigo; $("dTitle").textContent = p.nombre; $("dSub").textContent = p.categoria + " · " + p.tipo + " · " + p.unidad;
  const sc = $("dStock"); sc.textContent = "";
  for (const k of UKEYS) sc.append(el("div", null, el("span", { text: UB[k] }), el("b", { class: s[k] < 0 ? "neg" : "", text: fq(s[k]) })));
  sc.append(el("div", { class: "tot" }, el("span", { text: "Total" }), el("b", { text: fq(s.tot) })));
  const fl = $("dFlags"); fl.textContent = "";
  const line = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }); line.append(pill(st));
  if (isNum(p.costo)) line.append(el("span", { class: "muted", text: "Valor a costo: " + mf.format(Math.max(0, s.tot) * p.costo) }));
  fl.append(line);
  if (st.rev) fl.append(el("div", { class: "note warn", style: "margin-top:8px", text: "Tiene decimales o negativos en piezas. Cuéntalo en Inventario para corregirlo." }));
}
let histSeq = 0;
async function loadDetailHistory(code) {
  const h = $("dHist"); const seq = ++histSeq;
  if (!h.childElementCount) h.append(el("div", { class: "empty", text: "Cargando movimientos…" }));
  const { data, error } = await sb.from("movimientos").select("*").eq("codigo", code).order("fecha", { ascending: false }).order("creado", { ascending: false }).limit(15);
  if (seq !== histSeq || S.detail !== code) return;
  h.textContent = "";
  if (error) { h.append(el("div", { class: "empty", text: "No se pudo leer el historial." })); return; }
  if (!data.length) h.append(el("div", { class: "empty", text: "Sin movimientos registrados." }));
  for (const r of data) h.append(movRow(mapMov(r), false));
}
$("dClose").addEventListener("click", () => $("dlg").close());
$("dlg").addEventListener("close", () => { S.detail = null; $("dHist").textContent = ""; });
$("btnNuevo").addEventListener("click", openNew);
$("dMove").addEventListener("click", () => { const p = S.products.get(S.detail); $("dlg").close(); location.hash = "#registrar"; if (p) { $("mProd").value = prodLabel(p); renderStockBox(); } });
function nextCode(cat) {
  const pref = { "Salas": "SAL", "Camas de pestañas": "CAM", "Recámaras y tocadores": "REC", "Comedores": "COM", "Cojines": "COJ", "Telas": "TEL", "Materiales varios": "MAT", "Madera": "MAD", "Triplay": "TRI" }[cat] || (norm(cat).replace(/[^a-z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X"));
  let n = 0; for (const c of S.products.keys()) if (c.startsWith(pref + "-")) { const k = parseInt(c.slice(pref.length + 1), 10); if (k > n) n = k; }
  let code; do { n++; code = pref + "-" + String(n).padStart(3, "0"); } while (S.products.has(code)); return code;
}
$("dForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!guardWrite()) return;
  const nn = v => { const n = numOrNull(v); return n != null && n >= 0 ? n : null; };
  const data = { nombre: $("dNombre").value.trim(), categoria: $("dCat").value.trim(), tipo: $("dTipo").value, unidad: $("dUnidad").value.trim() || "pza", minimo: nn($("dMin").value), costo: nn($("dCosto").value), precio: nn($("dPrecio").value) };
  if (!data.nombre || !data.categoria) { toast("Escribe nombre y categoría."); return; }
  const dup = [...S.products.values()].find(p => norm(p.nombre) === norm(data.nombre) && p.codigo !== S.detail);
  if (dup) { toast("Ya existe un artículo con ese nombre (" + dup.codigo + ")."); return; }
  $("dSave").disabled = true;
  try {
    if (S.detailNew) {
      const code = nextCode(data.categoria);
      const { error } = await sb.from("productos").insert(Object.assign({ codigo: code }, data)); if (error) throw error;
      toast("Producto creado: " + code); $("dlg").close();
    } else {
      const { error } = await sb.from("productos").update(data).eq("codigo", S.detail); if (error) throw error;
      toast("Cambios guardados");
    }
    await refreshAll();
  } catch (err) { toast(dbError(err, "producto")); }
  finally { $("dSave").disabled = false; }
});

/* ---------- registrar ---------- */
let mTipo = "Venta";
function buildTipoButtons() { const box = $("mTipo"); box.textContent = ""; for (const x of TIPOS) box.append(el("button", { type: "button", "aria-pressed": String(x.t === mTipo), text: x.t, onclick: () => { mTipo = x.t; buildTipoButtons(); onTipo(); } })); }
function onTipo() { const tr = mTipo === "Traspaso"; $("lblDest").hidden = !tr; $("lblUbic").firstChild.textContent = tr ? "Desde" : "Ubicación"; renderStockBox(); }
function fillDatalists() {
  const dl = $("prodList"); if (dl.dataset.k === String(S.prodVer)) return;
  dl.textContent = ""; for (const p of sortedProducts()) dl.append(el("option", { value: prodLabel(p) })); dl.dataset.k = String(S.prodVer);
  refreshCatSelects();
}
function pickedProduct(v) { const s = String(v || "").trim(); if (!s) return null; const code = s.split(" · ")[0].trim().toUpperCase(); if (S.products.has(code)) return S.products.get(code); const n = norm(s); return [...S.products.values()].find(p => norm(p.nombre) === n) || null; }
function renderStockBox() {
  const box = $("mStock"); box.textContent = ""; const w = $("mWarn"); w.textContent = "";
  const p = pickedProduct($("mProd").value);
  if (!p) { if ($("mProd").value.trim()) box.append(el("div", { class: "note bad", text: "Elige un artículo de la lista. Si es nuevo, créalo primero en Buscar → Producto nuevo." })); return; }
  const s = S.stock.get(p.codigo); const line = el("div", { class: "note info", style: "display:flex;gap:10px;flex-wrap:wrap;align-items:center" });
  line.append(el("b", { text: p.nombre, style: "overflow-wrap:anywhere" }), el("span", { class: "muted", text: "Existencia:" }));
  const lc = el("span", { class: "loc" }); for (const k of UKEYS) lc.append(el("span", null, UB[k] + " ", el("b", { text: fq(s[k]) }))); line.append(lc, el("span", { class: "muted", text: p.unidad }));
  box.append(line);
  const q = Number($("mQty").value), t = TIPOS.find(x => x.t === mTipo), u = $("mUbic").value;
  if (q > 0 && (t.s < 0 || mTipo === "Traspaso") && s[u] - q < 0) w.append(el("div", { class: "note warn", text: "Con este movimiento " + UB[u] + " quedaría en " + fq(s[u] - q) + ". Revisa la ubicación o haz un conteo; puedes guardar de todas formas." }));
  if (mTipo === "Traspaso" && u === $("mDest").value) w.append(el("div", { class: "note bad", text: "El origen y el destino son la misma ubicación." }));
}
["mProd", "mQty", "mUbic", "mDest"].forEach(id => $(id).addEventListener("input", renderStockBox));
$("movForm").addEventListener("reset", () => setTimeout(() => { $("mFecha").value = today(); mTipo = "Venta"; buildTipoButtons(); onTipo(); }, 0));
async function addMovs(movs) {
  const rows = movs.map(m => ({ fecha: m.f, tipo: m.t, signo: m.s, codigo: m.c, ubic: m.u, destino: m.d || null, cantidad: m.q, nota: m.n ? m.n.slice(0, 140) : null }));
  for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from("movimientos").insert(rows.slice(i, i + 200)); if (error) throw error; }
  await refreshAll();
}
$("movForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!guardWrite()) return;
  const p = pickedProduct($("mProd").value), q = Number($("mQty").value), f = $("mFecha").value, u = $("mUbic").value, d = $("mDest").value;
  if (!p) { toast("Elige un artículo de la lista."); return; }
  if (!(q > 0)) { toast("Escribe una cantidad mayor a 0."); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) { toast("Escribe la fecha."); return; }
  if (mTipo === "Traspaso" && u === d) { toast("El origen y el destino deben ser distintos."); return; }
  const t = TIPOS.find(x => x.t === mTipo);
  $("mSave").disabled = true;
  try {
    await addMovs([{ f, t: mTipo, s: t.s, c: p.codigo, u, d: mTipo === "Traspaso" ? d : null, q, n: $("mNota").value.trim() }]);
    toast("Guardado: " + mTipo + " de " + fq(q) + " " + p.unidad + " · " + p.nombre); $("mQty").value = ""; $("mNota").value = ""; renderStockBox();
  } catch (err) { toast(dbError(err, "movimiento")); }
  finally { $("mSave").disabled = false; }
});

/* ---------- conteo físico ---------- */
const draftKey = () => "conteo:" + $("cUbic").value;
let cDraft = {};
const loadDraft = () => { cDraft = store.get(draftKey()) || {}; };
function renderConteo(full) {
  refreshCatSelects();
  const body = $("cBody");
  if (!S.gotP) { body.textContent = ""; body.append(el("tr", null, el("td", { colspan: 5, class: "empty", text: "Cargando catálogo…" }))); return; }
  const u = $("cUbic").value, cat = $("cCat").value, q = norm($("cQ").value).split(/\s+/).filter(Boolean);
  const list = sortedProducts().filter(p => {
    if (cat && p.categoria !== cat) return false;
    const mueble = p.tipo === "Producto terminado" && p.categoria !== "Cojines", has = S.stock.get(p.codigo)[u] > 0;
    if (u === "T") { if (mueble && !has) return false; } else if (!mueble && !has) return false;
    const hay = norm(p.codigo + " " + p.nombre); return !q.some(w => !hay.includes(w));
  });
  const sig = u + "|" + cat + "|" + q.join(" ") + "|" + list.map(p => p.codigo).join(",");
  if (full || body.dataset.sig !== sig) {
    body.dataset.sig = sig; body.textContent = "";
    let prev = null; const frag = document.createDocumentFragment();
    for (const p of list) {
      if (p.categoria !== prev) { prev = p.categoria; frag.append(el("tr", null, el("td", { colspan: 5, style: "background:var(--surface-2);font-weight:700", text: p.categoria }))); }
      const inp = el("input", { type: "number", class: "count", min: "0", step: "any", inputmode: "decimal", enterkeyhint: "next", "aria-label": "Contado " + p.nombre, "data-code": p.codigo });
      if (cDraft[p.codigo] != null) inp.value = cDraft[p.codigo];
      inp.addEventListener("input", () => { const v = inp.value; if (v === "") delete cDraft[p.codigo]; else cDraft[p.codigo] = Number(v); store.set(draftKey(), cDraft); updateConteoNumbers(); });
      frag.append(el("tr", { "data-code": p.codigo }, el("td", { class: "code c-code", text: p.codigo }), el("td", null, el("div", { text: p.nombre, style: "overflow-wrap:anywhere" }), el("small", { class: "muted", text: p.codigo + " · " + p.unidad })), el("td", { class: "n sys" }), el("td", { class: "n" }, inp), el("td", { class: "n dif" })));
    }
    if (!list.length) frag.append(el("tr", null, el("td", { colspan: 5 }, el("div", { class: "empty" }, el("b", { text: "No hay artículos con ese filtro" }), "Cambia la categoría o la búsqueda."))));
    body.append(frag);
  }
  updateConteoNumbers();
}
function updateConteoNumbers() {
  const u = $("cUbic").value; let n = 0;
  $("cBody").querySelectorAll("tr[data-code]").forEach(tr => {
    const code = tr.dataset.code, s = S.stock.get(code); if (!s) return; const sys = s[u];
    tr.querySelector(".sys").textContent = fq(sys); const c = cDraft[code], dif = tr.querySelector(".dif");
    if (c == null) { dif.textContent = ""; dif.className = "n dif"; tr.classList.remove("changed"); }
    else { const dv = c - sys; dif.textContent = (dv > 0 ? "+" : "") + fq(dv); dif.className = "n dif " + (dv > 0 ? "pos" : dv < 0 ? "neg" : ""); tr.classList.toggle("changed", Math.abs(dv) > 1e-9); }
  });
  for (const code in cDraft) { const s = S.stock.get(code); if (s && Math.abs(cDraft[code] - s[u]) > 1e-9) n++; }
  const counted = Object.keys(cDraft).length;
  $("cSummary").textContent = counted ? (pl(counted, "contado", "contados") + " en " + UB[u] + " · " + n + " con diferencia") : "Sin capturas todavía. Lo que escribas se guarda en este navegador hasta que lo confirmes.";
  $("cSave").disabled = !counted; $("cSave").textContent = n ? "Guardar " + pl(n, "ajuste", "ajustes") : "Guardar conteo";
}
["cCat", "cQ"].forEach(id => $(id).addEventListener("input", () => renderConteo(false)));
$("cUbic").addEventListener("change", () => { loadDraft(); renderConteo(true); });
let discardArmed = false;
$("cDiscard").addEventListener("click", () => {
  if (!discardArmed) { discardArmed = true; $("cDiscard").textContent = "¿Borrar? Toca otra vez"; setTimeout(() => { discardArmed = false; $("cDiscard").textContent = "Borrar captura"; }, 3000); return; }
  discardArmed = false; $("cDiscard").textContent = "Borrar captura"; cDraft = {}; store.del(draftKey()); renderConteo(true);
});
$("cSave").addEventListener("click", async () => {
  if (!guardWrite()) return;
  const u = $("cUbic").value, f = today(), movs = [];
  for (const code in cDraft) { const s = S.stock.get(code); if (!s) continue; const dv = cDraft[code] - s[u]; if (Math.abs(dv) > 1e-9) movs.push({ f, t: "Ajuste por conteo", s: dv > 0 ? 1 : -1, c: code, u, d: null, q: Math.abs(dv), n: "Conteo físico: había " + fq(s[u]) + ", se contaron " + fq(cDraft[code]) }); }
  $("cSave").disabled = true;
  try {
    if (movs.length) await addMovs(movs);
    const k = Object.keys(cDraft).length; cDraft = {}; store.del(draftKey()); renderConteo(true);
    toast(movs.length ? "Conteo guardado: " + pl(movs.length, "ajuste", "ajustes") + " en " + UB[u] : "Conteo guardado: " + pl(k, "artículo", "artículos") + " sin diferencia");
  } catch (err) { toast(dbError(err, "conteo")); updateConteoNumbers(); }
});

/* ---------- historial (consulta al servidor) ---------- */
let hLimit = 200, hSeq = 0, voidArm = null, hT = null;
function histQuery(limit) {
  const text = norm($("hQ").value).split(/\s+/).filter(Boolean), t = $("hTipo").value, u = $("hUbic").value, d1 = $("hDesde").value, d2 = $("hHasta").value;
  let q = sb.from("movimientos").select("*", { count: "exact" }).order("fecha", { ascending: false }).order("creado", { ascending: false }).range(0, limit - 1);
  if (t) q = q.eq("tipo", t);
  if (u) q = q.or("ubic.eq." + u + ",destino.eq." + u);
  if (d1) q = q.gte("fecha", d1);
  if (d2) q = q.lte("fecha", d2);
  if (text.length) {
    const codes = [...S.products.values()].filter(p => { const hay = norm(p.codigo + " " + p.nombre); return text.every(w => hay.includes(w)); }).map(p => p.codigo).slice(0, 150);
    if (!codes.length) return null;
    q = q.in("codigo", codes);
  }
  return q;
}
async function loadHistorial() {
  if (!sb || !S.started) return;
  const seq = ++hSeq, body = $("hBody");
  if (!body.childElementCount) body.append(el("tr", null, el("td", { colspan: 8, class: "empty", text: "Cargando movimientos…" })));
  const q = histQuery(hLimit);
  let rows = [], total = 0;
  if (q) { const { data, error, count } = await q; if (seq !== hSeq) return; if (error) { body.textContent = ""; body.append(el("tr", null, el("td", { colspan: 8, class: "empty", text: "No se pudo leer el historial. Revisa tu conexión." }))); return; } rows = data.map(mapMov); total = count || rows.length; }
  if (seq !== hSeq) return;
  S.hRows = rows; renderHistorial(rows, total);
}
function renderHistorial(rows, total) {
  const body = $("hBody"); body.textContent = "";
  $("hCount").textContent = pl(total, "movimiento", "movimientos");
  if (!rows.length) { body.append(el("tr", null, el("td", { colspan: 8 }, el("div", { class: "empty" }, el("b", { text: "Ningún movimiento con esos filtros" }), "Lo que registres en Registrar o en Inventario aparece aquí.")))); $("hMore").textContent = ""; return; }
  const frag = document.createDocumentFragment();
  for (const m of rows) {
    const p = S.products.get(m.c), where = m.t === "Traspaso" ? UB[m.u] + " → " + UB[m.d] : UB[m.u];
    const act = el("td");
    if (m.anulado) act.append(el("span", { class: "pill none", title: "Anulado por " + (m.anuladoPor || ""), text: "Anulado" }));
    else act.append(el("button", { class: "btn sm" + (voidArm === m.id ? " danger" : ""), type: "button", text: voidArm === m.id ? "¿Anular?" : "Anular", onclick: () => voidMov(m) }));
    const qty = el("td", { class: "n " + (m.anulado ? "muted" : m.t === "Traspaso" ? "" : (m.s > 0 ? "pos" : "neg")), style: m.anulado ? "text-decoration:line-through" : null, text: movQtyText(m) });
    frag.append(el("tr", null, el("td", { class: "num", style: "white-space:nowrap", text: fdate(m.f) }), el("td", null, el("div", { text: p ? p.nombre : m.c, style: "overflow-wrap:anywhere" }), el("small", { class: "code", text: m.c })), el("td", { text: m.t }), el("td", { text: where }), qty, el("td", { class: "muted", text: m.n || "" }), el("td", { class: "muted", style: "overflow-wrap:anywhere", text: m.by || "—" }), act));
  }
  body.append(frag);
  const more = $("hMore"); more.textContent = "";
  if (total > rows.length) more.append(el("button", { class: "btn", type: "button", text: "Mostrar más (" + pl(total - rows.length, "restante", "restantes") + ")", onclick: () => { hLimit += 300; loadHistorial(); } }));
}
async function voidMov(m) {
  if (!guardWrite()) return;
  if (voidArm !== m.id) { voidArm = m.id; renderHistorial(S.hRows, Math.max(S.hRows.length, parseInt($("hCount").textContent.replace(/\D/g, ""), 10) || 0)); setTimeout(() => { if (voidArm === m.id) { voidArm = null; loadHistorial(); } }, 4000); return; }
  voidArm = null;
  try { const { error } = await sb.from("movimientos").update({ anulado: true }).eq("id", m.id); if (error) throw error; toast("Movimiento anulado"); await refreshAll(); }
  catch (err) { toast(dbError(err, "anular")); loadHistorial(); }
}
["hQ", "hTipo", "hUbic", "hDesde", "hHasta"].forEach(id => $(id).addEventListener("input", () => { hLimit = 200; clearTimeout(hT); hT = setTimeout(loadHistorial, 250); }));

/* ---------- descargas ---------- */
function csv(rows) { return "﻿" + rows.map(r => r.map(v => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n"); }
function save(filename, text) { const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); const a = el("a", { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
$("dlStock").addEventListener("click", () => {
  const rows = [["Código", "Producto", "Categoría", "Tipo", "Unidad", "Mueblería", "Bodega", "Taller", "Total", "Stock mínimo", "Costo", "Precio", "Valor a costo", "Estado"]];
  for (const p of sortedProducts()) { const s = S.stock.get(p.codigo), st = statusOf(p.codigo); rows.push([p.codigo, p.nombre, p.categoria, p.tipo, p.unidad, s.M, s.B, s.T, s.tot, p.min ?? "", p.costo ?? "", p.precio ?? "", isNum(p.costo) ? Math.max(0, s.tot) * p.costo : "", st.label + (st.rev ? " / Revisar" : "")]); }
  save("existencias_" + today() + ".csv", csv(rows));
});
$("dlMov").addEventListener("click", async () => {
  const q = histQuery(5000); let data = [];
  if (q) { const r = await q; if (r.error) { toast("No se pudo descargar. Revisa tu conexión."); return; } data = r.data.map(mapMov); }
  const rows = [["Fecha", "Código", "Producto", "Tipo", "Ubicación", "Destino", "Cantidad", "Nota", "Registró", "Anulado"]];
  for (const m of data) { const p = S.products.get(m.c); rows.push([m.f, m.c, p ? p.nombre : "", m.t, UB[m.u] || "", m.d ? UB[m.d] : "", m.t === "Traspaso" ? m.q : (m.s || 0) * m.q, m.n || "", m.by || "", m.anulado ? "Sí" : ""]); }
  save("movimientos_" + today() + ".csv", csv(rows));
});

function guardWrite() { if (!sb || !S.started) { toast("Inicia sesión para guardar."); return false; } return true; }

/* ---------- sesión ---------- */
function showShell(on) { $("app").hidden = !on; $("login").hidden = on; $("userBox").hidden = !on; document.body.classList.toggle("out", !on); }
function loginNote(kind, text) { const n = $("lNote"); n.textContent = ""; if (text) n.append(el("div", { class: "note " + kind, text })); }
async function startApp(session) {
  S.email = (session.user && session.user.email) || ""; $("userEmail").textContent = S.email;
  showShell(true);
  if (S.started) return; S.started = true;
  setStatus("", "Cargando…");
  route();
  await refreshAll();
  sb.channel("inventario")
    .on("postgres_changes", { event: "*", schema: "public", table: "movimientos" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "productos" }, scheduleRefresh)
    .subscribe();
}
function stopApp() {
  S.started = false; S.gotP = false; S.gotM = false; S.products = new Map(); S.stock = new Map(); S.movs = [];
  try { sb.removeAllChannels(); } catch (e) {}
  if ($("dlg").open) $("dlg").close();
  showShell(false); setStatus("", "Sin sesión");
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.started) scheduleRefresh(); });

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); loginNote("", "");
  const email = $("lEmail").value.trim(), password = $("lPass").value;
  if (!email || !password) { loginNote("bad", "Escribe tu correo y tu contraseña."); return; }
  $("lSubmit").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $("lSubmit").disabled = false;
  if (error) loginNote("bad", /invalid login/i.test(error.message) ? "Correo o contraseña incorrectos." : /confirm/i.test(error.message) ? "Tu correo todavía no está confirmado. Pide al administrador que lo confirme." : "No se pudo entrar. Revisa tu conexión e intenta de nuevo.");
});
$("lForgot").addEventListener("click", async () => {
  const email = $("lEmail").value.trim();
  if (!email) { loginNote("warn", "Escribe tu correo arriba y vuelve a tocar \"Olvidé mi contraseña\"."); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  loginNote(error ? "bad" : "info", error ? "No se pudo enviar el correo. Intenta más tarde." : "Si el correo está registrado, te llegará un enlace para crear una contraseña nueva.");
});
$("pwForm").addEventListener("submit", async e => {
  e.preventDefault();
  const p1 = $("pw1").value, p2 = $("pw2").value;
  if (p1.length < 8) { toast("La contraseña debe tener al menos 8 caracteres."); return; }
  if (p1 !== p2) { toast("Las contraseñas no coinciden."); return; }
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) { toast("No se pudo cambiar la contraseña."); return; }
  $("pwDlg").close(); toast("Contraseña actualizada");
});
$("btnSalir").addEventListener("click", async () => { await sb.auth.signOut(); });

/* ---------- arranque ---------- */
function initStatic() {
  fillSelect($("mUbic"), UKEYS.map(k => [k, UB[k]])); fillSelect($("mDest"), UKEYS.map(k => [k, UB[k]])); $("mDest").value = "M"; $("mUbic").value = "M";
  fillSelect($("cUbic"), UKEYS.map(k => [k, UB[k]]));
  fillSelect($("hTipo"), [["", "Todos"]].concat(ALL_TIPOS.map(t => [t, t]))); fillSelect($("hUbic"), [["", "Todas"]].concat(UKEYS.map(k => [k, UB[k]])));
  $("mFecha").value = today(); buildTipoButtons(); onTipo(); loadDraft();
}
initStatic();
if (!sb) {
  showShell(false); $("loginForm").hidden = true; setStatus("err", "Sin configurar");
  loginNote("bad", "Falta configurar la conexión con Supabase. Edita el archivo config.js con la URL y la clave pública (anon) de tu proyecto.");
} else {
  showShell(false); setStatus("", "Sin sesión");
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { $("pwDlg").showModal(); }
    setTimeout(() => { if (session) startApp(session); else stopApp(); }, 0);
  });
}
})();
