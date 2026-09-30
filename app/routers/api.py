"""REST API for School ERP / SIS integrations (API-key auth) and payment webhooks."""
import hashlib
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlmodel import Session, select

from .. import config
from ..db import get_session
from ..models import Certificate, Event, Org, Registration, Transaction
from ..services import issuing, payments, plans, registrations

router = APIRouter(prefix="/api")


def tenant_by_key(session: Session, key: str | None) -> Org:
    if not key:
        raise HTTPException(401, "Missing X-API-Key")
    root = session.exec(select(Org).where(Org.api_key == key, Org.parent_id == None)).first()  # noqa: E711
    if not root or not root.active:
        raise HTTPException(401, "Invalid API key")
    return root


def event_of(session: Session, root: Org, slug: str) -> Event:
    ev = session.exec(select(Event).where(Event.slug == slug)).first()
    if not ev or plans.root_of(session, session.get(Org, ev.org_id)).id != root.id:
        raise HTTPException(404, "Event not found")
    return ev


@router.get("/v1/events/{slug}/registrations")
def list_registrations(slug: str, x_api_key: str | None = Header(None), session: Session = Depends(get_session)):
    ev = event_of(session, tenant_by_key(session, x_api_key), slug)
    rows = session.exec(select(Registration).where(Registration.event_id == ev.id)).all()
    return [dict(id=r.id, name_en=r.name_en, name_hi=r.name_hi, mobile=r.mobile, institution=r.institution,
                 grade=r.grade, approved=r.approved, status=r.status, pass_token=r.token) for r in rows]


@router.post("/v1/events/{slug}/registrations")
async def push_registrations(slug: str, request: Request, x_api_key: str | None = Header(None),
                             session: Session = Depends(get_session)):
    """Push one object or a list of objects (name_en, name_hi, mobile, institution, grade, email, parent_name)."""
    ev = event_of(session, tenant_by_key(session, x_api_key), slug)
    body = await request.json()
    rows = body if isinstance(body, list) else [body]
    created, errors = registrations.bulk_import(session, ev, rows)
    return {"created": created, "errors": errors}


@router.get("/v1/events/{slug}/certificates")
def list_certificates(slug: str, x_api_key: str | None = Header(None), session: Session = Depends(get_session)):
    ev = event_of(session, tenant_by_key(session, x_api_key), slug)
    rows = session.exec(select(Certificate).where(Certificate.event_id == ev.id)).all()
    return [dict(certificate_id=c.cert_id, name=c.name, mobile=c.mobile, issued_at=c.issued_at.isoformat(),
                 revoked=c.revoked, verify_url=issuing.verify_url(c.cert_id),
                 pdf_url=f"{config.BASE_URL}/certificate/{c.cert_id}") for c in rows]


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, x_razorpay_signature: str = Header(""),
                           session: Session = Depends(get_session)):
    """Server-to-server confirmation so payments complete even if the browser never returns."""
    secret = config.RAZORPAY_WEBHOOK_SECRET
    raw = await request.body()
    if not secret or not hmac.compare_digest(hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest(), x_razorpay_signature):
        raise HTTPException(400, "Bad signature")
    data = await request.json()
    if data.get("event") in ("payment.captured", "order.paid"):
        ent = data["payload"].get("payment", {}).get("entity", {})
        txn = session.exec(select(Transaction).where(Transaction.provider_ref == ent.get("order_id"))).first()
        if txn:
            payments.fulfill(session, txn)
    return {"ok": True}
