import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from app.auth import router as auth_router
from app.health import router as health_router
from app.operations import router as operations_router
from app.residents import router as residents_router
from app.settings import settings
from app.video_detection import router as video_detection_router


logger = logging.getLogger(__name__)
settings.validate_frontend_origins()
app = FastAPI(title="CityLens AI API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.trusted_frontend_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)
app.include_router(health_router)
app.include_router(health_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(operations_router, prefix="/api")
app.include_router(operations_router, prefix="/api/v1")
app.include_router(video_detection_router, prefix="/api")
app.include_router(video_detection_router, prefix="/api/v1")
app.include_router(residents_router, prefix="/api")
app.include_router(residents_router, prefix="/api/v1")


@app.exception_handler(Exception)
async def handle_unexpected_error(_: Request, error: Exception) -> JSONResponse:
    logger.error("Unhandled application error (%s).", type(error).__name__)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected server error occurred."},
    )