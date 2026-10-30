"""
Checks on the PUBLIC file only (site/data/aggregates.json). No microdata needed,
so these run everywhere, including CI for repos that never see the raw data.
"""

import re


def all_cells(agg):
    for key, cells in agg["tables"].items():
        for c in cells:
            yield key, c
    for key, s in agg["slices"].items():
        yield f"slice:{key}", s


def test_file_matches_config(agg, config):
    """Fails if survey.toml was edited but `make aggregate` wasn't re-run."""
    assert [i["id"] for i in agg["meta"]["indicators"]] == [i["id"] for i in config["indicators"]], \
        "Indicators differ from config/survey.toml: run `make aggregate`"
    assert [d["id"] for d in agg["meta"]["dimensions"]] == [d["column"] for d in config["dimensions"]], \
        "Dimensions differ from config/survey.toml: run `make aggregate`"
    for k in ("min_cell", "min_event", "round_base", "cv_e", "cv_f"):
        assert agg["meta"]["rules"][k] == config["rules"][k], f"Rule {k} differs from config: run `make aggregate`"


def test_counts_are_rounded(agg):
    base = agg["meta"]["rules"]["round_base"]
    bad = [(k, c["n"]) for k, c in all_cells(agg) if c["n"] is not None and c["n"] % base]
    assert not bad, f"Counts not rounded to {base}: {bad[:5]}"


def test_no_lone_suppressed_cell(agg):
    """A single hidden cell could be recovered as total minus the visible cells."""
    lone = [k for k, cells in agg["tables"].items() if sum(c["n"] is None for c in cells) == 1]
    assert not lone, f"Tables with exactly one hidden cell: {lone[:5]}"


def test_estimates_are_well_formed(agg):
    for key, c in all_cells(agg):
        if c["n"] is None:
            assert c["est"] is None, f"{key}: hidden cell still carries estimates"
            continue
        for ind, e in c["est"].items():
            if e is None:
                continue
            p, lo, hi, q = e
            assert 0 <= lo <= p <= hi <= 100, f"{key}/{ind}: bad interval {e}"
            assert q in ("A", "E"), f"{key}/{ind}: unknown quality flag {q}"


def test_only_aggregate_fields_present(agg):
    """Guard against respondent-level fields leaking into the public file."""
    allowed_cell_keys = {"level", "n", "est"}
    for key, c in all_cells(agg):
        extra = set(c) - allowed_cell_keys
        assert not extra, f"{key}: unexpected fields {extra}"
    text = str(agg)
    assert not re.search(r"respondent_?id|\bR\d{5}\b", text, re.I), "Looks like respondent IDs are in the public file"
