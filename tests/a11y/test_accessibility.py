"""
Automated accessibility checks: WCAG 2.2 Level AA (which covers AODA's WCAG 2.0 AA requirement).

Automated tools catch roughly a third to a half of accessibility issues. These tests are a
safety net, not a substitute for the manual checks in docs/ACCESSIBILITY.md
(screen reader, voice control, keyboard-only walkthroughs).
"""

import pytest

from tests.a11y.conftest import DESKTOP, MOBILE

pytestmark = pytest.mark.a11y

WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]


def axe_violations(page):
    from axe_playwright_python.sync_playwright import Axe

    results = Axe().run(page, options={"runOnly": {"type": "tag", "values": WCAG_TAGS}, "resultTypes": ["violations"]})
    return [
        f"{v['id']} ({v['impact']}): {v['help']} → {[n['target'] for n in v['nodes']][:3]}"
        for v in results.response["violations"]
    ]


# ── axe-core across languages, screen sizes, themes and views ───────────────
@pytest.mark.parametrize("lang", ["en", "fr"])
@pytest.mark.parametrize("viewport", [DESKTOP, MOBILE], ids=["desktop", "mobile"])
@pytest.mark.parametrize("scheme", ["light", "dark"])
@pytest.mark.parametrize("query", ["", "&by=gender&in=province%3DPEI", "&view=table&i=unmet_need&by=education"],
                         ids=["default", "suppressed", "table"])
def test_axe_no_wcag_violations(open_page, lang, viewport, scheme, query):
    page = open_page(f"?lang={lang}{query}", viewport=viewport, scheme=scheme)
    assert not page.errors, page.errors
    assert "[object" not in page.inner_text("body"), "a rendering bug leaked object text into the page"
    assert axe_violations(page) == []


@pytest.mark.parametrize("lang", ["en", "fr"])
def test_axe_mobile_filter_dialog(open_page, lang):
    page = open_page(f"?lang={lang}", viewport=MOBILE)
    page.click("#open-filters")
    page.wait_for_selector("#controls[role=dialog]")
    page.wait_for_timeout(300)
    assert axe_violations(page) == []


# ── Language (WCAG 3.1.1, 3.1.2) ────────────────────────────────────────────
def test_language_attribute_and_switch(open_page):
    page = open_page("?lang=en")
    assert page.get_attribute("html", "lang") == "en"
    toggle = page.locator("#lang-toggle")
    assert toggle.get_attribute("lang") == "fr" and toggle.inner_text() == "Français"
    toggle.click()
    assert page.get_attribute("html", "lang") == "fr"
    assert "Indicateur" in page.inner_text("label[for=indicator]")
    assert "lang=fr" in page.url
    assert page.evaluate("document.activeElement.id") == "lang-toggle"


def test_browser_language_used_on_first_visit(browser, base_url):
    ctx = browser.new_context(locale="fr-CA")
    page = ctx.new_page()
    page.goto(base_url)
    page.wait_for_selector(".dot-chart svg", state="attached")
    assert page.get_attribute("html", "lang") == "fr"
    ctx.close()


# ── Keyboard (WCAG 2.1.1, 2.4.1, 2.4.3, 2.4.7) ──────────────────────────────
def test_skip_link_is_first_and_works(open_page):
    page = open_page()
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.classList.contains('skip')")
    page.keyboard.press("Enter")
    assert page.evaluate("document.activeElement.id") == "main"


def test_compare_chips_are_a_radio_group(open_page):
    page = open_page("?by=province")
    page.focus(".chip[aria-checked=true]")
    page.keyboard.press("ArrowRight")
    focused = page.evaluate("[document.activeElement.dataset.dim, document.activeElement.getAttribute('aria-checked')]")
    assert focused == ["age_group", "true"]
    assert page.locator(".chip[tabindex='0']").count() == 1


def test_chart_rows_use_roving_focus(open_page):
    page = open_page()
    assert page.locator(".dot-chart .row[tabindex='0']").count() == 1
    first = page.locator(".dot-chart .row[tabindex='0']")
    first.focus()
    name1 = page.evaluate("document.activeElement.getAttribute('aria-label')")
    page.keyboard.press("ArrowDown")
    name2 = page.evaluate("document.activeElement.getAttribute('aria-label')")
    assert name1 != name2 and "95%" in name2
    page.keyboard.press("Escape")  # dismisses tooltip (1.4.13)
    assert page.locator("#tooltip").is_hidden()


def test_focus_kept_after_heatmap_column_selected(open_page):
    page = open_page()
    btn = page.locator(".heatmap thead button[data-fk='heat-diabetes']")
    btn.focus()
    page.keyboard.press("Enter")
    assert page.evaluate("document.activeElement.dataset.fk") == "heat-diabetes"
    assert page.evaluate("document.activeElement.getAttribute('aria-pressed')") == "true"


def test_mobile_filter_dialog_is_modal(open_page):
    page = open_page(viewport=MOBILE)
    page.click("#open-filters")
    page.wait_for_selector("#controls[role=dialog][aria-modal=true]")
    page.wait_for_timeout(150)
    assert page.evaluate("document.activeElement.id") == "indicator"
    for _ in range(15):  # focus must stay inside the dialog
        page.keyboard.press("Tab")
        assert page.evaluate("!!document.activeElement.closest('#controls')")
    page.keyboard.press("Escape")
    assert page.locator("#controls[role=dialog]").count() == 0
    assert page.evaluate("document.activeElement.id") == "open-filters"


def test_changes_are_announced(open_page):
    page = open_page("?lang=en")
    page.select_option("#indicator", "diabetes")
    page.wait_for_function("document.querySelector('#status').textContent.includes('Diabetes')")


# ── Reflow, spacing, target size (WCAG 1.4.10, 1.4.12, 2.5.8) ──────────────
@pytest.mark.parametrize("lang", ["en", "fr"])
def test_reflow_at_320px(open_page, lang):
    page = open_page(f"?lang={lang}", viewport={"width": 320, "height": 640})
    overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    assert overflow <= 0, f"page scrolls sideways by {overflow}px at 320px (data tables may scroll inside their own region)"


def test_text_spacing_does_not_clip(open_page):
    page = open_page("?lang=fr")
    page.add_style_tag(content="* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }")
    page.wait_for_timeout(200)
    clipped = page.evaluate("""() => [...document.querySelectorAll('body *')].filter(e => {
        if (e.closest('.sr-only, svg, .table-wrap')) return false;
        const cs = getComputedStyle(e);
        if (!['hidden', 'clip'].includes(cs.overflowX) && !['hidden', 'clip'].includes(cs.overflowY)) return false;
        return e.textContent.trim() && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1);
    }).map(e => e.className || e.tagName)""")
    assert clipped == []
    assert page.evaluate("document.documentElement.scrollWidth - window.innerWidth") <= 0


@pytest.mark.parametrize("viewport", [DESKTOP, MOBILE], ids=["desktop", "mobile"])
def test_target_size_minimum(open_page, viewport):
    page = open_page(viewport=viewport)
    small = page.evaluate("""() => [...document.querySelectorAll('button, select, a[href], [tabindex="0"]')]
        .filter(e => e.offsetParent !== null && !e.closest('p, li, .sr-only') && !e.classList.contains('skip'))
        .map(e => [e.id || e.className || e.tagName, e.getBoundingClientRect()])
        .filter(([, r]) => r.width < 24 || r.height < 24)
        .map(([n, r]) => `${n} ${Math.round(r.width)}x${Math.round(r.height)}`)""")
    assert small == []


def test_reduced_motion_respected(open_page):
    page = open_page(viewport=MOBILE, reduced_motion="reduce")
    assert page.evaluate("getComputedStyle(document.querySelector('#controls')).transitionDuration") in ("0s", "0s, 0s")
