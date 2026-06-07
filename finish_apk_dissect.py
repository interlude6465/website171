"""
finish_apk_dissect.py — completes the APK dissection that decode_apk.py
started. Fixes the bulk-extract API calls for pyaxmlparser, dumps strings/
colors/dimens/bools/integers from resources.arsc, decodes AndroidManifest +
res/xml/*, greps both classes*.dex for HTTP URLs / endpoints, and writes a
structured JSON dump per category.

Output layout (under apk_loot/decoded/):
    values/au.gov.vic.myvicroads/strings.xml      (1122 strings)
    values/au.gov.vic.myvicroads/colors.xml       (full brand palette)
    values/au.gov.vic.myvicroads/dimens.xml
    values/au.gov.vic.myvicroads/bools.xml
    values/au.gov.vic.myvicroads/integers.xml
    values/resources_summary.json                 (full dump, all packages)
    AndroidManifest.xml                           (decoded readable)
    xml/<name>.xml                                (re-decoded from res/xml/)
    dex_strings/classes_urls.txt
    dex_strings/classes2_urls.txt
    dex_strings/classes_combined_endpoints.txt    (HTTP/HTTPS only, dedup)
"""
import json
import re
import sys
import traceback
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

# Silence the "res1 is not zero!" spam pyaxmlparser prints to stdout
import os
class _Devnull:
    def write(self, *a, **kw): pass
    def flush(self): pass
_real_stdout = sys.stdout

ROOT = Path(__file__).parent
EXTRACTED = ROOT / "apk_extracted"
OUT = ROOT / "apk_loot" / "decoded"
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "values").mkdir(exist_ok=True)
(OUT / "xml").mkdir(exist_ok=True)
(OUT / "dex_strings").mkdir(exist_ok=True)

# Suppress pyaxmlparser's verbose internal warnings during import + parse
sys.stdout = _Devnull()
from pyaxmlparser.arscparser import ARSCParser
from pyaxmlparser.axmlprinter import AXMLPrinter
sys.stdout = _real_stdout

print("=" * 70)
print("  finish_apk_dissect.py — completing the APK dissection")
print("=" * 70)

# -------------------------------------------------------------------------
# 1. ARSC bulk extract — strings, colors, dimens, bools, integers
# -------------------------------------------------------------------------
arsc_path = EXTRACTED / "resources.arsc"
print(f"\n[1] Parsing {arsc_path.name} ({arsc_path.stat().st_size:,} bytes)")

sys.stdout = _Devnull()
with open(arsc_path, "rb") as f:
    arsc = ARSCParser(f.read())
sys.stdout = _real_stdout

packages = arsc.get_packages_names()
print(f"    Packages found: {packages}")

# Bulk getters return per-config XML strings. Parse that XML to extract
# name -> value pairs for each resource type.
def parse_resources_xml(xml_text, tag):
    """Pull <tag name="..."> ... </tag> pairs out of the resources XML."""
    if not xml_text:
        return {}
    # The bulk getters return Android values-style XML
    pattern = re.compile(
        rf'<{tag}\s+name="([^"]+)"[^>]*?>(.*?)</{tag}>',
        re.DOTALL
    )
    out = {}
    for m in pattern.finditer(xml_text):
        name = m.group(1)
        val  = m.group(2).strip()
        # Unescape common entities
        val = (val.replace("&amp;", "&")
                  .replace("&lt;", "<")
                  .replace("&gt;", ">")
                  .replace("&quot;", '"')
                  .replace("&apos;", "'"))
        out[name] = val
    return out

dump = {}
for pkg in packages:
    pkg_data = {
        "strings":  {},
        "colors":   {},
        "dimens":   {},
        "bools":    {},
        "integers": {},
    }

    # Bulk getters — quieter and more reliable than per-item iteration.
    try:
        sys.stdout = _Devnull()
        configs = arsc.get_string_resources(pkg)  # dict: config -> xml string
        sys.stdout = _real_stdout
        # Use default config '' (or first available)
        for cfg, xml_text in (configs.items() if isinstance(configs, dict) else [('', configs)]):
            if cfg in ('', '\x00\x00\x00\x00', None):  # default config
                pkg_data["strings"].update(parse_resources_xml(xml_text, "string"))
                break
        else:
            # No "default" config — merge them all
            for cfg, xml_text in configs.items():
                pkg_data["strings"].update(parse_resources_xml(xml_text, "string"))
    except Exception as e:
        sys.stdout = _real_stdout
        print(f"    [strings] error: {e}")

    try:
        sys.stdout = _Devnull()
        configs = arsc.get_color_resources(pkg)
        sys.stdout = _real_stdout
        for cfg, xml_text in (configs.items() if isinstance(configs, dict) else [('', configs)]):
            pkg_data["colors"].update(parse_resources_xml(xml_text, "color"))
    except Exception as e:
        sys.stdout = _real_stdout
        print(f"    [colors] error: {e}")

    try:
        sys.stdout = _Devnull()
        configs = arsc.get_dimen_resources(pkg)
        sys.stdout = _real_stdout
        for cfg, xml_text in (configs.items() if isinstance(configs, dict) else [('', configs)]):
            pkg_data["dimens"].update(parse_resources_xml(xml_text, "dimen"))
    except Exception as e:
        sys.stdout = _real_stdout
        print(f"    [dimens] error: {e}")

    try:
        sys.stdout = _Devnull()
        configs = arsc.get_bool_resources(pkg)
        sys.stdout = _real_stdout
        for cfg, xml_text in (configs.items() if isinstance(configs, dict) else [('', configs)]):
            pkg_data["bools"].update(parse_resources_xml(xml_text, "bool"))
    except Exception as e:
        sys.stdout = _real_stdout
        print(f"    [bools] error: {e}")

    try:
        sys.stdout = _Devnull()
        configs = arsc.get_integer_resources(pkg)
        sys.stdout = _real_stdout
        for cfg, xml_text in (configs.items() if isinstance(configs, dict) else [('', configs)]):
            pkg_data["integers"].update(parse_resources_xml(xml_text, "integer"))
    except Exception as e:
        sys.stdout = _real_stdout
        print(f"    [integers] error: {e}")

    dump[pkg] = pkg_data
    print(f"    {pkg}: strings={len(pkg_data['strings'])} colors={len(pkg_data['colors'])} "
          f"dimens={len(pkg_data['dimens'])} bools={len(pkg_data['bools'])} ints={len(pkg_data['integers'])}")

# Write JSON summary
with open(OUT / "values" / "resources_summary.json", "w", encoding="utf-8") as f:
    json.dump(dump, f, indent=2, ensure_ascii=False, default=str)
print(f"    -> values/resources_summary.json written")

# Write Android-style XML per package per type
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
                # Escape XML-special characters in value, preserve format-strings
                esc = xml_escape(str(val), {'"': "&quot;"})
                f.write(f'    <{tag} name="{name}">{esc}</{tag}>\n')
            f.write("</resources>\n")
        print(f"    -> values/{safe_pkg}/{kind}.xml ({len(data)} entries)")

# -------------------------------------------------------------------------
# 2. AndroidManifest.xml — binary AXML -> readable
# -------------------------------------------------------------------------
print(f"\n[2] Decoding AndroidManifest.xml")
manifest_path = EXTRACTED / "AndroidManifest.xml"
try:
    with open(manifest_path, "rb") as f:
        raw = f.read()
    sys.stdout = _Devnull()
    printer = AXMLPrinter(raw)
    sys.stdout = _real_stdout
    if printer.is_valid():
        xml_bytes = printer.get_buff()
        out_path = OUT / "AndroidManifest.xml"
        out_path.write_bytes(xml_bytes)
        print(f"    -> AndroidManifest.xml ({len(xml_bytes):,} bytes)")
    else:
        print("    [!] manifest reported not valid")
except Exception as e:
    print(f"    [!] manifest decode failed: {e}")
    traceback.print_exc()

# -------------------------------------------------------------------------
# 3. res/xml/* — backup rules, data extraction, remote_config_defaults, etc.
# -------------------------------------------------------------------------
print(f"\n[3] Decoding res/xml/* binary AXMLs")
xml_dir = EXTRACTED / "res" / "xml"
if xml_dir.is_dir():
    for xml_path in sorted(xml_dir.glob("*.xml")):
        try:
            raw = xml_path.read_bytes()
            sys.stdout = _Devnull()
            printer = AXMLPrinter(raw)
            sys.stdout = _real_stdout
            if printer.is_valid():
                text = printer.get_buff()
                out_path = OUT / "xml" / xml_path.name
                out_path.write_bytes(text)
                print(f"    -> xml/{xml_path.name} ({len(text):,} bytes)")
            else:
                print(f"    [!] {xml_path.name} not valid AXML — copying raw")
                (OUT / "xml" / xml_path.name).write_bytes(raw)
        except Exception as e:
            print(f"    [!] {xml_path.name} failed: {e}")

# Also try res/raw firebase_common_keep.xml — sometimes binary
firebase_keep = EXTRACTED / "res" / "raw" / "firebase_common_keep.xml"
if firebase_keep.exists():
    try:
        raw = firebase_keep.read_bytes()
        if raw[:4] == b'\x03\x00\x08\x00':  # AXML magic
            sys.stdout = _Devnull()
            printer = AXMLPrinter(raw)
            sys.stdout = _real_stdout
            if printer.is_valid():
                (OUT / "xml" / "firebase_common_keep.xml").write_bytes(printer.get_buff())
                print(f"    -> xml/firebase_common_keep.xml (decoded from AXML)")
        else:
            (OUT / "xml" / "firebase_common_keep.xml").write_bytes(raw)
            print(f"    -> xml/firebase_common_keep.xml (already plain)")
    except Exception as e:
        print(f"    [!] firebase_common_keep failed: {e}")

# -------------------------------------------------------------------------
# 4. classes.dex / classes2.dex string grep — URLs & endpoints
# -------------------------------------------------------------------------
print(f"\n[4] DEX URL/endpoint grep")

URL_RE = re.compile(rb'https?://[A-Za-z0-9._~:/?#\[\]@!$&\'()*+,;=\-]{4,200}')
ENDPOINT_RE = re.compile(rb'(?:/v\d+/|/api/|/graphql|/rest/|/auth/|/login|/cognito)[A-Za-z0-9._/?#\-]{0,80}')
INTERESTING_LIT = re.compile(
    rb'(?:vicroads|myvicroads|amazonaws|amplifyapp|cognito|appsync|graphql|firebase|fcm|gcm|recaptcha|maps\.google|pin_view|biometric|hologram|barcode|qrcode|licence|demerit|vehicles|payments|permit|webview)',
    re.IGNORECASE
)

combined_urls = set()
combined_endpoints = set()
interesting_strings = set()

for dex_name in ["classes.dex", "classes2.dex"]:
    dex_path = EXTRACTED / dex_name
    if not dex_path.exists():
        continue
    print(f"    [*] Scanning {dex_name} ({dex_path.stat().st_size:,} bytes)")
    raw = dex_path.read_bytes()

    urls = set(URL_RE.findall(raw))
    endpoints = set(ENDPOINT_RE.findall(raw))

    combined_urls.update(urls)
    combined_endpoints.update(endpoints)

    # Pull interesting plaintext literals (printable ASCII runs containing keywords)
    # We walk the file pulling printable runs >=8 chars then filter.
    printable_runs = re.findall(rb'[\x20-\x7E]{8,}', raw)
    for run in printable_runs:
        if INTERESTING_LIT.search(run):
            try:
                interesting_strings.add(run.decode('utf-8', errors='replace'))
            except Exception:
                pass

    out_urls = OUT / "dex_strings" / f"{dex_name}__urls.txt"
    with open(out_urls, "w", encoding="utf-8") as f:
        for u in sorted(urls):
            try:
                f.write(u.decode('utf-8', errors='replace') + "\n")
            except Exception:
                pass
    print(f"        -> {out_urls.name} ({len(urls)} URLs)")

# Combined dedup outputs
with open(OUT / "dex_strings" / "all_urls_dedup.txt", "w", encoding="utf-8") as f:
    for u in sorted(combined_urls):
        try:
            f.write(u.decode('utf-8', errors='replace') + "\n")
        except Exception:
            pass
print(f"    -> dex_strings/all_urls_dedup.txt ({len(combined_urls)} unique URLs)")

with open(OUT / "dex_strings" / "endpoint_fragments.txt", "w", encoding="utf-8") as f:
    for e in sorted(combined_endpoints):
        try:
            f.write(e.decode('utf-8', errors='replace') + "\n")
        except Exception:
            pass
print(f"    -> dex_strings/endpoint_fragments.txt ({len(combined_endpoints)} unique endpoints)")

with open(OUT / "dex_strings" / "interesting_literals.txt", "w", encoding="utf-8") as f:
    for s in sorted(interesting_strings):
        f.write(s + "\n")
print(f"    -> dex_strings/interesting_literals.txt ({len(interesting_strings)} unique strings)")

# -------------------------------------------------------------------------
# 5. Capture/copy plaintext config files for the inventory pipeline
# -------------------------------------------------------------------------
print(f"\n[5] Capturing plaintext configs")
configs_to_grab = [
    ("res/raw/amplifyconfiguration.json",            "amplifyconfiguration.json"),
    ("res/raw/inject_css.js",                        "inject_css.js"),
    ("res/raw/inject_js.js",                         "inject_js.js"),
    ("res/raw/hologram_vertex.glsl",                 "hologram_vertex.glsl"),
    ("res/raw/hologram_fragment.glsl",               "hologram_fragment.glsl"),
    ("kotlin-tooling-metadata.json",                 "kotlin-tooling-metadata.json"),
    ("action_logs.proto",                            "action_logs.proto"),
    ("client_analytics.proto",                       "client_analytics.proto"),
]
configs_dir = OUT / "configs"
configs_dir.mkdir(exist_ok=True)
for src_rel, dst_name in configs_to_grab:
    src = EXTRACTED / src_rel
    if src.exists():
        dst = configs_dir / dst_name
        dst.write_bytes(src.read_bytes())
        print(f"    -> configs/{dst_name} ({src.stat().st_size:,} bytes)")

# -------------------------------------------------------------------------
# 6. Properties files — version info etc.
# -------------------------------------------------------------------------
print(f"\n[6] Properties files (library versions)")
props_dir = OUT / "properties"
props_dir.mkdir(exist_ok=True)
props_count = 0
for p in sorted(EXTRACTED.glob("*.properties")):
    (props_dir / p.name).write_bytes(p.read_bytes())
    props_count += 1
print(f"    -> properties/ ({props_count} files)")

# -------------------------------------------------------------------------
# Final summary
# -------------------------------------------------------------------------
print("\n" + "=" * 70)
print("  Dissection complete")
print("=" * 70)
print(f"  Output: {OUT}")
