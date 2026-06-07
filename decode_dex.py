"""
decode_dex.py — myVicRoads v1.3.5 DEX analysis

Drives androguard to extract:
  A. API endpoints (URLs, Retrofit annotations, Apollo/Amplify GQL paths)
  B. LicenceViewModel + related data class schemas
  C. EnlargedQrCodeViewModel state + QR refresh constants
  D. Compose Color(0xFF...) literals with their owning class
  E. Hologram shader uniform feeders (u_time / u_roll)

Outputs:
  - apk_loot/decompiled/<package>/<Class>.txt   per-class dump (fields, methods, str refs)
  - apk_loot/decompiled/_index.txt              full class list
  - apk_loot/decompiled/_findings.json          structured findings
  - DEX_DECOMPILE.md is rewritten by emit_markdown()

Usage:
  py decode_dex.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable

os.environ.setdefault("LOGURU_LEVEL", "WARNING")
from loguru import logger  # noqa: E402

logger.remove()
logger.add(sys.stderr, level="WARNING")

from androguard.core.dex import DEX, ClassDefItem, EncodedMethod  # noqa: E402

ROOT = Path(__file__).parent.resolve()
DEX_FILES = [
    ROOT / "apk_extracted" / "classes.dex",
    ROOT / "apk_extracted" / "classes2.dex",
]
OUT_DIR = ROOT / "apk_loot" / "decompiled"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TYPE_MAP = {
    "V": "void", "Z": "boolean", "B": "byte", "S": "short", "C": "char",
    "I": "int", "J": "long", "F": "float", "D": "double",
}


def java_type(desc: str) -> str:
    """Convert DEX type descriptor to Java-style name."""
    arr = 0
    while desc.startswith("["):
        desc = desc[1:]
        arr += 1
    if desc in TYPE_MAP:
        out = TYPE_MAP[desc]
    elif desc.startswith("L") and desc.endswith(";"):
        out = desc[1:-1].replace("/", ".")
    else:
        out = desc
    return out + ("[]" * arr)


def short_type(desc: str) -> str:
    """Last-segment name only."""
    j = java_type(desc)
    return j.split(".")[-1]


def class_short(internal: str) -> str:
    """Lau/gov/vic/vicroads/foo/Bar; -> Bar"""
    if internal.startswith("L") and internal.endswith(";"):
        internal = internal[1:-1]
    return internal.split("/")[-1]


def class_pkg(internal: str) -> str:
    if internal.startswith("L") and internal.endswith(";"):
        internal = internal[1:-1]
    parts = internal.split("/")
    return "/".join(parts[:-1])


def safe_filename(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)


# ---------------------------------------------------------------------------
# Load DEX
# ---------------------------------------------------------------------------

def load_dex(p: Path) -> DEX:
    print(f"[load] {p.name} ({p.stat().st_size:,} bytes)", file=sys.stderr)
    with open(p, "rb") as f:
        return DEX(f.read())


# ---------------------------------------------------------------------------
# Per-class extraction
# ---------------------------------------------------------------------------

def extract_class(c: ClassDefItem, dex: DEX) -> dict:
    name = c.get_name()
    superc = c.get_superclassname()
    interfaces = list(c.get_interfaces() or [])
    fields = []
    for f in c.get_fields():
        fields.append({
            "name": f.get_name(),
            "type": f.get_descriptor(),
            "access": f.get_access_flags_string(),
        })
    methods = []
    for m in c.get_methods():
        proto = m.get_descriptor()  # (Ljava/lang/String;)V
        methods.append({
            "name": m.get_name(),
            "proto": proto,
            "access": m.get_access_flags_string(),
            "addr": m.get_code_off() if m.get_code() else 0,
        })
    return {
        "name": name,
        "super": superc,
        "interfaces": interfaces,
        "fields": fields,
        "methods": methods,
    }


def method_strings(m: EncodedMethod) -> list[str]:
    """Walk a method's instructions; return all string literals referenced."""
    code = m.get_code()
    if not code:
        return []
    out = []
    for ins in code.get_bc().get_instructions():
        op = ins.get_name()
        if "const-string" in op:
            ops = ins.get_output()
            # output is like "v0, 'somestring'"
            mo = re.search(r"'(.*)'", ops, re.DOTALL)
            if mo:
                out.append(mo.group(1))
    return out


def method_consts(m: EncodedMethod) -> list[tuple[str, int]]:
    """Return list of (op, value) for int/long const literals."""
    code = m.get_code()
    if not code:
        return []
    out = []
    for ins in code.get_bc().get_instructions():
        op = ins.get_name()
        if op.startswith("const"):
            ops = ins.get_output()
            # examples:
            #   const v0, 0xff43b02a
            #   const/16 v0, 0x4
            #   const-wide v0, 0xffffffffff
            for mo in re.finditer(r"-?0x[0-9a-fA-F]+|-?\d+", ops):
                tok = mo.group(0)
                try:
                    val = int(tok, 0)
                    out.append((op, val))
                except ValueError:
                    pass
    return out


def method_class_refs(m: EncodedMethod) -> list[str]:
    """Class types referenced by sget/iget/invoke instructions."""
    code = m.get_code()
    if not code:
        return []
    refs = set()
    for ins in code.get_bc().get_instructions():
        out = ins.get_output()
        for mo in re.finditer(r"L[\w/$]+;", out):
            refs.add(mo.group(0))
    return sorted(refs)


# ---------------------------------------------------------------------------
# Searches
# ---------------------------------------------------------------------------

def find_classes(dexes: list[DEX], patterns: list[str]) -> dict[str, list[ClassDefItem]]:
    rxs = [(p, re.compile(p, re.IGNORECASE)) for p in patterns]
    res: dict[str, list[ClassDefItem]] = {p: [] for p in patterns}
    for dex in dexes:
        for c in dex.get_classes():
            n = c.get_name()
            for p, rx in rxs:
                if rx.search(n):
                    res[p].append(c)
    return res


def dump_class_text(c: ClassDefItem, dex: DEX, out_path: Path) -> dict:
    info = extract_class(c, dex)
    lines = []
    lines.append(f"# {info['name']}")
    lines.append(f"super  : {info['super']}")
    if info["interfaces"]:
        lines.append("impls  : " + ", ".join(info["interfaces"]))
    lines.append("")
    lines.append("## Fields")
    for f in info["fields"]:
        lines.append(f"  {f['access']:24} {java_type(f['type']):40} {f['name']}")
    lines.append("")
    lines.append("## Methods")
    method_strings_collected: list[tuple[str, list[str]]] = []
    method_consts_collected: list[tuple[str, list[tuple[str, int]]]] = []
    for m in c.get_methods():
        ms = method_strings(m)
        mc = method_consts(m)
        sig = f"{m.get_name()}{m.get_descriptor()}"
        lines.append(f"  {m.get_access_flags_string():24} {sig}")
        if ms:
            method_strings_collected.append((sig, ms))
            for s in ms:
                show = s if len(s) < 220 else s[:220] + "...<truncated>"
                lines.append(f"      str: {show!r}")
        if mc:
            method_consts_collected.append((sig, mc))
            for op, v in mc:
                if v > 0xFF or v < -1:
                    lines.append(f"      const: {op:18} 0x{v & 0xFFFFFFFF:08x} ({v})")
        # only show class refs for interesting prefixes
        refs = method_class_refs(m)
        vr_refs = [r for r in refs if "vicroads" in r.lower() or "amplify" in r.lower()
                   or "graphql" in r.lower() or "retrofit" in r.lower()
                   or "okhttp" in r.lower() or "corbado" in r.lower() or "apollo" in r.lower()]
        if vr_refs:
            for r in vr_refs[:30]:
                lines.append(f"      ref: {r}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return {
        "info": info,
        "strings": method_strings_collected,
        "consts": method_consts_collected,
    }


def dump_all_vicroads_classes(dexes: list[DEX]) -> list[dict]:
    """Dump every au.gov.vic.vicroads.* class and return collected info."""
    collected = []
    index_lines = []
    for dex in dexes:
        for c in dex.get_classes():
            n = c.get_name()
            if not n.startswith("Lau/gov/vic/vicroads/"):
                continue
            inner = n[1:-1]  # strip L;
            parts = inner.split("/")
            pkg = "/".join(parts[:-1])
            short = parts[-1]
            out_path = OUT_DIR / pkg / (safe_filename(short) + ".txt")
            try:
                info = dump_class_text(c, dex, out_path)
                info["_path"] = str(out_path.relative_to(ROOT))
                info["_pkg"] = pkg
                collected.append(info)
                index_lines.append(str(out_path.relative_to(ROOT)))
            except Exception as e:
                print(f"[warn] {n}: {e}", file=sys.stderr)
    (OUT_DIR / "_index.txt").write_text("\n".join(sorted(index_lines)), encoding="utf-8")
    print(f"[dump] {len(collected)} VicRoads classes written", file=sys.stderr)
    return collected


# ---------------------------------------------------------------------------
# Cross-cutting findings
# ---------------------------------------------------------------------------

URL_RX = re.compile(r"https?://[^\s\"'<>()]+|/[a-zA-Z0-9_./{}\-]{4,}", re.IGNORECASE)
ENDPOINT_RX = re.compile(r"^/[a-zA-Z0-9_./{}\-]+$")
COLOR_RX = re.compile(r"0x[fF][fF][0-9a-fA-F]{6}")


def gather_urls_and_endpoints(collected: list[dict]) -> tuple[list[dict], list[dict]]:
    urls: list[dict] = []
    endpoints: list[dict] = []
    for cls in collected:
        cname = cls["info"]["name"]
        for sig, strs in cls["strings"]:
            for s in strs:
                if "://" in s:
                    urls.append({"class": cname, "method": sig, "url": s})
                elif s.startswith("/") and ENDPOINT_RX.match(s) and len(s) > 4 and not s.startswith("//"):
                    # skip stuff like "/dev/null" etc
                    if any(ch.isalpha() for ch in s):
                        endpoints.append({"class": cname, "method": sig, "path": s})
    return urls, endpoints


def gather_colors(dexes: list[DEX]) -> list[dict]:
    """Walk EVERY class in every DEX and look for 0xFFxxxxxx literals.
    Records owning class, method, and the int value.
    Restricts to classes that look like UI/compose to keep noise down.
    """
    out: list[dict] = []
    for dex in dexes:
        for c in dex.get_classes():
            n = c.get_name()
            # Heuristic: keep anything in au.gov.vic.vicroads.* OR with Compose markers
            keep = (n.startswith("Lau/gov/vic/vicroads/") or
                    "Theme" in n or "Color" in n or "compose" in n.lower())
            if not keep:
                continue
            for m in c.get_methods():
                for op, val in method_consts(m):
                    u32 = val & 0xFFFFFFFF
                    # color literal heuristic: high byte 0xFF, three meaningful low bytes
                    if (u32 >> 24) == 0xFF and 0 < (u32 & 0xFFFFFF):
                        out.append({
                            "class": n,
                            "method": f"{m.get_name()}{m.get_descriptor()}",
                            "value": u32,
                            "op": op,
                        })
    return out


def dedupe_colors(colors: list[dict]) -> list[dict]:
    """Group by class+value; pick first method occurrence."""
    seen: dict[tuple[str, int], dict] = {}
    for c in colors:
        key = (c["class"], c["value"])
        if key not in seen:
            seen[key] = c
    return sorted(seen.values(), key=lambda x: (x["class"], x["value"]))


# ---------------------------------------------------------------------------
# Markdown emitter
# ---------------------------------------------------------------------------

def emit_markdown(
    dexes: list[DEX],
    target_classes: dict[str, list[ClassDefItem]],
    licence_dump: list[dict],
    qr_dump: list[dict],
    urls: list[dict],
    endpoints: list[dict],
    colors: list[dict],
    shader_dump: list[dict],
):
    md = []
    md.append("# DEX Decompile Findings — myVicRoads v1.3.5\n")
    md.append("_Generated by `decode_dex.py`. Re-run to regenerate._\n")

    # §0
    md.append("## §0 Tooling used\n")
    md.append("| Tool | Version | Install | Verified via |")
    md.append("|------|---------|---------|--------------|")
    md.append("| androguard | 4.1.4 | `py -m pip install androguard` | `from androguard.core.dex import DEX; from androguard.misc import AnalyzeDex` |")
    md.append("| Python | 3.14.2 | preinstalled (`py` launcher) | `py --version` |")
    md.append("")
    md.append("Java/JRE was NOT installed (jadx unavailable). Androguard alone parses DEX format and yields field/method tables, string constants, and Dalvik instruction streams. Where Kotlin obfuscation collapsed names to single letters (`a`, `b`, `c`, ...), we recovered semantics by following string literals and call-graph patterns.\n")
    md.append("DEX inputs:")
    for d in DEX_FILES:
        md.append(f"- `{d.relative_to(ROOT).as_posix()}` ({d.stat().st_size:,} bytes)")
    md.append("")
    total = sum(len(list(dex.get_classes())) for dex in dexes)
    md.append(f"Total classes across both DEXes: **{total}**. VicRoads-namespace (`au.gov.vic.vicroads.*`) classes dumped: **{len(licence_dump)+len(qr_dump)+sum(1 for c in dexes for x in c.get_classes() if x.get_name().startswith('Lau/gov/vic/vicroads/'))}**.\n")

    # §1
    md.append("## §1 API endpoints (deliverable A)\n")
    md.append("### §1.1 Absolute URLs reached by Vicroads code\n")
    md.append("These are URLs whose `const-string` literal lives inside an `au.gov.vic.vicroads.*` class (excluding generic helpers, vendor SDK noise).\n")
    md.append("| URL | Owning class | Owning method |")
    md.append("|-----|--------------|---------------|")
    seen_urls = set()
    for u in urls:
        key = u["url"]
        if key in seen_urls:
            continue
        seen_urls.add(key)
        md.append(f"| `{u['url']}` | `{u['class']}` | `{u['method']}` |")
    md.append("")

    md.append("### §1.2 Endpoint path fragments (relative URLs)\n")
    md.append("Likely Retrofit/Apollo/HttpUrl path segments — strings starting with `/` that aren't filesystem paths.\n")
    md.append("| Path | Owning class | Owning method |")
    md.append("|------|--------------|---------------|")
    seen_ep = set()
    # Filter further: drop obvious non-API strings
    NOISE = re.compile(r"^/(android|java|kotlin|com/|org/|res/|assets/|lib/|META|build|src/|main/)", re.IGNORECASE)
    for e in endpoints:
        if NOISE.match(e["path"]):
            continue
        # skip stuff with spaces or angle brackets
        if " " in e["path"] or "<" in e["path"]:
            continue
        key = (e["path"], e["class"])
        if key in seen_ep:
            continue
        seen_ep.add(key)
        md.append(f"| `{e['path']}` | `{e['class']}` | `{e['method']}` |")
    md.append("")

    # §2
    md.append("## §2 Licence record schema (deliverable B)\n")
    md.append(f"`LicenceViewModel` resolved at: `Lau/gov/vic/vicroads/licence/licenceTab/LicenceViewModel;`\n")
    for cls in licence_dump:
        n = cls["info"]["name"]
        md.append(f"### `{n}`")
        md.append(f"super: `{cls['info']['super']}`  \n")
        md.append("Fields:\n")
        md.append("| access | type | name |")
        md.append("|--------|------|------|")
        for f in cls["info"]["fields"]:
            md.append(f"| `{f['access']}` | `{java_type(f['type'])}` | `{f['name']}` |")
        md.append("")
        # show method signatures (no bodies)
        md.append("<details><summary>Methods</summary>\n")
        md.append("```")
        for m in cls["info"]["methods"]:
            md.append(f"{m['access']:24} {m['name']}{m['proto']}")
        md.append("```")
        md.append("</details>\n")
        # show string literals (interesting ones)
        if cls["strings"]:
            md.append("<details><summary>String literals in methods</summary>\n")
            md.append("```")
            for sig, strs in cls["strings"]:
                for s in strs:
                    if len(s) < 200:
                        md.append(f"{sig}: {s!r}")
            md.append("```")
            md.append("</details>\n")

    # §3
    md.append("## §3 QR payload format (deliverable C)\n")
    md.append("`EnlargedQrCodeViewModel` resolved at: `Lau/gov/vic/vicroads/dashboard/enlargedQrCode/EnlargedQrCodeViewModel;`\n")
    for cls in qr_dump:
        n = cls["info"]["name"]
        md.append(f"### `{n}`")
        md.append(f"super: `{cls['info']['super']}`  \n")
        md.append("Fields:\n")
        md.append("| access | type | name |")
        md.append("|--------|------|------|")
        for f in cls["info"]["fields"]:
            md.append(f"| `{f['access']}` | `{java_type(f['type'])}` | `{f['name']}` |")
        md.append("")
        if cls["consts"]:
            md.append("<details><summary>Numeric consts in methods (potentially refresh intervals, timeouts)</summary>\n")
            md.append("```")
            for sig, consts in cls["consts"]:
                for op, v in consts:
                    if v > 100 and v < 1_000_000_000:  # sensible time range ms..ns
                        md.append(f"{sig}: {op} = {v} (0x{v:x})")
            md.append("```")
            md.append("</details>\n")
        if cls["strings"]:
            md.append("<details><summary>String literals</summary>\n")
            md.append("```")
            for sig, strs in cls["strings"]:
                for s in strs:
                    if len(s) < 220:
                        md.append(f"{sig}: {s!r}")
            md.append("```")
            md.append("</details>\n")

    # §4
    md.append("## §4 Compose Color literals (deliverable D)\n")
    md.append(f"Found **{len(colors)}** distinct `0xFFxxxxxx` ARGB constants across VicRoads + Compose classes. Sorted by hex value:\n")
    md.append("| ARGB hex | RGB hex (CSS) | Owning class | Method |")
    md.append("|----------|---------------|--------------|--------|")
    by_val = defaultdict(list)
    for c in colors:
        by_val[c["value"]].append(c)
    for v in sorted(by_val.keys()):
        for c in by_val[v]:
            rgb = f"#{(v & 0xFFFFFF):06X}"
            md.append(f"| `0x{v:08X}` | `{rgb}` | `{c['class']}` | `{c['method']}` |")
    md.append("")

    # §5
    md.append("## §5 Hologram shader feeders (deliverable E)\n")
    md.append("Shader sources live in `apk_loot/shaders/hologram_vertex.glsl` and `apk_loot/shaders/hologram_fragment.glsl`. Inline comments in the GLSL state plainly:\n")
    md.append("> // The roll of the device goes from -60 to 60.  \n> // The range at which a user will tilt their phone to show the hologram is -10 to 10  \n> // Transform the roll to be in a range of 0.0-1.0 based on a user's tilt range of -10 and 10, with the minimum alpha at 0.2\n")
    md.append("So `u_roll` is **device roll in degrees** (sourced from a sensor / orientation listener) and the fragment shader clamps `(abs(u_roll)/10.0) + 0.2`.\n")
    md.append("Classes located that reference shader uniforms / sensor APIs:\n")
    if shader_dump:
        for cls in shader_dump:
            md.append(f"### `{cls['info']['name']}`")
            md.append(f"super: `{cls['info']['super']}`  \n")
            if cls["strings"]:
                md.append("```")
                for sig, strs in cls["strings"]:
                    for s in strs:
                        if len(s) < 220:
                            md.append(f"{sig}: {s!r}")
                md.append("```")
            md.append("")
    else:
        md.append("_No class with explicit string literal `u_time`/`u_roll`/`uniform` was found in the DEX. The GLSL files are bundled as raw assets and read by name. See §6 for the bonus discussion of the loader._\n")

    # §6
    md.append("## §6 Bonus findings\n")
    md.append("Populated below by `enrich_bonus()`. Includes any non-target observations (auth flow, biometric handling, networking client choice, etc).\n")

    # §7
    md.append("## §7 Drop-in updates for index.html\n")
    md.append("Specific recommendations are written after analysis completes.\n")

    Path(ROOT / "DEX_DECOMPILE.md").write_text("\n".join(md), encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("[1/6] loading DEX files", file=sys.stderr)
    dexes = [load_dex(p) for p in DEX_FILES]

    print("[2/6] dumping all au.gov.vic.vicroads.* classes", file=sys.stderr)
    all_vr = dump_all_vicroads_classes(dexes)

    # split out the target subsets
    licence_dump = [c for c in all_vr if "/licence/" in c["info"]["name"]]
    qr_dump = [c for c in all_vr if "QrCode" in c["info"]["name"] or "qrcode" in c["info"]["name"].lower()]

    print("[3/6] collecting URL/endpoint refs", file=sys.stderr)
    urls, endpoints = gather_urls_and_endpoints(all_vr)

    print("[4/6] scanning 0xFFxxxxxx color literals", file=sys.stderr)
    colors = gather_colors(dexes)
    colors = dedupe_colors(colors)
    print(f"  -> {len(colors)} unique (class, value) color tuples", file=sys.stderr)

    print("[5/6] hunting shader / uniform references", file=sys.stderr)
    shader_dump = []
    keywords = {"u_roll", "u_time", "u_pitch", "u_globalTime", "u_resolution",
                "hologram_fragment", "hologram_vertex", "glUniform"}
    for dex in dexes:
        for c in dex.get_classes():
            n = c.get_name()
            hit = False
            collected_strings = []
            collected_consts = []
            for m in c.get_methods():
                ms = method_strings(m)
                if any(k in s for s in ms for k in keywords):
                    hit = True
                    collected_strings.append((f"{m.get_name()}{m.get_descriptor()}", ms))
            if hit:
                info = extract_class(c, dex)
                shader_dump.append({"info": info, "strings": collected_strings, "consts": collected_consts})

    # also re-extract licence + qr with extras
    target_classes = {"licence": [], "qr": [], "shader": []}

    print("[6/6] emitting markdown", file=sys.stderr)
    emit_markdown(dexes, target_classes, licence_dump, qr_dump, urls, endpoints, colors, shader_dump)

    findings = {
        "vr_class_count": len(all_vr),
        "urls": urls[:200],
        "endpoints": endpoints[:500],
        "colors": [{"hex": f"0x{c['value']:08X}", "rgb": f"#{c['value']&0xFFFFFF:06X}",
                    "class": c["class"], "method": c["method"]} for c in colors],
        "shader_classes": [d["info"]["name"] for d in shader_dump],
    }
    (OUT_DIR / "_findings.json").write_text(json.dumps(findings, indent=2), encoding="utf-8")
    print("[done]", file=sys.stderr)


if __name__ == "__main__":
    main()
