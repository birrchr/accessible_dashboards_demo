"""
Translation completeness:
  • every interface string in site/i18n.js exists in every language, with the same {placeholders}
  • every survey text in the public file (titles, indicators, groups) has every configured language
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = (ROOT / "site/i18n.js").read_text(encoding="utf-8")


def strings_by_lang() -> dict[str, dict[str, str]]:
    body = JS[JS.index("export const STRINGS"):]
    out, current = {}, None
    for line in body.splitlines():
        m = re.match(r"^  (\w+): \{$", line)
        if m:
            current = out.setdefault(m.group(1), {})
            continue
        m = re.match(r'^    (\w+): (".*"|\[.*\]),?$', line)
        if m and current is not None:
            current[m.group(1)] = m.group(2)
    return out


def test_interface_strings_complete():
    langs = strings_by_lang()
    assert {"en", "fr"} <= set(langs), f"languages found: {sorted(langs)}"
    base = langs["en"]
    for lang, table in langs.items():
        missing = sorted(set(base) - set(table))
        extra = sorted(set(table) - set(base))
        assert not missing, f"{lang}: missing keys {missing}"
        assert not extra, f"{lang}: keys not in en {extra}"
        for k, v in table.items():
            assert set(re.findall(r"\{(\w+)\}", v)) == set(re.findall(r"\{(\w+)\}", base[k])), f"{lang}.{k}: placeholders differ"


def test_locales_declared_for_each_language():
    langs = strings_by_lang()
    locales = re.search(r"LOCALES = \{(.*?)\}", JS).group(1)
    for lang in langs:
        assert re.search(rf"\b{lang}:", locales), f"LOCALES has no entry for {lang}"


def test_survey_text_has_every_language(agg):
    langs = agg["meta"]["site"]["languages"]
    ui = strings_by_lang()
    for lang in langs:
        assert lang in ui, f"[site] languages has {lang!r} but site/i18n.js has no {lang} block"

    def check(obj, where):
        assert isinstance(obj, dict), f"{where}: not localized (run make aggregate)"
        for lang in langs:
            assert obj.get(lang, "").strip(), f"{where}: empty {lang!r} text"

    for k in ("title", "eyebrow", "lede", "footer"):
        check(agg["meta"]["site"][k], f"site.{k}")
    for d in agg["meta"]["dimensions"]:
        check(d["label"], f"dimension {d['id']} label")
        for v in d["levels"]:
            check(d["level_labels"][v], f"dimension {d['id']} level {v!r}")
    for i in agg["meta"]["indicators"]:
        for k in ("label", "short", "theme"):
            check(i[k], f"indicator {i['id']} {k}")
