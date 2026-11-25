import logging
from fastapi import FastAPI
from routers.router import router as graph_router
from routers.auth_router import router as auth_router
from routers.assistance_router import router as assistance_router
from routers.user_router import router as user_router
from routers.chat_router import router as chat_router
from routers.validation_router import router as validation_router
from routers.history_router import router as history_router
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings

app = FastAPI(root_path=settings.API_ROOT_PATH)

if not settings.CORS_ORIGINS:
    # Fine for local development, but in production CORS_ORIGINS must list the frontend origin(s)
    logging.getLogger("uvicorn.error").warning(
        "CORS_ORIGINS is not set: allowing requests from ANY origin. "
        "Set CORS_ORIGINS in backend/.env for production (e.g. https://vsr.informatik.tu-chemnitz.de)."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graph_router)
app.include_router(auth_router)
app.include_router(assistance_router)
app.include_router(user_router)
app.include_router(chat_router)
app.include_router(validation_router)
app.include_router(history_router)

@app.on_event("startup")
def _read_kiste_model_list():
    # Reads GET <KISTE_BASE_URL>/v1/models once and prints the ids; the dropdown offers only models that are there
    from services.model_catalog import refresh_kiste_models
    refresh_kiste_models()
