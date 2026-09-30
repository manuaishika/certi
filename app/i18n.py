"""Tiny dictionary-based i18n (en / hi). Add a language by adding a column."""
STRINGS = {
    "tagline": {"en": "Smart Events, Instant Certificates", "hi": "स्मार्ट इवेंट, तुरंत प्रमाणपत्र"},
    "claim": {"en": "Get my certificate", "hi": "मेरा प्रमाणपत्र प्राप्त करें"},
    "verify": {"en": "Verify a certificate", "hi": "प्रमाणपत्र सत्यापित करें"},
    "register": {"en": "Register", "hi": "पंजीकरण करें"},
    "name_en": {"en": "Full name (English)", "hi": "पूरा नाम (अंग्रेज़ी)"},
    "name_hi": {"en": "Full name (Devanagari / हिंदी)", "hi": "पूरा नाम (हिंदी)"},
    "institution": {"en": "Institution", "hi": "संस्था"},
    "grade": {"en": "Grade / Class", "hi": "कक्षा"},
    "mobile": {"en": "Mobile number", "hi": "मोबाइल नंबर"},
    "email": {"en": "Email", "hi": "ईमेल"},
    "mode": {"en": "How will you attend?", "hi": "आप कैसे शामिल होंगे?"},
    "in_person": {"en": "In person", "hi": "प्रत्यक्ष"},
    "online": {"en": "Online", "hi": "ऑनलाइन"},
    "confirm": {"en": "Please confirm your details", "hi": "कृपया अपना विवरण जाँचें"},
    "confirm_hint": {"en": "Names are printed exactly as shown. Fix any spelling now.",
                     "hi": "नाम ठीक वैसे ही छपेंगे जैसे दिखाए गए हैं। वर्तनी अभी सुधारें।"},
    "edit": {"en": "Edit", "hi": "सुधारें"},
    "submit": {"en": "Confirm & register", "hi": "पुष्टि करें और पंजीकरण करें"},
    "lookup_hint": {"en": "Enter your registered mobile number or certificate ID",
                    "hi": "अपना पंजीकृत मोबाइल नंबर या प्रमाणपत्र आईडी दर्ज करें"},
    "download": {"en": "Download", "hi": "डाउनलोड"},
    "powered": {"en": "Powered by CerGeMA", "hi": "CerGeMA द्वारा संचालित"},
}


def translate(key: str, lang: str = "en") -> str:
    row = STRINGS.get(key)
    if not row:
        return key
    return row.get(lang) or row["en"]
