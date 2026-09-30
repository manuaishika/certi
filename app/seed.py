"""First-run bootstrap: Super Admin, plus demo tenant so the app is explorable immediately."""
from datetime import datetime, timedelta

from sqlmodel import Session, select

from .config import ADMIN_EMAIL, ADMIN_PASSWORD, SEED_DEMO
from .models import Coupon, Event, Org, User
from .security import hash_password, new_token
from .services.registrations import create_registration


def seed(session: Session) -> None:
    if session.exec(select(User)).first():
        return
    session.add(User(email=ADMIN_EMAIL, password_hash=hash_password(ADMIN_PASSWORD), role="super", name="Super Admin"))
    if SEED_DEMO:
        root = Org(name="Mangal Hands Demo Schools", plan="pro", wallet=200, api_key=new_token("K", 24))
        session.add(root)
        session.commit()
        session.refresh(root)
        branch = Org(name="Sindhi Girls College Campus", parent_id=root.id)
        session.add(branch)
        session.add(User(email="demo@cergema.local", password_hash=hash_password("demo123"), role="org_admin",
                         org_id=root.id, name="Demo Admin"))
        session.add(Coupon(code="PARTNER20", percent_off=10, affiliate_name="Demo Consultant", commission_percent=25))
        session.commit()
        session.refresh(branch)
        ev = Event(org_id=branch.id, title="Svabhasha Samman 2026", title_hi="स्वभाषा सम्मान 2026",
                   slug="svabhasha-samman-2026", mode="hybrid", template="mangal", accent="#0b5394",
                   description="A native-language recognition drive celebrating Hindi, Sindhi and regional scripts.",
                   venue="Sindhi Girls College Auditorium", meeting_url="https://meet.google.com/demo-link",
                   starts_at=datetime.utcnow() + timedelta(days=14), signatory="Dr. A. Sharma",
                   signatory_role="Campaign Director", cert_title="Certificate of Appreciation",
                   cohosts=[{"name": "Mangalman Campaign", "logo": ""}],
                   sponsors=[{"name": "Community CSR Partner", "logo": ""}])
        session.add(ev)
        session.commit()
        session.refresh(ev)
        for n, hi, g, m in [("Aarav Sharma", "आरव शर्मा", "8", "9876543210"),
                            ("Priya Lalwani", "प्रिया लालवानी", "10", "9876501234")]:
            create_registration(session, ev, dict(name_en=n, name_hi=hi, grade=g, mobile=m,
                                                  institution="Demo Public School"), approved=True)
    session.commit()
