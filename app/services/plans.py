"""Plans, module entitlements, quotas (SRS section 7). Super Admin can override per tenant."""
from datetime import datetime

from sqlmodel import Session, func, select

from ..config import OVERAGE_INR
from ..models import Certificate, Org

ALL_MODULES = ["certificates", "registration", "lifecycle", "idpass", "attendance", "ai", "cobrand"]
MODULE_LABELS = {
    "certificates": "Certificate Engine", "registration": "Registration Hub",
    "lifecycle": "Event Lifecycle (online/hybrid)", "idpass": "Digital ID Pass",
    "attendance": "QR Attendance Gate", "ai": "AI Design Engine", "cobrand": "Co-hosts & Sponsors",
}

PLANS = {
    "free": dict(name="Free Community", price_inr=0, period="month", quota=100, branches=1,
                 watermark=True, modules=["certificates"], ai_free=0, scope="tenant"),
    "event": dict(name="Pay-Per-Event", price_inr=1199, period="event", quota=1000, branches=1,
                  watermark=False, modules=["certificates", "registration"], ai_free=0, scope="event"),
    "pro": dict(name="Institutional Pro", price_inr=9999, period="year", quota=15000, branches=3,
                watermark=False, modules=["certificates", "registration", "lifecycle", "cobrand"],
                ai_free=5, scope="tenant"),
    "enterprise": dict(name="Enterprise Custom", price_inr=24999, period="year", quota=None, branches=None,
                       watermark=False, modules=list(ALL_MODULES), ai_free=None, scope="tenant"),
}


def root_of(session: Session, org: Org) -> Org:
    return session.get(Org, org.parent_id) if org.parent_id else org


def plan_of(root: Org) -> dict:
    return PLANS.get(root.plan, PLANS["free"])


def modules_of(root: Org) -> list[str]:
    if root.modules_override is not None:
        return list(root.modules_override)
    return plan_of(root)["modules"]


def has_module(root: Org, module: str) -> bool:
    return module in modules_of(root)


def quota_of(root: Org) -> int | None:
    if root.quota_override is not None:
        return root.quota_override
    return plan_of(root)["quota"]


def price_of(root_or_plan: str, org: Org | None = None) -> int:
    if org is not None and org.plan == root_or_plan and org.price_override_inr is not None:
        return org.price_override_inr
    return PLANS[root_or_plan]["price_inr"]


def _period_start(period: str) -> datetime | None:
    n = datetime.utcnow()
    if period == "month":
        return datetime(n.year, n.month, 1)
    if period == "year":
        return datetime(n.year, 1, 1)
    return None


def issued_in_period(session: Session, root: Org, event_id: int | None = None) -> int:
    plan = plan_of(root)
    q = select(func.count(Certificate.id)).where(Certificate.tenant_id == root.id,
                                                 Certificate.revoked == False)  # noqa: E712
    if plan["scope"] == "event" and event_id:
        q = q.where(Certificate.event_id == event_id)
    else:
        start = _period_start(plan["period"])
        if start:
            q = q.where(Certificate.issued_at >= start)
    return session.exec(q).one()


def remaining_quota(session: Session, root: Org, event_id: int | None = None) -> int | None:
    quota = quota_of(root)
    if quota is None:
        return None
    return max(0, quota - issued_in_period(session, root, event_id))


def branch_count(session: Session, root: Org) -> int:
    return session.exec(select(func.count(Org.id)).where(Org.parent_id == root.id)).one()


def branch_allowance(root: Org) -> int | None:
    return plan_of(root)["branches"]


OVERAGE = OVERAGE_INR
