# -*- coding: utf-8 -*-
"""Construye los JSON estaticos del sitio a partir de los archivos fuente en data/.
Se ejecuta una sola vez (manualmente) cada vez que cambian los excels/csv de origen.
"""
import csv
import json
import unicodedata
from pathlib import Path
from datetime import datetime

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def normalize(s):
    if s is None:
        return ""
    s = s.strip().upper()
    s = "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )
    return s


# CORDOBA en el geojson de Georef viene como "Córdoba" -> normaliza a CORDOBA, coincide.
# CABA en las fuentes es "CIUDAD DE BUENOS AIRES"; en Georef es "Ciudad Autónoma de Buenos Aires".
PROVINCIA_ALIASES = {
    "CIUDAD DE BUENOS AIRES": "CIUDAD AUTONOMA DE BUENOS AIRES",
}


def canon_provincia(raw):
    n = normalize(raw)
    return PROVINCIA_ALIASES.get(n, n)


# ---------------------------------------------------------------------------
# Diputados
# ---------------------------------------------------------------------------
def build_diputados():
    with open(DATA / "diputados.csv", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    out = []
    for row in rows:
        if row["FinalizaMandato"].strip() != "09/12/2027":
            continue
        out.append(
            {
                "apellido": row["Apellido"].strip(),
                "nombre": row["Nombre"].strip(),
                "provincia": canon_provincia(row["Distrito"]),
                "bloque": row["Bloque"].strip(),
            }
        )
    print(f"Diputados que renuevan en 2027: {len(out)}")
    return out


# ---------------------------------------------------------------------------
# Senadores
# ---------------------------------------------------------------------------
CORRECCIONES_CESE_LEGAL = {
    ("SUAREZ", "RODOLFO ALEJANDRO"): datetime(2027, 12, 9),
    ("MANZUR", "JUAN LUIS"): datetime(2027, 12, 9),
}


def build_senadores():
    wb = openpyxl.load_workbook(DATA / "Senadores 2026.xlsx", data_only=True)
    ws = wb[wb.sheetnames[0]]
    header = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    idx = {h: i for i, h in enumerate(header)}

    out = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[idx["APELLIDO"]] is None:
            continue
        apellido = str(row[idx["APELLIDO"]]).strip()
        nombre = str(row[idx["NOMBRE"]]).strip()
        cese_legal = row[idx["CESE LEGAL"]]

        key = (normalize(apellido), normalize(nombre))
        if key in CORRECCIONES_CESE_LEGAL:
            cese_legal = CORRECCIONES_CESE_LEGAL[key]

        if not isinstance(cese_legal, datetime) or cese_legal.year != 2027:
            continue

        out.append(
            {
                "apellido": apellido,
                "nombre": nombre,
                "provincia": canon_provincia(row[idx["PROVINCIA"]]),
                "bloque": str(row[idx["BLOQUE"]]).strip(),
            }
        )
    print(f"Senadores que renuevan en 2027: {len(out)}")
    return out


def main():
    diputados = build_diputados()
    senadores = build_senadores()

    (DATA / "diputados_2027.json").write_text(
        json.dumps(diputados, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DATA / "senadores_2027.json").write_text(
        json.dumps(senadores, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    from collections import Counter

    print("\nDiputados por provincia:")
    for prov, n in sorted(Counter(d["provincia"] for d in diputados).items()):
        print(f"  {prov}: {n}")

    print("\nSenadores por provincia:")
    for prov, n in sorted(Counter(s["provincia"] for s in senadores).items()):
        print(f"  {prov}: {n}")


if __name__ == "__main__":
    main()
