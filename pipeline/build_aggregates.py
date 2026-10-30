"""
build_aggregates.py — turn private microdata into ONE safe-to-publish JSON file.

    make aggregate
    # or: uv run python pipeline/build_aggregates.py [--config config/survey.toml] [--output site/data/aggregates.json]

Everything this script does is driven by config/survey.toml. You should not need to edit
this file to change indicators, groups, labels or disclosure rules (see docs/CUSTOMIZING.md).

What the browser will receive (and nothing else):
  * weighted percentages (1 decimal) with 95% confidence intervals
  * respondent counts rounded to `round_base`
  * a quality flag per estimate ("A" = fine, "E" = use with caution)

Disclosure rules (see docs/DISCLOSURE.md for the reasoning):
  1. Primary suppression   - hide any cell with fewer than `min_cell` respondents.
  2. Complementary         - within each table, keep hiding the next-smallest cell until at
                             least two are hidden and together they hold >= `min_cell` people,
                             so no hidden value equals "total minus the visible ones".
  3. Reliability           - hide estimates with CV > `cv_f`; flag CV > `cv_e` with "E".
  4. Attribute disclosure  - hide a % when fewer than `min_event` people are on either side.
  5. Rounding              - published counts rounded to `round_base`.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import tomllib
from datetime import datetime, timezone
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]


# ── Config ───────────────────────────────────────────────────────────────────
class ConfigError(Exception):
    pass


def load_config(path: Path) -> dict:
    try:
        cfg = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError(f"Config file not found: {path}")
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(f"{path} is not valid TOML: {e}")

    for section in ("site", "source", "rules", "dimensions", "indicators"):
        if section not in cfg:
            raise ConfigError(f"{path}: missing [{section}] section")

    ids = [i.get("id") for i in cfg["indicators"]]
    for i in cfg["indicators"]:
        missing = {"id", "label", "short", "theme", "better", "when"} - i.keys()
        if missing:
            raise ConfigError(f"Indicator {i.get('id', '?')!r} is missing: {', '.join(sorted(missing))}")
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", i["id"]):
            raise ConfigError(f"Indicator id {i['id']!r}: use letters, digits and underscores, starting with a letter")
        if i["better"] not in ("higher", "lower"):
            raise ConfigError(f"Indicator {i['id']!r}: better must be \"higher\" or \"lower\"")
    dupes = {x for x in ids if ids.count(x) > 1}
    if dupes:
        raise ConfigError(f"Duplicate indicator ids: {', '.join(sorted(dupes))}")

    cols = [d.get("column") for d in cfg["dimensions"]]
    for d in cfg["dimensions"]:
        if "column" not in d or "label" not in d:
            raise ConfigError(f"Every [[dimensions]] block needs column and label (got {d})")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", d["column"]):
            raise ConfigError(f"Dimension column {d['column']!r}: use letters, digits and underscores")
    if len(set(cols)) != len(cols):
        raise ConfigError("The same column is listed twice under [[dimensions]]")

    site = cfg["site"]
    if site.get("default_indicator") not in ids:
        raise ConfigError(f"[site] default_indicator {site.get('default_indicator')!r} is not an indicator id")
    if site.get("default_compare") not in cols:
        raise ConfigError(f"[site] default_compare {site.get('default_compare')!r} is not a dimension column")
    return cfg


def source_sql(src: dict) -> str:
    path = (ROOT / src["path"]).as_posix() if not Path(src["path"]).is_absolute() else src["path"]
    fmt = src.get("format", "parquet")
    if fmt == "parquet":
        return f"read_parquet('{path}')"
    if fmt == "csv":
        return f"read_csv_auto('{path}')"
    if fmt == "delta":
        return f"delta_scan('{path}')"  # needs the DuckDB delta extension (auto-installs online)
    raise ConfigError(f"[source] format must be parquet, csv or delta (got {fmt!r})")


def quote(v: str) -> str:
    return "'" + str(v).replace("'", "''") + "'"


# ── Build ────────────────────────────────────────────────────────────────────
def build(cfg: dict, output: Path) -> dict:
    rules = cfg["rules"]
    MIN_CELL, MIN_EVENT, BASE = rules["min_cell"], rules["min_event"], rules["round_base"]
    CV_E, CV_F = rules["cv_e"], rules["cv_f"]
    rnd = lambda x: int(BASE * round(x / BASE))  # noqa: E731

    con = duckdb.connect()
    src = cfg["source"]
    weight = src.get("weight") or ""
    dims = cfg["dimensions"]
    inds = cfg["indicators"]

    try:
        available = {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {source_sql(src)}").fetchall()}
    except duckdb.Error as e:
        raise ConfigError(f"Could not read the microdata at {src['path']}: {e}")
    for d in dims:
        if "expr" not in d and d["column"] not in available:
            raise ConfigError(f"Dimension column {d['column']!r} not found in microdata. Available: {', '.join(sorted(available))}")
    if weight and weight not in available:
        raise ConfigError(f"[source] weight column {weight!r} not found in microdata")

    # Allow-list: only dimensions, the weight and derived 0/1 indicator flags are kept.
    w_expr = f"CAST({weight} AS DOUBLE)" if weight else "1.0::DOUBLE"
    # A dimension can be a raw column, or computed with `expr` (e.g. a CASE that bands ages).
    sel = [f"({d.get('expr', d['column'])})::VARCHAR AS {d['column']}" for d in dims] + [f"{w_expr} AS _w"]
    for i in inds:
        sel.append(f"CAST(({i['when']}) AS INTEGER) AS {i['id']}")
    try:
        con.execute(f"CREATE TEMP TABLE micro AS SELECT {', '.join(sel)} FROM {source_sql(src)}")
    except duckdb.Error as e:
        # Find which dimension or indicator broke, to give a useful message.
        for d in dims:
            if "expr" in d:
                try:
                    con.execute(f"SELECT ({d['expr']})::VARCHAR FROM {source_sql(src)} LIMIT 1")
                except duckdb.Error as e2:
                    raise ConfigError(f"Dimension {d['column']!r}: the `expr` failed:\n  {d['expr']}\n  {e2}")
        for i in inds:
            try:
                con.execute(f"SELECT CAST(({i['when']}) AS INTEGER) FROM {source_sql(src)} LIMIT 1")
            except duckdb.Error as e2:
                raise ConfigError(f"Indicator {i['id']!r}: the `when` condition failed:\n  {i['when']}\n  {e2}")
        raise ConfigError(f"Could not prepare microdata: {e}")

    # Resolve dimension levels (configured order, or every value found).
    for d in dims:
        found = [r[0] for r in con.execute(
            f"SELECT DISTINCT {d['column']} FROM micro WHERE {d['column']} IS NOT NULL ORDER BY 1").fetchall()]
        if "levels" in d:
            missing = [lvl for lvl in d["levels"] if lvl not in found]
            if missing:
                print(f"⚠️  {d['column']}: configured levels not in data (will show as hidden): {missing}")
            extra = [v for v in found if v not in d["levels"]]
            if extra:
                print(f"ℹ️  {d['column']}: values in data but not in config (excluded from that dimension): {extra}")
        else:
            d["levels"] = found

    aggs = ["COUNT(*) AS n"]
    for i in inds:
        c = i["id"]
        aggs += [
            f"SUM(CASE WHEN {c} IS NOT NULL THEN _w END)::DOUBLE AS sw_{c}",
            f"SUM(CASE WHEN {c} IS NOT NULL THEN _w * _w END)::DOUBLE AS sw2_{c}",
            f"SUM(_w * {c})::DOUBLE AS wy_{c}",
            f"COUNT({c}) AS n_{c}",
            f"SUM({c}) AS ev_{c}",
        ]
    agg_sql = ", ".join(aggs)

    def estimates(row: dict) -> dict:
        out = {}
        for i in inds:
            c = i["id"]
            n, ev, sw, sw2 = row[f"n_{c}"], row[f"ev_{c}"] or 0, row[f"sw_{c}"], row[f"sw2_{c}"]
            if not n or n < MIN_CELL or ev < MIN_EVENT or (n - ev) < MIN_EVENT or not sw:
                out[c] = None
                continue
            p = row[f"wy_{c}"] / sw
            n_eff = sw * sw / sw2  # Kish effective sample size
            se = math.sqrt(p * (1 - p) / n_eff)
            cv = 100 * se / p if p > 0 else math.inf
            if cv > CV_F:
                out[c] = None
                continue
            lo, hi = max(0.0, p - 1.96 * se), min(1.0, p + 1.96 * se)
            out[c] = [round(100 * p, 1), round(100 * lo, 1), round(100 * hi, 1), "E" if cv > CV_E else "A"]
        return out

    def query(group_col: str | None, where: str | None) -> list[dict]:
        s = f"{group_col} AS level, " if group_col else ""
        g = f"GROUP BY {group_col}" if group_col else ""
        w = f"WHERE {where}" if where else ""
        rel = con.execute(f"SELECT {s}{agg_sql} FROM micro {w} {g}")
        names = [x[0] for x in rel.description]
        return [dict(zip(names, r)) for r in rel.fetchall()]

    # Slices = "everyone" plus every single dimension value.
    slice_defs: list[tuple[str, str | None, str | None]] = [("all", None, None)]
    for d in dims:
        for lvl in d["levels"]:
            slice_defs.append((f"{d['column']}={lvl}", d["column"], lvl))
    where_for = lambda col, lvl: None if col is None else f"{col} = {quote(lvl)}"  # noqa: E731

    slices: dict[str, dict] = {}
    for key, col, lvl in slice_defs:
        r = query(None, where_for(col, lvl))[0]
        slices[key] = {"n": None, "est": None} if r["n"] < MIN_CELL else {"n": rnd(r["n"]), "est": estimates(r)}

    tables: dict[str, list] = {}
    stats = {"tables": 0, "cells": 0, "primary": 0, "complementary": 0, "estimates": 0, "est_hidden": 0}
    for d in dims:
        by = d["column"]
        for key, scol, slvl in slice_defs:
            if scol == by or slices[key]["n"] is None:
                continue
            rows = {r["level"]: r for r in query(by, where_for(scol, slvl))}
            cells = []
            for lvl in d["levels"]:
                n = rows[lvl]["n"] if lvl in rows else 0
                cells.append({"level": lvl, "raw_n": n, "row": rows.get(lvl), "sup": n < MIN_CELL})
            stats["cells"] += len(cells)
            stats["primary"] += sum(c["sup"] for c in cells)

            def recoverable(cs):
                hidden = [c for c in cs if c["sup"]]
                return bool(hidden) and (len(hidden) < 2 or sum(c["raw_n"] for c in hidden) < MIN_CELL)

            while recoverable(cells):
                visible = sorted((c for c in cells if not c["sup"]), key=lambda c: c["raw_n"])
                if not visible:
                    break
                visible[0]["sup"] = True
                stats["complementary"] += 1

            out = []
            for c in cells:
                if c["sup"]:
                    out.append({"level": c["level"], "n": None, "est": None})
                else:
                    est = estimates(c["row"])
                    stats["estimates"] += len(est)
                    stats["est_hidden"] += sum(v is None for v in est.values())
                    out.append({"level": c["level"], "n": rnd(c["raw_n"]), "est": est})
            tables[f"{by}|{key}"] = out
            stats["tables"] += 1

    payload = {
        "meta": {
            "site": cfg["site"],
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "rules": {k: rules[k] for k in ("min_cell", "min_event", "round_base", "cv_e", "cv_f")},
            "weighted": bool(weight),
            "dimensions": [{"id": d["column"], "label": d["label"], "levels": d["levels"]} for d in dims],
            "indicators": [{k: i[k] for k in ("id", "label", "short", "theme", "better")} for i in inds],
        },
        "slices": slices,
        "tables": tables,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--config", type=Path, default=ROOT / "config/survey.toml")
    ap.add_argument("--output", type=Path, default=ROOT / "site/data/aggregates.json")
    args = ap.parse_args()
    try:
        cfg = load_config(args.config)
        stats = build(cfg, args.output)
    except ConfigError as e:
        print(f"❌ {e}", file=sys.stderr)
        return 1
    kb = args.output.stat().st_size / 1024
    print(f"✅ Wrote {args.output.relative_to(ROOT) if args.output.is_relative_to(ROOT) else args.output} ({kb:,.0f} KB)")
    print(f"   {stats['tables']} tables · {stats['cells']:,} cells · "
          f"{stats['primary']} primary + {stats['complementary']} complementary suppressions · "
          f"{stats['est_hidden']:,} of {stats['estimates']:,} estimates hidden (unreliable or too few events)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
