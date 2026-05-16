from fastapi import FastAPI
from routers.router import router as graph_router
from routers.auth_router import router as auth_router
from routers.assistance_router import router as assistance_router
from routers.user_router import router as user_router
from routers.chat_router import router as chat_router
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings

app = FastAPI()

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