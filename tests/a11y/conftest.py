"""
Fixtures for browser-based accessibility tests.

Starts a static file server for site/ and a headless Chromium (Playwright).
Run with:  make test-a11y      (first time: uv run playwright install chromium)
"""

import functools
import http.server
import threading
from pathlib import Path

import pytest

SITE = Path(__file__).resolve().parents[2] / "site"


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="session")
def base_url():
    handler = functools.partial(_QuietHandler, directory=str(SITE))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}/"
    server.shutdown()


@pytest.fixture(scope="session")
def browser():
    sync_playwright = pytest.importorskip("playwright.sync_api").sync_playwright
    with sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # browser not installed
            pytest.skip(f"Chromium not available ({e}). Run: uv run playwright install chromium")
        yield b
        b.close()


DESKTOP = {"width": 1280, "height": 900}
MOBILE = {"width": 390, "height": 844}


@pytest.fixture
def open_page(browser, base_url):
    pages = []

    def _open(query="", viewport=DESKTOP, scheme="light", reduced_motion="reduce"):
        ctx = browser.new_context(viewport=viewport, color_scheme=scheme, reduced_motion=reduced_motion)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base_url + query)
        page.wait_for_selector(".dot-chart svg", state="attached")
        page.errors = errors
        pages.append(ctx)
        return page

    yield _open
    for c in pages:
        c.close()
