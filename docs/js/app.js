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
// Estado global
// ---------------------------------------------------------------------
const state = {
  chamber: "senado", // 'senado' | 'diputados'
  bloqueFiltro: "",  // '' = sin filtro (solo aplica a diputados)
  diputadosByProv: new Map(),
  senadoresByProv: new Map(),
  desdoblamientoByProv: new Map(),
  displayNameByProv: new Map(), // clave canónica -> nombre bonito (del geojson)
  bloques: [],
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
    fetch("data/diputados_2027.json").then((r) => r.json()),
    fetch("data/senadores_2027.json").then((r) => r.json()),
    fetch("data/desdoblamiento_2027.json").then((r) => r.json()),
    fetch("data/provincias.geojson").then((r) => r.json()),
  ]);

  // Nombres de exhibición: uno por clave canónica, tomado del geojson.
  geojson.features.forEach((f) => {
    const key = canonProvinciaFromGeojson(f.properties.nombre);
    state.displayNameByProv.set(key, f.properties.nombre);
  });

  diputados.forEach((row) => {
    const key = canonProvinciaFromData(row.provincia);
    if (!state.diputadosByProv.has(key)) state.diputadosByProv.set(key, []);
    state.diputadosByProv.get(key).push(row);
    state.provinciasConDiputados.add(key);
  });

  senadores.forEach((row) => {
    const key = canonProvinciaFromData(row.provincia);
    if (!state.senadoresByProv.has(key)) state.senadoresByProv.set(key, []);
    state.senadoresByProv.get(key).push(row);
    state.provinciasConSenadores.add(key);
  });

  desdoblamiento.forEach((row) => {
    const key = canonProvinciaFromData(row.provincia);
    state.desdoblamientoByProv.set(key, row);
  });

  state.bloques = Array.from(new Set(diputados.map((d) => d.bloque))).sort(
    (a, b) => a.localeCompare(b, "es")
  );

  return geojson;
}

// ---------------------------------------------------------------------
// Coropleta
// ---------------------------------------------------------------------
function maxCountForBloque(bloque) {
  let max = 0;
  state.diputadosByProv.forEach((rows) => {
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

  if (state.chamber === "senado") {
    const renueva = state.provinciasConSenadores.has(provKey);
    return Object.assign(base, {
      fillColor: renueva ? "#005ca9" : "#e7edf3",
      color: renueva ? "#ffffff" : "#c7c7c9",
      fillOpacity: renueva ? 0.92 : 0.55,
    });
  }

  // Diputados
  if (!state.bloqueFiltro) {
    return Object.assign(base, { fillColor: "#5f9dc9", fillOpacity: 0.85 });
  }

  const rows = state.diputadosByProv.get(provKey) || [];
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

// Bounds del territorio continental + Tierra del Fuego. La geometría de
// "Tierra del Fuego, Antártida e Islas del Atlántico Sur" en el geojson de
// Georef incluye el reclamo antártico (hasta -90° de latitud); si se usara
// layer.getBounds() el mapa se encuadraría para abarcar la Antártida y las
// provincias continentales quedarían reducidas a un punto. Se fija un bbox
// razonable en su lugar.
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
  // Red de seguridad: el contenedor puede no tener su tamaño final en el
  // momento exacto en que se crea el mapa (fuentes/CSS todavía asentándose),
  // así que se reintenta unas cuantas veces durante el primer segundo y,
  // sobre todo, en cuanto el navegador confirme que el tamaño cambió.
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
  const count =
    state.chamber === "senado"
      ? (state.senadoresByProv.get(provKey) || []).length
      : (state.diputadosByProv.get(provKey) || []).length;
  const camaraLabel = state.chamber === "senado" ? "senador" : "diputado";
  const camaraLabelPlural = state.chamber === "senado" ? "senadores" : "diputados";
  const countTxt =
    count === 0
      ? `Sin bancas de ${state.chamber === "senado" ? "Senado" : "Diputados"} en 2027`
      : `${count} ${count === 1 ? camaraLabel : camaraLabelPlural} renuevan en 2027`;
  return `<div class="province-tooltip"><strong>${name}</strong>${countTxt}<div class="tt-badge">${badgeHTML(provKey)}</div></div>`;
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
// Panel lateral
// ---------------------------------------------------------------------
const panelEl = document.getElementById("panel");
const panelOverlayEl = document.getElementById("panelOverlay");
const panelTitleEl = document.getElementById("panelTitle");
const panelBadgeEl = document.getElementById("panelBadge");
const panelCountEl = document.getElementById("panelCount");
const panelListEl = document.getElementById("panelList");

function openPanel(provKey) {
  const name = state.displayNameByProv.get(provKey) || provKey;
  const rows =
    state.chamber === "senado"
      ? state.senadoresByProv.get(provKey) || []
      : state.diputadosByProv.get(provKey) || [];

  panelTitleEl.textContent = name;
  panelBadgeEl.innerHTML = badgeHTML(provKey);

  const camaraLabel = state.chamber === "senado" ? "Senado" : "Diputados";
  panelCountEl.textContent =
    rows.length === 0
      ? `Sin bancas de ${camaraLabel} venciendo en 2027`
      : `${rows.length} banca${rows.length === 1 ? "" : "s"} de ${camaraLabel} vencen el 9/12/2027`;

  panelListEl.innerHTML = "";
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "panel-empty";
    li.textContent = "No hay legisladores de esta cámara renovando en esta provincia en 2027.";
    panelListEl.appendChild(li);
  } else {
    rows
      .slice()
      .sort((a, b) => a.apellido.localeCompare(b.apellido, "es"))
      .forEach((row) => {
        const li = document.createElement("li");
        const dot = document.createElement("span");
        dot.className = "pl-dot";
        dot.style.background = colorForBloque(row.bloque);
        const text = document.createElement("span");
        text.innerHTML = `<span class="pl-name">${row.apellido}, ${row.nombre}</span><span class="pl-bloque">${row.bloque}</span>`;
        li.appendChild(dot);
        li.appendChild(text);
        panelListEl.appendChild(li);
      });
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
// Leyenda
// ---------------------------------------------------------------------
const legendEl = document.getElementById("legend");

function renderLegend() {
  if (state.chamber === "senado") {
    legendEl.innerHTML = `
      <h3>Senado 2027</h3>
      <div class="legend-row"><span class="legend-swatch" style="background:#005ca9"></span>Provincia renueva (3 bancas)</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#e7edf3;border-color:#c7c7c9"></span>No renueva en 2027</div>
    `;
    return;
  }

  if (!state.bloqueFiltro) {
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
// Controles
// ---------------------------------------------------------------------
const bloqueFilterWrap = document.getElementById("bloqueFilterWrap");
const bloqueSelect = document.getElementById("bloqueSelect");
const controlsHint = document.getElementById("controlsHint");

function setChamber(chamber) {
  state.chamber = chamber;
  document.querySelectorAll(".chamber-btn").forEach((btn) => {
    const active = btn.dataset.chamber === chamber;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  bloqueFilterWrap.hidden = chamber !== "diputados";
  controlsHint.textContent =
    chamber === "senado"
      ? "8 provincias renuevan un tercio del Senado en 2027 (24 bancas en total)."
      : "Las 24 provincias renuevan diputados en 2027. Filtrá por bloque para ver la coropleta.";
  refreshMapStyles();
  renderLegend();
  closePanel();
}

document.querySelectorAll(".chamber-btn").forEach((btn) => {
  btn.addEventListener("click", () => setChamber(btn.dataset.chamber));
});

bloqueSelect.addEventListener("change", () => {
  state.bloqueFiltro = bloqueSelect.value;
  refreshMapStyles();
  renderLegend();
});

function populateBloqueSelect() {
  state.bloques.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b;
    opt.textContent = b;
    bloqueSelect.appendChild(opt);
  });
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
(async function init() {
  const geojson = await loadData();
  populateBloqueSelect();
  initMap(geojson);
  setChamber("senado");
})();
