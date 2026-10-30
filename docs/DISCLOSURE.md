# How confidentiality is protected

**Assume anything sent to a browser is public.** Anyone can open the developer tools and download
`aggregates.json`. So the protection has to happen before that file exists, in the private build
step. The website itself hides nothing.

This page explains each rule, why it's there, how it's tested, and what it does **not** cover.

---

## What's published

For every combination of *indicator × group*, optionally narrowed to *one group of another dimension*:

| Field | Example | Notes |
|---|---|---|
| Estimate | `61.6` | Weighted %, 1 decimal |
| 95% CI | `60.2–63.0` | Normal approximation, using Kish's effective sample size for the weights |
| Quality | `A` / `E` | From the coefficient of variation |
| Respondents | `1,947 → 1,945` | Unweighted count, rounded |

**Never published:** respondent rows, IDs, weights, free text, or any cross-tabulation of more than two dimensions.

---

## The rules

### 1. Minimum cell size (`min_cell`, default 10)

A group with fewer than `min_cell` respondents is hidden entirely and shown as **x**.
*Protects against:* identifying individuals in tiny groups ("the 3 non-binary respondents in PEI").

### 2. Complementary suppression

The total for each table is published. If only one cell were hidden, anyone could recover it:
`hidden = total − sum(visible)`. So within each table, the build keeps hiding the next-smallest
visible cell until **at least two cells are hidden and together they hold ≥ `min_cell` people**.
*Protects against:* recovering a hidden cell by subtraction.

### 3. Minimum events (`min_event`, default 3)

Even in a big enough group, "0% of group X smoke" or "1 of 12 has condition Y" can reveal
something about specific people. An estimate is hidden when fewer than `min_event` people are on
**either** side of it.
*Protects against:* attribute disclosure, where you learn something about everyone (or no one) in a group.

### 4. Reliability (`cv_e` = 16.6%, `cv_f` = 33.3%)

These are statistical quality rules rather than privacy rules. They follow Statistics Canada's
conventions. With a CV of 16.6–33.3% the estimate is shown with an **E** (use with caution).
Above 33.3% it's hidden.
*Protects against:* people drawing conclusions from noise.

### 5. Rounding (`round_base`, default 5)

Published counts are rounded to the nearest 5. Percentages come from the unrounded data.
*Protects against:* exact-count differencing between tables.

---

## How it's tested

| Test file | Needs microdata? | Checks |
|---|---|---|
| `tests/test_public_file.py` | No | Counts are rounded; no table has a lone hidden cell; intervals are valid; no respondent-level fields; the file matches the config |
| `tests/test_disclosure_against_microdata.py` | Yes (skipped otherwise) | Re-counts every cell from the raw data: no published cell is below `min_cell`, and hidden cells can't be recovered from the total |
| `tests/test_build_rules.py` | No (uses tiny synthetic data) | Each rule behaves as described above |

The GitHub/GitLab deploy jobs run `test_public_file.py` and **refuse to publish** if it fails.
Run the full `make test` wherever the microdata lives, before you commit a new `aggregates.json`.

---

## Known limitations: read before using real data

These rules are a sound baseline, not a guarantee. Have someone responsible for disclosure review
your setup, especially for sensitive populations.

1. **Linked tables.** Complementary suppression is checked *within* each table. But the same people
   appear in linked tables. For example, *Province by Gender* (narrowed to Gender: Woman) and
   *Gender by Province* (narrowed to Province: PEI) both describe women in PEI. A cell hidden in one
   may be visible, or derivable, in the other. Options, from simplest:
   - Raise `min_cell` and merge small groups with `expr` (fewer small cells means fewer problems).
   - Reduce dimensions, or don't offer "narrow to" for dimensions with many small groups.
   - Run the tables through a dedicated tool such as
     [sdcTable](https://cran.r-project.org/package=sdcTable) or
     [τ-ARGUS](https://research.cbs.nl/casc/tau.htm), which solve suppression across linked tables.
2. **Releases over time.** Publishing a 2025 and a 2026 file can allow differencing between years.
   Keep the rules and groups stable between releases.
3. **Rare characteristics.** If a dimension is itself sensitive (for example, a rare diagnosis),
   consider not offering it at all.
4. **Weights.** Weighted percentages are shown with unweighted counts, and suppression is based on
   unweighted counts. That's the usual convention, but check it against your organization's policy.

---

## Changing the rules

Edit `[rules]` in `config/survey.toml`, then run `make aggregate && make test`. The about panel on the
website updates automatically, so the published explanation always matches the rules in force.
