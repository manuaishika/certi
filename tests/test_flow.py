import io
import re

from PIL import Image
from sqlmodel import Session, select

from app.db import engine
from app.models import Event, Org, Registration
from app.services import plans, registrations
from tests.conftest import login

FORM = dict(name_en="Test Student", name_hi="टेस्ट छात्र", institution="ABC School", grade="9",
            mobile="98765 11111", email="t@example.com", attend_mode="offline", parent_name="")


def test_public_pages(client):
    for path in ["/", "/claim", "/login", "/events/svabhasha-samman-2026", "/manifest.webmanifest", "/sw.js",
                 "/sitemap.xml", "/robots.txt", "/verify/CGM-NOPE"]:
        assert client.get(path).status_code == 200, path
    assert "Not found" in client.get("/verify/CGM-NOPE").text


def test_confirm_modal_validates(client):
    r = client.post("/events/svabhasha-samman-2026/confirm", data={**FORM, "mobile": "123"})
    assert "valid 10-digit" in r.text
    r = client.post("/events/svabhasha-samman-2026/confirm", data=FORM)
    assert "Test Student" in r.text and "9876511111" in r.text


def test_full_lifecycle(client):
    # register -> pass
    r = client.post("/events/svabhasha-samman-2026/register", data=FORM, follow_redirects=False)
    assert r.status_code == 303
    pass_url = r.headers["location"]
    token = pass_url.rsplit("/", 1)[1]
    assert client.get(pass_url).status_code == 200
    assert client.get(f"/qr/{token}.png").headers["content-type"] == "image/png"
    Image.open(io.BytesIO(client.get(f"{pass_url}/badge.png").content)).verify()

    # organiser flow
    login(client, "demo@cergema.local", "demo123")
    with Session(engine) as s:
        ev = s.exec(select(Event).where(Event.slug == "svabhasha-samman-2026")).one()
        eid = ev.id
    page = client.get(f"/admin/events/{eid}")
    assert page.status_code == 200 and "Test Student" in page.text
    client.post(f"/admin/events/{eid}/approve-all")
    # inline correction of a spelling mistake
    with Session(engine) as s:
        rid = s.exec(select(Registration).where(Registration.token == token)).one().id
    assert client.post(f"/admin/regs/{rid}/edit?field=name_en", data={"value": "Test Studentt"}).status_code == 204
    assert client.post(f"/admin/regs/{rid}/edit?field=name_en", data={"value": "Test Student"}).status_code == 204
    assert client.post(f"/admin/regs/{rid}/edit?field=mobile", data={"value": "12"}).status_code == 422
    client.post(f"/admin/events/{eid}/issue")

    # participant: claim by mobile -> feedback gate -> download
    r = client.post("/claim", data={"q": "9876511111"})
    cid = re.search(r"/certificate/(CGM-[A-Z0-9]{8})", r.text).group(1)
    assert client.get(f"/certificate/{cid}/download.pdf", follow_redirects=False).status_code == 303  # gated
    client.post(f"/certificate/{cid}/feedback", data={"rating": 5, "comment": "great"})
    pdf = client.get(f"/certificate/{cid}/download.pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    png = Image.open(io.BytesIO(client.get(f"/certificate/{cid}/download.png").content))
    assert png.size == (3508, 2480)
    assert "Authentic certificate" in client.get(f"/verify/{cid}").text
    assert client.get(f"/share/{cid}.png").status_code == 200

    # idempotent issuing
    client.post(f"/admin/events/{eid}/issue")
    assert len(re.findall(cid, client.post("/claim", data={"q": "9876511111"}).text)) >= 1


def test_portrait_and_layout(client):
    login(client, "demo@cergema.local", "demo123")
    with Session(engine) as s:
        eid = s.exec(select(Event)).first().id
    assert client.post(f"/admin/events/{eid}/style", data={"template": "modern", "accent": "#112233",
                                                          "orientation": "portrait"}).status_code in (200, 303)
    r = client.post(f"/admin/events/{eid}/layout", json={"name": {"x": 0.4, "y": 0.4, "size": 0.09}})
    assert r.json()["ok"]
    img = Image.open(io.BytesIO(client.get(f"/admin/events/{eid}/preview.png?dpi=60").content))
    assert img.height > img.width
    client.post(f"/admin/events/{eid}/style", data={"template": "mangal", "accent": "#0b5394", "orientation": "landscape"})


def test_ai_background_uses_free_quota_then_wallet(client):
    login(client, "demo@cergema.local", "demo123")
    with Session(engine) as s:
        eid = s.exec(select(Event)).first().id
        root = s.exec(select(Org).where(Org.parent_id == None)).first()  # noqa: E711
        before = root.wallet
    for _ in range(5):
        client.post(f"/admin/events/{eid}/ai-background", data={"prompt": "green eco leaves"})
    with Session(engine) as s:
        assert s.exec(select(Org).where(Org.parent_id == None)).first().wallet == before  # 5 free on Pro  # noqa: E711
    client.post(f"/admin/events/{eid}/ai-background", data={"prompt": "blue royal"})
    with Session(engine) as s:
        assert s.exec(select(Org).where(Org.parent_id == None)).first().wallet < before  # noqa: E711


def test_payment_mock_topup_and_coupon(client):
    login(client, "demo@cergema.local", "demo123")
    with Session(engine) as s:
        before = s.exec(select(Org).where(Org.parent_id == None)).first().wallet  # noqa: E711
    r = client.post("/admin/billing/topup", data={"amount": 500, "country": "IN"}, follow_redirects=False)
    pay = r.headers["location"]
    assert client.post(f"{pay}/mock", follow_redirects=False).status_code == 303
    with Session(engine) as s:
        assert s.exec(select(Org).where(Org.parent_id == None)).first().wallet == before + 500  # noqa: E711
    # double-fulfilment is idempotent
    client.post(f"{pay}/mock")
    with Session(engine) as s:
        assert s.exec(select(Org).where(Org.parent_id == None)).first().wallet == before + 500  # noqa: E711
    r = client.post("/admin/billing/plan", data={"plan": "event", "coupon": "PARTNER20", "country": "US"}, follow_redirects=False)
    assert r.status_code == 303


def test_tenant_isolation_and_roles(client):
    login(client, "admin@cergema.local", "admin123")
    client.post("/admin/orgs", data={"name": "Other School", "plan": "free", "admin_email": "o@x.com", "admin_password": "secret1"})
    client.get("/logout")
    login(client, "o@x.com", "secret1")
    with Session(engine) as s:
        eid = s.exec(select(Event)).first().id
    assert client.get(f"/admin/events/{eid}").status_code == 403  # someone else's event
    assert client.get("/admin/coupons").status_code == 403
    # free plan: no registration hub, no cobrand
    with Session(engine) as s:
        other = s.exec(select(Org).where(Org.name == "Other School")).one()
        assert plans.modules_of(other) == ["certificates"]
    client.get("/logout")


def test_api_key(client):
    with Session(engine) as s:
        root = s.exec(select(Org).where(Org.parent_id == None)).first()  # noqa: E711
        key = root.api_key
    h = {"X-API-Key": key}
    r = client.post("/api/v1/events/svabhasha-samman-2026/registrations", headers=h,
                    json=[{"name_en": "Api Kid", "mobile": "9123456780"}, {"name_en": "X", "mobile": "1"}])
    assert r.json()["created"] == 1 and len(r.json()["errors"]) == 1
    assert client.get("/api/v1/events/svabhasha-samman-2026/certificates", headers=h).status_code == 200
    assert client.get("/api/v1/events/svabhasha-samman-2026/certificates").status_code == 401


def test_attendance_scan_needs_module(client):
    login(client, "demo@cergema.local", "demo123")
    with Session(engine) as s:
        tok = s.exec(select(Registration)).first().token
    r = client.post("/admin/checkin", json={"token": tok})
    assert r.status_code == 403  # Pro plan has no Attendance module (per SRS tier table)
    login(client, "admin@cergema.local", "admin123")
    assert client.post("/admin/checkin", json={"token": tok}).json()["ok"]
    assert client.post("/admin/checkin", json={"token": tok}).json()["already"]


def test_quota_overage(client):
    """Free plan: 100/month cap, then overage debits wallet; blocked when wallet is empty."""
    from app.services.issuing import issue_certificates
    with Session(engine) as s:
        root = Org(name="Tiny", plan="free", quota_override=1, wallet=0.75)
        s.add(root); s.commit(); s.refresh(root)
        ev = Event(org_id=root.id, title="T", slug="tiny-ev", approval_required=False)
        s.add(ev); s.commit(); s.refresh(ev)
        regs = [registrations.create_registration(s, ev, dict(name_en=f"Kid {i}", mobile=f"98000000{i:02d}")) for i in range(3)]
        res = issue_certificates(s, ev, regs, root)
        assert res["issued"] == 2 and res["blocked"]  # 1 in quota + 1 paid overage, 3rd blocked
        s.refresh(root)
        assert root.wallet == 0


def test_attendance_gate_blocks_absent(client):
    from app.services.issuing import issue_certificates
    with Session(engine) as s:
        root = Org(name="Gate", plan="enterprise")
        s.add(root); s.commit(); s.refresh(root)
        ev = Event(org_id=root.id, title="G", slug="gate-ev", approval_required=False, gate_attendance=True)
        s.add(ev); s.commit(); s.refresh(ev)
        r1 = registrations.create_registration(s, ev, dict(name_en="Here", mobile="9800000001"))
        r2 = registrations.create_registration(s, ev, dict(name_en="Absent", mobile="9800000002"))
        r1.status = "present"; s.add(r1); s.commit()
        res = issue_certificates(s, ev, [r1, r2], root)
        assert res["issued"] == 1 and "not marked present" in res["skipped"][0]


def test_csv_import():
    rows = registrations.parse_upload("a.csv", "Name,Mobile,Grade\nA B,+91 98765 43210,7\n,,\nC,5,1\n".encode())
    assert len(rows) == 2 and registrations.normalize_mobile(rows[0]["mobile"]) == "9876543210"
