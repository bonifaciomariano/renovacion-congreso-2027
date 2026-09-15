# Renovación del Congreso 2027

Sitio estático (HTML/CSS/JS puro, sin backend) con un mapa interactivo de la
renovación de bancas del Congreso de la Nación Argentina en diciembre de 2027:
las 24 provincias que renuevan diputados y las 8 provincias que renuevan un
tercio del Senado, con el estado de desdoblamiento electoral de cada una.

**Sitio publicado:** https://bonifaciomariano.github.io/renovacion-congreso-2027/

## Qué muestra

- Un único mapa (geometría real de provincias, API Georef de datos.gob.ar,
  sin el reclamo antártico) con un selector Senado / Diputados.
- **Diputados:** las 24 provincias renuevan bancas (de 2 a 35 según la
  provincia). Sin filtro de bloque, todas se ven con el mismo color; al elegir
  un bloque/partido en el filtro, el mapa pasa a coropleta según cuántas
  bancas de ese bloque renuevan en cada provincia.
- **Senado:** solo 8 provincias (Catamarca, Chubut, Corrientes, Córdoba,
  La Pampa, Mendoza, Santa Fe y Tucumán) renuevan un tercio de sus bancas
  (3 cada una, 24 en total); el resto se muestra atenuado. También admite
  filtro por bloque, con su propia coropleta.
- Al elegir un bloque (en cualquiera de las dos cámaras) aparece, al costado
  del mapa, un resumen con el total de bancas actuales del bloque, las bancas
  en juego en 2027 y el desglose por provincia.
- Al hacer clic en una provincia se abre un panel lateral con la lista de
  legisladores que renuevan ahí (nombre y bloque).
- Al pasar el mouse por una provincia: en Senado, si no renueva en 2027,
  indica hasta qué año está vigente el mandato de sus senadores; en
  Diputados, indica cuántas bancas renuevan y cuántas continúan con mandato
  vigente.
- Badge de desdoblamiento electoral 2027 por provincia, con referencia
  siempre visible: **Desdobla** (con fecha si se conoce), **No desdobla**,
  **En definición** o **Sin dato** (provincias no mencionadas en la nota
  fuente — no es lo mismo que "no desdobla").

## Estructura

```
docs/                 → sitio publicado por GitHub Pages (main, /docs)
  index.html
  css/style.css
  js/app.js
  data/                → copia de los JSON/GeoJSON procesados, consumidos por el sitio
data/                  → fuentes de datos (los .csv/.xlsx originales no se versionan)
  provincias_raw.geojson  → geometría tal como la entrega Georef (sin procesar)
  provincias.geojson      → misma geometría, sin los sub-polígonos antárticos
  diputados_todos.json    → nómina completa (257), con año de fin de mandato
  senadores_todos.json    → nómina completa (72), con año de cese (ya corregido)
  desdoblamiento_2027.json
scripts/
  build_data.py        → genera los JSON de data/ a partir de diputados.csv y Senadores 2026.xlsx
```

## Datos y supuestos

- **Diputados que renuevan en 2027:** filas de `diputados.csv` con
  `FinalizaMandato = 09/12/2027` (130 bancas en 24 provincias).
- **Senadores que renuevan en 2027:** filas de `Senadores 2026.xlsx` con año
  de `CESE LEGAL` = 2027, aplicando antes una corrección manual sobre dos
  registros (Rodolfo Alejandro Suárez, Mendoza, y Juan Luis Manzur, Tucumán:
  `CESE LEGAL` corregido de 2029-12-09 a 2027-12-09) — con esta corrección
  quedan 8 provincias con sus 3 bancas completas (24 en total).
- **Desdoblamiento electoral 2027:** reconstruido a mano a partir de una nota
  periodística (no proviene de los excels), en
  `data/desdoblamiento_2027.json`.
- Los archivos fuente originales (`.csv`/`.xlsx`) no se suben al repositorio
  porque el Excel de Senadores incluye datos de contacto personal
  (email, teléfono); solo se versionan los JSON derivados, que contienen
  únicamente nombre, provincia, bloque y año de fin de mandato/cese.
- **Geometría de provincias:** se excluyó del GeoJSON todo sub-polígono de
  "Tierra del Fuego, Antártida e Islas del Atlántico Sur" cuyo punto más al
  norte cae por debajo de -60° de latitud (el límite del Tratado Antártico),
  para no deformar el encuadre del mapa con el reclamo antártico.

## Estilo

Paleta institucional y tipografía Montserrat, en línea con los proyectos
hermanos `hsn-sistema-legislativo` y el navegador de expedientes legislativos
destacados.
