"""Certificate backgrounds: built-in templates and the prompt-driven AI border generator.

The AI engine tries Google Imagen (Gemini API) when GEMINI_API_KEY is set and otherwise uses a
deterministic procedural generator seeded by the prompt, so the feature always works offline.
"""
import base64
import hashlib
import io
import math
import random

import httpx
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..config import GEMINI_API_KEY

PALETTES = {
    "green": ["#0f5132", "#2e8b57", "#d4af37"], "eco": ["#0f5132", "#2e8b57", "#d4af37"],
    "saffron": ["#ff9933", "#138808", "#1e3a8a"], "mangal": ["#ff9933", "#138808", "#1e3a8a"],
    "blue": ["#0b2a5b", "#2563eb", "#d4af37"], "royal": ["#2b1055", "#7c3aed", "#d4af37"],
    "red": ["#7f1d1d", "#dc2626", "#d4af37"], "gold": ["#8a6d1d", "#d4af37", "#f3e3a1"],
    "ocean": ["#0c4a6e", "#0ea5e9", "#e0f2fe"], "sunset": ["#9a3412", "#f97316", "#fde68a"],
    "purple": ["#3b0764", "#9333ea", "#f0abfc"],
}


def size_for(orientation: str, dpi: int = 300) -> tuple[int, int]:
    w, h = round(297 / 25.4 * dpi), round(210 / 25.4 * dpi)
    return (w, h) if orientation == "landscape" else (h, w)


def _rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _frame(d: ImageDraw.ImageDraw, w: int, h: int, inset: int, width: int, color):
    d.rectangle([inset, inset, w - inset, h - inset], outline=color, width=width)


def classic(size, accent="#1e3a8a"):
    w, h = size
    img = Image.new("RGB", size, "#fffdf6")
    d = ImageDraw.Draw(img)
    u = min(w, h) / 100
    gold, acc = _rgb("#b8902f"), _rgb(accent)
    _frame(d, w, h, int(3 * u), int(0.9 * u), acc)
    _frame(d, w, h, int(5 * u), int(0.3 * u), gold)
    for cx, cy in [(5, 5), (w / u - 5, 5), (5, h / u - 5), (w / u - 5, h / u - 5)]:
        d.ellipse([(cx - 2.2) * u, (cy - 2.2) * u, (cx + 2.2) * u, (cy + 2.2) * u], outline=gold, width=int(0.4 * u))
    return img


def modern(size, accent="#1e3a8a"):
    w, h = size
    img = Image.new("RGB", size, "#ffffff")
    d = ImageDraw.Draw(img)
    acc = _rgb(accent)
    u = min(w, h) / 100
    d.rectangle([0, 0, int(6 * u), h], fill=acc)
    d.polygon([(int(6 * u), 0), (int(18 * u), 0), (int(6 * u), int(12 * u))], fill=_rgb("#d4af37"))
    d.rectangle([w - int(2 * u), 0, w, h], fill=acc)
    return img


def mangal(size, accent="#1e3a8a"):
    w, h = size
    img = Image.new("RGB", size, "#fffaf0")
    d = ImageDraw.Draw(img)
    u = min(w, h) / 100
    for i, col in enumerate(["#ff9933", "#ffffff", "#138808"]):
        inset = int((2.2 + i * 1.3) * u)
        d.rectangle([inset, inset, w - inset, h - inset], outline=_rgb(col) if col != "#ffffff" else _rgb("#cfcfcf"),
                    width=int(1.2 * u))
    _frame(d, w, h, int(7 * u), int(0.3 * u), _rgb(accent))
    return img


TEMPLATES = {"classic": classic, "modern": modern, "mangal": mangal}
TEMPLATE_LABELS = {"classic": "Classic Gold", "modern": "Modern Band", "mangal": "Mangal Tricolour"}


def template_background(name: str, orientation: str, accent: str, dpi: int = 300) -> Image.Image:
    fn = TEMPLATES.get(name, classic)
    return fn(size_for(orientation, dpi), accent)


# ----------------------------------------------------------------------------- AI engine
def _palette_for(prompt: str, rng: random.Random) -> list[str]:
    low = prompt.lower()
    for key, pal in PALETTES.items():
        if key in low:
            return pal
    return rng.choice(list(PALETTES.values()))


def procedural_background(prompt: str, orientation: str, dpi: int = 150) -> Image.Image:
    """Deterministic generative border: soft gradient wash + layered rosette/wave ornament."""
    rng = random.Random(int(hashlib.sha256(prompt.encode()).hexdigest(), 16) % (2 ** 32))
    w, h = size_for(orientation, dpi)
    c1, c2, c3 = (_rgb(c) for c in _palette_for(prompt, rng))
    img = Image.new("RGB", (w, h), (255, 253, 247))
    wash = Image.new("RGB", (w, h), c2)
    mask = Image.linear_gradient("L").resize((w, h))
    mask = mask.point(lambda v: int(v * 0.10))
    img = Image.composite(wash, img, mask)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    u = min(w, h) / 100
    style = rng.choice(["rosette", "wave", "dots"])
    band = 7 * u
    step = int(4.5 * u)
    # border ornament along four sides
    def ornament(x, y, r, col):
        if style == "rosette":
            for k in range(8):
                a = k * math.pi / 4
                d.ellipse([x + math.cos(a) * r * .6 - r * .45, y + math.sin(a) * r * .6 - r * .45,
                           x + math.cos(a) * r * .6 + r * .45, y + math.sin(a) * r * .6 + r * .45], outline=col, width=max(1, int(u * .25)))
        elif style == "wave":
            d.arc([x - r, y - r, x + r, y + r], 0, 180, fill=col, width=max(1, int(u * .35)))
        else:
            d.ellipse([x - r * .4, y - r * .4, x + r * .4, y + r * .4], fill=col)
    for i in range(int(band // 2), w - int(band // 2), step):
        for y in (band / 2, h - band / 2):
            ornament(i, y, step * .55, c1 + (200,))
    for j in range(int(band // 2), h - int(band // 2), step):
        for x in (band / 2, w - band / 2):
            ornament(x, j, step * .55, c1 + (200,))
    for inset, col, wd in [(band + 1.2 * u, c3 + (255,), u * .5), (band + 2.6 * u, c1 + (255,), u * .2)]:
        d.rectangle([inset, inset, w - inset, h - inset], outline=col, width=max(1, int(wd)))
    for _ in range(14):  # soft corner flourishes
        cx, cy = rng.choice([(0, 0), (w, 0), (0, h), (w, h)])
        r = rng.randint(int(4 * u), int(16 * u))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=c2 + (90,), width=max(1, int(u * .3)))
    overlay = overlay.filter(ImageFilter.GaussianBlur(0.4))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    target = size_for(orientation, 300)
    return img.resize(target, Image.LANCZOS)


def imagen_background(prompt: str, orientation: str) -> Image.Image | None:
    if not GEMINI_API_KEY:
        return None
    ratio = "4:3" if orientation == "landscape" else "3:4"
    full = (f"Ornamental certificate border and background, decorative frame only, empty white centre, "
            f"no text, no letters, print ready. {prompt}")
    try:
        r = httpx.post(
            "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict",
            params={"key": GEMINI_API_KEY}, timeout=60,
            json={"instances": [{"prompt": full}], "parameters": {"sampleCount": 1, "aspectRatio": ratio}})
        r.raise_for_status()
        b64 = r.json()["predictions"][0]["bytesBase64Encoded"]
        img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
        return img.resize(size_for(orientation, 300), Image.LANCZOS)
    except Exception:
        return None


def generate_ai_background(prompt: str, orientation: str) -> tuple[Image.Image, str]:
    img = imagen_background(prompt, orientation)
    if img is not None:
        return img, "imagen"
    return procedural_background(prompt, orientation), "procedural"


def fit_cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Scale/crop an uploaded background to fill the page exactly."""
    img = img.convert("RGB")
    sw, sh = img.size
    scale = max(size[0] / sw, size[1] / sh)
    img = img.resize((int(sw * scale) + 1, int(sh * scale) + 1), Image.LANCZOS)
    l, t = (img.width - size[0]) // 2, (img.height - size[1]) // 2
    return img.crop((l, t, l + size[0], t + size[1]))


_ = ImageChops  # keep import for future blend modes
