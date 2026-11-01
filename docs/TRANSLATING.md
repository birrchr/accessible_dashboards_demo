# Languages and translation

The dashboard ships in **English and French**. Visitors switch language with the link at the top
right. The first visit uses the browser's language when it's available, and the choice is remembered.
Links include `?lang=en` or `?lang=fr`, so a shared link opens in the same language.

Text comes from two places:

| What | Where | Who edits it |
|---|---|---|
| **Survey content:** title, intro, indicators, group names, footer | `config/survey.toml` | Whoever owns the survey |
| **Interface text:** buttons, legends, help, screen-reader text, messages | `site/i18n.js` | Rarely changes, mainly when adding a language |

`make test` fails if anything is missing a language, so an untranslated label can't reach the site
unnoticed.

---

## Survey content (`config/survey.toml`)

Any text can be a single string (the same in every language) or one value per language:

```toml
label = { en = "Household income", fr = "Revenu du ménage" }
```

Group names (`levels`) translate the raw data value into display text. A missing language falls
back to the raw value:

```toml
levels = [
  { value = "PEI", en = "Prince Edward Island", fr = "Île-du-Prince-Édouard" },
  { value = "Quebec", fr = "Québec" },     # English shows "Quebec"
  "Ontario",                               # same in every language
]
```

After editing, `make aggregate` lists any text that has only one language:

```
🌐 indicator 'frequent_drinker' label: one text for all languages ('Drinks 3+ times a week')
```

---

## French typography

You can type ordinary spaces. The page converts them automatically:

- Spaces before `:` `;` `%` `$` become non-breaking (`61,6 %`, `Comparaison selon : …`).
- Spaces inside numbers become non-breaking (`30 000 $`), so they never wrap mid-number.
- Numbers and dates use the `fr-CA` locale (`61,6`, `1 novembre 2026`).

Conventions used in the included translation (follow them for consistency):

- Typographic apostrophe `’` (l’état, d’âge).
- No space before `?` and `!` (Canadian usage).
- Provinces and territories use their official French names.
- Money is written `30 000 $`, and ranges as `30 000 $ à 59 999 $`.

> **Have the French reviewed.** The included French was written for this demo. For a public
> site, get every string, especially indicator names and the accessibility statement, reviewed by
> a qualified translator, and plan for French and English to be released together.

---

## Interface text (`site/i18n.js`)

Each language is a block of `key: "text"` pairs:

```js
fr: {
  compareBy: "Comparer selon",
  ci: "IC à 95 % : {lo} à {hi}",     // keep {placeholders} exactly as in English
  ...
}
```

Rules:
- Translate the text and leave the keys and `{placeholders}` untouched. The test checks the placeholders match.
- `csvHeaders` is a list. Keep the same number of items.
- Screen-reader strings (`srBetter`, `rowLabel`, `chartHelp`…) are heard, not seen. Make them read naturally aloud.

---

## Adding a third language

1. In `site/i18n.js`:
   - add a block (copy `en`) and translate it
   - add the locale to `LOCALES` (for example, `iu: "iu-CA"`)
   - add its own name to `NATIVE_NAMES` (for example, `iu: "ᐃᓄᒃᑎᑐᑦ"`)
2. In `config/survey.toml`, add the code to `[site] languages` and add that language to every text value.
3. `make aggregate && make test`. The tests list anything you missed.

With more than two languages, the switch shows the next language. Replace the single link in
`index.html` and `applyStaticText()` with a list if you'd like every language shown at once.
Right-to-left languages also need `dir="rtl"` handling in `applyStaticText()`.
