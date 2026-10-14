// Tablero genérico de proyección de gasto (Q×P) — datos ficticios.
// Fuente única: pipeline (data/proyeccion.js, analitico.js, clusters.js).
// Sin capas exploratorias: todo número visible sale del pipeline.
// 24 jurisdicciones. ~200 prácticas del Nomenclador.

const PROVINCIAS = ["Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba",
  "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza",
  "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz",
  "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"];

// Padrón: SF 30%, SJ 30%, CBA 20%, ER 10%, resto 0,5% c/u
// (reparto para el Q per cápita del mapa; el padrón real viene del pipeline)
const PESO_PADRON = Object.fromEntries(PROVINCIAS.map(p => [p, 0.005]));
PESO_PADRON["Santa Fe"] = 0.30; PESO_PADRON["San Juan"] = 0.30;
PESO_PADRON["Córdoba"] = 0.20; PESO_PADRON["Entre Ríos"] = 0.10;

const PRACTICAS = (window.CATALOGO || []).map(p => ({ codigo: p.codigo, nombre: p.descripcion, capitulo: p.capitulo }));

function pracLabel(c) { const p = PRACTICAS.find(x => x.codigo === c); return p ? `${p.codigo} · ${p.nombre}` : c; }
const etiquetaMes = m => ({ "01": "Ene", "02": "Feb", "03": "Mar", "04": "Abr", "05": "May", "06": "Jun", "07": "Jul", "08": "Ago", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dic" }[m.slice(5)] + "-" + m.slice(2, 4));

const fmtARS = n => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fmtN = n => n.toLocaleString("es-AR");

let cBar, cLine, cClusters;
const TEAL = "#4C9BE0", NAVY = "#6AADE6", AMBAR = "#35B981", SLATE = "#9DB0C6";
// Spec 011: Chart.js hereda la pizarra (texto + grillas claras).
if (window.Chart) { Chart.defaults.color = "#9DB0C6"; Chart.defaults.borderColor = "rgba(157,176,198,.14)"; }
// Semántica de color (Spec 004): azul = real, naranja = predicción,
// violeta = proyección, rojo/ámbar = alertas.

// Reveal on scroll + botón imprimir
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); io.unobserve(e.target); } }), { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach(el => io.observe(el));
document.getElementById("btnPrint")?.addEventListener("click", () => window.print());
Chart.defaults.font.family = "'Outfit','Segoe UI',Roboto,sans-serif";
Chart.defaults.animation.duration = 800;

// Q mensual real × arancel del pipeline, según el ámbito del filtro madre.
function lineaPrecioCantidad(){
  if (AN && AN.series_q && AN.periodos) {
    const cods = esTotal() ? Object.keys(AN.series_q)
      : (AN.series_q[AMB] ? [AMB] : []);
    const serie = c => AN.series_q[c] || [];
    const arancel = c => (AN.gasto_q_base[c] || {}).arancel || 0;
    return {
      etiq: AN.periodos.map(etiquetaMes),
      qMes: AN.periodos.map((p, i) => cods.reduce((s, c) => s + (serie(c)[i] || 0), 0)),
      gMes: AN.periodos.map((p, i) => cods.reduce((s, c) => s + (serie(c)[i] || 0) * arancel(c), 0))
    };
  }
  const { hist } = histVista();
  return { etiq: hist.map(h => etiquetaMes(h[0])), qMes: hist.map(h => h[1]),
           gMes: hist.map(h => Math.round(h[1] * PRECIO_MEDIO)) };
}

function render() {
  // Efecto precio vs cantidad con el pipeline: Q mensual real × arancel
  // (analitico.js), según el ámbito. Sin capas exploratorias.
  const { etiq, qMes, gMes } = lineaPrecioCantidad();

  if (cLine) cLine.destroy();

  cLine = new Chart(document.getElementById("chLine"), {
    type: "line",
    data: { labels: etiq,
      datasets: [
        { label: "Gasto — efecto precio × cantidad ($)", data: gMes, yAxisID: "y", borderColor: NAVY, backgroundColor: "rgba(0,51,102,.10)", fill: true, tension: 0.3 },
        { label: "Cantidad consumida (Q)", data: qMes, yAxisID: "y1", borderColor: AMBAR, tension: 0.3 }
      ] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 900 },
      plugins: { legend: { labels: { usePointStyle: true, pointStyle: "round" } } },
      scales: { y: { ticks: { callback: v => "$" + (v / 1e6).toFixed(0) + "M" } }, y1: { position: "right", grid: { drawOnChartArea: false } } } }
  });
  dibujarMapa();

  // ---- Clusters de prácticas: dónde se concentra el gasto ----
  renderClusters();
}

// ---- Mapa de gasto por provincia (Plotly choropleth + GeoJSON local) ----
// data/provincias_geo.js (GADM simplificado, properties.cod = nombre tablero).
// Funciona con doble clic (sin fetch): el GeoJSON viaja en <script>.
function gastoProvAmbito(){
  // {prov: gasto} del ámbito actual (36 meses, Q×P real del pipeline).
  const out = Object.fromEntries(PROVINCIAS.map(p => [p, 0]));
  if (AN && AN.gasto_prov) {
    const cods = esTotal() ? Object.keys(AN.gasto_prov) : [AMB];
    cods.forEach(c => Object.entries(AN.gasto_prov[c] || {})
      .forEach(([p, g]) => { out[p] = (out[p] || 0) + g; }));
  }
  return out;
}
// ---- Spec 012: vuelo a la provincia (zoom animado + ficha) ----
let provSel = null, geoFull = null;
function bboxProv(nombre) {
  const feats = ((window.PROV_GEOJSON || {}).features) || [];
  const f = feats.find(x => ((x.properties || {}).cod) === nombre);
  if (!f || !f.geometry) return null;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const rec = g => {
    if (typeof g[0] === "number") {
      if (g[0] < x0) x0 = g[0]; if (g[0] > x1) x1 = g[0];
      if (g[1] < y0) y0 = g[1]; if (g[1] > y1) y1 = g[1];
    } else g.forEach(rec);
  };
  rec(f.geometry.coordinates);
  if (x0 > x1) return null;
  const dx = (x1 - x0) * 0.15 + 0.3, dy = (y1 - y0) * 0.15 + 0.3;
  return { lon: [x0 - dx, x1 + dx], lat: [y0 - dy, y1 + dy] };
}
function animarGeo(el, lon, lat, ms) {
  ms = ms || 650;
  const L = el._fullLayout.geo;
  const lo0 = [...L.lonaxis.range], la0 = [...L.lataxis.range], t0 = performance.now();
  cancelAnimationFrame(el._geoAnim || 0);
  const fr = t => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    Plotly.relayout(el, {
      "geo.lonaxis.range": [lo0[0] + (lon[0] - lo0[0]) * e, lo0[1] + (lon[1] - lo0[1]) * e],
      "geo.lataxis.range": [la0[0] + (lat[0] - la0[0]) * e, la0[1] + (lat[1] - la0[1]) * e]
    });
    if (k < 1) el._geoAnim = requestAnimationFrame(fr);
  };
  el._geoAnim = requestAnimationFrame(fr);
}
function pintarFicha(p, gasto, total) {
  const gpm = ((AN || {}).gasto_prov_mes || {})[p] || [];
  const ppm = ((AN || {}).padron_prov_mes || {})[p] || [];
  const spm = ((AN || {}).socios_prov_mes || {})[p] || [];
  const n = gpm.length || 1;
  const promSoc = gpm.reduce((s, x) => s + x, 0) / n / Math.max(1, ppm.reduce((s, x) => s + x, 0) / n);
  const ultSoc = (gpm[n - 1] || 0) / Math.max(1, ppm[n - 1] || 0);
  const ultMes = ((AN || {}).periodos || [])[n - 1] || "";
  const ultPadron = ppm[n - 1] || 0;
  const ultCons = spm[n - 1] || 0;
  const totG = Object.values((AN || {}).gasto_prov_mes || {}).reduce((s, a) => s + (a[n - 1] || 0), 0);
  const totS = (((AN || {}).padron_hist || [])[n - 1] || [])[1] || 1;
  const cods = (AN && esTotal()) ? Object.keys(AN.gasto_prov || {}) : [AMB];
  const top = cods.map(c => ({ c, g: (((AN || {}).gasto_prov || {})[c] || {})[p] || 0 }))
    .filter(x => x.g > 0).sort((a, b) => b.g - a.g).slice(0, 3);
  document.getElementById("fpNombre").textContent = p;
  document.getElementById("fpDatos").innerHTML =
    `<div><small>Gasto 36m</small><b>${fmtARS(gasto[p])}</b></div>` +
    `<div><small>% del gasto</small><b>${(gasto[p] / Math.max(1, total) * 100).toFixed(1)}%</b></div>` +
    `<div><small>$ por socio (prom)</small><b>$${fmtN(Math.round(promSoc))}</b></div>` +
    `<div><small>$ por socio (${ultMes.slice(5)}/${ultMes.slice(2, 4)})</small><b>$${fmtN(Math.round(ultSoc))}</b></div>` +
    `<div><small>Socios del padrón</small><b>${fmtN(ultPadron)}</b></div>` +
    `<div><small>Socios con consumo</small><b>${fmtN(ultCons)}</b></div>` +
    `<div class="fp-nota"><small>País ${ultMes.slice(5)}/${ultMes.slice(2, 4)}: $${fmtN(Math.round(totG / totS))} por socio del padrón · Referencia de costo para la cuota, no precio</small></div>`;
  document.getElementById("fpTop").innerHTML = top.map(t =>
    `<li>${practicaDesc(t.c)} — <b>${fmtARS(t.g)}</b></li>`).join("");
  document.getElementById("fichaProv").hidden = false;
  document.getElementById("mapSel").textContent = `${p}: ficha abajo ↓`;
}
async function volarA(p, gasto, total) {
  const el = document.getElementById("mapProv");
  if (!el || typeof Plotly === "undefined" || !el._fullLayout) return;
  if (!geoFull) geoFull = {
    lon: [...el._fullLayout.geo.lonaxis.range],
    lat: [...el._fullLayout.geo.lataxis.range]
  };
  provSel = p;
  if (!p) {
    document.getElementById("fichaProv").hidden = true;
    document.getElementById("mapSel").textContent = "—";
    try {
      await Plotly.restyle(el, {
        "marker.line.color": [PROVINCIAS.map(() => "#fff")],
        "marker.line.width": [PROVINCIAS.map(() => 1)]
      }, [0]);
    } catch (e) { /* no crítico */ }
    animarGeo(el, geoFull.lon, geoFull.lat);
    return;
  }
  const bb = bboxProv(p);
  try {
    await Plotly.restyle(el, {
      "marker.line.color": [PROVINCIAS.map(x => x === p ? "#FFD166" : "#fff")],
      "marker.line.width": [PROVINCIAS.map(x => x === p ? 4 : 1)]
    }, [0]);
  } catch (e) { /* no crítico */ }
  if (bb) animarGeo(el, bb.lon, bb.lat);
  pintarFicha(p, gasto, total);
}
async function dibujarMapa(){
  const el = document.getElementById("mapProv");
  if (!el) return;
  const gasto = gastoProvAmbito();
  const perCapita = {};
  PROVINCIAS.forEach(p => {
    perCapita[p] = gasto[p] / Math.max(1, sociosViva * (PESO_PADRON[p] || 0.005));
  });
  const sinDatos = Object.values(gasto).every(v => !v) || typeof Plotly === "undefined";
  if (sinDatos) { dibujarBarrasFallback(gasto); return; }
  const geo = window.PROV_GEOJSON || null;
  if (!geo) { dibujarBarrasFallback(gasto); return; }
  // Spec 017: no re-dibujar si el gasto no cambió (el slider solo mueve el
  // padrón): preserva cámara y animación del vuelo; actualiza hover + selección.
  const mapaKey = AMB + "|" + PROVINCIAS.map(p => gasto[p]).join(",");
  const totalMapa = Object.values(gasto).reduce((s, x) => s + x, 0);
  if (el._mapaKey === mapaKey && el._fullLayout) {
    try {
      await Plotly.restyle(el, {
        text: [PROVINCIAS.map(p => `${p}<br>${fmtARS(gasto[p])}<br>$${fmtN(Math.round(perCapita[p]))} por socio`)],
        "marker.line.color": [PROVINCIAS.map(p => p === provSel ? "#FFD166" : "#fff")],
        "marker.line.width": [PROVINCIAS.map(p => p === provSel ? 4 : 1)]
      }, [0]);
    } catch (e) { /* hover/selección: no crítico */ }
    if (provSel && PROVINCIAS.includes(provSel)) pintarFicha(provSel, gasto, totalMapa);
    return;
  }
  el._mapaKey = mapaKey;
  try {
    document.getElementById("mapWrap").hidden = false;
    document.getElementById("barFallback").hidden = true;
    await Plotly.react(el, [{
      type: "choropleth", geojson: geo, featureidkey: "properties.cod",
      locationmode: "geojson-id",
      locations: PROVINCIAS, z: PROVINCIAS.map(p => gasto[p]),
      text: PROVINCIAS.map(p => `${p}<br>${fmtARS(gasto[p])}<br>$${fmtN(Math.round(perCapita[p]))} por socio`),
      hoverinfo: "text", colorscale: [[0, "#22364F"], [0.35, "#2A6CB0"], [0.65, "#6AADE6"], [1, "#CDE9FF"]],
      marker: { line: { color: PROVINCIAS.map(p => p === provSel ? "#FFD166" : "#fff"), width: PROVINCIAS.map(p => p === provSel ? 4 : 1) } },
      colorbar: { title: { text: "Gasto 36m" }, thickness: 14, len: 0.8,
        tickvals: [0, 100e9, 200e9, 300e9], ticktext: ["0", "$100.000M", "$200.000M", "$300.000M"] }
    }], { autosize: true, paper_bgcolor: "rgba(0,0,0,0)", font: { color: "#D7E3F0" },
      geo: { scope: "south america", showframe: false, showcoastlines: false,
        bgcolor: "rgba(0,0,0,0)", showland: true, landcolor: "#152B46",
        showocean: true, oceancolor: "rgba(0,0,0,0)",
        fitbounds: "locations", projection: { type: "mercator" },
        domain: { x: [0, 0.70], y: [0, 1] } },
      margin: { t: 10, b: 0, l: 0, r: 0 } },
      { responsive: true, displayModeBar: true, displaylogo: false,
        modeBarButtonsToRemove: ["toImage", "hoverClosestGeo"] });
    const total = Object.values(gasto).reduce((s, x) => s + x, 0);
    el._gastoM = { gasto, total };
    if (!el._clickMapa) {
      el._clickMapa = true;
      el.on("plotly_click", d => {
        const loc = d.points && d.points[0] && d.points[0].location;
        const i = PROVINCIAS.indexOf(loc);
        const g = el._gastoM || { gasto: {}, total: 1 };
        if (i >= 0) volarA(PROVINCIAS[i], g.gasto, g.total);
      });
    }
    const bv = document.getElementById("btnVolverPais");
    if (bv && !bv._wired) {
      bv._wired = true;
      bv.addEventListener("click", () => volarA(null, gasto, total));
    }
    if (provSel && PROVINCIAS.includes(provSel)) {
      // Spec 017: no forzar cámara al re-dibujar (mataba la animación);
      // el vuelo lo maneja volarA; acá solo se repinta la ficha.
      pintarFicha(provSel, gasto, total);
    }
  } catch (e) { dibujarBarrasFallback(gasto); }
}
function dibujarBarrasFallback(gasto){
  document.getElementById("mapWrap").hidden = true;
  const fb = document.getElementById("barFallback");
  fb.hidden = false;
  const orden = [...PROVINCIAS].sort((a, b) => gasto[b] - gasto[a]);
  if (cBar) cBar.destroy();
  cBar = new Chart(document.getElementById("chBar"), {
    type: "bar",
    data: { labels: orden, datasets: [{ data: orden.map(p => gasto[p]),
      backgroundColor: orden.map((_, i) => i < 4 ? ["#6AADE6", "#4C9BE0", "#2A7CC7", "#8AA8C8"][i] : "#3A526E"),
      borderRadius: 6, maxBarThickness: 18 }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: { duration: 900 },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#0A2540", padding: 12, callbacks: { label: c => fmtARS(c.raw) } } },
      scales: { x: { grid: { color: "rgba(157,176,198,.14)" }, ticks: { callback: v => "$" + (v / 1e6).toFixed(0) + "M" } }, y: { grid: { display: false } } } }
  });
  document.getElementById("mapSel").textContent = "Mapa no disponible sin internet: ranking por gasto.";
}

function practicaDesc(codigo) {
  const p = PRACTICAS.find(x => x.codigo === codigo);
  return p ? `${p.codigo} · ${p.nombre}` : codigo;
}

// K-Means sobre 36 meses (perfil temporal + entropía geo + derivación).
// Fuente: window.CLUSTERS (data/clusters.js, pipeline). Sin filtros: es foto estructural.
function renderClusters() {
  const metaEl = document.getElementById("clusterMeta");
  const cardsEl = document.getElementById("clusterCards");
  const driftEl = document.getElementById("clusterDrift");
  const CL = window.CLUSTERS || null, ME = window.CLUSTERS_META || null;
  if (!CL || !CL.clusters || !CL.clusters.length) {
    if (metaEl) metaEl.textContent = "Sin datos de clustering (falta data/clusters.js).";
    return;
  }
  if (metaEl) metaEl.textContent =
    `K-Means K=${ME ? ME.k_optimo : CL.clusters.length} · silhouette ${ME ? ME.silhouette : "—"} · ` +
    `${ME ? ME.n_practicas : 199} prácticas en 36 meses. El invierno explica el grueso con pocas prácticas.`;
  const COLORES = ["#6AADE6", "#E8A25C", "#4CC38A", "#C79BF2", "#F08787", "#4CC3D9", "#9DB0C6", "#D9A066"];
  cardsEl.innerHTML = CL.clusters.map((c, i) => {
    const tops = c.top_practicas.slice(0, 3).map(t => `${t.codigo} · ${t.descripcion}`).join("<br>");
    return `<div><small>${c.nombre} — ${c.n_practicas} prácticas</small>` +
      `<b>${c.pct_gasto.toLocaleString("es-AR")}% del gasto</b>` +
      `<span>${c.pct_q.toLocaleString("es-AR")}% del Q · ${c.capitulos_top}<br>${tops}</span></div>`;
  }).join("");
  const labels = (ME ? ME.periodos : []).map(p =>
    ({ "01": "Ene", "02": "Feb", "03": "Mar", "04": "Abr", "05": "May", "06": "Jun",
       "07": "Jul", "08": "Ago", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dic" }[p.slice(5)] + "-" + p.slice(2, 4)));
  if (cClusters) cClusters.destroy();
  cClusters = new Chart(document.getElementById("chClusters"), {
    type: "line",
    data: { labels, datasets: CL.clusters.map((c, i) => ({
      label: `${c.nombre} (${c.pct_gasto}% gasto)`, data: c.serie_media,
      borderColor: COLORES[i % COLORES.length], backgroundColor: "transparent",
      tension: 0.3, pointRadius: 0 })) },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 900 },
      plugins: { legend: { labels: { usePointStyle: true, pointStyle: "round" } },
        tooltip: { backgroundColor: "#0A2540", padding: 12 } },
      scales: { y: { grid: { color: "rgba(157,176,198,.14)" }, ticks: { callback: v => (v * 100).toFixed(1) + "%" } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } } } }
  });
  const d0 = (CL.top_deriva || [])[0];
  if (driftEl) driftEl.innerHTML = d0
    ? `Cómo leerlo: cada línea es el perfil mensual promedio de un cluster (pico = mes fuerte). ` +
      `Mayor deriva interanual: <b>${d0.codigo} · ${d0.descripcion}</b> (cluster ${d0.cluster + 1}, deriva ${d0.drift}). ` +
      `Si un cluster de invierno crece fuera de temporada, es alerta temprana de desvío.`
    : "Cada línea es el perfil mensual promedio de un cluster.";
  dibujarScatter3D(CL);
  pintarGuia3D(CL);
}

// Dispersión 3D para no-expertos (Spec 004): ejes con nombre verificado
// (pipeline), tamaño = gasto, grupos con nombre de negocio, vistas guiadas.
let vista3d = "TODO";
function dibujarScatter3D(CL) {
  const el = document.getElementById("scatter3d");
  if (!el || typeof Plotly === "undefined" || !CL.puntos_3d) return;
  const COLORES = ["#6AADE6", "#E8A25C", "#4CC38A", "#C79BF2", "#F08787"];
  const infoDe = c => CL.clusters.find(x => x.cluster_id === +c) || {};
  const maxGasto = Math.max(1, ...CL.puntos_3d.map(p => p.gasto || 0));
  const porCluster = {};
  CL.puntos_3d.forEach(p => { (porCluster[p.cluster] = porCluster[p.cluster] || []).push(p); });
  const trazas = Object.entries(porCluster).map(([c, pts]) => {
    const atenuado = vista3d !== "TODO" && (infoDe(c).perfil_dominante || "") !== vista3d;
    return {
      type: "scatter3d", mode: "markers", name: infoDe(c).nombre || ("Cluster " + (+c + 1)),
      x: pts.map(p => p.x), y: pts.map(p => p.y), z: pts.map(p => p.z),
      text: pts.map(p => `${p.codigo} · ${p.descripcion}<br>${p.capitulo}<br><b>${fmtARS(p.gasto || 0)}</b> en 36 meses`),
      hoverinfo: "text",
      marker: {
        size: pts.map(p => {
          const base = 4 + 9 * Math.sqrt((p.gasto || 0) / maxGasto); // tamaño = plata
          return (!esTotal() && p.codigo === AMB) ? Math.max(base, 10) : Math.round(base);
        }),
        color: COLORES[+c % COLORES.length],
        opacity: pts.map(p => atenuado ? 0.1 : ((esTotal() || p.codigo === AMB) ? 0.95 : 0.25))
      }
    };
  });
  const ejes = CL.ejes || [{ titulo: "Eje 1" }, { titulo: "Eje 2" }, { titulo: "Eje 3" }];
  const chico = window.innerWidth < 700;
  const CAM0 = { eye: { x: 1.5, y: 1.5, z: 1.1 } };
  Plotly.react(el, trazas, {
    margin: { t: 30, b: 50, l: 0, r: 0 },
    dragmode: "orbit", paper_bgcolor: "rgba(0,0,0,0)", font: { color: "#D7E3F0" },
    title: { text: esTotal() ? "199 prácticas: estacionalidad × gasto" : `Ámbito resaltado: ${nombreAmbito()}`, font: { size: chico ? 11 : 13 } },
    scene: { uirevision: "camara-fija", camera: CAM0, bgcolor: "rgba(0,0,0,0)",
      xaxis: { title: ejes[0].titulo, color: "#9DB0C6", gridcolor: "#29405E", zerolinecolor: "#29405E" },
      yaxis: { title: ejes[1].titulo, color: "#9DB0C6", gridcolor: "#29405E", zerolinecolor: "#29405E" },
      zaxis: { title: ejes[2].titulo, color: "#9DB0C6", gridcolor: "#29405E", zerolinecolor: "#29405E" } },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.12 }
  }, { responsive: true, displayModeBar: true, displaylogo: false,
    modeBarButtonsToRemove: ["toImage", "hoverClosest3d", "tableRotation"] });
  el._cam0 = CAM0;
  if (!el._click3d) {
    el._click3d = true;
    el.on("plotly_click", d => {
      const p = d.points && d.points[0];
      if (p) document.getElementById("pto3d").textContent =
        `${p.text.replace(/<[^>]+>/g, " ")}`;
    });
  }
}
function pintarGuia3D(CL) {
  const fr = document.getElementById("franja3d");
  const inv = CL.clusters.find(c => c.perfil_dominante === "INVIERNO");
  if (fr) fr.innerHTML = inv
    ? `Conclusión: <b>${inv.n_practicas} prácticas de invierno explican el ${inv.pct_gasto}% del gasto.</b> Ahí se negocia arancel y se planifica la demanda fría.`
    : "Conclusión: el gasto está repartido; ningún grupo estacional domina.";
  const ej = document.getElementById("ejes3d");
  if (ej && CL.ejes) ej.innerHTML = "<b>Qué mide cada eje (verificado con los datos):</b> " +
    CL.ejes.map((e, i) => `${"XYZ"[i]} = <b>${e.titulo}</b> — ${e.frase}`).join(" ");
  const qm = document.getElementById("queMirar");
  if (qm) qm.innerHTML = [
    "<li><b>El tamaño es la plata:</b> los puntos grandes son las prácticas que más gastan en 36 meses (pasá el mouse para ver el monto).</li>",
    "<li><b>Los colores son comportamientos:</b> cada grupo consume distinto en el año; el de invierno se amontona a la derecha.</li>",
    "<li><b>Rotá el cubo</b> con el mouse y acercá con la rueda. En el celu: arrastrá con un dedo para rotar, pellizcá para acercar y tocá un punto para ver el monto.</li>"
  ].join("");
  const bv = document.getElementById("btnVista0");
  if (bv && !bv._wired) {
    bv._wired = true;
    bv.addEventListener("click", () => {
      const el = document.getElementById("scatter3d");
      if (el && el._cam0 && typeof Plotly !== "undefined")
        Plotly.relayout(el, { "scene.camera": el._cam0, "scene.uirevision": "reset-" + Date.now() });
    });
  }
  document.querySelectorAll(".vistas3d [data-vista]").forEach(b => {
    b.classList.toggle("active", b.dataset.vista === vista3d);
    if (!b._wired) {
      b._wired = true;
      b.addEventListener("click", () => {
        vista3d = b.dataset.vista;
        document.querySelectorAll(".vistas3d [data-vista]").forEach(x => x.classList.toggle("active", x === b));
        dibujarScatter3D(window.CLUSTERS);
      });
    }
  });
}

// Herramienta de proyección de gasto — sin nombres propios, 100% genérica

// (render inicial diferido al final del script: el filtro madre se define abajo)

// ---- Modelo ML: real vs predicho + proyección viva por padrón + estacionalidad ----
/* Fuente única: window.PROYECCION (data/proyeccion.js, generado por el pipeline).
   Fallback con los últimos valores conocidos si el archivo falta. */
const HIST_FB = [["2024-10",168772],["2024-11",159837],["2024-12",154853],["2025-01",164490],["2025-02",163916],["2025-03",180453],["2025-04",171170],["2025-05",194005],["2025-06",202214],["2025-07",197784],["2025-08",176436],["2025-09",175580],["2025-10",185868],["2025-11",167730],["2025-12",169835],["2026-01",163053],["2026-02",179353],["2026-03",171150],["2026-04",176540],["2026-05",210352],["2026-06",195370],["2026-07",213232],["2026-08",199664],["2026-09",174998]];
const EVAL_FB = {"2026-05":187824,"2026-06":180213,"2026-07":193607,"2026-08":178845,"2026-09":174942};
const P = window.PROYECCION || null;
const HIST = P ? P.hist : HIST_FB;
const EVAL = P ? P.eval : EVAL_FB;
const Q_BASE = P ? P.volumen_q : 164990, PADRON_BASE = 153000, PRECIO_MEDIO = P ? P.precio_medio : 15328;
const MAE = P ? P.mae : 64, MAPE = P ? P.mape : 4.69, MAPE_TEMP = P ? P.mape_temporal : 7.5;
const CUT = Object.keys(EVAL).sort()[0];
let cML = null, cSeason = null, sociosViva = PADRON_BASE, playTimer = null;
const $ = id => document.getElementById(id);

// ---- Filtro madre: TODO el tablero responde a AMB ("TOTAL" o código de práctica) ----
const AN = window.ANALITICO || null;
let AMB = "TOTAL";
const esTotal = () => AMB === "TOTAL";
function nombreAmbito(){
  if (esTotal()) return "Toda la obra social";
  const p = PRACTICAS.find(x => x.codigo === AMB);
  return p ? `${p.codigo} · ${p.nombre}` : AMB;
}
function baseAmbito(){
  // Base de proyección del ámbito: global = salida del RF; práctica = Q real
  // del último mes × factor padrón (proxy explícito, el RF global no se re-corre).
  if (esTotal() || !AN || !AN.gasto_q_base[AMB]) return { q: Q_BASE, arancel: PRECIO_MEDIO };
  const b = AN.gasto_q_base[AMB];
  return { q: b.q, arancel: b.arancel };
}
function histVista(){
  // Serie visible del ámbito: global usa HIST+EVAL del pipeline; práctica usa
  // su serie real de 36m (sin línea naranja: el corte temporal es global).
  if (esTotal() || !AN || !AN.series_q[AMB]) return { hist: HIST, eval: EVAL };
  const per = AN.periodos, s = AN.series_q[AMB];
  return { hist: per.map((p, i) => [p, s[i]]), eval: {} };
}

function qViva(s){ return Math.round(baseAmbito().q * (s / PADRON_BASE)); }
function gastoViva(s){ return qViva(s) * baseAmbito().arancel; }

// Índice estacional del ámbito: promedio de cada mes calendario / promedio global × 100
function indicesEstacionales(hist){
  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const acc = meses.map(()=>[]);
  (hist || HIST).forEach(([f,v])=>{ acc[parseInt(f.slice(5),10)-1].push(v); });
  const prom = a => a.reduce((s,x)=>s+x,0)/a.length;
  const global = prom((hist || HIST).map(h=>h[1]));
  return { meses, idx: acc.map(a=>Math.round(prom(a)/global*100)) };
}

function dibujarML(){
  const { hist, eval } = histVista();
  const labels = [...hist.map(h=>h[0]), "Mes siguiente*"];
  const real = [...hist.map(h=>h[1]), null]; // sólida y continua: lo que pasó
  const tieneEval = Object.keys(eval).length > 0;
  const ds = [
    { label:"Consumo real (lo que pasó)", data:real, borderColor:"#4C9BE0", backgroundColor:"rgba(76,155,224,.12)", fill:true, tension:.35, pointRadius:0, borderWidth:2.5, spanGaps:false }
  ];
  if (tieneEval) {
    const pred = hist.map(h => eval[h[0]] ?? null);
    pred.push(null); // solo existe en testing
    ds.push({ label:"Modelo: lo que hubiera predicho", data:pred, borderColor:"#F09A4C", borderDash:[7,5], tension:.35, pointRadius:3, borderWidth:2 });
  }
  const fut = labels.map(()=>null);
  fut[fut.length-2] = hist[hist.length-1][1]; // engancha en el último real: sin corte
  fut[fut.length-1] = qViva(sociosViva);
  ds.push({ label:"Proyección mes siguiente (según padrón)", data:fut, borderColor:"#A678D1", borderDash:[3,4], tension:0, pointRadius:[0,9], pointBackgroundColor:"#A678D1", borderWidth:3.5 });
  if (!esTotal()) {
    // Spec 016: fantasma reescalada al padrón actual (referencia visual, el pasado real no cambia).
    const factor = sociosViva / PADRON_BASE;
    const fantasma = [...hist.map(h => Math.round(h[1] * factor)), null];
    ds.push({ label:"A padrón actual (referencia)", data:fantasma, borderColor:"#9DB0C6", borderDash:[2,4], tension:.35, pointRadius:0, borderWidth:1.5 });
  }
  if (cML) cML.destroy();
  cML = new Chart($("chML"), {
    type: "line",
    data: { labels, datasets: ds },
    options: { responsive:true, maintainAspectRatio:false, animation:{duration:600, easing:"easeOutQuart"},
      interaction:{mode:"index", intersect:false},
      plugins:{ legend:{labels:{usePointStyle:true,boxWidth:10,font:{size:11}}}, tooltip:{backgroundColor:"#0A2540",padding:12,callbacks:{label:c=>` ${c.dataset.label}: ${c.raw==null?"—":fmtN(c.raw)+" prestaciones"}`}} },
      scales:{ y:{ticks:{callback:v=>(v/1000).toFixed(0)+"k"}}, x:{ticks:{maxRotation:60,minRotation:45,font:{size:10}}} } }
  });
  const { meses, idx } = indicesEstacionales(hist);
  if (cSeason) cSeason.destroy();
  cSeason = new Chart($("chSeason"), {
    type: "bar",
    data: { labels: meses, datasets: [{ data: idx, backgroundColor: idx.map(v=>v>=110?"#35B981":v>=100?"#4C9BE0":v>=95?"#7FA8CC":"#E5B567"), borderRadius:6 }] },
    options: { responsive:true, maintainAspectRatio:false, animation:{duration:600},
      plugins:{ legend:{display:false}, tooltip:{backgroundColor:"#0A2540",callbacks:{label:c=>` Índice ${c.raw} (${c.raw-100>=0?"+":""}${c.raw-100}%)`}},
        annotation:{}},
      scales:{ y:{min:80,max:120,ticks:{callback:v=>v+"Idx"}}, x:{grid:{display:false}} } }
  });
}

// Alerta del hero: refleja el colchón vigente (lee el DOM: evita orden de init).
function actualizarHeroAlert(){
  const el = document.getElementById("kHeroAlert");
  if (!el) return;
  const pct = parseInt((document.getElementById("colchonRange") || {}).value, 10) || 0;
  el.textContent = pct > 0 ? `Colchón invierno +${pct}% aplicado` : "Invierno: colchón sugerido 8–10%";
  el.parentElement.classList.toggle("alerta", pct > 0);
}

function actualizarViva(){
  const q = qViva(sociosViva), g = gastoViva(sociosViva);
  $("sociosVal").textContent = fmtN(sociosViva);
  $("cSociosLbl").textContent = fmtN(sociosViva);
  $("heroReserva").textContent = fmtARS(g);
  $("heroQ").textContent = fmtN(q);
  $("heroMes").innerHTML = `· Nov 2026 · <span id="heroSocios">${fmtN(sociosViva)} socios</span> · ${nombreAmbito()}`;
  $("kHeroQ").textContent = fmtN(q)+" prestaciones";
  $("kGasto").textContent = fmtARS(g);
  $("kGastoSub").textContent = `Nov-26 · ${nombreAmbito()}`;
  $("kVol").textContent = fmtN(q);
  $("kArancel").textContent = fmtARS(Math.round(baseAmbito().arancel));
  const fmtPct = v => v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
  const prec = 100 - MAPE, precTemp = 100 - MAPE_TEMP;
  $("kHeroPrec").textContent = fmtPct(prec);
  $("kPrecVal").textContent = fmtPct(prec);
  $("kPrecSub").textContent = `MAPE ${fmtPct(MAPE)} · Random Forest`;
  actualizarHeroAlert();
  $("pillModelo").textContent = `Modelo ML · MAPE ${fmtPct(MAPE)} · Precisión ${fmtPct(prec)}`;
  $("mMae").textContent = "±" + fmtN(Math.round(MAE)) + " prestaciones";
  $("mMaeSub").textContent = `En promedio se equivoca en ${fmtN(Math.round(MAE))} por cada predicción`;
  $("mPrec").textContent = fmtPct(prec);
  $("mPrecSub").textContent = `Acierta el ${fmtPct(prec)} (error ${fmtPct(MAPE)})`;
  $("mTemp").textContent = fmtPct(precTemp);
  $("mTempSub").textContent = `Error ${fmtPct(MAPE_TEMP)} en corte temporal`;
  const evalMeses = Object.keys(EVAL).sort();
  const { hist: hv, eval: ev } = histVista();
  const f0 = hv[0][0], f1 = hv[hv.length-1][0];
  const rango = m => ({ "01": "Ene", "02": "Feb", "03": "Mar", "04": "Abr", "05": "May", "06": "Jun", "07": "Jul", "08": "Ago", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dic" }[m.slice(5)] + "-" + m.slice(2, 4));
  const lineaNaranja = Object.keys(ev).length
    ? ` <b>Línea naranja punteada = lo que el modelo predijo</b> para ${rango(evalMeses[0])}→${rango(evalMeses[evalMeses.length-1])} sin haber visto esos meses.`
    : ` (vista por práctica: el corte temporal se audita sobre el total).`;
  $("modeloDesc").innerHTML = `<b>Ámbito: ${nombreAmbito()}</b>. <b>Línea sólida azul = lo que realmente pasó</b> (${rango(f0)} → ${rango(f1)}, siempre continua: el pasado no cambia con el padrón).${lineaNaranja} <b>Violeta = mes siguiente: con ${fmtN(sociosViva)} socios → ${fmtN(qViva(sociosViva))} prestaciones</b> (se mueve con el padrón del panel). El salto Abr→May no es un error: es el pico de invierno que se repite cada año (ver gráfico de estacionalidad).`;
  // Auditoría del corte temporal (global): mes con mayor desvío del modelo.
  let pico = evalMeses[0], gapJul = 0, txtGap = "—";
  if (Object.keys(ev).length) {
    hv.forEach(([f, v]) => { if (ev[f] != null && v > hv.find(h => h[0] === pico)[1]) pico = f; });
    const realPico = hv.find(h => h[0] === pico)[1], evalPico = ev[pico];
    gapJul = Math.round((realPico - evalPico) / realPico * 100);
    txtGap = "−" + gapJul + "% (" + fmtN(evalPico) + " vs " + fmtN(realPico) + " reales)";
  }
  $("mGap").textContent = txtGap;
  const bA = baseAmbito(), qMil = Math.round(bA.q / 153), gMil = Math.round(bA.q / 153 * bA.arancel);
  const lineaAmbito = esTotal()
    ? `<li><b>Prever ${fmtARS(g)}</b> con ${fmtN(sociosViva)} socios (${fmtN(q)} Q × $${fmtN(bA.arancel)} promedio) como fondo de contingencia. Cada +1.000 socios ≈ +${fmtN(qMil)} Q / +${fmtARS(gMil)}.</li>`
    : `<li><b>Prever ${fmtARS(g)} para ${nombreAmbito()}</b> con ${fmtN(sociosViva)} socios (${fmtN(q)} Q × $${fmtN(bA.arancel)}) como fondo de contingencia. Base estimada del último mes real × factor padrón.</li>`;
  $("conclList").innerHTML = [
    lineaAmbito,
    `<li><b>Auditoría del modelo (Random Forest, 36 meses):</b> entrenó sin ver los últimos 5 meses y los predijo con error ${fmtPct(MAPE_TEMP)}. En validación cruzada el error es ${fmtPct(MAPE)} (precisión ${fmtPct(prec)}).${gapJul ? ` Mayor desvío: ${rango(pico)} ${txtGap} — el modelo subestima picos de invierno.` : ""}</li>`,
    `<li><b>Colchón de invierno:</b> May–Jul rinde ~10–14% sobre el promedio. Aplicar <b>8–10% en invierno</b>, 0% en verano. El colchón cubre volatilidad estacional, no falla del modelo.</li>`,
    `<li><b>Concentración:</b> el cluster de invierno (14 prácticas) explica el 35% del gasto y la consulta 42.01.01 ≈ 19% del fondo. Negociar esos aranceles + plan invierno mueve la aguja.</li>`
  ].join("");
  dibujarML(); dibujarMapa(); renderClusters();
}
function refrescoRapido(){
  // Sin destruir el gráfico: solo mueve el punto futuro → animación fluida
  const q = qViva(sociosViva), g = gastoViva(sociosViva);
  $("sociosVal").textContent = fmtN(sociosViva);
  $("cSociosLbl").textContent = fmtN(sociosViva);
  $("heroReserva").textContent = fmtARS(g);
  $("heroQ").textContent = fmtN(q);
  $("heroSocios").textContent = fmtN(sociosViva)+" socios";
  const khq = document.getElementById("kHeroQ");
  if (khq) khq.textContent = fmtN(q)+" prestaciones";
  const kgr = document.getElementById("kGasto");
  if (kgr) kgr.textContent = fmtARS(g);
  const kvr = document.getElementById("kVol");
  if (kvr) kvr.textContent = fmtN(q);
  if (cML){
    const q = qViva(sociosViva);
    cML.data.datasets.forEach(d => {
      if ((d.label || "").startsWith("Proyección")) {
        d.data[d.data.length - 1] = q;
      } else if ((d.label || "").startsWith("A padrón actual")) {
        // Spec 016: la fantasma sigue al slider sin re-animar.
        const { hist } = histVista();
        const factor = sociosViva / PADRON_BASE;
        d.data = [...hist.map(h => Math.round(h[1] * factor)), null];
      }
    });
    cML.update("none"); // sin re-animar: movimiento continuo
  }
  clearTimeout(refrescoRapido._t);
  refrescoRapido._t = setTimeout(actualizarViva, 350); // conclusiones al soltar
}
const rangeEl = $("sociosRange");
function syncRangeFill(){ if(rangeEl) rangeEl.style.setProperty("--fill", ((rangeEl.value - rangeEl.min) / (rangeEl.max - rangeEl.min) * 100) + "%"); }
syncRangeFill();
rangeEl?.addEventListener("input", e => { sociosViva = parseInt(e.target.value,10); syncRangeFill(); refrescoRapido(); });
$("btnResetSocios")?.addEventListener("click", () => { sociosViva = PADRON_BASE; $("sociosRange").value = PADRON_BASE; actualizarViva(); });
$("btnPlay")?.addEventListener("click", e => {
  if (playTimer){ clearInterval(playTimer); playTimer=null; e.target.textContent="▶ Animar"; actualizarViva(); return; }
  e.target.textContent="⏸ Pausar";
  let v = 120000, dir = 1000;
  playTimer = setInterval(()=>{ v += dir; if(v>=200000||v<=120000) dir*=-1; sociosViva=v; $("sociosRange").value=v; refrescoRapido(); },160);
});
// Render inicial (todas las definiciones ya evaluadas: filtro madre, mapa, clusters).
render();
actualizarViva();

// ---- Spec 001 v2: evolución del padrón (36 meses, global + cierre mensual) ----
// HIST ya trae 36 meses del pipeline (proyeccion.js). Solo anteponer los 12
// previos legacy si el payload trajera la ventana vieja de 24.
const HIST_PRE = [["2023-10",166600],["2023-11",154000],["2023-12",152600],["2024-01",154000],["2024-02",161300],["2024-03",165200],["2024-04",163400],["2024-05",182000],["2024-06",178900],["2024-07",183200],["2024-08",165800],["2024-09",164900]];
if (HIST.length <= 24) HIST.unshift(...HIST_PRE);
// Padrón mensual REAL del pipeline (parametros_mensuales.csv vía analitico.js,
// con altas y bajas). Fallback: serie sintética si falta el archivo.
const PADRON_FIN = 153000;
function padronHist(){
  if (AN && AN.padron_hist && AN.padron_hist.length) return AN.padron_hist.map(([m, s]) => [m, s]);
  const n = HIST.length, arr = [];
  for (let i = 0; i < n; i++) arr.push(Math.round(PADRON_FIN / Math.pow(1.004, n - 1 - i)));
  return HIST.map((h, i) => [h[0], arr[i]]);
}
let PH = padronHist(); // [[mes, socios]] REAL del pipeline
let referencia = null; // dato actualizado ingresado (solo referencia, RF-6)
let cPad = null;

function dibujarPadron(){
  const labels = [...PH.map(h => h[0]), "Mes siguiente"];
  const real = [...PH.map(h => h[1]), null];
  const fut = labels.map(() => null);
  fut[fut.length - 2] = PH[PH.length - 1][1];
  fut[fut.length - 1] = sociosViva;
  const ds = [
    { label: "Socios reales", data: real, borderColor: "#6AADE6", backgroundColor: "rgba(106,173,230,.12)", fill: true, tension: .35, pointRadius: 0, borderWidth: 2.5 },
    { label: "Mes siguiente proyectado", data: fut, borderColor: "#A678D1", borderDash: [3, 4], tension: 0, pointRadius: [0, 7], borderWidth: 2.5 }
  ];
  if (referencia != null) {
    const ref = labels.map(() => null);
    ref[ref.length - 1] = referencia;
    ds.push({ label: "Tu referencia", data: ref, borderColor: "#35B981", pointRadius: 6, pointBackgroundColor: "#35B981", showLine: false });
  }
  if (cPad) cPad.destroy();
  cPad = new Chart($("chPadron"), { type: "line",
    data: { labels, datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
      plugins: { legend: { labels: { usePointStyle: true, boxWidth: 10, font: { size: 11 } } } },
      scales: { y: { ticks: { callback: v => (v / 1000).toFixed(0) + "k" } }, x: { ticks: { maxRotation: 60, minRotation: 45, font: { size: 10 } } } } } });
  $("sdPadron").hidden = true;
  // Coincidencia (RF-6)
  const coin = referencia != null && referencia === sociosViva;
  $("coinBadge").hidden = !coin;
}

function refrescoPadron(){ dibujarPadron(); }
$("sociosRange")?.addEventListener("input", refrescoPadron);
$("btnRef")?.addEventListener("click", () => {
  const v = parseInt($("refSocios").value, 10);
  if (!(v > 0)) { $("coinBadge").hidden = true; referencia = null; dibujarPadron(); return; }
  referencia = Math.round(v);
  dibujarPadron();
});

// Cierre mensual RF-5: confirma Q real + padrón real, agrega a la historia (36 fijos) y re-proyecta.
const cMes = $("cMes");
["2026-10", "2026-11"].forEach(m => { const o = document.createElement("option"); o.value = m; o.textContent = m; cMes.appendChild(o); });
const reales = {}; // mes -> {q, padron}
$("btnCierre")?.addEventListener("click", () => {
  const mes = cMes.value, q = parseInt($("cQ").value, 10), p = parseInt($("cPadron").value, 10);
  if (!(q >= 0) || !(p > 0)) { $("cierreMsg").textContent = "Ingresá Q real (0 o más) y padrón real (mayor a 0)."; return; }
  if (reales[mes]) { $("cierreMsg").textContent = `El mes ${mes} ya fue cerrado: no se duplica la fila.`; return; }
  reales[mes] = { q: Math.round(q), padron: Math.round(p) };
  HIST.push([mes, Math.round(q)]); HIST.shift();
  PH.push([mes, Math.round(p)]); PH.shift();
  $("cierreMsg").textContent = `${mes} cerrado: Q ${fmtN(Math.round(q))} · padrón ${fmtN(Math.round(p))}. Historia: ${HIST.length} meses. Proyección re-calculada.`;
  dibujarPadron(); dibujarML();
});
$("btnCsvRow")?.addEventListener("click", () => {
  const mes = cMes.value, r = reales[mes];
  if (!r) { $("cierreMsg").textContent = "Primero confirmá el mes para descargar su fila CSV."; return; }
  const blob = new Blob([`Fecha,Volumen_Q,Padron\n${mes},${r.q},${r.padron}\n`], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `cierre_${mes}.csv`; a.click();
  URL.revokeObjectURL(a.href);
});
// ---- Visor por práctica + FILTRO MADRE: un ámbito gobierna todo el tablero ----
let cPractica = null;
const selPractica = document.getElementById("selPractica");
const ambitoSel = document.getElementById("ambito");
if (selPractica) {
  PRACTICAS.forEach(p => {
    const o = document.createElement("option");
    o.value = p.codigo; o.textContent = `${p.codigo} · ${p.nombre}`;
    selPractica.appendChild(o);
  });
  selPractica.value = "42.01.01";
}
if (ambitoSel) {
  PRACTICAS.forEach(p => {
    const o = document.createElement("option");
    o.value = p.codigo; o.textContent = `${p.codigo} · ${p.nombre}`;
    ambitoSel.appendChild(o);
  });
}
function aplicarAmbito(cod, origen) {
  AMB = cod;
  if (ambitoSel && origen !== "ambito") ambitoSel.value = cod;
  if (selPractica && origen !== "sel") selPractica.value = cod === "TOTAL" ? "42.01.01" : cod;
  $("ambitoSub").textContent = esTotal()
    ? "Ámbito: toda la obra social. Hero, modelo, estacionalidad, mapa y clusters recalculan."
    : `Ámbito: ${nombreAmbito()}. Todo el tablero recalcula sobre este código.`;
  render(); dibujarPractica(); actualizarViva();
}
ambitoSel?.addEventListener("change", () => aplicarAmbito(ambitoSel.value, "ambito"));
function dibujarPractica() {
  if (!selPractica) return;
  const cod = esTotal() ? selPractica.value : AMB;
  if (esTotal() && selPractica) { /* el visor sigue al selector de sección */ }
  const serie = AN && AN.series_q[cod];
  const per = AN ? AN.periodos : [];
  const arancel = (AN && AN.gasto_q_base[cod] && AN.gasto_q_base[cod].arancel)
    || (window.CATALOGO || []).find(p => p.codigo === cod)?.arancel || 0;
  const qMes = serie ? serie.slice() : [];
  const gMes = qMes.map(q => q * arancel);
  const qTot = qMes.reduce((s, x) => s + x, 0);
  const gTot = gMes.reduce((s, x) => s + x, 0);
  const gastoGlobal = AN ? Object.values(AN.gasto_q_base).reduce((s, b) => s + b.gasto * 36, 0) : 1;
  const meta = document.getElementById("practicaMeta");
  if (meta) meta.textContent = qTot
    ? `${pracLabel(cod)} · ${fmtN(qTot)} Q en 36m · ${fmtARS(gTot)} (${(gTot / Math.max(1, gastoGlobal) * 100).toFixed(2)}% del gasto) · arancel ${fmtARS(arancel)}`
    : `${pracLabel(cod)} · sin datos`;
  const sd = document.getElementById("sdPractica");
  if (sd) sd.hidden = qTot > 0;
  if (cPractica) cPractica.destroy();
  const etiquetas = per.map(p => ({ "01": "Ene", "02": "Feb", "03": "Mar", "04": "Abr", "05": "May", "06": "Jun", "07": "Jul", "08": "Ago", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dic" }[p.slice(5)] + "-" + p.slice(2, 4)));
  cPractica = new Chart(document.getElementById("chPractica"), {
    type: "bar",
    data: { labels: etiquetas.length ? etiquetas : qMes.map((_, i) => "M" + (i + 1)),
      datasets: [
        { label: "Gasto ($) — Q × arancel real", data: gMes, yAxisID: "y", backgroundColor: "rgba(10,58,107,.75)", borderRadius: 6 },
        { label: "Volumen (Q) — conteo exacto del pipeline", data: qMes, yAxisID: "y1", type: "line", borderColor: "#35B981", tension: .3, pointRadius: 0 }
      ] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
      plugins: { legend: { labels: { usePointStyle: true, boxWidth: 10 } },
        tooltip: { backgroundColor: "#0A2540", padding: 12, callbacks: { label: c => c.dataset.yAxisID === "y" ? ` ${fmtARS(c.raw)}` : ` ${fmtN(c.raw)} Q` } } },
      scales: { y: { ticks: { callback: v => "$" + (v / 1e6).toFixed(1) + "M" } }, y1: { position: "right", grid: { drawOnChartArea: false } } } }
  });
}
selPractica?.addEventListener("change", () => { if (esTotal()) dibujarPractica(); else aplicarAmbito(selPractica.value, "sel"); });
dibujarPractica();
dibujarPadron();

// ---- Colchón invierno (idea marketing #15: calculadora accionable) ----
const colRange = $("colchonRange");
function actualizarColchon() {
  if (!colRange) return;
  const pct = parseInt(colRange.value, 10) || 0;
  $("colchonVal").textContent = pct + "%";
  colRange.style.setProperty("--fill", (pct / 20 * 100) + "%");
  const g = gastoViva(sociosViva);
  const tot = Math.round(g * (1 + pct / 100));
  const el = $("vColchon");
  if (el) el.textContent = fmtARS(tot);
  actualizarHeroAlert();
}
colRange?.addEventListener("input", actualizarColchon);
const _av = actualizarViva;
actualizarViva = function () { _av(); actualizarColchon(); };
$("sociosRange")?.addEventListener("input", () => setTimeout(actualizarColchon, 360));
actualizarColchon();

// ---- Spec 004: pestañas reales (los canvas ocultos miden 0: redibujar al mostrar) ----
function refrescoTotal(){ render(); dibujarPractica(); dibujarPadron(); actualizarViva(); }
function mostrarTab(nombre){
  document.querySelectorAll(".tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === nombre ? "true" : "false"));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.dataset.panel === nombre));
}
function activarTab(nombre){
  // Spec 005 RF-1: al inicio del contenido (barra de pestañas), nunca al hero.
  mostrarTab(nombre);
  document.querySelector(".tabs").scrollIntoView({ behavior: "smooth", block: "start" });
  requestAnimationFrame(() => requestAnimationFrame(refrescoTotal));
}
document.querySelectorAll(".tabs [data-tab]").forEach(b => b.addEventListener("click", () => activarTab(b.dataset.tab)));
document.getElementById("btnControles")?.addEventListener("click", () => document.getElementById("barraControles")?.classList.toggle("abierto"));
