# Customizing the dashboard

Most changes need **one file**, [`config/survey.toml`](../config/survey.toml), and **no JavaScript**.
This guide goes from the most common changes to the least common.

- [The edit loop](#the-edit-loop)
- [1. Change the wording on the page](#1-change-the-wording-on-the-page)
- [2. Add, remove or reorder indicators](#2-add-remove-or-reorder-indicators)
- [3. Add or change a dimension (the groups)](#3-add-or-change-a-dimension-the-groups)
- [4. Point it at your real data](#4-point-it-at-your-real-data)
- [5. Tune the disclosure rules](#5-tune-the-disclosure-rules)
- [6. Branding and colours](#6-branding-and-colours)
- [7. Changing the website itself](#7-changing-the-website-itself)
- [Troubleshooting](#troubleshooting)

---

## The edit loop

Every change follows the same four steps:

```bash
# 1. edit config/survey.toml
make aggregate   # 2. rebuild site/data/aggregates.json
make test        # 3. confirm it's still safe to publish
make serve       # 4. look at it: http://localhost:8000 (refresh after each rebuild)
```

> **TOML in 30 seconds.** `key = "text"`, `key = 10`, `key = ["a", "b"]`. Lines starting with `#` are
> comments. `[section]` starts a section, and `[[indicators]]` starts *another item in a list*, so
> each indicator gets its own `[[indicators]]` header. Text with an apostrophe inside works fine in
> double quotes: `"Children's health"`.

---

## 1. Change the wording on the page

Everything above the filters, plus the footer, comes from the `[site]` section. Text can be given
per language (see [TRANSLATING.md](TRANSLATING.md)):

```toml
[site]
languages        = ["en", "fr"]
default_language = "en"
title   = { en = "Community well-being at a glance", fr = "Le bien-être communautaire en un coup d’œil" }
eyebrow = { en = "Example Foundation · 2025 survey", fr = "Fondation Exemple · Enquête 2025" }
lede    = { en = "Explore key indicators by region, age and income.", fr = "Explorez les principaux indicateurs selon la région, l’âge et le revenu." }
footer  = { en = "Source: 2025 Community Well-being Survey.", fr = "Source : Enquête sur le bien-être communautaire 2025." }
accessibility_contact = "accessibility@your-org.ca"   # AODA feedback contact, shown on the page

default_indicator = "srh_good"  # must be an indicator id
default_compare   = "province"  # must be a dimension column
```

Run `make aggregate`. The page picks up the new text from the data file, so no HTML editing is needed.
**English only?** Set `languages = ["en"]` and the language switch disappears.

---

## 2. Add, remove or reorder indicators

Every indicator is a **percentage of people for whom a condition is true**. To add one, copy an
existing `[[indicators]]` block and change it:

```toml
[[indicators]]
id     = "frequent_drinker"                     # unique; letters/digits/underscores; shows up in shared links
label  = { en = "Drinks alcohol 3+ times a week", fr = "Boit de l’alcool 3 fois ou plus par semaine" }  # titles, dropdown
short  = { en = "Drinks 3+ times/week", fr = "Alcool 3+ fois/sem." }   # heatmap header, tiles: keep it short
theme  = { en = "Lifestyle", fr = "Habitudes de vie" }  # dropdown section; new names create new sections
better = "lower"                                # "higher" or "lower": decides better (▲ blue) vs worse (▼ red)
when   = "alcohol_frequency = '3+ times/week'"  # DuckDB SQL condition over your columns
```

### Writing the `when` condition

`when` is anything you could put after `WHERE` in SQL. Useful patterns:

| You want | `when =` |
|---|---|
| A 0/1 or true/false flag | `"has_family_doctor = 1"` |
| One of several answers | `"self_rated_health IN ('Very good', 'Excellent')"` |
| Text starts with… | `"smoking_status LIKE 'Current%'"` |
| A numeric threshold | `"bmi >= 30"` |
| Combined conditions | `"diabetes = 1 AND hypertension = 1"` |
| Count across flags | `"(diabetes + asthma + arthritis) >= 2"` |
| Exclude "don't know" from the denominator | `"CASE WHEN q12 IN ('DK', 'Refused') THEN NULL ELSE q12 = 'Yes' END"` |

Two rules to know:

- Use **single quotes** for text values inside the double-quoted string.
- If the condition is **NULL** for a respondent, that person is left out of that indicator's
  denominator. That's how you handle "not applicable", "don't know" and skipped questions.

If you make a typo, `make aggregate` names the indicator and shows DuckDB's error:

```
❌ Indicator 'frequent_drinker': the `when` condition failed:
  alcohol_freq = '3+ times/week'
  Binder Error: Referenced column "alcohol_freq" not found in FROM clause!
Candidate bindings: "alcohol_frequency", ...
```

**To remove an indicator,** delete its block. **To reorder,** move blocks: the dropdown and heatmap
columns follow the order in the file.

---

## 3. Add or change a dimension (the groups)

Dimensions are the **Compare by** chips and the **Narrow to** options.

```toml
[[dimensions]]
column = "education"                                  # column in the microdata
label  = { en = "Education", fr = "Scolarité" }       # what users see
levels = [                                            # display order
  { value = "Less than high school", fr = "Moins qu’un diplôme d’études secondaires" },
  { value = "College / trades", en = "College or trades", fr = "Collège ou métiers" },
  "Graduate degree",                                  # same text in every language
]
```

Each level is the **raw value in your data**, optionally with display text per language.

- **Order of the groups:** the order of `levels`. Leave `levels` out to show every value found,
  sorted alphabetically.
- **Hide a group** (for example, "Not stated"): leave it out of `levels`. The build prints a note
  listing values it ignored.
- **Order of the chips:** the order of the `[[dimensions]]` blocks.

### Computed groups with `expr`

When the groups you want aren't a column yet, compute them with SQL. You can band ages, merge small
categories or rename values:

```toml
# Merge provinces into regions (also helps with small-cell suppression)
[[dimensions]]
column = "region"                   # a NEW name, since it isn't in the data
label  = { en = "Region", fr = "Région" }
expr   = """
  CASE
    WHEN province IN ('Newfoundland', 'PEI', 'Nova Scotia', 'New Brunswick') THEN 'Atlantic'
    WHEN province IN ('Manitoba', 'Saskatchewan', 'Alberta') THEN 'Prairies'
    WHEN province IN ('Quebec', 'Ontario', 'British Columbia', 'Territories') THEN province
  END"""
levels = [{ value = "Atlantic", fr = "Atlantique" }, { value = "Quebec", fr = "Québec" }, "Ontario",
          "Prairies", { value = "British Columbia", fr = "Colombie-Britannique" }, { value = "Territories", fr = "Territoires" }]

# Band a numeric age
[[dimensions]]
column = "age_band"
label  = { en = "Age", fr = "Âge" }
expr   = "CASE WHEN age < 35 THEN '18–34' WHEN age < 55 THEN '35–54' ELSE '55+' END"
levels = [{ value = "18–34", fr = "18 à 34 ans" }, { value = "35–54", fr = "35 à 54 ans" }, { value = "55+", fr = "55 ans et plus" }]
```

> **Mind the size.** The file has one table per (dimension × every group of every other dimension).
> Five dimensions with about 30 groups in total gives about 130 tables and about 300 KB. Ten dimensions
> would roughly quadruple that. If it grows past about 2 MB, drop rarely used dimensions or merge groups.

---

## 4. Point it at your real data

```toml
[source]
path   = "data/raw/survey_2025.parquet"   # relative to the repo, or an absolute path
format = "parquet"                        # "parquet" | "csv" | "delta"
weight = "final_wt"                       # your survey weight column; "" = unweighted
```

| Your data is… | Do this |
|---|---|
| **Parquet** | Set `format = "parquet"`. A glob works too: `"data/raw/*.parquet"`. |
| **CSV** | Set `format = "csv"`. DuckDB detects types automatically. |
| **Delta table** (Fabric, Databricks) | Set `format = "delta"` and point `path` at the table folder. The first run downloads DuckDB's delta extension, so it needs internet access once. |
| **SAS / SPSS / Stata** | Convert once to Parquet (below). |
| **In a database** | Export a Parquet extract of just the columns you need. |

**Converting from SAS, SPSS or Stata:**

```bash
uv run --with pyreadstat --with pyarrow python -c "
import pyreadstat
df, meta = pyreadstat.read_sas7bdat('survey.sas7bdat')   # or read_sav / read_dta
df.to_parquet('data/raw/microdata.parquet', index=False)
"
```

**Running in Microsoft Fabric:** copy `pipeline/build_aggregates.py` and `config/survey.toml` into a
notebook's resources. Set `path` to the Lakehouse table (`/lakehouse/default/Tables/survey`,
`format = "delta"`), run it, and download `aggregates.json`. The microdata never leaves Fabric.

**Keep the microdata out of Git.** Everything in `data/raw/` except its README is git-ignored.
If you keep data elsewhere, make sure that path isn't inside the repo, or add it to `.gitignore`.

---

## 5. Tune the disclosure rules

```toml
[rules]
min_cell   = 10      # hide groups smaller than this
min_event  = 3       # hide a % when fewer than this many people are on either side of it
round_base = 5       # round published counts to this base
cv_e       = 16.6    # flag E ("use with caution") above this CV %
cv_f       = 33.3    # hide estimates above this CV %
```

Higher numbers are safer and give sparser output. Check your organization's own policy. Many
statistical agencies use `min_cell` between 5 and 30. See [DISCLOSURE.md](DISCLOSURE.md) for what each
rule protects against and the limits of the approach.

---

## 6. Branding and colours

All colours are CSS variables at the top of [`site/styles.css`](../site/styles.css), defined three
times: light, dark (from the OS setting) and dark (from the toggle). Change the same names in each.

| Variable | Controls |
|---|---|
| `--accent`, `--accent-ink`, `--series-1` | Brand colour: buttons, links, chart dots |
| `--ci` | Confidence-interval bars (usually the brand colour at ~35% opacity) |
| `--div-b1` … `--div-b3` | Heatmap "better" scale, light → strong |
| `--div-r1` … `--div-r3` | Heatmap "worse" scale, light → strong |
| `--div-0` | Heatmap "about the same" |
| `--page`, `--surface`, `--ink`, `--ink-2` | Background, card and text colours |
| `--font` | Typeface |

Tips:

- **Run `make test` after any colour change.** `tests/test_contrast.py` checks every token against
  WCAG AA (4.5:1 for text, 3:1 for controls and chart marks) in both themes and names the pairs that fail.
- **Keep the heatmap scales one hue each**, getting darker (light mode) or brighter (dark mode).
  Blue/red is colour-blind friendly. Avoid green/red.
- **Custom font:** add a `<link>` to the font in `index.html`'s `<head>`, then set
  `--font: "Your Font", system-ui, sans-serif;`.

---

## 7. Changing the website itself

The site is three files with no build step. Edit them, then refresh the browser.

| File | What's in it |
|---|---|
| `site/index.html` | Page structure: header, filter bar, the cards, footer |
| `site/i18n.js` | Interface text in each language (buttons, legends, screen-reader text) |
| `site/styles.css` | Theme tokens, layout, mobile breakpoint (`@media (max-width: 720px)`) |
| `site/app.js` | Organized into labelled sections: controls, tiles, dot plot, table + CSV, heatmap, about |

**Remove a section** (for example, the heatmap): delete its `<section class="card">` in `index.html`,
then delete the `renderHeatmap()` calls in `app.js`.

**Add a chart:** write a `renderSomething()` function next to the others in `app.js`. Call it from
`update()` so it re-renders when filters change. It can read:

```js
state                      // { ind, by, slice, sort, view }: the current selection
currentRows()              // [{ level, n, est: [pct, ciLow, ciHigh, "A"|"E"] | null, reason }]
sliceEst(indicatorId)      // the overall estimate for the current "narrow to" group
DATA.tables[`${by}|${slice}`]   // any other table, e.g. "age_group|all" or "province|gender=Woman"
META.indicators, META.dimensions
```

**What's in `aggregates.json`:**

```jsonc
{
  "meta":   { "site": {...}, "rules": {...}, "dimensions": [...], "indicators": [...] },
  "slices": { "all": { "n": 5000, "est": { "srh_good": [61.6, 60.2, 63.0, "A"], ... } },
              "gender=Woman": { ... } },
  "tables": { "province|all":          [ { "level": "PEI", "n": 25, "est": {...} }, ... ],
              "province|gender=Woman": [ ... ] }
}
```

`n: null` means the whole group is suppressed. `est.<id>: null` means just that estimate is suppressed.
Text in `meta` is per language (`{"en": "…", "fr": "…"}`). Use the `L()` helper in `app.js` to pick
the current one, and `levelLabel(dim, value)` for group names.

**Accessibility rules for new charts:** give every chart a table equivalent, put `aria-hidden` on
decorative SVG, give each meaningful mark an accessible name, never put interface words directly in
`app.js` (add them to `i18n.js`), and run `make test-a11y`. See [ACCESSIBILITY.md](ACCESSIBILITY.md).

**Use a charting library instead?** You can. For example, Observable Plot or Chart.js loaded from
a CDN. The data shape above maps straight to a dot or bar chart. Keep the table view and the
"suppressed" rows so the page stays accessible and honest about gaps.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `uv: command not found` | Install uv, then open a new terminal. |
| `❌ Config file … is not valid TOML` | The message gives the line. Usually it's a missing quote or a `[[indicators]]` typo. |
| `❌ Dimension column 'x' not found` | The message lists available columns. Check the spelling, or use `expr`. |
| `⚠️ configured levels not in data` | A value in `levels` doesn't match the data exactly. Check spaces, dashes (– vs -) and capitals. |
| `test_file_matches_config` fails | You edited the config but didn't rebuild. Run `make aggregate`. |
| `test_survey_text_has_every_language` fails | A label is missing a language. The message names it. |
| `test_contrast` fails | A colour you changed is too light or dark. The message gives the pair and its ratio. |
| Page says "Couldn't load the data" | You opened `index.html` as a file. Use `make serve`, because browsers block loading data from `file://`. |
| A group shows as **x** everywhere | It's below `min_cell`, or hidden to protect a smaller group. That's working as intended. Merge groups with `expr` if it matters. |
| Lots of **E** flags or hidden estimates | Rare outcomes in small groups aren't reliable. Compare by broader groups. |
