import hashlib
import hmac
import secrets

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from .config import SECRET_KEY
from .db import get_session
from .models import User


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(hash_password(password, salt), stored)


def sign(value: str, n: int = 10) -> str:
    """Short HMAC used to make verification URLs tamper-evident."""
    return hmac.new(SECRET_KEY.encode(), value.encode(), hashlib.sha256).hexdigest()[:n]


def new_token(prefix: str = "", n: int = 10) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return prefix + "".join(secrets.choice(alphabet) for _ in range(n))


def current_user(request: Request, session: Session = Depends(get_session)) -> User | None:
    uid = request.session.get("uid")
    return session.get(User, uid) if uid else None


def require_user(user: User | None = Depends(current_user)) -> User:
    if not user:
        raise HTTPException(status_code=303, headers={"Location": "/login"})
    return user


def require_super(user: User = Depends(require_user)) -> User:
    if user.role != "super":
        raise HTTPException(status_code=403, detail="Super Admin only")
    return user
