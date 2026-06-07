#!/usr/bin/env python3
"""apk_vd_to_svg.py — Convert Android VectorDrawable XML to SVG.

Reads every `drawable__<name>.xml` in `apk_loot/decoded/drawables_xml/`
(skipping the `drawable__$<name>__N.xml` sub-files which hold embedded
gradient definitions — those get inlined into their parent).

Outputs `apk_loot/icons/<category>/<name>.svg` and prints a summary.

Categorisation heuristics:
  ic_home/ic_vehicle/ic_licence/ic_payments/ic_profile   -> nav/
  demerit_point_icon / registered_vehicles_icon          -> home/
  *_logo*                                                -> logos/
  *_qr* / placeholder_qr_code                            -> qr/
  *learner* / *p_plate* / *p1* / *p2* / *probationary*   -> badges/
  ic_external_link / *chevron* / *_drop_*arrow*          -> ui/
  everything else                                        -> misc/

Conversion rules follow the spec:
  vector width/height/viewport -> svg viewBox/width/height
  path pathData/fillColor/strokeColor/strokeWidth/fillType -> SVG attrs
  group translateX/Y, scaleX/Y, rotation -> g transform
  clip-path pathData -> <clipPath><path/></clipPath>
  external @resourceId fill refs -> inlined <linearGradient>/<radialGradient>
  ARGB #FFXXXXXX -> #XXXXXX, other alpha -> rgba()
"""
from __future__ import annotations
import os, re, sys, xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "apk_loot" / "decoded" / "drawables_xml"
DST = ROOT / "apk_loot" / "icons"

ANDROID = "{http://schemas.android.com/apk/res/android}"
AAPT = "{http://schemas.android.com/aapt}"

ISSUES: list[str] = []
SKIPPED_NON_VECTOR: list[str] = []
CONVERTED: list[str] = []


# ---------- helpers ----------

def aval(elem, key: str) -> str | None:
    """Read android: namespaced attribute."""
    return elem.get(f"{ANDROID}{key}")


def argb_to_css(c: str | None) -> str | None:
    """Convert Android #AARRGGBB color literal to CSS hex or rgba()."""
    if not c:
        return None
    c = c.strip()
    if not c.startswith("#"):
        return c
    hexpart = c[1:]
    if len(hexpart) == 8:
        a = int(hexpart[0:2], 16)
        rgb = hexpart[2:]
        if a == 255:
            return f"#{rgb}"
        if a == 0:
            return "none"  # fully transparent — emit `fill="none"`
        alpha = a / 255.0
        r = int(rgb[0:2], 16); g = int(rgb[2:4], 16); b = int(rgb[4:6], 16)
        return f"rgba({r},{g},{b},{alpha:.3f})"
    if len(hexpart) == 6:
        return f"#{hexpart}"
    if len(hexpart) == 4:
        # #ARGB shorthand
        a = int(hexpart[0]*2, 16) / 255.0
        rgb = "".join(ch*2 for ch in hexpart[1:])
        if a == 1:
            return f"#{rgb}"
        r = int(rgb[0:2], 16); g = int(rgb[2:4], 16); b = int(rgb[4:6], 16)
        return f"rgba({r},{g},{b},{a:.3f})"
    if len(hexpart) == 3:
        return f"#{hexpart}"
    return c


def parse_dim(s: str | None) -> str:
    """Parse '32.000000dip' -> '32'."""
    if s is None:
        return "24"
    m = re.match(r"([-+]?[\d.]+)", s)
    if not m:
        return s
    val = float(m.group(1))
    if val == int(val):
        return str(int(val))
    return f"{val:g}"


def fill_type_to_rule(v: str | None) -> str | None:
    if v is None:
        return None
    if v in ("1", "evenOdd", "evenodd"):
        return "evenodd"
    if v in ("0", "nonZero", "nonzero"):
        return "nonzero"
    return None


def stroke_cap(v: str | None) -> str | None:
    if v is None: return None
    m = {"0": "butt", "1": "round", "2": "square",
         "butt": "butt", "round": "round", "square": "square"}
    return m.get(v)


def stroke_join(v: str | None) -> str | None:
    if v is None: return None
    m = {"0": "miter", "1": "round", "2": "bevel",
         "miter": "miter", "round": "round", "bevel": "bevel"}
    return m.get(v)


def group_transform(elem) -> str | None:
    """Build SVG transform string from VectorDrawable group attributes."""
    parts = []
    tx = aval(elem, "translateX"); ty = aval(elem, "translateY")
    if tx or ty:
        parts.append(f"translate({tx or 0} {ty or 0})")
    rot = aval(elem, "rotation")
    px = aval(elem, "pivotX") or "0"
    py = aval(elem, "pivotY") or "0"
    if rot:
        if px != "0" or py != "0":
            parts.append(f"rotate({rot} {px} {py})")
        else:
            parts.append(f"rotate({rot})")
    sx = aval(elem, "scaleX"); sy = aval(elem, "scaleY")
    if sx or sy:
        parts.append(f"scale({sx or 1} {sy or 1})")
    return " ".join(parts) if parts else None


# ---------- gradient sub-file resolver ----------

def find_gradient_subfiles(stem: str) -> list[Path]:
    """Return the parent vector's external gradient files, sorted by index N."""
    pat = re.compile(rf"^drawable__\${re.escape(stem)}__(\d+)\.xml$")
    found = []
    for p in SRC.iterdir():
        m = pat.match(p.name)
        if m:
            found.append((int(m.group(1)), p))
    found.sort()
    return [p for _, p in found]


def parse_gradient(path: Path, gid: str) -> str | None:
    """Read a sub-file <gradient> and emit SVG <linearGradient>/<radialGradient> def XML."""
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as e:
        ISSUES.append(f"{path.name}: gradient parse error ({e})")
        return None
    tag = root.tag.split("}")[-1]
    if tag != "gradient":
        ISSUES.append(f"{path.name}: expected <gradient>, got <{tag}>")
        return None
    gtype = aval(root, "type") or "0"
    stops_xml = []
    for it in root.findall(f"{ANDROID}item") + root.findall("item"):
        off = aval(it, "offset") or "0"
        raw = aval(it, "color")
        # For gradient stops we need access to the raw alpha — re-parse
        if raw and raw.startswith("#") and len(raw) == 9:
            a = int(raw[1:3], 16)
            rgb = raw[3:]
            hexc = f"#{rgb}"
            if a == 255:
                stops_xml.append(f'<stop offset="{off}" stop-color="{hexc}"/>')
            else:
                stops_xml.append(
                    f'<stop offset="{off}" stop-color="{hexc}" '
                    f'stop-opacity="{a/255.0:.3f}"/>'
                )
            continue
        color = argb_to_css(raw) or "#000"
        if color == "none":
            color = "#000"  # transparent stop — colour irrelevant
            stops_xml.append(
                f'<stop offset="{off}" stop-color="{color}" stop-opacity="0"/>'
            )
            continue
        stops_xml.append(f'<stop offset="{off}" stop-color="{color}"/>')

    stops = "".join(stops_xml)
    if gtype == "0":  # linear
        x1 = aval(root, "startX") or "0"
        y1 = aval(root, "startY") or "0"
        x2 = aval(root, "endX") or "1"
        y2 = aval(root, "endY") or "0"
        return (
            f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" '
            f'x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{stops}</linearGradient>'
        )
    if gtype == "1":  # radial
        cx = aval(root, "centerX") or "0"
        cy = aval(root, "centerY") or "0"
        r = aval(root, "gradientRadius") or "1"
        return (
            f'<radialGradient id="{gid}" gradientUnits="userSpaceOnUse" '
            f'cx="{cx}" cy="{cy}" r="{r}">{stops}</radialGradient>'
        )
    if gtype == "2":  # sweep — SVG has no native sweep; emulate w/ linear + note
        cx = aval(root, "centerX") or "0"
        cy = aval(root, "centerY") or "0"
        ISSUES.append(f"{path.name}: sweep gradient approximated as linear (SVG has no sweep)")
        return (
            f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" '
            f'x1="{cx}" y1="{cy}" x2="{float(cx)+1}" y2="{cy}">{stops}</linearGradient>'
        )
    ISSUES.append(f"{path.name}: unknown gradient type {gtype}")
    return None


# ---------- vector walker ----------

class GradPool:
    """Allocate sequential gradient IDs for one drawable and return defs XML."""
    def __init__(self, parent_stem: str):
        self.parent_stem = parent_stem
        self.subs = find_gradient_subfiles(parent_stem)
        self.idx = 0
        self.defs: list[str] = []

    def next_url(self) -> str | None:
        if self.idx >= len(self.subs):
            # Not a gradient ref -> a plain color resource reference
            # (e.g. @android:00000000 or ?attr/colorControlNormal).
            # We can't resolve the runtime value, so we emit currentColor so
            # the icon picks up CSS `color`. Note silently; not an error.
            return "currentColor"
        sub = self.subs[self.idx]
        gid = f"g_{self.parent_stem}_{self.idx}"
        defxml = parse_gradient(sub, gid)
        self.idx += 1
        if defxml is None:
            return None
        self.defs.append(defxml)
        return f"url(#{gid})"


def resolve_fill_or_stroke(value: str | None, pool: GradPool) -> str | None:
    """Convert one fill/stroke attr value to its SVG equivalent."""
    if value is None:
        return None
    v = value.strip()
    # @RESOURCE_ID reference -> next gradient sub-file, or currentColor
    if v.startswith("@"):
        return pool.next_url()
    # ?attr reference -> use currentColor (runtime theme color)
    if v.startswith("?"):
        return "currentColor"
    return argb_to_css(v)


def walk_path(p, pool: GradPool, out: list[str]) -> None:
    d = aval(p, "pathData")
    if not d:
        return
    fill_raw = aval(p, "fillColor")
    stroke_raw = aval(p, "strokeColor")
    fill = resolve_fill_or_stroke(fill_raw, pool)
    stroke = resolve_fill_or_stroke(stroke_raw, pool)
    sw = aval(p, "strokeWidth")
    cap = stroke_cap(aval(p, "strokeLineCap"))
    join = stroke_join(aval(p, "strokeLineJoin"))
    miter = aval(p, "strokeMiterLimit")
    fill_rule = fill_type_to_rule(aval(p, "fillType"))
    fa = aval(p, "fillAlpha")
    sa = aval(p, "strokeAlpha")

    attrs = [f'd="{d}"']
    attrs.append(f'fill="{fill if fill else "none"}"')
    if fa: attrs.append(f'fill-opacity="{fa}"')
    if fill_rule: attrs.append(f'fill-rule="{fill_rule}"')
    if stroke:
        attrs.append(f'stroke="{stroke}"')
        if sw and float(sw) > 0:
            sw_n = float(sw)
            attrs.append(f'stroke-width="{sw_n:g}"')
    if sa: attrs.append(f'stroke-opacity="{sa}"')
    if cap: attrs.append(f'stroke-linecap="{cap}"')
    if join: attrs.append(f'stroke-linejoin="{join}"')
    if miter: attrs.append(f'stroke-miterlimit="{miter}"')
    out.append(f"<path {' '.join(attrs)}/>")


CLIP_COUNTER = [0]

def walk_group(g, pool: GradPool, out: list[str]) -> None:
    tx = group_transform(g)
    open_tags: list[str] = []
    if tx:
        open_tags.append(f'<g transform="{tx}">')
    else:
        open_tags.append("<g>")
    # collect children: clip-path first (must wrap subsequent siblings),
    # but SVG works fine if we just convert clip-path to a <clipPath> def
    # and apply clip-path="url(#id)" on the group.
    clip_attr = None
    for ch in list(g):
        tag = ch.tag.split("}")[-1]
        if tag == "clip-path":
            d = aval(ch, "pathData")
            if d:
                CLIP_COUNTER[0] += 1
                cid = f"clip_{pool.parent_stem}_{CLIP_COUNTER[0]}"
                pool.defs.append(f'<clipPath id="{cid}"><path d="{d}"/></clipPath>')
                clip_attr = f'url(#{cid})'
    if clip_attr:
        # rewrite opening <g> to include clip-path attribute
        if tx:
            open_tags[0] = f'<g transform="{tx}" clip-path="{clip_attr}">'
        else:
            open_tags[0] = f'<g clip-path="{clip_attr}">'
    out.append(open_tags[0])
    for ch in list(g):
        tag = ch.tag.split("}")[-1]
        if tag == "path":
            walk_path(ch, pool, out)
        elif tag == "group":
            walk_group(ch, pool, out)
        elif tag == "clip-path":
            continue  # already handled
        else:
            ISSUES.append(f"{pool.parent_stem}: unsupported group child <{tag}>")
    out.append("</g>")


def convert_vector(stem: str, root: ET.Element) -> str | None:
    pool = GradPool(stem)
    w = parse_dim(aval(root, "width"))
    h = parse_dim(aval(root, "height"))
    vw = aval(root, "viewportWidth") or w
    vh = aval(root, "viewportHeight") or h
    # Drop trailing zeros from viewport floats
    try:
        vw = f"{float(vw):g}"; vh = f"{float(vh):g}"
    except ValueError:
        pass
    body: list[str] = []
    # Iterate top-level children (may include direct paths or groups).
    for ch in list(root):
        tag = ch.tag.split("}")[-1]
        if tag == "path":
            walk_path(ch, pool, body)
        elif tag == "group":
            walk_group(ch, pool, body)
        elif tag == "clip-path":
            # rare: top-level clip-path with no group wrapper
            d = aval(ch, "pathData")
            if d:
                CLIP_COUNTER[0] += 1
                cid = f"clip_{stem}_{CLIP_COUNTER[0]}"
                pool.defs.append(f'<clipPath id="{cid}"><path d="{d}"/></clipPath>')
        else:
            ISSUES.append(f"{stem}: unsupported top-level <{tag}>")

    defs = "".join(pool.defs)
    defs_block = f"<defs>{defs}</defs>" if defs else ""
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {vw} {vh}" width="{w}" height="{h}">'
        f'{defs_block}{"".join(body)}</svg>\n'
    )
    return svg


# ---------- categorisation ----------

def categorise(stem: str) -> str:
    s = stem.lower()
    nav_keys = ("ic_home_", "ic_vehicle_", "ic_licence_",
                "ic_payments_", "ic_profile_")
    if any(s.startswith(k) for k in nav_keys):
        return "nav"
    if s in ("demerit_point_icon", "registered_vehicles_icon"):
        return "home"
    # logos: explicit allow-list to avoid grabbing 'logout' etc
    if s in ("vicroads_logo", "vicroads_logo_black", "vicroads_logo_white",
             "vicroads_home_logo"):
        return "logos"
    if "qr" in s and ("ic_qr" in s or "qr_code" in s):
        return "qr"
    if ("learner" in s or "p_plate" in s or "probationary" in s
            or re.search(r"\bp[12]\b", s)):
        return "badges"
    if ("chevron" in s or s == "ic_external_link"
            or "drop_down" in s or "drop_up" in s
            or "drop_right" in s or "arrow_drop" in s):
        return "ui"
    return "misc"


# ---------- main loop ----------

def main() -> int:
    DST.mkdir(parents=True, exist_ok=True)
    for sub in ("nav", "home", "logos", "qr", "badges", "ui", "misc"):
        (DST / sub).mkdir(exist_ok=True)

    files = sorted(SRC.glob("drawable*.xml"))
    for f in files:
        name = f.name
        # skip aapt gradient sub-files
        if "__$" in name:
            continue
        # stem after the prefix qualifier
        # name like 'drawable__foo.xml' or 'drawable-v21__bar.xml'
        m = re.match(r"^drawable[^_]*__(.+)\.xml$", name)
        if not m:
            continue
        stem = m.group(1)
        try:
            tree = ET.parse(f)
        except ET.ParseError as e:
            ISSUES.append(f"{name}: XML parse error ({e})")
            continue
        root = tree.getroot()
        root_tag = root.tag.split("}")[-1]
        if root_tag != "vector":
            SKIPPED_NON_VECTOR.append(f"{stem} (<{root_tag}>)")
            continue
        try:
            svg = convert_vector(stem, root)
        except Exception as e:
            ISSUES.append(f"{name}: conversion crashed ({type(e).__name__}: {e})")
            continue
        if svg is None:
            continue
        cat = categorise(stem)
        outpath = DST / cat / f"{stem}.svg"
        outpath.write_text(svg, encoding="utf-8")
        CONVERTED.append(f"{cat}/{stem}.svg")

    print(f"Converted: {len(CONVERTED)}")
    print(f"Skipped non-vector roots: {len(SKIPPED_NON_VECTOR)}")
    print(f"Issues logged: {len(ISSUES)}")
    if SKIPPED_NON_VECTOR[:10]:
        print("\n  Non-vector samples:")
        for s in SKIPPED_NON_VECTOR[:10]:
            print(f"    - {s}")
    if ISSUES[:10]:
        print("\n  Issue samples:")
        for s in ISSUES[:10]:
            print(f"    - {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
