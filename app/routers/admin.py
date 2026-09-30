"""Authenticated console: tenants, events, registrations, designer, scanner, billing, coupons."""
import csv
import io
import json
import re
from datetime import datetime

from fastapi import (APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile)
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from sqlmodel import Session, func, select

from .. import config
from ..db import engine, get_session
from ..models import (Certificate, Commission, Coupon, Event, Feedback, Org, Registration, Transaction, User)
from ..security import hash_password, new_token, require_super, require_user, verify_password
from ..services import backgrounds, issuing, notify, payments, plans, registrations
from ..services.images import save_upload
from ..services.render import CertData, FIELDS, FIELD_LABELS, merged_layout, render_certificate, to_png
from ..web import render

router = APIRouter()


# ---------------------------------------------------------------- helpers
def flash(request: Request, msg: str) -> None:
    request.session["flash"] = msg


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role == "volunteer":
        raise HTTPException(303, headers={"Location": "/admin/scan"})
    return user


def user_root(session: Session, user: User) -> Org | None:
    return plans.root_of(session, session.get(Org, user.org_id)) if user.org_id else None


def org_access(session: Session, user: User, org: Org) -> Org:
    """Return the tenant root of `org`, raising 403 when the user may not touch it."""
    root = plans.root_of(session, org)
    if user.role != "super" and (not user.org_id or user_root(session, user).id != root.id):
        raise HTTPException(403, "Not your organisation")
    return root


def get_org(session: Session, user: User, org_id: int) -> tuple[Org, Org]:
    org = session.get(Org, org_id)
    if not org:
        raise HTTPException(404, "Organisation not found")
    return org, org_access(session, user, org)


def get_event(session: Session, user: User, event_id: int) -> tuple[Event, Org, Org]:
    ev = session.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    branch = session.get(Org, ev.org_id)
    return ev, org_access(session, user, branch), branch


def tenant_orgs(session: Session, user: User) -> list[Org]:
    """All orgs (roots + branches) the user can host events under."""
    if user.role == "super":
        return session.exec(select(Org).where(Org.active == True).order_by(Org.id)).all()  # noqa: E712
    root = user_root(session, user)
    return [root] + session.exec(select(Org).where(Org.parent_id == root.id)).all() if root else []


def slugify(text: str, session: Session) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "event"
    slug, n = base, 1
    while session.exec(select(Event).where(Event.slug == slug)).first():
        n += 1
        slug = f"{base}-{n}"
    return slug


def billing_root(session: Session, user: User, org_id: int | None) -> Org:
    if user.role == "super":
        org = session.get(Org, org_id) if org_id else session.exec(select(Org).where(Org.parent_id == None)).first()  # noqa: E711
        if not org:
            raise HTTPException(404, "Create a tenant first")
        return plans.root_of(session, org)
    return user_root(session, user)


# ---------------------------------------------------------------- auth
@router.get("/login")
def login_page(request: Request):
    return render(request, "login.html", error="")


@router.post("/login")
def login(request: Request, email: str = Form(...), password: str = Form(...), session: Session = Depends(get_session)):
    from ..web import rate_limit
    rate_limit(request, "login", 10)
    user = session.exec(select(User).where(User.email == email.strip().lower())).first()
    if not user or not verify_password(password, user.password_hash):
        return render(request, "login.html", status_code=401, error="Invalid email or password")
    request.session["uid"] = user.id
    return RedirectResponse("/admin/scan" if user.role == "volunteer" else "/admin", status_code=303)


@router.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/", status_code=303)


# ---------------------------------------------------------------- dashboard
@router.get("/admin")
def dashboard(request: Request, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    root = user_root(session, user)
    if user.role == "super":
        ev_ids = session.exec(select(Event.id)).all()
        stats = dict(tenants=session.exec(select(func.count(Org.id)).where(Org.parent_id == None)).one(),  # noqa: E711
                     events=len(ev_ids),
                     regs=session.exec(select(func.count(Registration.id))).one(),
                     certs=session.exec(select(func.count(Certificate.id))).one())
        revenue = sum(t.amount for t in session.exec(select(Transaction).where(
            Transaction.status == "paid", Transaction.currency == "INR", Transaction.kind.in_(["topup", "plan"]))))
        return render(request, "dashboard.html", user=user, root=None, stats=stats, revenue=revenue, usage=None,
                      tenants=session.exec(select(Org).where(Org.parent_id == None)).all())  # noqa: E711
    ids = [o.id for o in tenant_orgs(session, user)]
    events = session.exec(select(Event).where(Event.org_id.in_(ids))).all()
    eids = [e.id for e in events]
    stats = dict(events=len(events),
                 regs=session.exec(select(func.count(Registration.id)).where(Registration.event_id.in_(eids))).one() if eids else 0,
                 certs=session.exec(select(func.count(Certificate.id)).where(Certificate.tenant_id == root.id)).one())
    quota = plans.quota_of(root)
    used = plans.issued_in_period(session, root)
    usage = dict(quota=quota, used=used, pct=min(100, int(used * 100 / quota)) if quota else 0)
    return render(request, "dashboard.html", user=user, root=root, stats=stats, usage=usage, revenue=None, tenants=[])


# ---------------------------------------------------------------- organisations
@router.get("/admin/orgs")
def orgs_page(request: Request, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    if user.role == "super":
        roots = session.exec(select(Org).where(Org.parent_id == None).order_by(Org.id)).all()  # noqa: E711
    else:
        roots = [user_root(session, user)]
    data = []
    for r in roots:
        data.append(dict(root=r, branches=session.exec(select(Org).where(Org.parent_id == r.id)).all(),
                         users=session.exec(select(User).where(User.org_id == r.id)).all(),
                         used=plans.issued_in_period(session, r), quota=plans.quota_of(r),
                         modules=plans.modules_of(r), allowance=plans.branch_allowance(r)))
    return render(request, "orgs.html", user=user, data=data)


@router.post("/admin/orgs")
def create_tenant(request: Request, name: str = Form(...), plan: str = Form("free"), admin_email: str = Form(...),
                  admin_password: str = Form(...), user: User = Depends(require_super),
                  session: Session = Depends(get_session)):
    if plan not in plans.PLANS:
        raise HTTPException(422, "Unknown plan")
    if session.exec(select(User).where(User.email == admin_email.lower())).first():
        raise HTTPException(409, "That email is already in use")
    root = Org(name=name.strip(), plan=plan, api_key=new_token("K", 24))
    session.add(root)
    session.commit()
    session.refresh(root)
    session.add(User(email=admin_email.strip().lower(), password_hash=hash_password(admin_password), role="org_admin",
                     org_id=root.id, name=name))
    session.commit()
    flash(request, f"Tenant '{root.name}' created.")
    return RedirectResponse("/admin/orgs", status_code=303)


@router.post("/admin/orgs/{org_id}/branch")
def add_branch(request: Request, org_id: int, name: str = Form(...), user: User = Depends(require_admin),
               session: Session = Depends(get_session)):
    org, root = get_org(session, user, org_id)
    allowance = plans.branch_allowance(root)
    if user.role != "super" and allowance is not None and plans.branch_count(session, root) >= allowance:
        flash(request, f"Your plan allows {allowance} branch(es). Upgrade to add more.")
    else:
        session.add(Org(name=name.strip(), parent_id=root.id))
        session.commit()
        flash(request, "Branch added.")
    return RedirectResponse("/admin/orgs", status_code=303)


@router.post("/admin/orgs/{org_id}/logo")
async def org_logo(request: Request, org_id: int, logo: UploadFile = File(...), user: User = Depends(require_admin),
                   session: Session = Depends(get_session)):
    org, _ = get_org(session, user, org_id)
    org.logo_path = await save_upload(logo, 1200) or org.logo_path
    session.add(org)
    session.commit()
    flash(request, "Logo updated.")
    return RedirectResponse("/admin/orgs", status_code=303)


@router.post("/admin/orgs/{org_id}/settings")
def org_settings(request: Request, org_id: int, plan: str = Form("free"), quota_override: str = Form(""),
                 price_override: str = Form(""), wallet_adjust: float = Form(0), use_modules: str = Form(None),
                 modules: list[str] = Form(default=[]), active: str = Form(None), user: User = Depends(require_super),
                 session: Session = Depends(get_session)):
    org = session.get(Org, org_id)
    if not org or org.parent_id:
        raise HTTPException(404, "Tenant not found")
    if plan not in plans.PLANS:
        raise HTTPException(422, "Unknown plan")
    org.plan = plan
    org.quota_override = int(quota_override) if quota_override.strip() else None
    org.price_override_inr = int(price_override) if price_override.strip() else None
    org.modules_override = [m for m in modules if m in plans.ALL_MODULES] if use_modules else None
    org.active = bool(active)
    if wallet_adjust:
        org.wallet += wallet_adjust
        session.add(Transaction(org_id=org.id, kind="topup", credits=wallet_adjust, provider="manual", status="paid",
                                note=f"Manual adjustment by {user.email}"))
    session.add(org)
    session.commit()
    flash(request, "Tenant settings saved.")
    return RedirectResponse("/admin/orgs", status_code=303)


@router.post("/admin/orgs/{org_id}/user")
def add_user(request: Request, org_id: int, email: str = Form(...), password: str = Form(...), role: str = Form("volunteer"),
             user: User = Depends(require_admin), session: Session = Depends(get_session)):
    _, root = get_org(session, user, org_id)
    if role not in ("org_admin", "volunteer"):
        raise HTTPException(422, "Bad role")
    if len(password) < 6:
        raise HTTPException(422, "Password must be at least 6 characters")
    if session.exec(select(User).where(User.email == email.lower())).first():
        raise HTTPException(409, "That email is already in use")
    session.add(User(email=email.strip().lower(), password_hash=hash_password(password), role=role, org_id=root.id))
    session.commit()
    flash(request, f"{role.replace('_', ' ').title()} added.")
    return RedirectResponse("/admin/orgs", status_code=303)


@router.post("/admin/orgs/{org_id}/apikey")
def rotate_key(request: Request, org_id: int, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    _, root = get_org(session, user, org_id)
    root.api_key = new_token("K", 24)
    session.add(root)
    session.commit()
    flash(request, "New API key generated.")
    return RedirectResponse("/admin/orgs", status_code=303)


# ---------------------------------------------------------------- events
@router.get("/admin/events")
def events_page(request: Request, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    ids = [o.id for o in tenant_orgs(session, user)]
    events = session.exec(select(Event).where(Event.org_id.in_(ids)).order_by(Event.id.desc())).all()
    rows = []
    for e in events:
        rows.append(dict(ev=e, regs=session.exec(select(func.count(Registration.id)).where(Registration.event_id == e.id)).one(),
                         certs=session.exec(select(func.count(Certificate.id)).where(Certificate.event_id == e.id)).one()))
    return render(request, "events.html", user=user, rows=rows)


@router.get("/admin/events/new")
def event_new(request: Request, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    return render(request, "event_form.html", user=user, ev=None, orgs=tenant_orgs(session, user))


def _apply_event_form(ev: Event, root: Org, f: dict) -> None:
    lifecycle = plans.has_module(root, "lifecycle")
    ev.title, ev.title_hi = f["title"].strip(), f["title_hi"].strip()
    ev.description, ev.venue, ev.arrival_info = f["description"], f["venue"], f["arrival_info"]
    ev.mode = f["mode"] if lifecycle and f["mode"] in ("offline", "online", "hybrid") else "offline"
    ev.meeting_url = f["meeting_url"].strip() if lifecycle else ""
    ev.lat = float(f["lat"]) if f["lat"].strip() else None
    ev.lng = float(f["lng"]) if f["lng"].strip() else None
    ev.starts_at = datetime.fromisoformat(f["starts_at"]) if f["starts_at"] else None
    ev.orientation = f["orientation"] if f["orientation"] in ("landscape", "portrait") else "landscape"
    ev.cert_title, ev.cert_body = f["cert_title"].strip() or ev.cert_title, f["cert_body"].strip() or ev.cert_body
    ev.signatory, ev.signatory_role = f["signatory"].strip(), f["signatory_role"].strip()
    ev.gate_attendance = bool(f["gate_attendance"]) and plans.has_module(root, "attendance")
    ev.feedback_gate, ev.approval_required, ev.reg_open = bool(f["feedback_gate"]), bool(f["approval_required"]), bool(f["reg_open"])


def _event_form_dict(**kw) -> dict:
    return kw


@router.post("/admin/events")
def event_create(request: Request, title: str = Form(...), title_hi: str = Form(""), description: str = Form(""),
                 org_id: int = Form(...), mode: str = Form("offline"), venue: str = Form(""), arrival_info: str = Form(""),
                 meeting_url: str = Form(""), lat: str = Form(""), lng: str = Form(""), starts_at: str = Form(""),
                 orientation: str = Form("landscape"), cert_title: str = Form(""), cert_body: str = Form(""),
                 signatory: str = Form(""), signatory_role: str = Form(""), gate_attendance: str = Form(None),
                 feedback_gate: str = Form(None), approval_required: str = Form(None), reg_open: str = Form(None),
                 user: User = Depends(require_admin), session: Session = Depends(get_session)):
    org, root = get_org(session, user, org_id)
    ev = Event(org_id=org.id, title=title, slug=slugify(title, session))
    f = dict(locals())
    _apply_event_form(ev, root, f)
    session.add(ev)
    session.commit()
    session.refresh(ev)
    flash(request, "Event created. Now design the certificate.")
    return RedirectResponse(f"/admin/events/{ev.id}", status_code=303)


@router.post("/admin/events/{event_id}/settings")
def event_update(request: Request, event_id: int, title: str = Form(...), title_hi: str = Form(""),
                 description: str = Form(""), mode: str = Form("offline"), venue: str = Form(""),
                 arrival_info: str = Form(""), meeting_url: str = Form(""), lat: str = Form(""), lng: str = Form(""),
                 starts_at: str = Form(""), orientation: str = Form("landscape"), cert_title: str = Form(""),
                 cert_body: str = Form(""), signatory: str = Form(""), signatory_role: str = Form(""),
                 gate_attendance: str = Form(None), feedback_gate: str = Form(None), approval_required: str = Form(None),
                 reg_open: str = Form(None), sponsor_label: str = Form("Supported By"),
                 user: User = Depends(require_admin), session: Session = Depends(get_session)):
    ev, root, _ = get_event(session, user, event_id)
    f = dict(locals())
    if orientation != ev.orientation:
        ev.layout = {}  # positions differ per orientation
    _apply_event_form(ev, root, f)
    ev.sponsor_label = sponsor_label.strip() or "Supported By"
    session.add(ev)
    session.commit()
    flash(request, "Event saved.")
    return RedirectResponse(f"/admin/events/{ev.id}", status_code=303)


@router.get("/admin/events/{event_id}")
def event_detail(request: Request, event_id: int, q: str = "", user: User = Depends(require_admin),
                 session: Session = Depends(get_session)):
    ev, root, branch = get_event(session, user, event_id)
    regs = _query_regs(session, ev, q)
    certs = {c.registration_id: c for c in session.exec(select(Certificate).where(Certificate.event_id == ev.id))}
    fb = session.exec(select(Feedback).where(Feedback.cert_id.in_([c.cert_id for c in certs.values()]))).all() if certs else []
    avg = round(sum(f.rating for f in fb) / len(fb), 2) if fb else None
    return render(request, "event_detail.html", user=user, ev=ev, root=root, branch=branch, regs=regs, certs=certs,
                  feedback=fb[-8:], avg=avg, fb_count=len(fb), orgs=tenant_orgs(session, user),
                  lifecycle=plans.has_module(root, "lifecycle"), attendance=plans.has_module(root, "attendance"),
                  cobrand=plans.has_module(root, "cobrand"), remaining=plans.remaining_quota(session, root, ev.id),
                  stats=dict(total=len(regs), present=sum(r.status == "present" for r in regs),
                             approved=sum(r.approved for r in regs)), q=q)


def _query_regs(session: Session, ev: Event, q: str = "") -> list[Registration]:
    stmt = select(Registration).where(Registration.event_id == ev.id).order_by(Registration.id)
    rows = session.exec(stmt).all()
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in r.name_en.lower() or ql in r.mobile or ql in r.institution.lower()]
    return rows


# --- co-hosts & sponsors
@router.post("/admin/events/{event_id}/brand")
async def add_brand(request: Request, event_id: int, kind: str = Form(...), name: str = Form(...),
                    logo: UploadFile = File(None), user: User = Depends(require_admin),
                    session: Session = Depends(get_session)):
    ev, root, _ = get_event(session, user, event_id)
    if not plans.has_module(root, "cobrand"):
        flash(request, "Co-hosts and sponsors need the Institutional Pro plan or higher.")
        return RedirectResponse(f"/admin/events/{ev.id}", status_code=303)
    key, limit = ("cohosts", config.MAX_COHOSTS) if kind == "cohost" else ("sponsors", config.MAX_SPONSORS)
    current = list(getattr(ev, key) or [])
    if len(current) >= limit:
        flash(request, f"Limit reached: {limit} {key} per event.")
    else:
        current.append({"name": name.strip(), "logo": await save_upload(logo, 1200)})
        setattr(ev, key, current)
        session.add(ev)
        session.commit()
        flash(request, "Added.")
    return RedirectResponse(f"/admin/events/{ev.id}", status_code=303)


@router.post("/admin/events/{event_id}/brand/{kind}/{idx}/delete")
def del_brand(request: Request, event_id: int, kind: str, idx: int, user: User = Depends(require_admin),
              session: Session = Depends(get_session)):
    ev, _, _ = get_event(session, user, event_id)
    key = "cohosts" if kind == "cohost" else "sponsors"
    current = list(getattr(ev, key) or [])
    if 0 <= idx < len(current):
        current.pop(idx)
        setattr(ev, key, current)
        session.add(ev)
        session.commit()
    return RedirectResponse(f"/admin/events/{ev.id}", status_code=303)


# --- registrations (HTMX)
def _reg_ctx(session: Session, ev: Event, reg: Registration) -> dict:
    cert = session.exec(select(Certificate).where(Certificate.registration_id == reg.id)).first()
    return dict(ev=ev, r=reg, cert=cert)


@router.get("/admin/events/{event_id}/regs")
def regs_partial(request: Request, event_id: int, q: str = "", user: User = Depends(require_admin),
                 session: Session = Depends(get_session)):
    ev, root, _ = get_event(session, user, event_id)
    certs = {c.registration_id: c for c in session.exec(select(Certificate).where(Certificate.event_id == ev.id))}
    return render(request, "_regs.html", ev=ev, regs=_query_regs(session, ev, q), certs=certs,
                  attendance=plans.has_module(root, "attendance"))


def _reg_for(session: Session, user: User, rid: int) -> tuple[Registration, Event, Org]:
    reg = session.get(Registration, rid)
    if not reg:
        raise HTTPException(404)
    ev, root, _ = get_event(session, user, reg.event_id)
    return reg, ev, root


@router.post("/admin/regs/{rid}/edit")
def reg_edit(rid: int, field: str, value: str = Form(""), user: User = Depends(require_admin),
             session: Session = Depends(get_session)):
    """Inline spreadsheet-style correction; issued certificates pick the fix up automatically."""
    reg, ev, _ = _reg_for(session, user, rid)
    if field not in ("name_en", "name_hi", "institution", "grade", "mobile", "email", "parent_name"):
        raise HTTPException(422, "Bad field")
    value = registrations.clean_name(value)
    if field == "mobile":
        value = registrations.normalize_mobile(value)
    trial = {"name_en": reg.name_en, "name_hi": reg.name_hi, "mobile": reg.mobile, "email": reg.email, field: value}
    if errs := registrations.validate(trial):
        raise HTTPException(422, "; ".join(errs))
    setattr(reg, field, value)
    session.add(reg)
    for c in session.exec(select(Certificate).where(Certificate.registration_id == reg.id)):
        c.name, c.mobile = reg.name_en, reg.mobile
        session.add(c)
    session.commit()
    return Response(status_code=204)


@router.post("/admin/regs/{rid}/toggle/{what}")
def reg_toggle(request: Request, rid: int, what: str, user: User = Depends(require_admin),
               session: Session = Depends(get_session)):
    reg, ev, root = _reg_for(session, user, rid)
    if what == "approved":
        reg.approved = not reg.approved
    elif what == "present":
        reg.status = "registered" if reg.status == "present" else "present"
        reg.checked_in_at = datetime.utcnow() if reg.status == "present" else None
    else:
        raise HTTPException(404)
    session.add(reg)
    session.commit()
    cert = session.exec(select(Certificate).where(Certificate.registration_id == reg.id)).first()
    return render(request, "_reg_row.html", ev=ev, r=reg, cert=cert, attendance=plans.has_module(root, "attendance"))


@router.post("/admin/regs/{rid}/delete")
def reg_delete(rid: int, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    reg, ev, _ = _reg_for(session, user, rid)
    if session.exec(select(Certificate).where(Certificate.registration_id == reg.id)).first():
        raise HTTPException(409, "Certificate already issued — revoke it first")
    session.delete(reg)
    session.commit()
    return Response(status_code=200)


@router.post("/admin/events/{event_id}/regs/add")
def reg_add(request: Request, event_id: int, name_en: str = Form(""), name_hi: str = Form(""), institution: str = Form(""),
            grade: str = Form(""), mobile: str = Form(""), email: str = Form(""), user: User = Depends(require_admin),
            session: Session = Depends(get_session)):
    ev, _, _ = get_event(session, user, event_id)
    try:
        registrations.create_registration(session, ev, dict(name_en=name_en, name_hi=name_hi, institution=institution,
                                                            grade=grade, mobile=mobile, email=email), approved=True)
        flash(request, "Participant added.")
    except HTTPException as e:
        flash(request, f"Could not add: {e.detail}")
    return RedirectResponse(f"/admin/events/{ev.id}", status_code=303)


@router.post("/admin/events/{event_id}/import")
async def reg_import(request: Request, event_id: int, file: UploadFile = File(...), user: User = Depends(require_admin),
                     session: Session = Depends(get_session)):
    ev, _, _ = get_event(session, user, event_id)
    rows = registrations.parse_upload(file.filename or "", await file.read())
    created, errors = registrations.bulk_import(session, ev, rows)
    flash(request, f"Imported {created} participant(s)." + (f" {len(errors)} row(s) skipped: " + " | ".join(errors[:5]) if errors else ""))
    return RedirectResponse(f"/admin/events/{ev.id}", status_code=303)


@router.post("/admin/events/{event_id}/approve-all")
def approve_all(request: Request, event_id: int, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    ev, _, _ = get_event(session, user, event_id)
    for r in _query_regs(session, ev):
        if not r.approved:
            r.approved = True
            session.add(r)
    session.commit()
    flash(request, "All participants approved.")
    return RedirectResponse(f"/admin/events/{ev.id}", status_code=303)


def _notify_issued(cert_ids: list[str]) -> None:
    from sqlmodel import Session as S
    with S(engine) as s:
        for cid in cert_ids:
            cert = s.exec(select(Certificate).where(Certificate.cert_id == cid)).first()
            if cert:
                ev = s.get(Event, cert.event_id)
                notify.send(s, "whatsapp", cert.mobile,
                            f"Congratulations {cert.name}! Your certificate for {ev.title} is ready: "
                            f"{config.BASE_URL}/certificate/{cert.cert_id}")


@router.post("/admin/events/{event_id}/issue")
def issue(request: Request, event_id: int, bg: BackgroundTasks, notify_people: str = Form(None),
          user: User = Depends(require_admin), session: Session = Depends(get_session)):
    ev, root, _ = get_event(session, user, event_id)
    before = {c.cert_id for c in session.exec(select(Certificate).where(Certificate.event_id == ev.id))}
    res = issuing.issue_certificates(session, ev, _query_regs(session, ev), root)
    msg = f"Issued {res['issued']} certificate(s)."
    if res.get("overage_cost"):
        msg += f" Overage billed: ₹{res['overage_cost']:.2f} from wallet."
    if res["skipped"]:
        msg += f" Skipped {len(res['skipped'])} (e.g. {res['skipped'][0]})."
    if res["blocked"]:
        msg += " " + res["blocked"]
    flash(request, msg)
    if notify_people:
        new = [c.cert_id for c in session.exec(select(Certificate).where(Certificate.event_id == ev.id)) if c.cert_id not in before]
        bg.add_task(_notify_issued, new)
    return RedirectResponse(f"/admin/events/{ev.id}", status_code=303)


@router.post("/admin/certs/{cert_id}/revoke")
def revoke(request: Request, cert_id: str, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    cert = session.exec(select(Certificate).where(Certificate.cert_id == cert_id)).first()
    if not cert:
        raise HTTPException(404)
    get_event(session, user, cert.event_id)
    cert.revoked = not cert.revoked
    session.add(cert)
    session.commit()
    flash(request, f"Certificate {cert.cert_id} {'revoked' if cert.revoked else 'restored'}.")
    return RedirectResponse(f"/admin/events/{cert.event_id}", status_code=303)


@router.get("/admin/events/{event_id}/export.csv")
def export_csv(event_id: int, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    ev, _, _ = get_event(session, user, event_id)
    certs = {c.registration_id: c for c in session.exec(select(Certificate).where(Certificate.event_id == ev.id))}
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["name_en", "name_hi", "institution", "grade", "mobile", "email", "mode", "approved", "status", "certificate_id"])
    for r in _query_regs(session, ev):
        c = certs.get(r.id)
        w.writerow([r.name_en, r.name_hi, r.institution, r.grade, r.mobile, r.email, r.attend_mode, r.approved,
                    r.status, c.cert_id if c else ""])
    return Response("﻿" + out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{ev.slug}-participants.csv"'})


# ---------------------------------------------------------------- designer
@router.get("/admin/events/{event_id}/design")
def design(request: Request, event_id: int, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    ev, root, branch = get_event(session, user, event_id)
    policy, detail = ai_policy(session, root)
    return render(request, "design.html", user=user, ev=ev, root=root, layout=merged_layout(ev), fields=FIELDS,
                  labels=FIELD_LABELS, templates=backgrounds.TEMPLATE_LABELS, ai_policy=policy, ai_detail=detail,
                  v=int(datetime.utcnow().timestamp()), wallet=root.wallet)


@router.get("/admin/events/{event_id}/preview.png")
def design_preview(event_id: int, dpi: int = 90, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    ev, root, branch = get_event(session, user, event_id)
    sample = CertData(name_en="Aarav Sharma", name_hi="आरव शर्मा", grade="8", institution="Demo Public School",
                      cert_id="CGM-SAMPLE01", issued=datetime.utcnow())
    img = render_certificate(ev, sample, root, branch, dpi=max(40, min(dpi, 300)), watermark=plans.plan_of(root)["watermark"])
    return Response(to_png(img), media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/admin/events/{event_id}/layout")
async def save_layout(request: Request, event_id: int, user: User = Depends(require_admin),
                      session: Session = Depends(get_session)):
    ev, _, _ = get_event(session, user, event_id)
    body = await request.json()
    clean = {}
    for k, v in (body or {}).items():
        if k in FIELDS and isinstance(v, dict):
            clean[k] = {kk: max(0.0, min(1.0, float(vv))) for kk, vv in v.items() if kk in ("x", "y", "size")}
    ev.layout = clean
    session.add(ev)
    session.commit()
    return JSONResponse({"ok": True})


@router.post("/admin/events/{event_id}/layout/reset")
def reset_layout(event_id: int, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    ev, _, _ = get_event(session, user, event_id)
    ev.layout = {}
    session.add(ev)
    session.commit()
    return RedirectResponse(f"/admin/events/{ev.id}/design", status_code=303)


@router.post("/admin/events/{event_id}/style")
def save_style(request: Request, event_id: int, template: str = Form("classic"), accent: str = Form("#1e3a8a"),
               orientation: str = Form("landscape"), user: User = Depends(require_admin),
               session: Session = Depends(get_session)):
    ev, _, _ = get_event(session, user, event_id)
    if template in backgrounds.TEMPLATES:
        ev.template, ev.bg_path = template, ""
    if re.fullmatch(r"#[0-9a-fA-F]{6}", accent):
        ev.accent = accent
    if orientation in ("landscape", "portrait") and orientation != ev.orientation:
        ev.orientation, ev.layout = orientation, {}
        if ev.template == "custom":
            ev.template, ev.bg_path = "classic", ""
    session.add(ev)
    session.commit()
    return RedirectResponse(f"/admin/events/{ev.id}/design", status_code=303)


@router.post("/admin/events/{event_id}/background")
async def upload_bg(request: Request, event_id: int, file: UploadFile = File(...), user: User = Depends(require_admin),
                    session: Session = Depends(get_session)):
    ev, _, _ = get_event(session, user, event_id)
    name = await save_upload(file, 4000)
    if name:
        ev.bg_path, ev.template = name, "custom"
        session.add(ev)
        session.commit()
        flash(request, "Custom background applied. Drag the fields to fit your artwork.")
    return RedirectResponse(f"/admin/events/{ev.id}/design", status_code=303)


def ai_policy(session: Session, root: Org) -> tuple[str, str]:
    """('blocked'|'free'|'wallet', explanation) per SRS tier rules."""
    plan = plans.plan_of(root)
    if root.plan == "free" and "ai" not in plans.modules_of(root):
        return "blocked", "AI backgrounds are not included in the Free plan."
    free = plan["ai_free"]
    if free is None:
        return "free", "Unlimited AI generations on your plan."
    start = datetime(datetime.utcnow().year, datetime.utcnow().month, 1)
    used = session.exec(select(func.count(Transaction.id)).where(
        Transaction.org_id == root.id, Transaction.kind == "ai", Transaction.created_at >= start)).one()
    if used < free:
        return "free", f"{free - used} of {free} free generations left this month."
    return "wallet", f"Each generation costs {config.AI_CREDITS_PER_RUN} credits (wallet: {root.wallet:.0f})."


@router.post("/admin/events/{event_id}/ai-background")
def ai_background(request: Request, event_id: int, prompt: str = Form(...), user: User = Depends(require_admin),
                  session: Session = Depends(get_session)):
    ev, root, _ = get_event(session, user, event_id)
    policy, detail = ai_policy(session, root)
    prompt = prompt.strip()[:300]
    if policy == "blocked" or len(prompt) < 3:
        flash(request, detail if policy == "blocked" else "Describe the background you want (3+ characters).")
        return RedirectResponse(f"/admin/events/{ev.id}/design", status_code=303)
    if policy == "wallet" and root.wallet < config.AI_CREDITS_PER_RUN:
        flash(request, f"Not enough credits: need {config.AI_CREDITS_PER_RUN}, have {root.wallet:.0f}. Top up the wallet.")
        return RedirectResponse(f"/admin/events/{ev.id}/design", status_code=303)
    img, engine_used = backgrounds.generate_ai_background(prompt, ev.orientation)
    import uuid
    name = f"{uuid.uuid4().hex}.png"
    img.save(config.UPLOAD_DIR / name, "PNG")
    ev.bg_path, ev.template = name, "custom"
    session.add(ev)
    if policy == "wallet":
        payments.spend_credits(session, root, config.AI_CREDITS_PER_RUN, f"AI background: {prompt[:60]}")
    else:
        session.add(Transaction(org_id=root.id, kind="ai", credits=0, provider="free-quota", status="paid",
                                note=f"AI background: {prompt[:60]}"))
    session.commit()
    flash(request, f"AI background generated ({engine_used}).")
    return RedirectResponse(f"/admin/events/{ev.id}/design", status_code=303)


# ---------------------------------------------------------------- scanner / check-in
@router.get("/admin/scan")
def scan_page(request: Request, user: User = Depends(require_user), session: Session = Depends(get_session)):
    root = user_root(session, user)
    enabled = user.role == "super" or (root and plans.has_module(root, "attendance"))
    return render(request, "scan.html", user=user, enabled=enabled)


@router.post("/admin/checkin")
async def checkin(request: Request, user: User = Depends(require_user), session: Session = Depends(get_session)):
    body = await request.json()
    token = str(body.get("token", "")).strip().upper()
    reg = session.exec(select(Registration).where(Registration.token == token)).first()
    if not reg:
        return JSONResponse({"ok": False, "message": "Unknown pass"}, status_code=404)
    ev = session.get(Event, reg.event_id)
    root = org_access(session, user, session.get(Org, ev.org_id))
    if not plans.has_module(root, "attendance") and user.role != "super":
        return JSONResponse({"ok": False, "message": "QR attendance is not enabled for this organisation"}, status_code=403)
    already = reg.status == "present"
    if not already:
        reg.status, reg.checked_in_at = "present", datetime.utcnow()
        session.add(reg)
        session.commit()
    return JSONResponse({"ok": True, "already": already, "name": reg.name_en, "event": ev.title,
                         "approved": reg.approved, "mode": reg.attend_mode,
                         "message": "Already checked in" if already else "Welcome!"})


# ---------------------------------------------------------------- billing
@router.get("/admin/billing")
def billing(request: Request, org: int | None = None, country: str = "", user: User = Depends(require_admin),
            session: Session = Depends(get_session)):
    root = billing_root(session, user, org)
    country = (country or request.headers.get("cf-ipcountry") or request.headers.get("x-vercel-ip-country") or "IN").upper()
    cur = payments.currency_for(country)
    txns = session.exec(select(Transaction).where(Transaction.org_id == root.id).order_by(Transaction.id.desc()).limit(25)).all()
    return render(request, "billing.html", user=user, root=root, country=country, cur=cur, txns=txns,
                  gateway=payments.provider_for(cur), usd=config.USD_PER_INR, prices={k: plans.price_of(k, root) for k in plans.PLANS},
                  overage=plans.OVERAGE, ai_cost=config.AI_CREDITS_PER_RUN, orgs=None)


@router.post("/admin/billing/topup")
def topup(request: Request, amount: int = Form(...), org: int = Form(0), country: str = Form("IN"),
          user: User = Depends(require_admin), session: Session = Depends(get_session)):
    root = billing_root(session, user, org or None)
    if not 100 <= amount <= 200000:
        raise HTTPException(422, "Top-up must be between ₹100 and ₹2,00,000")
    txn = payments.create_order(session, root, kind="topup", amount_inr=amount, country=country)
    return RedirectResponse(f"/pay/{txn.id}", status_code=303)


@router.post("/admin/billing/plan")
def buy_plan(request: Request, plan: str = Form(...), coupon: str = Form(""), org: int = Form(0), country: str = Form("IN"),
             user: User = Depends(require_admin), session: Session = Depends(get_session)):
    root = billing_root(session, user, org or None)
    if plan not in plans.PLANS or plan == "free":
        raise HTTPException(422, "Choose a paid plan")
    if coupon and not payments.find_coupon(session, coupon):
        flash(request, "That coupon code is not valid.")
        return RedirectResponse("/admin/billing", status_code=303)
    txn = payments.create_order(session, root, kind="plan", amount_inr=plans.price_of(plan, root), country=country,
                                plan=plan, coupon_code=coupon)
    return RedirectResponse(f"/pay/{txn.id}", status_code=303)


def _txn_for(session: Session, user: User, txn_id: int) -> Transaction:
    txn = session.get(Transaction, txn_id)
    if not txn:
        raise HTTPException(404)
    org_access(session, user, session.get(Org, txn.org_id))
    return txn


@router.get("/pay/stripe/return")
def stripe_return(request: Request, txn: int, sid: str, user: User = Depends(require_admin),
                  session: Session = Depends(get_session)):
    t = _txn_for(session, user, txn)
    if t.provider == "stripe" and t.provider_ref == sid and payments.stripe_paid(sid):
        payments.fulfill(session, t)
        flash(request, "Payment received. Thank you!")
    else:
        flash(request, "Payment not completed.")
    return RedirectResponse("/admin/billing", status_code=303)


@router.get("/pay/{txn_id}")
def pay_page(request: Request, txn_id: int, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    t = _txn_for(session, user, txn_id)
    if t.status == "paid":
        return RedirectResponse("/admin/billing", status_code=303)
    if t.provider == "stripe" and t.note.startswith("http"):
        return RedirectResponse(t.note, status_code=303)
    return render(request, "pay.html", user=user, txn=t, key=config.RAZORPAY_KEY_ID, minor=int(round(t.amount * 100)))


@router.post("/pay/{txn_id}/mock")
def pay_mock(request: Request, txn_id: int, user: User = Depends(require_admin), session: Session = Depends(get_session)):
    t = _txn_for(session, user, txn_id)
    if t.provider != "mock":  # never allow self-certified payment on a live gateway
        raise HTTPException(403, "Test payments are disabled when a live gateway is configured")
    payments.fulfill(session, t)
    flash(request, "Test payment recorded. (Mock gateway — no money moved.)")
    return RedirectResponse("/admin/billing", status_code=303)


@router.post("/pay/{txn_id}/razorpay")
def pay_razorpay(request: Request, txn_id: int, razorpay_payment_id: str = Form(""), razorpay_order_id: str = Form(""),
                 razorpay_signature: str = Form(""), user: User = Depends(require_admin), session: Session = Depends(get_session)):
    t = _txn_for(session, user, txn_id)
    if t.provider == "razorpay" and razorpay_order_id == t.provider_ref and \
            payments.verify_razorpay(razorpay_order_id, razorpay_payment_id, razorpay_signature):
        payments.fulfill(session, t)
        flash(request, "Payment received. Thank you!")
    else:
        flash(request, "Payment verification failed.")
    return RedirectResponse("/admin/billing", status_code=303)


# ---------------------------------------------------------------- coupons / affiliates
@router.get("/admin/coupons")
def coupons(request: Request, user: User = Depends(require_super), session: Session = Depends(get_session)):
    rows = []
    for c in session.exec(select(Coupon).order_by(Coupon.id.desc())):
        owed = session.exec(select(func.coalesce(func.sum(Commission.amount_inr), 0)).where(Commission.coupon_code == c.code)).one()
        rows.append((c, owed))
    return render(request, "coupons.html", user=user, rows=rows)


@router.post("/admin/coupons")
def coupon_create(request: Request, code: str = Form(...), percent_off: int = Form(10), affiliate_name: str = Form(""),
                  commission_percent: int = Form(20), user: User = Depends(require_super),
                  session: Session = Depends(get_session)):
    code = re.sub(r"[^A-Z0-9]", "", code.upper())
    if not code or session.exec(select(Coupon).where(Coupon.code == code)).first():
        flash(request, "Code missing or already exists.")
    else:
        session.add(Coupon(code=code, percent_off=max(0, min(90, percent_off)), affiliate_name=affiliate_name,
                           commission_percent=max(0, min(50, commission_percent))))
        session.commit()
        flash(request, f"Coupon {code} created.")
    return RedirectResponse("/admin/coupons", status_code=303)


@router.post("/admin/coupons/{cid}/toggle")
def coupon_toggle(cid: int, user: User = Depends(require_super), session: Session = Depends(get_session)):
    c = session.get(Coupon, cid)
    if c:
        c.active = not c.active
        session.add(c)
        session.commit()
    return RedirectResponse("/admin/coupons", status_code=303)


_ = (HTMLResponse, json)
