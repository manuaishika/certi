"""SMS / WhatsApp dispatch via Twilio. Without credentials messages are only logged (dev mode)."""
import httpx
from sqlmodel import Session

from ..config import TWILIO_SID, TWILIO_SMS_FROM, TWILIO_TOKEN, TWILIO_WA_FROM
from ..models import MessageLog


def send(session: Session, channel: str, mobile: str, body: str) -> None:
    to = f"+91{mobile}" if not mobile.startswith("+") else mobile
    status = "logged"
    if TWILIO_SID and TWILIO_TOKEN:
        sender = TWILIO_WA_FROM if channel == "whatsapp" else TWILIO_SMS_FROM
        dest = f"whatsapp:{to}" if channel == "whatsapp" else to
        sender = f"whatsapp:{sender}" if channel == "whatsapp" and not sender.startswith("whatsapp:") else sender
        try:
            r = httpx.post(f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
                           auth=(TWILIO_SID, TWILIO_TOKEN), data={"To": dest, "From": sender, "Body": body}, timeout=15)
            status = "sent" if r.status_code < 300 else f"failed:{r.status_code}"
        except Exception as e:  # never block the user flow on messaging
            status = f"failed:{type(e).__name__}"
    session.add(MessageLog(channel=channel, to=to, body=body, status=status))
    session.commit()
