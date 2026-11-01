"""
Colour contrast of the design tokens in site/styles.css, in light and dark themes.

WCAG 1.4.3  text ≥ 4.5:1          WCAG 1.4.11  UI component and graphic boundaries ≥ 3:1
Heatmap cells: the page picks black or white text per cell; the better of the two must reach 4.5:1.
Runs without a browser. If you re-brand (docs/CUSTOMIZING.md §6), this tells you what to fix.
"""

import re
from pathlib import Path

import pytest

CSS = (Path(__file__).resolve().parents[1] / "site/styles.css").read_text(encoding="utf-8")


def block(start: str) -> str:
    i = CSS.index(start)
    return CSS[i: CSS.index("}", i)]


def tokens(text: str) -> dict:
    return dict(re.findall(r"(--[\w-]+):\s*(#[0-9a-fA-F]{6})", text))


LIGHT = tokens(block(":root {"))
DARK = {**LIGHT, **tokens(block(':root[data-theme="dark"] {'))}
THEMES = {"light": LIGHT, "dark": DARK}


def luminance(hex_: str) -> float:
    c = [int(hex_[i: i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a: str, b: str) -> float:
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def test_dark_theme_blocks_match():
    """The OS-dark and toggle-dark blocks must define the same values."""
    media = CSS[CSS.index("@media (prefers-color-scheme: dark)"):]
    assert tokens(media[: media.index("}\n}")]) == tokens(block(':root[data-theme="dark"] {'))


@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("fg", ["--ink", "--ink-2", "--ink-muted", "--axis-ink", "--accent-ink"])
@pytest.mark.parametrize("bg", ["--page", "--surface", "--surface-2"])
def test_text_contrast(theme, fg, bg):
    t = THEMES[theme]
    assert ratio(t[fg], t[bg]) >= 4.5, f"{theme}: {fg} on {bg} = {ratio(t[fg], t[bg]):.2f}:1"


@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("fg", ["--control-border", "--ci", "--series-1", "--accent", "--ink-2"])
@pytest.mark.parametrize("bg", ["--page", "--surface"])
def test_non_text_contrast(theme, fg, bg):
    t = THEMES[theme]
    assert ratio(t[fg], t[bg]) >= 3, f"{theme}: {fg} on {bg} = {ratio(t[fg], t[bg]):.2f}:1"


@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("cell", ["--div-b3", "--div-b2", "--div-b1", "--div-0", "--div-r1", "--div-r2", "--div-r3"])
def test_heatmap_cell_text(theme, cell):
    bg = THEMES[theme][cell]
    best = max(ratio("#ffffff", bg), ratio("#0b0b0b", bg))
    assert best >= 4.5, f"{theme}: no readable text colour on {cell} {bg} (best {best:.2f}:1)"
