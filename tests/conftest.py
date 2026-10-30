import json
import sys
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

AGG_PATH = ROOT / "site/data/aggregates.json"
CONFIG_PATH = ROOT / "config/survey.toml"


@pytest.fixture(scope="session")
def agg() -> dict:
    if not AGG_PATH.exists():
        pytest.fail("site/data/aggregates.json not found. Run `make aggregate` first.")
    return json.loads(AGG_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def config() -> dict:
    return tomllib.loads(CONFIG_PATH.read_text(encoding="utf-8"))
