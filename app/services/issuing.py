"""Certificate issuance: approval + attendance gating, quota and overage billing."""
from sqlmodel import Session, select

from ..config import BASE_URL
from ..models import Certificate, Event, Org, Registration, Transaction
from ..security import new_token, sign
from . import plans
from .render import CertData


def verify_url(cert_id: str) -> str:
    return f"{BASE_URL}/verify/{cert_id}?s={sign(cert_id)}"


def eligible(event: Event, reg: Registration) -> str | None:
    """Return a reason string when a registration can't get a certificate, else None."""
    if event.approval_required and not reg.approved:
        return "not approved"
    if event.gate_attendance and reg.status != "present":
        return "not marked present"
    return None


def issue_certificates(session: Session, event: Event, regs: list[Registration], root: Org) -> dict:
    if not plans.has_module(root, "certificates"):
        return dict(issued=0, skipped=[], blocked="Certificate module is disabled for this organisation.")
    existing = {c.registration_id for c in session.exec(
        select(Certificate).where(Certificate.event_id == event.id, Certificate.revoked == False))}  # noqa: E712
    remaining = plans.remaining_quota(session, root, event.id)
    issued, skipped, overage_cost, blocked = 0, [], 0.0, ""
    for reg in regs:
        if reg.id in existing:
            continue
        why = eligible(event, reg)
        if why:
            skipped.append(f"{reg.name_en}: {why}")
            continue
        is_over = remaining is not None and remaining <= 0
        if is_over:
            if root.wallet < plans.OVERAGE:
                blocked = (f"Quota reached and wallet balance is too low for overage "
                           f"(₹{plans.OVERAGE:.2f} per certificate). Top up the wallet or upgrade the plan.")
                break
            root.wallet -= plans.OVERAGE
            overage_cost += plans.OVERAGE
        elif remaining is not None:
            remaining -= 1
        session.add(Certificate(cert_id=new_token("CGM-", 8), event_id=event.id, registration_id=reg.id,
                                tenant_id=root.id, name=reg.name_en, mobile=reg.mobile, overage=is_over))
        issued += 1
    if overage_cost:
        session.add(Transaction(org_id=root.id, kind="overage", amount=overage_cost, credits=-overage_cost,
                                provider="wallet", status="paid", note=f"Overage for event {event.title}"))
        session.add(root)
    session.commit()
    return dict(issued=issued, skipped=skipped, blocked=blocked, overage_cost=overage_cost)


def cert_data(cert: Certificate, reg: Registration) -> CertData:
    return CertData(name_en=reg.name_en, name_hi=reg.name_hi, grade=reg.grade, institution=reg.institution,
                    cert_id=cert.cert_id, issued=cert.issued_at, verify_url=verify_url(cert.cert_id))
