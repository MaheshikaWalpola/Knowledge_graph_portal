import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    GRAPHDB_BASE_URL   = os.getenv("GRAPHDB_BASE_URL")
    GRAPHDB_REPOSITORY = os.getenv("GRAPHDB_REPOSITORY")

    CMP_NS          = os.getenv("CMP_NS")
    CMP_INSTANCE_NS = os.getenv("CMP_INSTANCE_NS")

    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

    BASE_SCHEMA_GRAPH = os.getenv("BASE_SCHEMA_GRAPH")
    BASE_INSTANCE_GRAPH = os.getenv("BASE_INSTANCE_GRAPH")

    # ---- NEW: MongoDB
    MONGODB_URI = os.getenv("MONGODB_URI")
    MONGODB_DB  = os.getenv("MONGODB_DB")

    # ---- NEW: JWT
    JWT_SECRET    = os.getenv("JWT_SECRET")
    JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

    # ---- NEW: Email
    FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173")
    SMTP_USER   = os.getenv("SMTP_USER")
    SMTP_PASS   = os.getenv("SMTP_PASS")
    MAIL_FROM   = os.getenv("MAIL_FROM", SMTP_USER)
    MAIL_PORT   = int(os.getenv("MAIL_PORT", "587"))
    MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.gmail.com")

    # ---- OPENAI
    OPEN_API_KEY = os.getenv("OPEN_API_KEY")

settings = Settings()
