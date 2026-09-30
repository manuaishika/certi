"""Font discovery with real Devanagari shaping (needs libraqm; the Dockerfile installs it)."""
import glob
import os
from functools import lru_cache

from PIL import ImageFont, features

from ..config import BASE_DIR

_DIRS = [os.getenv("FONT_DIR", ""), str(BASE_DIR / "assets" / "fonts"), "/usr/share/fonts",
         "/usr/local/share/fonts", os.path.expanduser("~/.fonts"), "/Library/Fonts", "C:/Windows/Fonts"]

LATIN = {False: ["NotoSerif-Regular", "DejaVuSerif.", "LiberationSerif-Regular", "Georgia", "times"],
         True: ["NotoSerif-Bold", "DejaVuSerif-Bold", "LiberationSerif-Bold", "georgiab", "timesbd"]}
DEVA = {False: ["NotoSerifDevanagari-Regular", "NotoSansDevanagari-Regular", "Mukta-Regular", "Lohit-Devanagari",
                "Sanskrit2003", "Nirmala", "mangal", "Kalimati", "Samanata", "FreeSerif.", "FreeSans."],
        True: ["NotoSerifDevanagari-Bold", "NotoSansDevanagari-Bold", "Mukta-Bold", "Lohit-Devanagari",
               "NirmalaB", "mangalb", "Kalimati", "Samanata", "FreeSerifBold", "FreeSansBold"]}


def is_devanagari(text: str) -> bool:
    return any("\u0900" <= ch <= "\u097f" for ch in text)


@lru_cache(maxsize=None)
def _index() -> list[str]:
    found: list[str] = []
    for d in _DIRS:
        if d and os.path.isdir(d):
            for ext in ("ttf", "otf", "ttc"):
                found += glob.glob(os.path.join(d, "**", f"*.{ext}"), recursive=True)
    return found


@lru_cache(maxsize=None)
def find_font(devanagari: bool, bold: bool) -> str | None:
    table = DEVA if devanagari else LATIN
    files = [f for f in _index() if not any(x in os.path.basename(f).lower() for x in ("italic", "oblique", "mono"))]
    stem = lambda f: os.path.splitext(os.path.basename(f))[0].lower()  # noqa: E731
    for wanted in table[bold]:  # exact file-name match first, so "FreeSerifBold" never picks a variant
        for f in files:
            if stem(f) == wanted.lower().rstrip("."):
                return f
    for wanted in table[bold]:
        for f in files:
            if wanted.lower() in os.path.basename(f).lower():
                return f
    if devanagari:  # last resort: any font whose name hints at Devanagari
        for f in files:
            low = os.path.basename(f).lower()
            if "devanagari" in low and (("bold" in low) == bold or True):
                return f
    return None


def shaping_available() -> bool:
    return features.check("raqm")


@lru_cache(maxsize=256)
def get_font(size: int, devanagari: bool = False, bold: bool = False):
    size = max(8, int(size))
    path = find_font(devanagari, bold)
    if path:
        engine = ImageFont.Layout.RAQM if shaping_available() else ImageFont.Layout.BASIC
        try:
            return ImageFont.truetype(path, size, layout_engine=engine, index=0)
        except Exception:
            pass
    return ImageFont.load_default(size)


def font_for(text: str, size: int, bold: bool = False):
    return get_font(size, is_devanagari(text), bold)
