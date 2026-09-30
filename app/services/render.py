"""Server-side certificate renderer (Pillow). 300 DPI A4, landscape or portrait, EN + Devanagari."""
import io
import textwrap
from dataclasses import dataclass
from datetime import datetime

import qrcode
from PIL import Image, ImageDraw

from ..models import Event, Org
from . import backgrounds
from .fonts import font_for
from .images import load_upload

FIELDS = ["org", "branch", "cohosts", "title", "certify", "name", "name_hi", "body", "grade",
          "date", "signature", "qr", "sponsors", "id"]
FIELD_LABELS = {"org": "Organisation", "branch": "Branch / Campus", "cohosts": "Co-host logos",
                "title": "Title", "certify": "'This is to certify'", "name": "Name (English)",
                "name_hi": "Name (Devanagari)", "body": "Body text", "grade": "Grade / Institution",
                "date": "Date", "signature": "Signature", "qr": "Verification QR",
                "sponsors": "Sponsors", "id": "Certificate ID"}


def default_layout(orientation: str, cohosts: bool = False) -> dict:
    """x, y = centre as a fraction of the page; size = font size as a fraction of the short side.

    Everything stays inside the ornament-safe zone (roughly 8-92 % of each axis).
    """
    if orientation == "landscape":
        lay = {
            "org": dict(x=.5, y=.12, size=.05), "branch": dict(x=.5, y=.175, size=.028),
            "cohosts": dict(x=.5, y=.10, size=.07), "title": dict(x=.5, y=.285, size=.08),
            "certify": dict(x=.5, y=.365, size=.03), "name": dict(x=.5, y=.445, size=.09),
            "name_hi": dict(x=.5, y=.53, size=.05), "body": dict(x=.5, y=.61, size=.03),
            "grade": dict(x=.5, y=.70, size=.027), "date": dict(x=.22, y=.78, size=.027),
            "signature": dict(x=.5, y=.78, size=.027), "qr": dict(x=.83, y=.74, size=.13),
            "sponsors": dict(x=.5, y=.885, size=.05), "id": dict(x=.83, y=.86, size=.016),
        }
        if cohosts:
            lay["org"].update(y=.17, size=.038)
            lay["branch"].update(y=.215)
        return lay
    lay = {
        "org": dict(x=.5, y=.10, size=.05), "branch": dict(x=.5, y=.135, size=.03),
        "cohosts": dict(x=.5, y=.095, size=.06), "title": dict(x=.5, y=.225, size=.072),
        "certify": dict(x=.5, y=.29, size=.033), "name": dict(x=.5, y=.355, size=.08),
        "name_hi": dict(x=.5, y=.415, size=.048), "body": dict(x=.5, y=.49, size=.033),
        "grade": dict(x=.5, y=.58, size=.03), "date": dict(x=.26, y=.69, size=.03),
        "signature": dict(x=.74, y=.69, size=.03), "qr": dict(x=.8, y=.80, size=.14),
        "sponsors": dict(x=.36, y=.83, size=.05), "id": dict(x=.8, y=.895, size=.017),
    }
    if cohosts:
        lay["org"].update(y=.145, size=.036)
        lay["branch"].update(y=.175)
    return lay


def merged_layout(event: Event) -> dict:
    base = default_layout(event.orientation, bool(event.cohosts))
    for k, v in (event.layout or {}).items():
        if k in base and isinstance(v, dict):
            base[k].update({kk: float(vv) for kk, vv in v.items() if kk in ("x", "y", "size")})
    return base


@dataclass
class CertData:
    name_en: str
    name_hi: str = ""
    grade: str = ""
    institution: str = ""
    cert_id: str = "CGM-PREVIEW"
    issued: datetime | None = None
    verify_url: str = "https://cergema.mangalhands.com/verify/CGM-PREVIEW"


def make_qr(url: str, px: int) -> Image.Image:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=1, box_size=10)
    qr.add_data(url)
    qr.make(fit=True)
    return qr.make_image(fill_color="black", back_color="white").convert("RGB").resize((px, px), Image.NEAREST)


def _text(d, xy, text, size, fill, bold=False, maxw=None, anchor="mm"):
    f = font_for(text, size, bold)
    if maxw:
        while size > 10 and d.textlength(text, font=f) > maxw:
            size = int(size * 0.94)
            f = font_for(text, size, bold)
    d.text(xy, text, font=f, fill=fill, anchor=anchor)


def _paste_logos(img, logos: list[Image.Image], cx, cy, box, gap, align="center"):
    """Equal-proportion logo row."""
    if not logos:
        return
    scaled = []
    for lg in logos:
        r = min(box / lg.width, box / lg.height)
        scaled.append(lg.resize((max(1, int(lg.width * r)), max(1, int(lg.height * r))), Image.LANCZOS))
    total = sum(s.width for s in scaled) + gap * (len(scaled) - 1)
    x = int(cx - total / 2)
    for s in scaled:
        img.paste(s, (x, int(cy - s.height / 2)), s)
        x += s.width + gap


def render_certificate(event: Event, data: CertData, root: Org, branch: Org | None, *,
                       dpi: int = 300, watermark: bool = False) -> Image.Image:
    size = backgrounds.size_for(event.orientation, 300)
    if event.bg_path and (up := load_upload(event.bg_path)):
        img = backgrounds.fit_cover(up, size)
    else:
        img = backgrounds.template_background(event.template if event.template != "custom" else "classic",
                                              event.orientation, event.accent)
    img = img.convert("RGB")
    W, H = img.size
    base = min(W, H)
    d = ImageDraw.Draw(img)
    L = merged_layout(event)
    ink, accent, muted = (20, 24, 38), _hex(event.accent), (90, 96, 110)

    def pos(k):
        return int(L[k]["x"] * W), int(L[k]["y"] * H)

    def sz(k):
        return int(L[k]["size"] * base)

    has_cohosts = bool(event.cohosts)
    logos = []
    if root.logo_path and (lg := load_upload(root.logo_path)):
        logos.append(lg)
    for c in (event.cohosts or []):
        if (lg := load_upload(c.get("logo", ""))):
            logos.append(lg)

    org_name = root.name if not has_cohosts else " × ".join([root.name] + [c.get("name", "") for c in event.cohosts])
    if logos and has_cohosts:  # co-host mode: crests in the header, equal size
        _paste_logos(img, logos, *pos("cohosts"), box=sz("cohosts"), gap=int(base * .05))
        _text(d, pos("org"), org_name, sz("org"), accent, True, W * .8)
    else:
        if logos:
            _paste_logos(img, logos[:1], int(W * .5 - min(W * .4, d.textlength(org_name, font=font_for(org_name, sz("org"), True)) / 2) - base * .06),
                         pos("org")[1], box=int(base * .07), gap=0)
        _text(d, pos("org"), org_name, sz("org"), accent, True, W * .7)
    if branch and branch.id != root.id:
        _text(d, pos("branch"), branch.name, sz("branch"), muted, False, W * .7)

    _text(d, pos("title"), event.cert_title, sz("title"), accent, True, W * .8)
    _text(d, pos("certify"), "This is to certify that", sz("certify"), muted, False, W * .7)
    _text(d, pos("name"), data.name_en, sz("name"), ink, True, W * .78)
    if data.name_hi:
        _text(d, pos("name_hi"), data.name_hi, sz("name_hi"), ink, True, W * .7)

    date_txt = (event.starts_at or data.issued or datetime.utcnow()).strftime("%d %B %Y")
    body = event.cert_body.replace("{event}", event.title).replace("{date}", date_txt) \
        .replace("{name}", data.name_en).replace("{grade}", data.grade)
    bx, by = pos("body")
    f = font_for(body, sz("body"))
    wrap_w = 60 if event.orientation == "landscape" else 42
    for i, line in enumerate(textwrap.wrap(body, wrap_w)):
        d.text((bx, by + i * int(sz("body") * 1.45)), line, font=f, fill=ink, anchor="mm")

    detail = " · ".join(x for x in [f"Grade {data.grade}" if data.grade else "", data.institution] if x)
    if detail:
        _text(d, pos("grade"), detail, sz("grade"), muted, False, W * .7)

    dx, dy = pos("date")
    _text(d, (dx, dy), date_txt, sz("date"), ink)
    d.line([dx - base * .12, dy - base * .03, dx + base * .12, dy - base * .03], fill=muted, width=3)
    _text(d, (dx, dy + base * .035), "Date", sz("date") * .7, muted)
    if event.signatory:
        sx, sy = pos("signature")
        _text(d, (sx, sy), event.signatory, sz("signature"), ink, True)
        d.line([sx - base * .14, sy - base * .03, sx + base * .14, sy - base * .03], fill=muted, width=3)
        _text(d, (sx, sy + base * .035), event.signatory_role or "Authorised Signatory", sz("signature") * .7, muted)

    q = int(L["qr"]["size"] * base)
    qx, qy = pos("qr")
    img.paste(make_qr(data.verify_url, q), (qx - q // 2, qy - q // 2))
    _text(d, (qx, qy + q // 2 + int(base * .018)), "Scan to verify", int(base * .014), muted)
    _text(d, pos("id"), data.cert_id, sz("id"), muted)

    sponsors = [load_upload(s.get("logo", "")) for s in (event.sponsors or [])]
    sponsors = [s for s in sponsors if s]
    if sponsors:
        sx, sy = pos("sponsors")
        _text(d, (sx, sy - int(sz("sponsors") * .75)), event.sponsor_label, int(base * .016), muted)
        _paste_logos(img, sponsors, sx, sy, box=sz("sponsors"), gap=int(base * .04))
    elif event.sponsors:
        names = "   |   ".join(s.get("name", "") for s in event.sponsors)
        _text(d, pos("sponsors"), f"{event.sponsor_label}: {names}", int(base * .018), muted, False, W * .8)

    if watermark:
        _text(d, (W // 2, int(H * .915)), "Powered by CerGeMA · cergema.mangalhands.com", int(base * .014), muted)

    if dpi != 300:
        s = dpi / 300
        img = img.resize((int(W * s), int(H * s)), Image.LANCZOS)
    return img


def _hex(h: str) -> tuple[int, int, int]:
    h = (h or "#1e3a8a").lstrip("#")
    try:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except Exception:
        return (30, 58, 138)


def to_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", dpi=(300, 300))
    return buf.getvalue()


def to_pdf(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PDF", resolution=300.0)
    return buf.getvalue()


def share_badge(name: str, event_title: str, org: str, cert_id: str) -> Image.Image:
    """1200x630 social preview badge (WhatsApp / LinkedIn / Facebook)."""
    img = Image.new("RGB", (1200, 630), "#0b2a5b")
    d = ImageDraw.Draw(img)
    d.rectangle([24, 24, 1176, 606], outline=(212, 175, 55), width=4)
    _text(d, (600, 120), "CERTIFIED", 40, (212, 175, 55), True)
    _text(d, (600, 250), name, 88, (255, 255, 255), True, 1000)
    _text(d, (600, 360), f"successfully completed", 34, (200, 210, 235))
    _text(d, (600, 430), event_title, 50, (255, 255, 255), True, 1050)
    _text(d, (600, 505), org, 32, (200, 210, 235), False, 1000)
    _text(d, (600, 570), f"Verify: {cert_id}  ·  CerGeMA", 24, (150, 165, 200))
    return img
