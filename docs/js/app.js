/* Mapa interactivo — Renovación del Congreso 2027
 * Sin backend: todo se resuelve con fetch a los JSON estáticos en /data.
 */

// ---------------------------------------------------------------------
// Normalización de nombres de provincia para cruzar CSV/XLSX <-> GeoJSON
// ---------------------------------------------------------------------
function normalize(s) {
  if (!s) return "";
  return s
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// El geojson de Georef trae nombres completos que no coinciden 1:1 con los
// distritos de las nóminas legislativas. Alias explícitos para esos casos.
const GEOJSON_NAME_ALIASES = {
  "TIERRA DEL FUEGO, ANTARTIDA E ISLAS DEL ATLANTICO SUR": "TIERRA DEL FUEGO",
};

// Los datos de las nóminas usan "CIUDAD DE BUENOS AIRES"; el geojson usa
// "Ciudad Autónoma de Buenos Aires". Se unifican ambos en una sola clave canónica.
const DATA_NAME_ALIASES = {
  "CIUDAD DE BUENOS AIRES": "CIUDAD AUTONOMA DE BUENOS AIRES",
};

function canonProvinciaFromData(raw) {
  const n = normalize(raw);
  return DATA_NAME_ALIASES[n] || n;
}

function canonProvinciaFromGeojson(raw) {
  const n = normalize(raw);
  return GEOJSON_NAME_ALIASES[n] || n;
}

// ---------------------------------------------------------------------
// Colores por bloque (determinístico, paleta acotada y sobria)
// ---------------------------------------------------------------------
const BLOQUE_PALETTE = [
  "#005ca9", "#b98a24", "#2f7d4f", "#a83f2a", "#6a4c93",
  "#1b998b", "#c04abc", "#3f6b4f", "#c9622a", "#4a5fc1",
  "#8a8a3c", "#c14b6a", "#2e8b8b", "#8a5a2f", "#5a6b8a",
  "#a1435a", "#4f8a3f", "#8a4f8a", "#3f8aa1", "#a17a3f", "#6b6b6b",
];
const bloqueColorCache = new Map();
function colorForBloque(bloque) {
  if (bloqueColorCache.has(bloque)) return bloqueColorCache.get(bloque);
  let hash = 0;
  for (let i = 0; i < bloque.length; i++) {
    hash = (hash * 31 + bloque.charCodeAt(i)) >>> 0;
  }
  const color = BLOQUE_PALETTE[hash % BLOQUE_PALETTE.length];
  bloqueColorCache.set(bloque, color);
  return color;
}

// ---------------------------------------------------------------------
// Helpers de agrupación
// ---------------------------------------------------------------------
function groupByProvincia(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = canonProvinciaFromData(row.provincia);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function countByProvincia(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = canonProvinciaFromData(row.provincia);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

function uniqueBloques(rows) {
  return Array.from(new Set(rows.map((r) => r.bloque))).sort((a, b) =>
    a.localeCompare(b, "es")
  );
}

// ---------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------
const state = {
  chamber: "senado", // 'senado' | 'diputados'
  bloqueFiltro: "",  // '' = sin filtro

  diputadosTodos: [],
  senadoresTodos: [],

  diputados2027ByProv: new Map(),   // provincia -> filas que renuevan en 2027
  diputadosVigentesByProv: new Map(), // provincia -> filas con mandato vigente hasta 2029
  senadores2027ByProv: new Map(),   // provincia -> filas que renuevan en 2027
  senadoresCeseAnioPorProv: new Map(), // provincia (no renueva en 2027) -> año de cese

  bloquesDiputados: [],
  bloquesSenado: [],

  desdoblamientoFiltro: null, // null | 'all' | 'desdobla' | 'no_desdobla' | 'en_definicion' | 'sin_dato'
  desdoblamientoByProv: new Map(),
  displayNameByProv: new Map(), // clave canónica -> nombre bonito (del geojson)
  geoLayer: null,
  provinciasConDiputados: new Set(),
  provinciasConSenadores: new Set(),
};

const DESDOBLAMIENTO_LABEL = {
  desdobla: "Desdobla",
  no_desdobla: "No desdobla",
  en_definicion: "En definición",
  sin_dato: "Sin dato",
};

const DESDOBLAMIENTO_COLOR = {
  desdobla: "#2f7d4f",
  no_desdobla: "#a83f2a",
  en_definicion: "#b98a24",
  sin_dato: "#9aa1a6",
};

function getDesdoblamiento(provKey) {
  return (
    state.desdoblamientoByProv.get(provKey) || {
      estado: "sin_dato",
      fecha: null,
      nota: null,
    }
  );
}

function badgeHTML(provKey) {
  const d = getDesdoblamiento(provKey);
  const label = DESDOBLAMIENTO_LABEL[d.estado] || "Sin dato";
  const fechaTxt = d.fecha ? ` · ${formatFecha(d.fecha)}` : "";
  return `<span class="badge badge-${d.estado}">${label}${fechaTxt}</span>`;
}

function formatFecha(iso) {
  const [y, m, d] = iso.split("-");
  const meses = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
  return `${parseInt(d, 10)} de ${meses[parseInt(m, 10) - 1]} de ${y}`;
}

// ---------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------
async function loadData() {
  const [diputados, senadores, desdoblamiento, geojson] = await Promise.all([
    fetch("data/diputados_todos.json").then((r) => r.json()),
    fetch("data/senadores_todos.json").then((r) => r.json()),
    fetch("data/desdoblamiento_2027.json").then((r) => r.json()),
    fetch("data/provincias.geojson").then((r) => r.json()),
  ]);

  state.diputadosTodos = diputados;
  state.senadoresTodos = senadores;

  // Nombres de exhibición: uno por clave canónica, tomado del geojson.
  geojson.features.forEach((f) => {
    const key = canonProvinciaFromGeojson(f.properties.nombre);
    state.displayNameByProv.set(key, f.properties.nombre);
  });

  const diputados2027 = diputados.filter((d) => d.finalizaAnio === 2027);
  const diputadosVigentes = diputados.filter((d) => d.finalizaAnio !== 2027);
  state.diputados2027ByProv = groupByProvincia(diputados2027);
  state.diputadosVigentesByProv = groupByProvincia(diputadosVigentes);
  state.provinciasConDiputados = new Set(state.diputados2027ByProv.keys());
  state.bloquesDiputados = uniqueBloques(diputados2027);

  const senadores2027 = senadores.filter((s) => s.ceseAnio === 2027);
  const senadoresNo2027 = senadores.filter((s) => s.ceseAnio !== 2027);
  state.senadores2027ByProv = groupByProvincia(senadores2027);
  state.provinciasConSenadores = new Set(state.senadores2027ByProv.keys());
  state.bloquesSenado = uniqueBloques(senadores2027);

  senadoresNo2027.forEach((s) => {
    const key = canonProvinciaFromData(s.provincia);
    state.senadoresCeseAnioPorProv.set(key, s.ceseAnio);
  });

  desdoblamiento.forEach((row) => {
    const key = canonProvinciaFromData(row.provincia);
    state.desdoblamientoByProv.set(key, row);
  });

  return geojson;
}

// ---------------------------------------------------------------------
// Coropleta
// ---------------------------------------------------------------------
function currentByProv() {
  return state.chamber === "senado" ? state.senadores2027ByProv : state.diputados2027ByProv;
}

function maxCountForBloque(bloque) {
  let max = 0;
  currentByProv().forEach((rows) => {
    const n = rows.filter((r) => r.bloque === bloque).length;
    if (n > max) max = n;
  });
  return max;
}

function colorScaleBlue(t) {
  // t en [0,1] -> interpola entre celeste muy pálido y azul institucional profundo
  const stops = [
    [214, 238, 251], // brand-sky-pale
    [0, 92, 169],    // brand-primary
    [21, 85, 163],   // brand-deep
  ];
  const seg = t <= 0.5 ? 0 : 1;
  const localT = t <= 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = stops[seg];
  const b = stops[seg + 1];
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * localT));
  return `rgb(${rgb.join(",")})`;
}

function styleForProvince(provKey) {
  const base = {
    weight: 1,
    color: "#ffffff",
    fillOpacity: 0.92,
  };

  if (state.desdoblamientoFiltro) {
    const estado = getDesdoblamiento(provKey).estado;
    const color = DESDOBLAMIENTO_COLOR[estado] || DESDOBLAMIENTO_COLOR.sin_dato;
    if (state.desdoblamientoFiltro === "all" || state.desdoblamientoFiltro === estado) {
      return Object.assign(base, { fillColor: color, fillOpacity: 0.88 });
    }
    return Object.assign(base, { fillColor: "#e7edf3", fillOpacity: 0.3, color: "#c7c7c9" });
  }

  if (!state.bloqueFiltro) {
    if (state.chamber === "senado") {
      const renueva = state.provinciasConSenadores.has(provKey);
      return Object.assign(base, {
        fillColor: renueva ? "#005ca9" : "#e7edf3",
        color: renueva ? "#ffffff" : "#c7c7c9",
        fillOpacity: renueva ? 0.92 : 0.55,
      });
    }
    return Object.assign(base, { fillColor: "#5f9dc9", fillOpacity: 0.85 });
  }

  const rows = currentByProv().get(provKey) || [];
  const n = rows.filter((r) => r.bloque === state.bloqueFiltro).length;
  const max = maxCountForBloque(state.bloqueFiltro) || 1;
  if (n === 0) {
    return Object.assign(base, { fillColor: "#e7edf3", fillOpacity: 0.55, color: "#c7c7c9" });
  }
  const t = n / max;
  return Object.assign(base, { fillColor: colorScaleBlue(t), fillOpacity: 0.92 });
}

// ---------------------------------------------------------------------
// Mapa Leaflet
// ---------------------------------------------------------------------
let map;

// Bounds del territorio continental + Tierra del Fuego (el reclamo antártico
// ya se removió de la geometría en build_data.py).
const ARGENTINA_BOUNDS = L.latLngBounds([
  [-55.5, -73.6],
  [-21.6, -53.5],
]);

function initMap(geojson) {
  map = L.map("map", {
    zoomControl: true,
    attributionControl: false,
    minZoom: 3,
    maxZoom: 7,
    scrollWheelZoom: false,
  });

  state.geoLayer = L.geoJSON(geojson, {
    style: (feature) => styleForProvince(canonProvinciaFromGeojson(feature.properties.nombre)),
    onEachFeature: (feature, layer) => {
      const key = canonProvinciaFromGeojson(feature.properties.nombre);
      layer.on({
        mouseover: (e) => {
          e.target.setStyle({ weight: 2.5, color: "#0d3f73" });
          e.target.bringToFront();
        },
        mouseout: (e) => {
          state.geoLayer.resetStyle(e.target);
        },
        click: () => openPanel(key),
      });
      layer.bindTooltip(tooltipHTML(key), {
        sticky: true,
        direction: "top",
        className: "province-tooltip-wrap",
      });
    },
  }).addTo(map);

  // El contenedor puede no tener aún su tamaño final (fuentes cargando,
  // layout todavía asentándose) en el momento de crear el mapa: se fuerza un
  // recálculo antes de encuadrar para evitar que los polígonos se proyecten
  // sobre un lienzo de ancho 0.
  const fitToArgentina = () => {
    map.invalidateSize();
    map.fitBounds(ARGENTINA_BOUNDS, { padding: [14, 14] });
  };
  fitToArgentina();
  [100, 300, 700, 1200].forEach((ms) => setTimeout(fitToArgentina, ms));
  window.addEventListener("load", fitToArgentina);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) fitToArgentina();
  });
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => fitToArgentina());
    ro.observe(document.getElementById("map"));
    setTimeout(() => ro.disconnect(), 3000);
  }
  window.addEventListener("resize", () => map.invalidateSize());
}

function tooltipHTML(provKey) {
  const name = state.displayNameByProv.get(provKey) || provKey;
  let bodyHTML;

  if (state.chamber === "senado") {
    const rows = state.senadores2027ByProv.get(provKey) || [];
    if (rows.length > 0) {
      bodyHTML = `${rows.length} ${rows.length === 1 ? "senador" : "senadores"} renuevan en 2027`;
    } else {
      const anio = state.senadoresCeseAnioPorProv.get(provKey);
      bodyHTML = anio
        ? `No renueva en 2027 — mandato vigente hasta ${anio}`
        : "No renueva en 2027";
    }
  } else {
    const renuevan = (state.diputados2027ByProv.get(provKey) || []).length;
    const vigentes = (state.diputadosVigentesByProv.get(provKey) || []).length;
    const partes = [];
    partes.push(`${renuevan} ${renuevan === 1 ? "diputado renueva" : "diputados renuevan"} en 2027`);
    partes.push(`${vigentes} ${vigentes === 1 ? "continúa" : "continúan"} con mandato vigente`);
    bodyHTML = partes.join("<br>");
  }

  return `<div class="province-tooltip"><strong>${name}</strong>${bodyHTML}<div class="tt-badge">${badgeHTML(provKey)}</div></div>`;
}

function refreshMapStyles() {
  if (!state.geoLayer) return;
  state.geoLayer.eachLayer((layer) => {
    const key = canonProvinciaFromGeojson(layer.feature.properties.nombre);
    layer.setStyle(styleForProvince(key));
    layer.unbindTooltip();
    layer.bindTooltip(tooltipHTML(key), {
      sticky: true,
      direction: "top",
      className: "province-tooltip-wrap",
    });
  });
}

// ---------------------------------------------------------------------
// Panel lateral (detalle de una provincia)
// ---------------------------------------------------------------------
const panelEl = document.getElementById("panel");
const panelOverlayEl = document.getElementById("panelOverlay");
const panelTitleEl = document.getElementById("panelTitle");
const panelBadgeEl = document.getElementById("panelBadge");
const panelCountEl = document.getElementById("panelCount");
const panelListEl = document.getElementById("panelList");

function legislatorLi(row, extraClass) {
  const li = document.createElement("li");
  if (extraClass) li.className = extraClass;
  const dot = document.createElement("span");
  dot.className = "pl-dot";
  dot.style.background = colorForBloque(row.bloque);
  const text = document.createElement("span");
  text.innerHTML = `<span class="pl-name">${row.apellido}, ${row.nombre}</span><span class="pl-bloque">${row.bloque}</span>`;
  li.appendChild(dot);
  li.appendChild(text);
  return li;
}

function appendLegislatorRows(rows, emptyText) {
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "panel-empty";
    li.textContent = emptyText;
    panelListEl.appendChild(li);
    return;
  }
  rows
    .slice()
    .sort((a, b) => a.apellido.localeCompare(b.apellido, "es"))
    .forEach((row) => panelListEl.appendChild(legislatorLi(row)));
}

function openPanel(provKey) {
  const name = state.displayNameByProv.get(provKey) || provKey;

  panelTitleEl.textContent = name;
  panelBadgeEl.innerHTML = badgeHTML(provKey);
  panelListEl.innerHTML = "";

  if (state.chamber === "senado") {
    const rows = state.senadores2027ByProv.get(provKey) || [];
    panelCountEl.textContent =
      rows.length === 0
        ? "Sin bancas de Senado venciendo en 2027"
        : `${rows.length} banca${rows.length === 1 ? "" : "s"} de Senado vencen el 9/12/2027`;
    appendLegislatorRows(rows, "No hay senadores renovando en esta provincia en 2027.");
  } else {
    const rows2027 = state.diputados2027ByProv.get(provKey) || [];
    const rowsVigentes = state.diputadosVigentesByProv.get(provKey) || [];
    panelCountEl.textContent = `${rows2027.length} banca${rows2027.length === 1 ? "" : "s"} vence${rows2027.length === 1 ? "" : "n"} el 9/12/2027 · ${rowsVigentes.length} con mandato vigente hasta 2029`;

    const heading2027 = document.createElement("li");
    heading2027.className = "panel-section-title";
    heading2027.textContent = `Vencen el 9/12/2027 (${rows2027.length})`;
    panelListEl.appendChild(heading2027);
    rows2027
      .slice()
      .sort((a, b) => a.apellido.localeCompare(b.apellido, "es"))
      .forEach((row) => panelListEl.appendChild(legislatorLi(row)));
    if (rows2027.length === 0) {
      const li = document.createElement("li");
      li.className = "panel-empty";
      li.textContent = "Ningún diputado de esta provincia renueva en 2027.";
      panelListEl.appendChild(li);
    }

    const heading2029 = document.createElement("li");
    heading2029.className = "panel-section-title panel-section-title-2029";
    heading2029.textContent = `Mandato vigente hasta 2029 (${rowsVigentes.length})`;
    panelListEl.appendChild(heading2029);
    if (rowsVigentes.length === 0) {
      const li = document.createElement("li");
      li.className = "panel-empty";
      li.textContent = "Ningún diputado de esta provincia tiene mandato hasta 2029.";
      panelListEl.appendChild(li);
    } else {
      rowsVigentes
        .slice()
        .sort((a, b) => a.apellido.localeCompare(b.apellido, "es"))
        .forEach((row) => panelListEl.appendChild(legislatorLi(row, "panel-row-2029")));
    }
  }

  panelEl.classList.add("open");
  panelOverlayEl.classList.add("open");
  panelEl.setAttribute("aria-hidden", "false");
}

function closePanel() {
  panelEl.classList.remove("open");
  panelOverlayEl.classList.remove("open");
  panelEl.setAttribute("aria-hidden", "true");
}

document.getElementById("panelClose").addEventListener("click", closePanel);
panelOverlayEl.addEventListener("click", closePanel);

// ---------------------------------------------------------------------
// Leyenda del mapa (coropleta / senado)
// ---------------------------------------------------------------------
const legendEl = document.getElementById("legend");

function renderLegend() {
  if (state.desdoblamientoFiltro) {
    const rows = Object.keys(DESDOBLAMIENTO_LABEL)
      .map(
        (estado) =>
          `<div class="legend-row"><span class="legend-swatch" style="background:${DESDOBLAMIENTO_COLOR[estado]}"></span>${DESDOBLAMIENTO_LABEL[estado]}</div>`
      )
      .join("");
    legendEl.innerHTML = `
      <h3>Desdoblamiento electoral 2027</h3>
      ${rows}
      <p style="margin:6px 0 0;color:var(--ink-faint)">Clic de nuevo en la categoría o en el título para volver al mapa por cámara.</p>
    `;
    return;
  }

  if (!state.bloqueFiltro) {
    if (state.chamber === "senado") {
      legendEl.innerHTML = `
        <h3>Senado 2027</h3>
        <div class="legend-row"><span class="legend-swatch" style="background:#005ca9"></span>Provincia renueva (3 bancas)</div>
        <div class="legend-row"><span class="legend-swatch" style="background:#e7edf3;border-color:#c7c7c9"></span>No renueva en 2027</div>
      `;
      return;
    }
    legendEl.innerHTML = `
      <h3>Diputados 2027</h3>
      <div class="legend-row"><span class="legend-swatch" style="background:#5f9dc9"></span>Provincia con bancas que renuevan</div>
      <p style="margin:6px 0 0;color:var(--ink-faint)">Elegí un bloque en el filtro para ver la coropleta por cantidad de bancas.</p>
    `;
    return;
  }

  const max = maxCountForBloque(state.bloqueFiltro);
  legendEl.innerHTML = `
    <h3>${escapeHTML(state.bloqueFiltro)}</h3>
    <div class="legend-scale">
      <div class="legend-scale-bar"></div>
    </div>
    <div class="legend-scale-labels"><span>1 banca</span><span>${max} banca${max === 1 ? "" : "s"}</span></div>
    <div class="legend-row" style="margin-top:8px"><span class="legend-swatch" style="background:#e7edf3;border-color:#c7c7c9"></span>Sin bancas de este bloque</div>
  `;
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------------------------------------------------------------------
// Resumen de bloque (al costado del mapa, cuando hay un bloque filtrado)
// ---------------------------------------------------------------------
const bloqueSummaryEl = document.getElementById("bloqueSummary");
const summaryNameEl = document.getElementById("summaryBloqueName");
const summaryActualesEl = document.getElementById("summaryActuales");
const summaryEnJuegoEl = document.getElementById("summaryEnJuego");
const summaryProvListEl = document.getElementById("summaryProvList");

function renderBloqueSummary() {
  if (!state.bloqueFiltro) {
    bloqueSummaryEl.hidden = true;
    return;
  }

  const todos = state.chamber === "senado" ? state.senadoresTodos : state.diputadosTodos;
  const anioKey = state.chamber === "senado" ? "ceseAnio" : "finalizaAnio";
  const bloque = state.bloqueFiltro;

  const actuales = todos.filter((r) => r.bloque === bloque).length;
  const enJuego = todos.filter((r) => r.bloque === bloque && r[anioKey] === 2027).length;

  const porProvincia = new Map();
  currentByProv().forEach((rows, provKey) => {
    const n = rows.filter((r) => r.bloque === bloque).length;
    if (n > 0) porProvincia.set(provKey, n);
  });
  const provinciasOrdenadas = Array.from(porProvincia.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const nameA = state.displayNameByProv.get(a[0]) || a[0];
    const nameB = state.displayNameByProv.get(b[0]) || b[0];
    return nameA.localeCompare(nameB, "es");
  });

  summaryNameEl.textContent = bloque;
  summaryActualesEl.textContent = actuales;
  summaryEnJuegoEl.textContent = enJuego;

  summaryProvListEl.innerHTML = "";
  if (provinciasOrdenadas.length === 0) {
    const li = document.createElement("li");
    li.className = "summary-empty";
    li.textContent = "Sin bancas en juego en 2027.";
    summaryProvListEl.appendChild(li);
  } else {
    provinciasOrdenadas.forEach(([provKey, n]) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = state.displayNameByProv.get(provKey) || provKey;
      const count = document.createElement("span");
      count.className = "summary-prov-count";
      count.textContent = n;
      li.appendChild(name);
      li.appendChild(count);
      summaryProvListEl.appendChild(li);
    });
  }

  bloqueSummaryEl.hidden = false;
}

// ---------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------
const bloqueSelect = document.getElementById("bloqueSelect");
const controlsHint = document.getElementById("controlsHint");

function populateBloqueSelect() {
  const bloques = state.chamber === "senado" ? state.bloquesSenado : state.bloquesDiputados;
  bloqueSelect.innerHTML = '<option value="">Todos los bloques (sin coropleta)</option>';
  bloques.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b;
    opt.textContent = b;
    bloqueSelect.appendChild(opt);
  });
  bloqueSelect.value = "";
}

function setChamber(chamber) {
  state.chamber = chamber;
  state.bloqueFiltro = "";
  document.querySelectorAll(".chamber-btn").forEach((btn) => {
    const active = btn.dataset.chamber === chamber;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  populateBloqueSelect();
  controlsHint.textContent =
    chamber === "senado"
      ? "8 provincias renuevan un tercio del Senado en 2027 (24 bancas en total)."
      : "Las 24 provincias renuevan diputados en 2027.";
  refreshMapStyles();
  renderLegend();
  renderBloqueSummary();
  closePanel();
}

document.querySelectorAll(".chamber-btn").forEach((btn) => {
  btn.addEventListener("click", () => setChamber(btn.dataset.chamber));
});

bloqueSelect.addEventListener("change", () => {
  state.bloqueFiltro = bloqueSelect.value;
  refreshMapStyles();
  renderLegend();
  renderBloqueSummary();
});

// ---------------------------------------------------------------------
// Leyenda de desdoblamiento clickeable (filtra/colorea el mapa)
// ---------------------------------------------------------------------
const badgeLegendLabelEl = document.getElementById("badgeLegendLabel");

function updateBadgeLegendActiveStates() {
  badgeLegendLabelEl.classList.toggle("active", state.desdoblamientoFiltro === "all");
  document.querySelectorAll("#badgeLegend [data-estado]").forEach((el) => {
    el.classList.toggle("active", state.desdoblamientoFiltro === el.dataset.estado);
  });
}

function setDesdoblamientoFiltro(value) {
  state.desdoblamientoFiltro = state.desdoblamientoFiltro === value ? null : value;
  refreshMapStyles();
  renderLegend();
  updateBadgeLegendActiveStates();
}

badgeLegendLabelEl.addEventListener("click", () => setDesdoblamientoFiltro("all"));
badgeLegendLabelEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    setDesdoblamientoFiltro("all");
  }
});

document.querySelectorAll("#badgeLegend [data-estado]").forEach((el) => {
  el.addEventListener("click", () => setDesdoblamientoFiltro(el.dataset.estado));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setDesdoblamientoFiltro(el.dataset.estado);
    }
  });
});

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
(async function init() {
  const geojson = await loadData();
  initMap(geojson);
  setChamber("senado");
})();
