"""Safe image upload handling: decode with Pillow, cap size, re-encode as PNG."""
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image

from ..config import UPLOAD_DIR

MAX_BYTES = 8 * 1024 * 1024


async def save_upload(file: UploadFile | None, max_side: int = 3600) -> str:
    """Return stored filename (relative to UPLOAD_DIR) or '' when nothing uploaded."""
    if not file or not file.filename:
        return ""
    data = await file.read()
    if not data:
        return ""
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image too large (max 8 MB)")
    try:
        img = Image.open(__import__("io").BytesIO(data))
        img.load()
    except Exception:
        raise HTTPException(400, "Not a valid image file")
    img = img.convert("RGBA")
    img.thumbnail((max_side, max_side))
    name = f"{uuid.uuid4().hex}.png"
    img.save(UPLOAD_DIR / name, "PNG")
    return name


def load_upload(name: str) -> Image.Image | None:
    if not name:
        return None
    path = Path(UPLOAD_DIR / Path(name).name)  # strip any path components
    if not path.exists():
        return None
    return Image.open(path).convert("RGBA")
