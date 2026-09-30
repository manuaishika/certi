"""Shared web helpers: template rendering, rate limiting, PWA icon generation."""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request
from fastapi.templating import Jinja2Templates
from PIL import Image, ImageDraw

from . import config
from .i18n import translate
from .services import plans
from .services.fonts import shaping_available

templates = Jinja2Templates(directory=str(config.BASE_DIR / "templates"))
templates.env.globals.update(cfg=config, plans=plans, PLANS=plans.PLANS, MODULE_LABELS=plans.MODULE_LABELS)
templates.env.filters["inr"] = lambda v: f"₹{v:,.0f}" if float(v).is_integer() else f"₹{v:,.2f}"


def render(request: Request, name: str, status_code: int = 200, **ctx):
    lang = request.query_params.get("lang") or request.cookies.get("lang") or "en"
    lang = lang if lang in ("en", "hi") else "en"
    flash = request.session.pop("flash", None) if "session" in request.scope else None
    ctx.update(lang=lang, t=lambda k: translate(k, lang), request=request, shaping=shaping_available(), flash=flash)
    resp = templates.TemplateResponse(request, name, ctx, status_code=status_code)
    if request.query_params.get("lang"):
        resp.set_cookie("lang", lang, max_age=31536000, samesite="lax")
    return resp


_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request, bucket: str, limit: int = 20, window: int = 60) -> None:
    ip = request.client.host if request.client else "?"
    q = _hits[f"{bucket}:{ip}"]
    now = time.time()
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Too many requests, please wait a minute.")
    q.append(now)


def ensure_icons() -> None:
    out = config.BASE_DIR / "static" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        p = out / f"icon-{size}.png"
        if p.exists():
            continue
        img = Image.new("RGB", (size, size), "#0b2a5b")
        d = ImageDraw.Draw(img)
        m = size // 8
        d.rounded_rectangle([m, m, size - m, size - m], radius=size // 10, outline=(212, 175, 55), width=size // 32)
        d.ellipse([size * .32, size * .3, size * .68, size * .66], outline=(255, 255, 255), width=size // 28)
        d.polygon([(size * .42, size * .62), (size * .36, size * .82), (size * .5, size * .74), (size * .64, size * .82),
                   (size * .58, size * .62)], fill=(212, 175, 55))
        img.save(p)
