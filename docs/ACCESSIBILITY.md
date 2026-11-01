# Accessibility

**Target:** [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA. This also covers
WCAG 2.1 AA, and the WCAG 2.0 AA required by the **AODA Information and Communications Standards**
(O. Reg. 191/11, IASR Part II). Accessibility is built into the code and checked automatically on
every push. This page records how each requirement is met, how to test it, and what to keep in mind
when you change things.

> ⚠️ **Conformance is a claim about a specific, deployed site with your content.** This repo gives you a
> tested starting point, but any change to colours, charts, wording or data can affect it. Before
> launch, have the deployed site checked: run the manual checklist below, ideally with people who use
> assistive technology every day.

- [What's built in](#whats-built-in)
- [Automated tests](#automated-tests)
- [Manual test checklist](#manual-test-checklist)
- [AODA requirements beyond WCAG](#aoda-requirements-beyond-wcag)
- [Keeping it accessible when you customize](#keeping-it-accessible-when-you-customize)
- [Known limitations](#known-limitations)

---

## What's built in

| Area | WCAG 2.2 criteria | How it's met |
|---|---|---|
| **Structure** | 1.3.1, 2.4.1, 2.4.6, 4.1.2 | Semantic HTML5 landmarks (`header`, `main`, `footer`, labelled `section`s) and a single `h1` with logical `h2`/`h3`. A skip link is the first Tab stop. Real `<label>`s, `<fieldset>`/`<legend>`, and data tables with `<caption>`, `scope` and row headers. |
| **Language** | 3.1.1, 3.1.2 | `<html lang>` follows the selected language. The language switch is marked with its own `lang` and `hreflang`. English-only terms inside French text (the file name `aggregates.json`) are marked `lang="en"`. |
| **Text alternatives for charts** | 1.1.1, 1.3.1 | Each chart row has a full accessible name: value, confidence interval, comparison and reliability. Every chart has a **Table** view with the same data. Heatmap cells carry screen-reader text ("better than overall", "suppressed", "use with caution"). Decorative SVG (axes, gridlines) is `aria-hidden`. |
| **Not colour alone** | 1.4.1 | Heatmap cells show ▲ or ▼ arrows as well as colour. Suppressed cells show "x" and a hatched texture. Low-reliability estimates show "E" and a hollow dot. Selected chips and buttons change shape and weight, not just colour. |
| **Contrast** | 1.4.3, 1.4.11 | All text tokens reach at least 4.5:1, and controls, focus rings and chart marks at least 3:1, in light and dark themes. Heatmap text switches between black and white per cell (minimum 4.5:1). This is checked by `tests/test_contrast.py`. |
| **Keyboard** | 2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11 | Everything works with a keyboard. "Compare by" is an ARIA radio group: arrow keys move, Home and End jump. The chart is a single Tab stop, and arrow keys move between rows (roving tabindex). Focus stays on the same control when content re-renders. Visible 2px focus rings are shown. `scroll-padding` keeps the focused element clear of the sticky filter bar. |
| **Dialog** | 2.1.2, 2.4.3, 4.1.2 | On small screens the filters open as a modal dialog (`role="dialog"`, `aria-modal`). Focus moves in and is kept inside, and the rest of the page is `inert`. Escape closes it and focus returns to the button that opened it. |
| **Dynamic content** | 4.1.3 | Filter changes, copied links and similar actions are announced through one polite live region. Results aren't re-read on every change. |
| **Hover/focus content** | 1.4.13 | Tooltips appear on hover and focus. They can be dismissed with Escape, they can be hovered without disappearing, and they stay until dismissed. Their content is repeated in accessible names and in the Table view, so nobody depends on them. |
| **Reflow & zoom** | 1.4.4, 1.4.10, 1.4.12 | Mobile-first layout with no sideways scrolling at 320 CSS px (400% zoom). Data tables scroll inside their own keyboard-focusable region, which is allowed. Survives the text-spacing override without clipping. Sticky bars stop being sticky on short screens. |
| **Pointer** | 2.5.3, 2.5.8 | Targets are at least 24×24 px (most are 40 to 48 px), and visible labels match accessible names, so "click Filters" works with voice control. |
| **Motion & preferences** | 2.3.3 (AAA, partial), 1.4.11 | `prefers-reduced-motion` turns off transitions. `prefers-color-scheme` and a dark theme toggle (`aria-pressed`) are supported. `forced-colors` (Windows High Contrast) keeps dots, intervals and selection visible. |
| **Consistent help** | 3.2.6 | The accessibility statement and feedback contact are in the same place on every view (footer link). |

---

## Automated tests

```bash
make browser      # once: installs Chromium for Playwright
make test         # contrast tokens, translation completeness, data safety (no browser)
make test-a11y    # browser tests below
```

| Test | What it checks |
|---|---|
| `tests/test_contrast.py` | Every text, control and chart colour token against WCAG thresholds in both themes. It also checks that the two dark-theme blocks match. |
| `tests/test_i18n.py` | Every interface string exists in every language with the same placeholders, and every survey label has every language. |
| `tests/a11y/test_accessibility.py` | **axe-core** (WCAG 2.0/2.1/2.2 A and AA rules) on EN and FR × desktop and mobile × light and dark × default, suppressed and table views, plus the open mobile dialog. **Keyboard:** skip link, radio group, chart roving focus, focus kept after re-render, modal focus trap and return. **Live region** announcements. **Reflow** at 320px. **Text spacing** with no clipping. **Target size** of at least 24px. **Reduced motion.** |

CI runs all of them on every push. The Pages deploy refuses to publish if any fail.

> Automated tools find roughly 30–50% of accessibility problems. The manual checklist is still needed.

---

## Manual test checklist

Do this on the **deployed** site, in English and French, before launch and after major changes.

**Keyboard only** (unplug the mouse)
- [ ] Tab through the whole page: the order is logical, focus is always visible and never hidden under the sticky bar.
- [ ] Change every filter, toggle sort and view, select a heatmap column, switch language and theme.
- [ ] On a phone-sized window: open Filters, Tab cycles inside, Escape closes, focus returns to the button.

**Screen readers.** Test at least two of these:
- [ ] NVDA + Firefox or Chrome (Windows)
- [ ] JAWS + Chrome or Edge (Windows)
- [ ] VoiceOver + Safari (macOS and iOS)
- [ ] TalkBack + Chrome (Android)

For each: headings list makes sense; changing a filter is announced; chart rows read value, interval and comparison; tables read with headers; "x" reads as "suppressed"; the French page is read with a French voice.

**Voice control** (Dragon, Voice Control on macOS or iOS, Voice Access on Android)
- [ ] "Click Filters", "Click Table", "Click Province", "Click Français" all work.

**Zoom and display**
- [ ] Browser zoom at 200% and 400%: nothing is cut off and there's no sideways page scrolling.
- [ ] Windows High Contrast / forced colours: dots, intervals, arrows and the selected state are visible.
- [ ] OS text size set to large (mobile): layout holds.

**Content**
- [ ] Titles, indicator names and group names are clear in both languages (plain language, no unexplained jargon).
- [ ] The French text has been reviewed by a qualified translator (see [TRANSLATING.md](TRANSLATING.md)).

Record results (date, tester, assistive technology and version, issues found) for your compliance file.

---

## AODA requirements beyond WCAG

The IASR Information and Communications Standards include obligations that are about **your
organization's processes**, not the code. The site gives you hooks for them:

| Requirement | Where it's handled |
|---|---|
| **Feedback processes are accessible** (s. 11) | The footer links to the accessibility statement, which shows `[site] accessibility_contact` from `config/survey.toml`. Use a monitored address, and offer phone or other options if your policy requires. |
| **Accessible formats and communication supports on request** (s. 12) | The statement invites requests for other formats. The Table view and CSV download give an immediate alternative. Your organization must be ready to provide others (for example, a tagged PDF or plain-text summary) in a timely manner and at no extra cost. |
| **Accessibility policies, multi-year plan and compliance reports** (ss. 3–4, AODA s. 14) | These are organizational documents. Reference this site and its test records in them. |
| **Training** (s. 7) | Staff who maintain the content should understand the [Keeping it accessible](#keeping-it-accessible-when-you-customize) rules below. |

If you also serve federal audiences, the *Accessible Canada Act* and the federal *Standard on Web
Accessibility* point to the same WCAG AA criteria. The *Official Languages Act* and Quebec's
*Charter of the French Language* may require French content to be **equivalent**, not only
available. Check with your legal or communications team.

---

## Keeping it accessible when you customize

| If you… | Then… |
|---|---|
| Change colours | Run `make test`. `test_contrast.py` tells you which pairs fail. Keep the heatmap scales one hue each, and don't rely on red vs green. |
| Add or rename indicators or groups | Give every one an `fr` (and other language) label, so `make test` passes. Keep `short` names short enough to read in the heatmap header. |
| Add a chart | Give it a text equivalent: either the existing Table view or its own `<table>`. Put `aria-hidden` on decorative SVG, and add an accessible name to each meaningful mark (follow `renderDot` in `app.js`). Don't make tooltips the only way to get a value. |
| Add interface text | Add it to `site/i18n.js` in **every** language. Never hard-code words in `app.js` or `index.html`. |
| Add a third-party embed (map, analytics, video) | Check that it meets WCAG 2.2 AA itself. The tests here can't vouch for code you don't control. Analytics must not add cookie banners that trap focus. |
| Change the layout | Run `make test-a11y` and check 320px width and 200% zoom by hand. |

---

## Known limitations

- **Complex charts and screen readers.** SVG roles (`group`, `img`) are well supported in current
  NVDA, JAWS and VoiceOver, but older combinations may announce chart rows less smoothly. The Table
  view is the dependable alternative, and the chart's help text points to it.
- **Heatmap width.** On phones the heatmap scrolls sideways inside its own focusable region. This is
  allowed for data tables under 1.4.10, but it isn't ideal. The dot chart and Table view are the
  primary mobile experience.
- **Automatic language detection** uses the browser's language on the first visit. The switch is
  always visible and the choice is remembered.
- **CSV** uses "." decimals in every language so files open the same everywhere. French Excel users
  may need to choose "." as the decimal separator on import.
