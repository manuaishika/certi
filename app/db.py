from sqlmodel import Session, SQLModel, create_engine

from .config import DATABASE_URL

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
_url = DATABASE_URL
if _url.startswith("postgres://"):
    _url = _url.replace("postgres://", "postgresql+psycopg://", 1)
elif _url.startswith("postgresql://"):
    _url = _url.replace("postgresql://", "postgresql+psycopg://", 1)
engine = create_engine(_url, connect_args=_connect_args, pool_pre_ping=True)


def init_db() -> None:
    from . import models  # noqa: F401  (register tables)
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
