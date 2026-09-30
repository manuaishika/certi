"""Central configuration (12-factor: everything comes from environment variables)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT_DIR / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# SQLite by default; set DATABASE_URL to a Postgres URL (e.g. Supabase) for production.
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'cergema.db'}")
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000").rstrip("/")

APP_NAME = "CerGeMA"
TAGLINE = "Smart Events, Instant Certificates"

# Bootstrap Super Admin (created on first start if no users exist)
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@cergema.local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
SEED_DEMO = os.getenv("SEED_DEMO", "1") == "1"

# Payments (mock mode is used automatically when keys are absent)
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
STRIPE_SECRET_KEY =os.getenv("STRIPE_SECRET_KEY", "")
USD_PER_INR = float(os.getenv("USD_PER_INR", "0.012"))

# AI background engine
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")  # Imagen via Gemini API
AI_CREDITS_PER_RUN = int(os.getenv("AI_CREDITS_PER_RUN", "12"))  # SRS: 10-15 credits

# Messaging (SMS / WhatsApp via Twilio; logged only when unset)
TWILIO_SID = os.getenv("TWILIO_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_TOKEN", "")
TWILIO_SMS_FROM = os.getenv("TWILIO_SMS_FROM", "")
TWILIO_WA_FROM = os.getenv("TWILIO_WA_FROM", "")

# Co-branding capacity (SRS stakeholder question #3: 1 primary + 1 co-host + 2 sponsors)
MAX_COHOSTS = int(os.getenv("MAX_COHOSTS", "1"))
MAX_SPONSORS = int(os.getenv("MAX_SPONSORS", "2"))

OVERAGE_INR = float(os.getenv("OVERAGE_INR", "0.75"))  # SRS: Rs 0.50 - 1.00 per extra cert
ANDROID_PACKAGE = os.getenv("ANDROID_PACKAGE", "com.mangalhands.cergema")
ANDROID_SHA256 = os.getenv("ANDROID_SHA256", "")  # for /.well-known/assetlinks.json (TWA)
