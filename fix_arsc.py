"""
fix_arsc.py — re-runs only the ARSC bulk-extract pass with proper bytes handling.
get_string_resources()/get_color_resources() etc return BYTES, not str.
"""
import json
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

class _Devnull:
    def write(self, *a, **kw): pass
    def flush(self): pass
_real_stdout = sys.stdout

sys.stdout = _Devnull()
from pyaxmlparser.arscparser import ARSCParser
sys.stdout = _real_stdout

ROOT = Path(__file__).parent
OUT = ROOT / "apk_loot" / "decoded"

with open(ROOT / "apk_extracted" / "resources.arsc", "rb") as f:
    sys.stdout = _Devnull()
    arsc = ARSCParser(f.read())
    sys.stdout = _real_stdout

packages = arsc.get_packages_names()

def parse_resources_xml(xml_text, tag):
    """Pull <tag name="..."> ... </tag> pairs out of the resources XML.
    Accepts str or bytes; bytes are decoded utf-8/latin-1 robust."""
    if not xml_text:
        return {}
    if isinstance(xml_text, bytes):
        try:
            xml_text = xml_text.decode("utf-8")
        except UnicodeDecodeError:
            xml_text = xml_text.decode("latin-1", errors="replace")
    # Self-closing: <bool name="x">true</bool>  OR  <item ...>val</item>
    pattern = re.compile(
        rf'<{tag}\s+name="([^"]+)"[^>]*?>(.*?)</{tag}>',
        re.DOTALL
    )
    out = {}
    for m in pattern.finditer(xml_text):
        name = m.group(1)
        val  = m.group(2).strip()
        val  = (val.replace("&amp;", "&")
                   .replace("&lt;", "<")
                   .replace("&gt;", ">")
                   .replace("&quot;", '"')
                   .replace("&apos;", "'"))
        out[name] = val
    return out

dump = {}
for pkg in packages:
    pkg_data = {"strings": {}, "colors": {}, "dimens": {}, "bools": {}, "integers": {}}

    for kind, getter_name, tag in [
        ("strings",  "get_string_resources",  "string"),
        ("colors",   "get_color_resources",   "color"),
        ("dimens",   "get_dimen_resources",   "dimen"),
        ("bools",    "get_bool_resources",    "bool"),
        ("integers", "get_integer_resources", "integer"),
    ]:
        try:
            sys.stdout = _Devnull()
            getter = getattr(arsc, getter_name)
            result = getter(pkg)
            sys.stdout = _real_stdout

            # Result may be: str/bytes (single config), or dict {config: str/bytes}
            if isinstance(result, dict):
                # Merge all configs (default + any qualifier-specific)
                for cfg, xml_text in result.items():
                    parsed = parse_resources_xml(xml_text, tag)
                    pkg_data[kind].update(parsed)
            else:
                pkg_data[kind].update(parse_resources_xml(result, tag))
        except Exception as e:
            sys.stdout = _real_stdout
            print(f"[{kind}] error: {e}")

    dump[pkg] = pkg_data
    print(f"{pkg}: strings={len(pkg_data['strings'])} colors={len(pkg_data['colors'])} "
          f"dimens={len(pkg_data['dimens'])} bools={len(pkg_data['bools'])} ints={len(pkg_data['integers'])}")

# Write
with open(OUT / "values" / "resources_summary.json", "w", encoding="utf-8") as f:
    json.dump(dump, f, indent=2, ensure_ascii=False, default=str)

for pkg, sections in dump.items():
    safe_pkg = pkg.replace(":", "_").replace("/", "_")
    pkg_dir = OUT / "values" / safe_pkg
    pkg_dir.mkdir(parents=True, exist_ok=True)
    for kind, tag in [("strings", "string"), ("colors", "color"),
                       ("dimens", "dimen"), ("bools", "bool"),
                       ("integers", "integer")]:
        data = sections.get(kind, {})
        with open(pkg_dir / f"{kind}.xml", "w", encoding="utf-8") as f:
            f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n')
            for name, val in sorted(data.items()):
                if val is None:
                    continue
                esc = xml_escape(str(val), {'"': "&quot;"})
                f.write(f'    <{tag} name="{name}">{esc}</{tag}>\n')
            f.write("</resources>\n")
        print(f"  -> {kind}.xml ({len(data)} entries)")

print("DONE")
