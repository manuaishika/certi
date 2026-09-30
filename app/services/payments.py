"""Payments: Razorpay (India/UPI) and Stripe (international). Falls back to a mock gateway in dev."""
import hashlib
import hmac
import math

import httpx
from sqlmodel import Session, select

from ..config import (BASE_URL, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, STRIPE_SECRET_KEY, USD_PER_INR)
from ..models import Commission, Coupon, Org, Transaction
from . import plans


def currency_for(country: str | None) -> str:
    return "INR" if (country or "IN").upper() == "IN" else "USD"


def to_minor(amount_inr: float, currency: str) -> tuple[float, int]:
    if currency == "USD":
        usd = math.ceil(amount_inr * USD_PER_INR * 100) / 100
        return usd, int(round(usd * 100))
    return amount_inr, int(round(amount_inr * 100))


def provider_for(currency: str) -> str:
    if currency == "INR":
        return "razorpay" if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET else "mock"
    return "stripe" if STRIPE_SECRET_KEY else "mock"


def find_coupon(session: Session, code: str | None) -> Coupon | None:
    if not code:
        return None
    return session.exec(select(Coupon).where(Coupon.code == code.strip().upper(), Coupon.active == True)).first()  # noqa: E712


def create_order(session: Session, root: Org, *, kind: str, amount_inr: float, country: str | None,
                 plan: str = "", coupon_code: str = "") -> Transaction:
    coupon = find_coupon(session, coupon_code) if kind == "plan" else None
    if coupon:
        amount_inr = round(amount_inr * (100 - coupon.percent_off) / 100, 2)
    currency = currency_for(country)
    amount, minor = to_minor(amount_inr, currency)
    provider = provider_for(currency)
    txn = Transaction(org_id=root.id, kind=kind, amount=amount, currency=currency, provider=provider,
                      plan=plan, coupon=coupon.code if coupon else "",
                      credits=amount_inr if kind == "topup" else 0, status="created")
    session.add(txn)
    session.commit()
    session.refresh(txn)
    if provider == "razorpay":
        r = httpx.post("https://api.razorpay.com/v1/orders", auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET), timeout=30,
                       json={"amount": minor, "currency": "INR", "receipt": f"txn{txn.id}"})
        r.raise_for_status()
        txn.provider_ref = r.json()["id"]
    elif provider == "stripe":
        r = httpx.post("https://api.stripe.com/v1/checkout/sessions", auth=(STRIPE_SECRET_KEY, ""), timeout=30, data={
            "mode": "payment", "success_url": f"{BASE_URL}/pay/stripe/return?txn={txn.id}&sid={{CHECKOUT_SESSION_ID}}",
            "cancel_url": f"{BASE_URL}/admin/billing", "line_items[0][quantity]": 1,
            "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": minor,
            "line_items[0][price_data][product_data][name]": f"CerGeMA {kind} {plan}".strip(),
            "client_reference_id": str(txn.id)})
        r.raise_for_status()
        txn.provider_ref = r.json()["id"]
        txn.note = r.json()["url"]
    session.add(txn)
    session.commit()
    return txn


def verify_razorpay(order_id: str, payment_id: str, signature: str) -> bool:
    expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def stripe_paid(session_id: str) -> bool:
    r = httpx.get(f"https://api.stripe.com/v1/checkout/sessions/{session_id}", auth=(STRIPE_SECRET_KEY, ""), timeout=30)
    return r.status_code == 200 and r.json().get("payment_status") == "paid"


def fulfill(session: Session, txn: Transaction) -> Transaction:
    """Idempotently mark a transaction paid and apply its effect (credits / plan / commission)."""
    if txn.status == "paid":
        return txn
    txn.status = "paid"
    root = session.get(Org, txn.org_id)
    if txn.kind == "topup":
        root.wallet += txn.credits
    elif txn.kind == "plan" and txn.plan in plans.PLANS:
        root.plan = txn.plan
    session.add_all([txn, root])
    if txn.coupon:
        coupon = find_coupon(session, txn.coupon)
        if coupon:
            coupon.uses += 1
            inr = txn.amount if txn.currency == "INR" else txn.amount / USD_PER_INR
            session.add(Commission(coupon_code=coupon.code, transaction_id=txn.id,
                                   amount_inr=round(inr * coupon.commission_percent / 100, 2)))
            session.add(coupon)
    session.commit()
    return txn


def spend_credits(session: Session, root: Org, credits: float, note: str, kind: str = "ai") -> bool:
    if root.wallet < credits:
        return False
    root.wallet -= credits
    session.add(root)
    session.add(Transaction(org_id=root.id, kind=kind, credits=-credits, provider="wallet", status="paid", note=note))
    session.commit()
    return True
