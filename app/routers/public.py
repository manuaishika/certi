"""Public, passwordless surface: landing, event registration, ID pass, claim, verify, PWA/SEO."""
import io
import json
from urllib.parse import quote

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse, Response
from PIL import Image, ImageDraw
from sqlmodel import Session, select

from .. import config
from ..db import get_session
from ..models import Certificate, Event, Feedback, Org, Registration
from ..security import sign
from ..services import issuing, notify, plans, registrations
from ..services.fonts import font_for
from ..services.render import make_qr, render_certificate, share_badge, to_pdf, to_png
from ..web import rate_limit, render

router = APIRouter()


def _event_or_404(session: Session, slug: str) -> Event:
    ev = session.exec(select(Event).where(Event.slug == slug)).first()
    if not ev:
        raise HTTPException(404, "Event not found")
    return ev


def _orgs(session: Session, ev: Event) -> tuple[Org, Org]:
    branch = session.get(Org, ev.org_id)
    return plans.root_of(session, branch), branch


@router.get("/")
def landing(request: Request, session: Session = Depends(get_session)):
    events = session.exec(select(Event).where(Event.reg_open == True).order_by(Event.id.desc()).limit(6)).all()  # noqa: E712
    return render(request, "landing.html", events=events)


# ---------------------------------------------------------------- registration hub
@router.get("/events/{slug}")
def event_page(request: Request, slug: str, session: Session = Depends(get_session)):
    ev = _event_or_404(session, slug)
    root, branch = _orgs(session, ev)
    enabled = plans.has_module(root, "registration")
    return render(request, "event.html", ev=ev, root=root, branch=branch, enabled=enabled,
                  lifecycle=plans.has_module(root, "lifecycle"), form={}, errors=[])


def _form_fields(name_en, name_hi, parent_name, institution, grade, mobile, email, attend_mode) -> dict:
    return dict(name_en=name_en, name_hi=name_hi, parent_name=parent_name, institution=institution, grade=grade,
                mobile=mobile, email=email, attend_mode=attend_mode)


@router.post("/events/{slug}/confirm")
def confirm(request: Request, slug: str, name_en: str = Form(""), name_hi: str = Form(""), parent_name: str = Form(""),
            institution: str = Form(""), grade: str = Form(""), mobile: str = Form(""), email: str = Form(""),
            attend_mode: str = Form("offline"), session: Session = Depends(get_session)):
    """Pre-submission confirmation modal (HTMX fragment) — catches spelling errors before they are printed."""
    rate_limit(request, "confirm", 40)
    ev = _event_or_404(session, slug)
    form = _form_fields(name_en, name_hi, parent_name, institution, grade, mobile, email, attend_mode)
    form["mobile"] = registrations.normalize_mobile(mobile)
    errors = registrations.validate(form)
    return render(request, "_confirm.html", ev=ev, form=form, errors=errors)


@router.post("/events/{slug}/register")
def register(request: Request, slug: str, name_en: str = Form(""), name_hi: str = Form(""), parent_name: str = Form(""),
             institution: str = Form(""), grade: str = Form(""), mobile: str = Form(""), email: str = Form(""),
             attend_mode: str = Form("offline"), session: Session = Depends(get_session)):
    rate_limit(request, "register", 15)
    ev = _event_or_404(session, slug)
    root, _ = _orgs(session, ev)
    if not ev.reg_open or not plans.has_module(root, "registration"):
        raise HTTPException(403, "Registration is closed for this event")
    reg = registrations.create_registration(
        session, ev, _form_fields(name_en, name_hi, parent_name, institution, grade, mobile, email, attend_mode))
    notify.send(session, "whatsapp", reg.mobile,
                f"Hi {reg.name_en}, you're registered for {ev.title}. Your ID pass: {config.BASE_URL}/pass/{reg.token}")
    return RedirectResponse(f"/pass/{reg.token}", status_code=303)


# ---------------------------------------------------------------- digital ID pass
@router.get("/pass/{token}")
def pass_page(request: Request, token: str, session: Session = Depends(get_session)):
    reg = session.exec(select(Registration).where(Registration.token == token)).first()
    if not reg:
        raise HTTPException(404, "Pass not found")
    ev = session.get(Event, reg.event_id)
    root, branch = _orgs(session, ev)
    cert = session.exec(select(Certificate).where(Certificate.registration_id == reg.id,
                                                  Certificate.revoked == False)).first()  # noqa: E712
    show_link = reg.attend_mode == "online" and ev.meeting_url and plans.has_module(root, "lifecycle")
    return render(request, "pass.html", reg=reg, ev=ev, root=root, branch=branch, cert=cert, show_link=show_link)


@router.get("/qr/{token}.png")
def qr_png(token: str):
    buf = io.BytesIO()
    make_qr(token, 600).save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/pass/{token}/badge.png")
def pass_png(token: str, session: Session = Depends(get_session)):
    reg = session.exec(select(Registration).where(Registration.token == token)).first()
    if not reg:
        raise HTTPException(404)
    ev = session.get(Event, reg.event_id)
    root, _ = _orgs(session, ev)
    img = Image.new("RGB", (900, 1300), "#ffffff")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 900, 260], fill="#0b2a5b")
    for text, y, size, fill, bold in [(root.name, 70, 44, "#ffffff", True), (ev.title, 150, 38, "#d4af37", True),
                                      ("ENTRY PASS", 215, 28, "#c8d2eb", False)]:
        d.text((450, y), text, font=font_for(text, size, bold), fill=fill, anchor="mm")
    d.text((450, 380), reg.name_en, font=font_for(reg.name_en, 64, True), fill="#111827", anchor="mm")
    if reg.name_hi:
        d.text((450, 460), reg.name_hi, font=font_for(reg.name_hi, 44, True), fill="#111827", anchor="mm")
    sub = " · ".join(x for x in [reg.institution, f"Grade {reg.grade}" if reg.grade else ""] if x)
    d.text((450, 530), sub, font=font_for(sub, 30), fill="#4b5563", anchor="mm")
    img.paste(make_qr(reg.token, 560), (170, 600))
    d.text((450, 1210), reg.token, font=font_for(reg.token, 40, True), fill="#111827", anchor="mm")
    d.text((450, 1260), reg.attend_mode.upper(), font=font_for("A", 28), fill="#6b7280", anchor="mm")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png",
                    headers={"Content-Disposition": f'attachment; filename="pass-{reg.token}.png"'})


# ---------------------------------------------------------------- claim (passwordless retrieval)
@router.get("/claim")
def claim_form(request: Request):
    return render(request, "claim.html", results=None, q="")


@router.post("/claim")
def claim(request: Request, q: str = Form(""), session: Session = Depends(get_session)):
    rate_limit(request, "claim", 15)
    q = q.strip()
    certs: list[Certificate] = []
    if q.upper().startswith("CGM-"):
        certs = session.exec(select(Certificate).where(Certificate.cert_id == q.upper(),
                                                       Certificate.revoked == False)).all()  # noqa: E712
    else:
        mobile = registrations.normalize_mobile(q)
        if len(mobile) == 10:
            certs = session.exec(select(Certificate).where(Certificate.mobile == mobile,
                                                           Certificate.revoked == False)).all()  # noqa: E712
    rows = [(c, session.get(Event, c.event_id)) for c in certs]
    return render(request, "claim.html", results=rows, q=q)


def _cert_or_404(session: Session, cert_id: str) -> tuple[Certificate, Event, Registration]:
    cert = session.exec(select(Certificate).where(Certificate.cert_id == cert_id)).first()
    if not cert or cert.revoked:
        raise HTTPException(404, "Certificate not found")
    return cert, session.get(Event, cert.event_id), session.get(Registration, cert.registration_id)


def _unlocked(session: Session, cert: Certificate, ev: Event) -> bool:
    if not ev.feedback_gate:
        return True
    return session.exec(select(Feedback).where(Feedback.cert_id == cert.cert_id)).first() is not None


@router.get("/certificate/{cert_id}")
def certificate_page(request: Request, cert_id: str, session: Session = Depends(get_session)):
    cert, ev, reg = _cert_or_404(session, cert_id)
    root, branch = _orgs(session, ev)
    url = f"{config.BASE_URL}/verify/{cert.cert_id}"
    share = {
        "whatsapp": "https://wa.me/?text=" + quote(f"I just earned a certificate for {ev.title}! Verify: {url}"),
        "linkedin": "https://www.linkedin.com/sharing/share-offsite/?url=" + quote(url),
        "facebook": "https://www.facebook.com/sharer/sharer.php?u=" + quote(url),
    }
    return render(request, "certificate.html", cert=cert, ev=ev, reg=reg, root=root, branch=branch,
                  unlocked=_unlocked(session, cert, ev), share=share, verify_url=url)


@router.post("/certificate/{cert_id}/feedback")
def feedback(request: Request, cert_id: str, rating: int = Form(...), comment: str = Form(""),
             session: Session = Depends(get_session)):
    cert, _, _ = _cert_or_404(session, cert_id)
    if not 1 <= rating <= 5:
        raise HTTPException(422, "Rating must be 1-5")
    if not session.exec(select(Feedback).where(Feedback.cert_id == cert.cert_id)).first():
        session.add(Feedback(cert_id=cert.cert_id, rating=rating, comment=comment.strip()[:1000]))
        session.commit()
    return RedirectResponse(f"/certificate/{cert_id}", status_code=303)


def _render_cert(session: Session, cert_id: str, dpi: int):
    cert, ev, reg = _cert_or_404(session, cert_id)
    root, branch = _orgs(session, ev)
    wm = plans.plan_of(root)["watermark"]
    return cert, ev, render_certificate(ev, issuing.cert_data(cert, reg), root, branch, dpi=dpi, watermark=wm)


@router.get("/certificate/{cert_id}/preview.png")
def cert_preview(cert_id: str, session: Session = Depends(get_session)):
    _, _, img = _render_cert(session, cert_id, 90)
    return Response(to_png(img), media_type="image/png")


@router.get("/certificate/{cert_id}/download.{ext}")
def cert_download(cert_id: str, ext: str, session: Session = Depends(get_session)):
    cert, ev, reg = _cert_or_404(session, cert_id)
    if not _unlocked(session, cert, ev):
        return RedirectResponse(f"/certificate/{cert_id}", status_code=303)
    if ext not in ("pdf", "png"):
        raise HTTPException(404)
    _, _, img = _render_cert(session, cert_id, 300)
    body, mt = (to_pdf(img), "application/pdf") if ext == "pdf" else (to_png(img), "image/png")
    return Response(body, media_type=mt, headers={"Content-Disposition": f'attachment; filename="{cert_id}.{ext}"'})


@router.get("/share/{cert_id}.png")
def share_png(cert_id: str, session: Session = Depends(get_session)):
    cert, ev, reg = _cert_or_404(session, cert_id)
    root, _ = _orgs(session, ev)
    buf = io.BytesIO()
    share_badge(reg.name_en, ev.title, root.name, cert.cert_id).save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


# ---------------------------------------------------------------- verification
@router.get("/verify/{cert_id}")
def verify(request: Request, cert_id: str, s: str = "", session: Session = Depends(get_session)):
    rate_limit(request, "verify", 60)
    cert = session.exec(select(Certificate).where(Certificate.cert_id == cert_id.upper())).first()
    ctx = dict(cert=cert, ev=None, reg=None, root=None, branch=None, cert_id=cert_id, sig_ok=None)
    if cert:
        ev = session.get(Event, cert.event_id)
        root, branch = _orgs(session, ev)
        ctx.update(ev=ev, reg=session.get(Registration, cert.registration_id), root=root, branch=branch,
                   sig_ok=(sign(cert.cert_id) == s) if s else None)
    return render(request, "verify.html", **ctx)


# ---------------------------------------------------------------- SEO + PWA / TWA
@router.get("/sitemap.xml")
def sitemap(session: Session = Depends(get_session)):
    urls = [f"{config.BASE_URL}/", f"{config.BASE_URL}/claim"] + [
        f"{config.BASE_URL}/events/{e.slug}" for e in session.exec(select(Event).where(Event.reg_open == True))]  # noqa: E712
    body = "".join(f"<url><loc>{u}</loc></url>" for u in urls)
    return Response(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>',
                    media_type="application/xml")


@router.get("/robots.txt")
def robots():
    return PlainTextResponse(f"User-agent: *\nDisallow: /admin\nDisallow: /api\nSitemap: {config.BASE_URL}/sitemap.xml\n")


@router.get("/manifest.webmanifest")
def manifest():
    return JSONResponse({
        "name": "CerGeMA — Smart Events, Instant Certificates", "short_name": "CerGeMA", "start_url": "/",
        "scope": "/", "display": "standalone", "background_color": "#0b2a5b", "theme_color": "#0b2a5b",
        "icons": [{"src": "/static/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
                  {"src": "/static/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}],
        "shortcuts": [{"name": "Get my certificate", "url": "/claim"}, {"name": "Scan entry", "url": "/admin/scan"}],
    }, media_type="application/manifest+json")


@router.get("/sw.js")
def service_worker():
    js = (config.BASE_DIR / "static" / "sw.js").read_text()
    return Response(js, media_type="application/javascript", headers={"Service-Worker-Allowed": "/"})


@router.get("/.well-known/assetlinks.json")
def assetlinks():
    if not config.ANDROID_SHA256:
        return JSONResponse([])
    return JSONResponse([{"relation": ["delegate_permission/common.handle_all_urls"],
                          "target": {"namespace": "android_app", "package_name": config.ANDROID_PACKAGE,
                                     "sha256_cert_fingerprints": [config.ANDROID_SHA256]}}])


_ = json
