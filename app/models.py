"""Relational model. Works on SQLite (dev) and PostgreSQL / Supabase (prod)."""
from datetime import datetime
from pydantic import NaiveDatetime
from typing import Any, Optional

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def now() -> datetime:
    return datetime.utcnow()


class Org(SQLModel, table=True):
    """Parent organisation (tenant root, parent_id is None) or one of its branches/campuses."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    parent_id: Optional[int] = Field(default=None, foreign_key="org.id", index=True)
    logo_path: str = ""
    # --- tenant-level settings (used on root orgs) ---
    plan: str = "free"
    modules_override: Optional[list] = Field(default=None, sa_column=Column(JSON))
    quota_override: Optional[int] = None
    price_override_inr: Optional[int] = None
    wallet: float = 0.0  # 1 credit = Rs 1
    api_key: str = ""
    referral_code: str = ""
    active: bool = True
    created_at: NaiveDatetime = Field(default_factory=now)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    role: str = "org_admin"  # super | org_admin | volunteer
    org_id: Optional[int] = Field(default=None, foreign_key="org.id")
    name: str = ""


class Event(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(foreign_key="org.id", index=True)  # branch (or root) hosting the event
    title: str
    title_hi: str = ""
    slug: str = Field(index=True, unique=True)
    description: str = ""
    mode: str = "offline"  # offline | online | hybrid
    venue: str = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    arrival_info: str = ""
    meeting_url: str = ""
    starts_at: Optional[NaiveDatetime] = None
    reg_open: bool = True
    # certificate config
    orientation: str = "landscape"  # landscape | portrait
    template: str = "classic"  # classic | modern | mangal | custom
    bg_path: str = ""
    accent: str = "#1e3a8a"
    cert_title: str = "Certificate of Participation"
    cert_body: str = "for actively participating in {event} held on {date}."
    signatory: str = ""
    signatory_role: str = ""
    layout: dict = Field(default_factory=dict, sa_column=Column(JSON))
    cohosts: list = Field(default_factory=list, sa_column=Column(JSON))  # [{name, logo}]
    sponsors: list = Field(default_factory=list, sa_column=Column(JSON))  # [{name, logo}]
    sponsor_label: str = "Supported By"
    gate_attendance: bool = False  # only "present" attendees get certificates
    feedback_gate: bool = True
    approval_required: bool = True
    created_at: NaiveDatetime = Field(default_factory=now)


class Registration(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: int = Field(foreign_key="event.id", index=True)
    name_en: str
    name_hi: str = ""
    parent_name: str = ""
    institution: str = ""
    grade: str = ""
    mobile: str = Field(index=True)
    email: str = ""
    attend_mode: str = "offline"  # offline | online
    token: str = Field(index=True, unique=True)
    status: str = "registered"  # registered | present
    approved: bool = False
    checked_in_at: Optional[NaiveDatetime] = None
    created_at: NaiveDatetime = Field(default_factory=now)


class Certificate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    cert_id: str = Field(index=True, unique=True)
    event_id: int = Field(foreign_key="event.id", index=True)
    registration_id: int = Field(foreign_key="registration.id", index=True)
    tenant_id: int = Field(foreign_key="org.id", index=True)  # root org that pays
    name: str
    mobile: str = Field(index=True)
    issued_at: NaiveDatetime = Field(default_factory=now)
    revoked: bool = False
    overage: bool = False


class Feedback(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    cert_id: str = Field(index=True)
    rating: int
    comment: str = ""
    created_at: NaiveDatetime = Field(default_factory=now)


class Transaction(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(foreign_key="org.id", index=True)
    kind: str  # topup | plan | ai | overage | commission
    amount: float = 0.0  # money charged, in `currency`
    currency: str = "INR"
    credits: float = 0.0  # +/- wallet delta
    provider: str = ""  # razorpay | stripe | mock | wallet
    provider_ref: str = ""
    plan: str = ""
    coupon: str = ""
    status: str = "created"  # created | paid | failed
    note: str = ""
    created_at: NaiveDatetime = Field(default_factory=now)


class Coupon(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    percent_off: int = 10
    affiliate_name: str = ""
    commission_percent: int = 20  # SRS: recurring 20-30 %
    uses: int = 0
    active: bool = True


class Commission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    coupon_code: str = Field(index=True)
    transaction_id: int
    amount_inr: float
    created_at: NaiveDatetime = Field(default_factory=now)


class MessageLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    channel: str  # sms | whatsapp
    to: str
    body: str
    status: str = "logged"
    created_at: NaiveDatetime = Field(default_factory=now)


JSONType = Any
