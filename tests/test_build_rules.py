"""
Unit tests for the suppression logic, using tiny hand-made datasets so the
expected answer is obvious. These don't touch your real data.
"""

import json

import duckdb
import pytest

import build_aggregates as ba


def make_config(tmp_path, rows, **rules):
    data = tmp_path / "micro.parquet"
    con = duckdb.connect()
    con.execute("CREATE TABLE t (region VARCHAR, sex VARCHAR, flag INTEGER)")
    con.executemany("INSERT INTO t VALUES (?, ?, ?)", rows)
    con.execute(f"COPY t TO '{data.as_posix()}' (FORMAT parquet)")
    return {
        "site": {"title": "t", "default_indicator": "flag", "default_compare": "region"},
        "source": {"path": str(data), "format": "parquet", "weight": ""},
        "rules": {"min_cell": 10, "min_event": 3, "round_base": 5, "cv_e": 16.6, "cv_f": 33.3, **rules},
        "dimensions": [
            {"column": "region", "label": "Region", "levels": ["A", "B", "C", "D"]},
            {"column": "sex", "label": "Sex", "levels": ["F", "M"]},
        ],
        "indicators": [{"id": "flag", "label": "Flag", "short": "Flag", "theme": "T", "better": "higher", "when": "flag = 1"}],
    }


def rows_for(region, n, sex="F"):
    # half flagged, so estimates are reliable
    return [(region, sex, i % 2) for i in range(n)]


def build(tmp_path, cfg):
    out = tmp_path / "agg.json"
    ba.build(cfg, out)
    return json.loads(out.read_text())


def test_small_cell_triggers_complementary_suppression(tmp_path):
    rows = rows_for("A", 100) + rows_for("B", 60) + rows_for("C", 40) + rows_for("D", 4)
    agg = build(tmp_path, make_config(tmp_path, rows))
    cells = {c["level"]: c for c in agg["tables"]["region|all"]}
    assert cells["D"]["n"] is None          # primary: 4 < 10
    assert cells["C"]["n"] is None          # complementary: next smallest
    assert cells["A"]["n"] == 100 and cells["B"]["n"] == 60


def test_no_suppression_when_all_cells_large(tmp_path):
    rows = rows_for("A", 50) + rows_for("B", 50) + rows_for("C", 50) + rows_for("D", 50)
    agg = build(tmp_path, make_config(tmp_path, rows))
    assert all(c["n"] is not None for c in agg["tables"]["region|all"])


def test_counts_rounded(tmp_path):
    rows = rows_for("A", 52) + rows_for("B", 48) + rows_for("C", 33) + rows_for("D", 61)
    agg = build(tmp_path, make_config(tmp_path, rows))
    assert [c["n"] for c in agg["tables"]["region|all"]] == [50, 50, 35, 60]


def test_attribute_disclosure_hidden(tmp_path):
    # Region D: 30 people, only 1 flagged → "about 3%" would single someone out
    rows = rows_for("A", 50) + rows_for("B", 50) + rows_for("C", 50) + [("D", "F", 0)] * 29 + [("D", "F", 1)]
    agg = build(tmp_path, make_config(tmp_path, rows))
    d = next(c for c in agg["tables"]["region|all"] if c["level"] == "D")
    assert d["n"] == 30 and d["est"]["flag"] is None


def test_bad_indicator_sql_gives_helpful_error(tmp_path):
    cfg = make_config(tmp_path, rows_for("A", 20))
    cfg["indicators"][0]["when"] = "no_such_column = 1"
    with pytest.raises(ba.ConfigError, match="Indicator 'flag'"):
        ba.build(cfg, tmp_path / "x.json")


def test_computed_dimension(tmp_path):
    rows = rows_for("A", 30) + rows_for("B", 30) + rows_for("C", 30) + rows_for("D", 30)
    cfg = make_config(tmp_path, rows)
    cfg["dimensions"].append({"column": "east_west", "label": "East/West",
                              "expr": "CASE WHEN region IN ('A', 'B') THEN 'East' ELSE 'West' END",
                              "levels": ["East", "West"]})
    agg = build(tmp_path, cfg)
    assert [c["n"] for c in agg["tables"]["east_west|all"]] == [60, 60]
