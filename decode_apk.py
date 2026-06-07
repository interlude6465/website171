"""
APK decode pass — turns binary AXML + resources.arsc into readable XML + JSON
loot, dumped into apk_loot/decoded/.

Strategy:
1. ARSCParser → colors.json, strings.json, dimens.json, styles.json
2. AXMLPrinter → AndroidManifest.xml (readable)
3. Walk res/drawable*/ — decode every .xml as either vector drawable
   (vector → SVG-equivalent) or other (shape, layer-list, selector...)
4. Walk res/values*/ if present in binary form
"""
import os, sys, json, glob, traceback
from pathlib import Path

from pyaxmlparser.arscparser import ARSCParser
from pyaxmlparser.axmlprinter import AXMLPrinter

ROOT = Path(__file__).parent
EXTRACTED = ROOT / "apk_extracted"
OUT = ROOT / "apk_loot" / "decoded"
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "drawables_xml").mkdir(exist_ok=True)
(OUT / "layouts_xml").mkdir(exist_ok=True)
(OUT / "values").mkdir(exist_ok=True)

def safe(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except Exception as e:
        return f"<error: {e}>"

# ---------------------------------------------------------------------------
# 1. ARSC — the resource table (colors, strings, dimens, styles)
# ---------------------------------------------------------------------------
arsc_path = EXTRACTED / "resources.arsc"
print(f"[*] Parsing {arsc_path} ({arsc_path.stat().st_size:,} bytes)")
with open(arsc_path, "rb") as f:
    arsc = ARSCParser(f.read())

packages = arsc.get_packages_names()
print(f"[*] Packages found: {packages}")

dump = {}
for pkg in packages:
    dump[pkg] = {
        "colors":  {},
        "strings": {},
        "dimens":  {},
        "bools":   {},
        "integers": {},
    }
    # Each get_*_resources returns config-keyed XML; we want flat key->value
    # by walking the items directly via ResType.
    types = arsc.get_types(pkg)
    print(f"[*] Package '{pkg}' types: {types[:25]}{'...' if len(types) > 25 else ''}")

    # Colors
    try:
        items = arsc.get_items(pkg, "color")
        for it in items:
            name = it.get_name()
            # Get the value across all configs (default config '')
            val = arsc.get_resource_color(pkg, name)
            dump[pkg]["colors"][name] = val
    except Exception as e:
        dump[pkg]["colors"]["__error__"] = str(e)

    # Strings
    try:
        items = arsc.get_items(pkg, "string")
        for it in items:
            name = it.get_name()
            val = arsc.get_resource_string(pkg, name)
            dump[pkg]["strings"][name] = val
    except Exception as e:
        dump[pkg]["strings"]["__error__"] = str(e)

    # Dimens
    try:
        items = arsc.get_items(pkg, "dimen")
        for it in items:
            name = it.get_name()
            val = arsc.get_resource_dimen(pkg, name)
            dump[pkg]["dimens"][name] = val
    except Exception as e:
        dump[pkg]["dimens"]["__error__"] = str(e)

    # Bools
    try:
        items = arsc.get_items(pkg, "bool")
        for it in items:
            name = it.get_name()
            val = arsc.get_resource_bool(pkg, name)
            dump[pkg]["bools"][name] = val
    except Exception as e:
        dump[pkg]["bools"]["__error__"] = str(e)

    # Integers
    try:
        items = arsc.get_items(pkg, "integer")
        for it in items:
            name = it.get_name()
            val = arsc.get_resource_integer(pkg, name)
            dump[pkg]["integers"][name] = val
    except Exception as e:
        dump[pkg]["integers"]["__error__"] = str(e)

# Write a friendly summary plus the full JSON
with open(OUT / "values" / "resources_summary.json", "w", encoding="utf-8") as f:
    json.dump(dump, f, indent=2, default=str, ensure_ascii=False)

# Per-package values/colors.xml and values/strings.xml in Android format
for pkg, sections in dump.items():
    safe_pkg = pkg.replace(":", "_").replace("/", "_")
    pkg_dir = OUT / "values" / safe_pkg
    pkg_dir.mkdir(parents=True, exist_ok=True)

    # colors.xml
    colors = sections.get("colors", {})
    real = {k: v for k, v in colors.items() if not k.startswith("__") and v is not None}
    with open(pkg_dir / "colors.xml", "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n')
        for name, val in sorted(real.items()):
            f.write(f'    <color name="{name}">{val}</color>\n')
        f.write("</resources>\n")
    print(f"[+] Wrote {len(real)} colors to values/{safe_pkg}/colors.xml")

    # strings.xml
    strings = sections.get("strings", {})
    real = {k: v for k, v in strings.items() if not k.startswith("__") and v is not None}
    with open(pkg_dir / "strings.xml", "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n')
        for name, val in sorted(real.items()):
            esc = (str(val)
                   .replace("&", "&amp;")
                   .replace("<", "&lt;")
                   .replace(">", "&gt;")
                   .replace('"', "&quot;"))
            f.write(f'    <string name="{name}">{esc}</string>\n')
        f.write("</resources>\n")
    print(f"[+] Wrote {len(real)} strings to values/{safe_pkg}/strings.xml")

# ---------------------------------------------------------------------------
# 2. AndroidManifest.xml — binary AXML at the APK root
# ---------------------------------------------------------------------------
manifest_path = EXTRACTED / "AndroidManifest.xml"
print(f"[*] Decoding {manifest_path}")
with open(manifest_path, "rb") as f:
    raw = f.read()
try:
    printer = AXMLPrinter(raw)
    if printer.is_valid():
        xml_bytes = printer.get_buff()
        out = OUT / "AndroidManifest.xml"
        out.write_bytes(xml_bytes)
        print(f"[+] Wrote decoded manifest ({len(xml_bytes):,} bytes)")
    else:
        print("[!] Manifest AXMLPrinter reported not valid")
except Exception:
    traceback.print_exc()

# ---------------------------------------------------------------------------
# 3. Decode binary XMLs under res/drawable*/, res/layout*/, res/xml/
# ---------------------------------------------------------------------------
def decode_dir(in_subdir, out_subdir, limit=None):
    src_root = EXTRACTED / "res"
    dst_root = OUT / out_subdir
    dst_root.mkdir(exist_ok=True)
    count = ok = fail = 0
    for xml_path in sorted(src_root.glob(f"{in_subdir}/*.xml")):
        if limit is not None and count >= limit:
            break
        count += 1
        try:
            raw = xml_path.read_bytes()
            printer = AXMLPrinter(raw)
            if not printer.is_valid():
                fail += 1
                continue
            text = printer.get_buff()
            # Preserve sub-folder name (drawable, drawable-v23, ...) in filename
            stem = f"{xml_path.parent.name}__{xml_path.name}"
            (dst_root / stem).write_bytes(text)
            ok += 1
        except Exception:
            fail += 1
    print(f"[+] {in_subdir}: decoded {ok}/{count} (failed {fail})")
    return ok, fail

# Decode every drawable*/ subdir's XMLs (vector drawables, shapes, selectors,
# layer-lists). These are where the brand icons live (back arrow, P pill,
# tab icons, etc).
total_ok = total_fail = 0
for sub in ["drawable", "drawable-v21", "drawable-v23", "drawable-anydpi-v23",
            "drawable-hdpi-v4", "drawable-watch-v20"]:
    if (EXTRACTED / "res" / sub).is_dir():
        ok, fail = decode_dir(sub, "drawables_xml")
        total_ok += ok; total_fail += fail

# Sample of layouts too — useful to see screen names + view IDs
for sub in ["layout", "layout-land", "layout-v21", "layout-v26",
            "layout-sw600dp-v13", "layout-watch-v20"]:
    if (EXTRACTED / "res" / sub).is_dir():
        ok, fail = decode_dir(sub, "layouts_xml", limit=200)
        total_ok += ok; total_fail += fail

# xml/ — network security config, file_paths, accessibility, etc.
if (EXTRACTED / "res" / "xml").is_dir():
    ok, fail = decode_dir("xml", "values")
    total_ok += ok; total_fail += fail

print(f"\n[*] DONE — total binary XMLs decoded: {total_ok} ok, {total_fail} failed")
print(f"[*] Output: {OUT}")
