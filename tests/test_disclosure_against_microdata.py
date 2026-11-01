"""
Re-derives TRUE (unrounded) counts from the private microdata and checks the public file
against them. Skipped automatically when the microdata isn't available (e.g. public CI).
Run this wherever the raw data lives, before publishing.
"""

import duckdb
import pytest

from tests.conftest import ROOT


@pytest.fixture(scope="module")
def con(config):
    src = config["source"]
    path = ROOT / src["path"]
    if not path.exists():
        pytest.skip(f"microdata not available at {src['path']}")
    reader = {"parquet": "read_parquet", "csv": "read_csv_auto", "delta": "delta_scan"}[src.get("format", "parquet")]
    c = duckdb.connect()
    c.execute(f"CREATE VIEW m AS SELECT * FROM {reader}('{path.as_posix()}')")
    return c


def true_n(con, exprs, by, level, slice_key):
    where, params = [f"({exprs[by]})::VARCHAR = ?"], [level]
    if slice_key != "all":
        col, val = slice_key.split("=", 1)
        where.append(f"({exprs[col]})::VARCHAR = ?")
        params.append(val)
    return con.execute(f"SELECT COUNT(*) FROM m WHERE {' AND '.join(where)}", params).fetchone()[0]


@pytest.fixture(scope="module")
def exprs(config):
    return {d["column"]: d.get("expr", d["column"]) for d in config["dimensions"]}


def test_published_cells_meet_minimum(con, exprs, agg):
    min_cell = agg["meta"]["rules"]["min_cell"]
    bad = []
    for key, cells in agg["tables"].items():
        by, slice_key = key.split("|", 1)
        for c in cells:
            if c["n"] is not None:
                n = true_n(con, exprs, by, c["level"], slice_key)
                if n < min_cell:
                    bad.append((key, c["level"], n))
    assert not bad, f"Published cells below min_cell: {bad[:5]}"


def test_hidden_cells_not_recoverable(con, exprs, agg):
    min_cell = agg["meta"]["rules"]["min_cell"]
    bad = []
    for key, cells in agg["tables"].items():
        by, slice_key = key.split("|", 1)
        hidden = [true_n(con, exprs, by, c["level"], slice_key) for c in cells if c["n"] is None]
        if hidden and (len(hidden) < 2 or sum(hidden) < min_cell):
            bad.append((key, hidden))
    assert not bad, f"Hidden cells recoverable from the total: {bad[:5]}"
