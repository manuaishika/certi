from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session
from starlette.middleware.sessions import SessionMiddleware

from . import config
from .db import engine, init_db
from .routers import admin, api, public
from .seed import seed
from .web import ensure_icons, render


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    ensure_icons()
    with Session(engine) as s:
        seed(s)
    yield


app = FastAPI(title=f"{config.APP_NAME} — {config.TAGLINE}", lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=config.SECRET_KEY, same_site="lax",
                   https_only=config.BASE_URL.startswith("https"), max_age=60 * 60 * 12)
app.mount("/static", StaticFiles(directory=str(config.BASE_DIR / "static")), name="static")
app.mount("/uploads", StaticFiles(directory=str(config.UPLOAD_DIR)), name="uploads")
app.include_router(public.router)
app.include_router(admin.router)
app.include_router(api.router)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    if exc.status_code == 303 and exc.headers and "Location" in exc.headers:
        return RedirectResponse(exc.headers["Location"], status_code=303)
    if request.headers.get("hx-request") or request.url.path.startswith("/api/"):
        from fastapi.responses import JSONResponse, PlainTextResponse
        if request.url.path.startswith("/api/"):
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        return PlainTextResponse(str(exc.detail), status_code=exc.status_code)
    return render(request, "error.html", status_code=exc.status_code, code=exc.status_code, detail=exc.detail)
