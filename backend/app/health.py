from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.database import check_database


router = APIRouter()


@router.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "citylens-api"}


@router.get("/ready", tags=["system"])
def readiness() -> JSONResponse:
    if check_database():
        return JSONResponse(
            status_code=200,
            content={"status": "ready", "database": "connected"},
        )
    return JSONResponse(
        status_code=503,
        content={"status": "not_ready", "database": "unavailable"},
    )