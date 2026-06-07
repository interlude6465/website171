"""
Animation extraction pass for myVicRoads v1.3.5 APK.

Re-runnable. Produces:
    apk_loot/animations/anim/                  - tween animations
    apk_loot/animations/anim-v21/
    apk_loot/animations/animator/              - property animators
    apk_loot/animations/animator-v21/
    apk_loot/animations/interpolator/
    apk_loot/animations/interpolator-v21/
    apk_loot/animations/avd/                   - copies of animated vector drawables
    apk_loot/dex_fragments/animations.txt      - dex string scan results

The matching ANIMATIONS_INVENTORY.md is written by hand based on these outputs.
"""
import os
import re
import shutil
from pathlib import Path

from pyaxmlparser.axmlprinter import AXMLPrinter

ROOT = Path(__file__).parent
EXTRACTED = ROOT / "apk_extracted"
LOOT = ROOT / "apk_loot"
ANIM_OUT = LOOT / "animations"
DEX_OUT = LOOT / "dex_fragments"

ANIM_DIRS = ["anim", "anim-v21", "animator", "animator-v21",
             "interpolator", "interpolator-v21"]

# Decoded drawable XMLs that the previous pass already wrote — we copy the
# animation-related ones into apk_loot/animations/avd/ for a self-contained
# inventory.
DRAWABLES_XML = LOOT / "decoded" / "drawables_xml"

# Boilerplate prefixes we deliberately skip when picking out AVDs.
# These are AppCompat/MaterialComponents library files, not app-specific art.
BOILERPLATE_PREFIXES = ("abc_", "mtrl_", "design_", "btn_checkbox_",
                        "btn_radio_", "ic_mtrl_")


def decode_axml_dir(subdir: str) -> tuple[int, int]:
    src = EXTRACTED / "res" / subdir
    dst = ANIM_OUT / subdir
    if not src.is_dir():
        return 0, 0
    dst.mkdir(parents=True, exist_ok=True)
    ok = fail = 0
    for path in sorted(src.glob("*.xml")):
        try:
            with open(path, "rb") as f:
                printer = AXMLPrinter(f.read())
            if not printer.is_valid():
                fail += 1
                continue
            text = printer.get_buff()
            # Pretty-print: insert a newline before every '<' (except the first
            # one) and a leading XML declaration if absent. Cheap but readable.
            decoded = text.decode("utf-8")
            if not decoded.startswith("<?xml"):
                decoded = '<?xml version="1.0" encoding="utf-8"?>\n' + decoded
            # Light pretty-pass: break long single-line XML so diffs are sane.
            pretty = re.sub(r"><", ">\n<", decoded)
            (dst / path.name).write_text(pretty, encoding="utf-8")
            ok += 1
        except Exception as e:
            print(f"  [!] {path.name}: {e}")
            fail += 1
    print(f"  [+] {subdir}: {ok} ok, {fail} failed")
    return ok, fail


def collect_avds():
    """Copy animation-related drawables (vectors + objectAnimator children)
    out of the existing decoded drawables_xml dump into animations/avd/."""
    out = ANIM_OUT / "avd"
    out.mkdir(parents=True, exist_ok=True)
    if not DRAWABLES_XML.is_dir():
        print(f"  [!] no decoded drawables at {DRAWABLES_XML}")
        return 0, 0
    copied = skipped = 0
    for path in sorted(DRAWABLES_XML.iterdir()):
        name = path.name
        # Strip the "drawable__" prefix the previous decoder added so the
        # filter reads the resource name.
        m = re.match(r"^(?:drawable[^_]*__)\$?(.+?)\.xml$", name)
        if not m:
            continue
        resname = m.group(1)
        # Keywords that mean "this is or relates to an animated vector".
        matches = (
            "avd_" in resname
            or "_anim" in resname
            or "_animation" in resname
        )
        if not matches:
            continue
        is_boilerplate = resname.startswith(BOILERPLATE_PREFIXES)
        if is_boilerplate:
            skipped += 1
            continue
        shutil.copy2(path, out / name)
        copied += 1
    print(f"  [+] avd/: copied {copied}, skipped {skipped} boilerplate")
    return copied, skipped


# -----------------------------------------------------------------------------
# DEX scan — pull printable strings from classes*.dex and grep for animation
# API references. We don't disassemble; we just look at the embedded string
# pool, which is what dexlib stores most class/method names in.
# -----------------------------------------------------------------------------

DEX_PATTERNS = [
    # Compose animation
    r"androidx/compose/animation",
    r"animateAsState", r"animateFloatAsState", r"animateDpAsState",
    r"animateColorAsState", r"animateIntAsState", r"animateValueAsState",
    r"animateContentSize", r"animateItemPlacement",
    r"AnimatedVisibility", r"AnimatedContent", r"AnimatedNavHost",
    r"Crossfade", r"updateTransition",
    r"rememberInfiniteTransition", r"InfiniteTransition",
    r"Transition\$",
    # Spec types
    r"TweenSpec", r"SpringSpec", r"KeyframesSpec",
    r"RepeatableSpec", r"InfiniteRepeatableSpec", r"SnapSpec",
    r"FiniteAnimationSpec", r"AnimationSpec",
    r"VectorizedAnimationSpec", r"DurationBasedAnimationSpec",
    # Builders
    r"AnimationSpecKt", r"\btween\b", r"\bspring\b",
    r"\bkeyframes\b", r"\brepeatable\b", r"\binfiniteRepeatable\b",
    r"\bsnap\b", r"\bfadeIn\b", r"\bfadeOut\b",
    r"slideIn", r"slideOut", r"expandIn", r"shrinkOut",
    r"slideInHorizontally", r"slideOutHorizontally",
    r"slideInVertically", r"slideOutVertically",
    r"expandHorizontally", r"shrinkHorizontally",
    r"expandVertically", r"shrinkVertically",
    r"scaleIn", r"scaleOut",
    r"EnterTransition", r"ExitTransition",
    # Easing
    r"FastOutSlowInEasing", r"LinearOutSlowInEasing",
    r"FastOutLinearInEasing", r"LinearEasing", r"CubicBezierEasing",
    r"EaseIn", r"EaseOut", r"EaseInOut",
    # Platform animation
    r"ObjectAnimator", r"ValueAnimator", r"AnimatorSet",
    r"PropertyValuesHolder", r"TimeInterpolator",
    r"AccelerateInterpolator", r"DecelerateInterpolator",
    r"AccelerateDecelerateInterpolator",
    r"AnticipateInterpolator", r"OvershootInterpolator",
    r"PathInterpolator", r"BounceInterpolator",
    r"FastOutSlowIn", r"LinearInterpolator",
    # Stateful animation
    r"setDuration", r"setStartDelay", r"setInterpolator",
    r"setRepeatCount", r"setRepeatMode",
    # Vector animation
    r"AnimatedVectorDrawable", r"AnimatedStateListDrawable",
    # Transition framework
    r"TransitionManager", r"ChangeBounds", r"\bFade\b",
    r"\bSlide\b", r"\bExplode\b",
    # Lottie / Compose UI specific
    r"LottieAnimation", r"LottieComposition",
    # myVicRoads-specific guesses
    r"Hologram", r"hologram", r"Shimmer", r"shimmer",
    r"Pulse", r"pulse", r"PullToRefresh", r"SwipeRefresh",
    # Confetti / haptic / motion
    r"Confetti", r"confetti", r"animateOffset", r"animateRect",
    # Material motion
    r"MaterialMotion", r"FadeThrough", r"SharedAxis",
    r"ContainerTransform",
]


def extract_dex_strings(dex_path: Path) -> list[str]:
    """Pull all printable strings >= 4 chars from a DEX file. DEX has a
    proper string section but a literal byte scan is simpler and good enough
    for grepping symbol names."""
    data = dex_path.read_bytes()
    # Match ASCII runs >= 4 chars. Real symbols are well within this.
    return [m.group(0).decode("ascii", errors="replace")
            for m in re.finditer(rb"[\x20-\x7e]{4,}", data)]


def scan_dex_for_animations() -> list[str]:
    DEX_OUT.mkdir(parents=True, exist_ok=True)
    hits: set[str] = set()
    compiled = [(p, re.compile(p)) for p in DEX_PATTERNS]
    for dex in ["classes.dex", "classes2.dex"]:
        path = EXTRACTED / dex
        if not path.exists():
            continue
        print(f"  [*] scanning {dex} ({path.stat().st_size:,} bytes)")
        n = 0
        for s in extract_dex_strings(path):
            for _pat, rx in compiled:
                if rx.search(s):
                    hits.add(s)
                    n += 1
                    break
        print(f"      {n} raw hits, {len(hits)} unique so far")
    # Filter: drop strings that are mostly junk (very long, low-signal).
    cleaned = []
    for s in sorted(hits):
        if len(s) > 250:
            continue
        cleaned.append(s)
    return cleaned


def main():
    print("[*] Decoding binary animation XMLs ...")
    ANIM_OUT.mkdir(parents=True, exist_ok=True)
    total_ok = total_fail = 0
    for sub in ANIM_DIRS:
        ok, fail = decode_axml_dir(sub)
        total_ok += ok
        total_fail += fail

    print("[*] Collecting AVDs from existing decoded drawables ...")
    collect_avds()

    print("[*] Scanning DEX for animation APIs ...")
    hits = scan_dex_for_animations()
    out_txt = DEX_OUT / "animations.txt"
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write("# DEX symbol scan for animation APIs\n")
        f.write(f"# {len(hits)} unique matches (deduped, sorted)\n")
        f.write(f"# patterns: {len(DEX_PATTERNS)}\n\n")
        for s in hits:
            f.write(s + "\n")
    print(f"[+] wrote {len(hits)} animation symbols to {out_txt}")

    print("\n[*] DONE")
    print(f"    animations XML decoded: {total_ok} ok, {total_fail} failed")
    print(f"    output root: {ANIM_OUT}")


if __name__ == "__main__":
    main()
